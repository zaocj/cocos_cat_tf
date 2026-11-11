import { expect, test } from 'vitest';
import { MvpSession, PetState, PATH_LENGTH, pointOnPath, RunSnapshot } from '../assets/scripts/domain/MvpSession.ts';
import { mutationChoices, mutationCards, PET_GROWTH } from '../assets/scripts/domain/PetGrowth.ts';
import { recordMutationProgress } from '../assets/scripts/domain/FirstGuide.ts';
import { RunArchive, SAVE_KEYS } from '../assets/scripts/infrastructure/RunArchive.ts';
import { playRandomExpedition, Build } from './support/RandomExpedition.ts';

function prepare(depth = 0, seed = 3, chance = 0): MvpSession {
    const game = new MvpSession(seed, { mutationChance: chance });
    for (let i = 0; i <= depth; i++) {
        const node = game.available.find(n => n.kind === 'battle') ?? game.available[0];
        if (!node || !game.chooseNode(node.id)) throw new Error('Missing route node');
        if (i !== depth) { game.phase = 'won'; game.continueRoute(); }
    }
    return game;
}
function cat(game: MvpSession, star: 2 | 3 = 2): PetState {
    const a = game.summonPet('cat', 0); const b = game.summonPet('cat', 2);
    if (!a.ok || !b.ok) throw new Error('Could not summon fixture cats');
    const merged = game.mergePets(b.pet.id, a.pet.id);
    if (!merged.ok) throw new Error('Could not merge fixture cats');
    if (game.pendingMutation) game.chooseMutation(game.pendingMutation.choices[0]);
    // Three-star fixtures test the command independently of acquisition; campaign tests use normal income.
    if (star === 3) Object.assign(merged.pet, { star: 3, purchaseCost: 120 });
    return merged.pet;
}
function lastEnemy(game: MvpSession, travel: number, hp = 1): void {
    if (!game.current) throw new Error('Missing encounter');
    game.spawned = game.current.count;
    game.enemies = [{ id: 1000, kind: 'mist', distance: travel, ...pointOnPath(travel), hp, maxHp: hp, lastDamageTick: 0 }];
}

test('first cat choices cover all three pairs uniformly conditional on a 50 percent trigger', () => {
    const counts = new Map<string, number>(); let triggered = 0;
    for (let seed = 0; seed < 3000; seed++) {
        const game = prepare(0, seed, 0.5); cat(game);
        // cat() resolves the fixture choice; reconstruct from the committed random state for a second session.
        const other = prepare(0, seed, 0.5);
        const a = other.summonPet('cat', 0); const b = other.summonPet('cat', 2);
        if (!a.ok || !b.ok) throw new Error('Missing cats');
        other.mergePets(b.pet.id, a.pet.id);
        if (!other.pendingMutation) continue;
        triggered++;
        const pair = other.pendingMutation.choices.join(','); counts.set(pair, (counts.get(pair) ?? 0) + 1);
        expect(other.mutationRngState).toBe(game.mutationRngState);
    }
    expect(triggered).toBeGreaterThan(1350); expect(triggered).toBeLessThan(1650);
    expect(counts.size).toBe(3);
    for (const count of counts.values()) { expect(count).toBeGreaterThan(400); expect(count).toBeLessThan(600); }
});

test('existing form is always selectable, alternatives are different and species-safe', () => {
    for (const roll of [0, 0.2, 0.6, 0.999999]) {
        const choices = mutationChoices('cat', ['longarm'], roll, 0);
        expect(choices[0]).toBe('longarm'); expect(choices).toHaveLength(2);
        expect(choices[1]).not.toBe('longarm'); expect(Object.isFrozen(choices)).toBe(true);
        const rabbit = mutationChoices('rabbit', ['power'], roll, 0); expect(rabbit[0]).toBe('power'); expect(rabbit[1]).not.toBe('power');
    }
});

test('checkpoint rewards are once per completed third and sixth station, with exact restoration', () => {
    const game = prepare(2); expect(game.mutationCredits).toBe(0);
    game.startBattle(); lastEnemy(game, PATH_LENGTH - 1, 100); game.step();
    expect(game.phase).toBe('won'); expect(game.heart).toBe(2); expect(game.kills).toBe(0);
    expect(game.mutationCredits).toBe(1); expect(game.mutationRewardDepths).toEqual([2]);
    const restored = MvpSession.restore(game.snapshot());
    expect(restored.continueRoute()).toBe(true); expect(restored.continueRoute()).toBe(false);
    expect(restored.mutationCredits).toBe(1);
    const sixth = prepare(5); expect(sixth.mutationCredits).toBe(1);
    sixth.phase = 'won'; sixth.continueRoute(); expect(sixth.mutationCredits).toBe(2);
    expect(MvpSession.restore(sixth.snapshot()).mutationCredits).toBe(2);
    expect(new MvpSession(game.seed).mutationCredits).toBe(0);
});

test('lethal checkpoint escape grants nothing and failure takes priority', () => {
    const game = prepare(2); game.heart = 1; game.startBattle(); lastEnemy(game, PATH_LENGTH - 1, 100); game.step();
    expect(game.phase).toBe('lost'); expect(game.mutationCredits).toBe(0); expect(game.continueRoute()).toBe(false);
});

test('active metamorphosis is atomic for reserve three-stars and never changes investment, timing or money', () => {
    const game = prepare(4); const pet = cat(game, 3); pet.mutations = ['power', 'resonance']; pet.slot = null;
    pet.cooldown = 0.7; pet.attackCount = 2; pet.readyTick = 60;
    const before = game.snapshot(); const rng = game.mutationRngState; const summonRng = game.summonRngState;
    for (let i = 0; i < 5; i++) expect(game.metamorphosisError(pet.id)).toBeNull();
    expect(game.snapshot()).toEqual(before);
    expect(game.beginMetamorphosis(pet.id).ok).toBe(true); expect(game.mutationCredits).toBe(0);
    expect(game.pendingMutation).toMatchObject({ source: 'metamorphosis', resumePhase: 'prepare', choices: ['longarm'] });
    expect(game.mutationRngState).toBe((rng + 0x6D2B79F5) >>> 0); expect(game.summonRngState).toBe(summonRng);
    const pending = game.snapshot(); const copy = MvpSession.restore(pending);
    for (let i = 0; i < 60; i++) copy.step(); expect(copy.snapshot()).toEqual(pending);
    expect(copy.beginMetamorphosis(pet.id).ok).toBe(false); expect(copy.startBattle()).toBe(false);
    expect(copy.chooseMutation('longarm')).toBe(true); expect(copy.chooseMutation('longarm')).toBe(false);
    expect(copy.pets[0]).toEqual({ ...before.pets[0], mutations: ['power', 'resonance', 'longarm'] }); expect(copy.dew).toBe(before.dew); expect(copy.mutationCredits).toBe(0);
    expect(copy.beginMetamorphosis(pet.id)).toEqual({ ok: false, reason: 'NO_NEW_MUTATION' });
});

test('one-star, nonexistent, wrong-phase, paused and no-credit failures do not consume anything', () => {
    const game = prepare(4); const single = game.summonPet('cat', 0);
    if (!single.ok) throw new Error('Missing pet');
    const unchanged = (id: number, reason: string): void => {
        const before = game.snapshot(); expect(game.beginMetamorphosis(id)).toEqual({ ok: false, reason });
        expect(game.snapshot()).toEqual(before);
    };
    unchanged(single.pet.id, 'STAR_TOO_LOW'); unchanged(999, 'PET_NOT_FOUND');
    game.setPaused(true); unchanged(single.pet.id, 'PAUSED'); expect(game.startBattle()).toBe(false);
    game.setPaused(false); game.startBattle(); unchanged(single.pet.id, 'WRONG_PHASE');
    const early = prepare(); const pet = cat(early);
    expect(early.beginMetamorphosis(pet.id)).toEqual({ ok: false, reason: 'NO_MUTATION_CREDIT' });
});

test('background pause survives a preparation-stage choice and only offered forms can be selected', () => {
    const game = prepare(4); const pet = cat(game); game.beginMetamorphosis(pet.id);
    const choices = game.pendingMutation?.choices; if (!choices) throw new Error('Missing choices');
    const excluded = mutationCards('cat').find(card => !choices.includes(card.id));
    if (!excluded) throw new Error('Missing excluded form');
    expect(game.chooseMutation(excluded.id)).toBe(false);
    game.setPaused(true); const restored = MvpSession.restore(game.snapshot());
    expect(restored.chooseMutation(choices[0])).toBe(true); expect(restored.phase).toBe('prepare');
    expect(restored.paused).toBe(true); expect(restored.startBattle()).toBe(false);
});

test('longarm trades real damage for real range without changing attack timing or the path', () => {
    const game = prepare(); const pet = cat(game); pet.mutations = ['longarm'];
    expect(game.petStats(pet).damage).toBeCloseTo(34.2);
    expect(game.petStats(pet)).toMatchObject({ range: 150.4, interval: 0.65 });
    game.startBattle(); lastEnemy(game, 180, 100); game.step();
    expect(pet.attackCount).toBe(1); expect(game.enemies[0].hp).toBeCloseTo(65.8);
    expect(pet.cooldown).toBe(0.65);
});

test('resonant cat splashes at most three targets with stable distance and ID ties', () => {
    const game = prepare(); const pet = cat(game); pet.mutations = ['resonance']; pet.attackCount = 2;
    game.startBattle(); lastEnemy(game, 260, 1000);
    const target = game.enemies[0];
    for (const id of [9, 8, 7, 6]) game.enemies.push({ ...target, id, distance: 230, ...pointOnPath(230) });
    game.step();
    const damage = 45.6 * PET_GROWTH.clawBaseDamage;
    expect(target.hp).toBeCloseTo(1000 - damage);
    expect(game.enemies.find(e => e.id === 9)?.hp).toBe(1000);
    for (const id of [6, 7, 8]) expect(game.enemies.find(e => e.id === id)?.hp).toBeCloseTo(1000 - damage * 0.6);
});

test('viewing, reserves and losing never collect a new form; winning after actual use collects once', () => {
    const game = prepare(); const pet = cat(game); pet.mutations = ['longarm'];
    for (let i = 0; i < 5; i++) { game.petStats(pet); game.attackRange(pet); game.effectiveDamage(pet); }
    expect(game.snapshot().battleMutations).toEqual([]); expect(game.usedMutations).toEqual([]);
    game.startBattle(); lastEnemy(game, 210); game.step(); expect(game.phase).toBe('won');
    expect(game.usedMutations).toEqual([{ species: 'cat', mutation: 'longarm' }]);
    expect(Object.isFrozen(game.usedMutations[0])).toBe(true);
    game.continueRoute(); expect(game.usedMutations).toHaveLength(1);
    const profile = recordMutationProgress({ guideSeen: [] }, game);
    expect(recordMutationProgress(profile, game).mutationCollection).toEqual(profile.mutationCollection);
    const fresh = new MvpSession(9); expect(recordMutationProgress(profile, fresh).mutationCollection).toHaveLength(1);
    const reserve = prepare(); const bench = cat(reserve); bench.mutations = ['longarm']; bench.slot = null;
    reserve.startBattle(); lastEnemy(reserve, PATH_LENGTH - 1, 100); reserve.step();
    expect(reserve.phase).toBe('won'); expect(reserve.usedMutations).toEqual([]);
    const lost = prepare(); const doomed = cat(lost); doomed.mutations = ['longarm'];
    lost.startBattle(); lastEnemy(lost, 210, 10000); lost.step(); lost.heart = 1;
    lost.enemies[0].distance = PATH_LENGTH - 1; Object.assign(lost.enemies[0], pointOnPath(PATH_LENGTH - 1)); lost.step();
    expect(lost.phase).toBe('lost'); expect(lost.usedMutations).toEqual([]);
});

test('untrusted snapshots reject cross-species forms, duplicated pairs, forged credits and broken sources', () => {
    const game = prepare(4); const pet = cat(game); game.beginMetamorphosis(pet.id);
    const changes: ((s: RunSnapshot) => void)[] = [
        s => { s.pets[0].species = 'rabbit'; s.pets[0].mutations = ['longarm']; },
        s => { if (s.pendingMutation) s.pendingMutation.choices = ['power', 'power']; },
        s => { s.mutationRewardDepths = [2, 5]; }, s => { s.mutationCreditsSpent = 99; },
        s => { if (s.pendingMutation) s.pendingMutation.resumePhase = 'battle'; },
        s => { s.usedMutations = [{ species: 'rabbit', mutation: 'longarm' }]; },
    ];
    for (const change of changes) { const data = game.snapshot(); change(data); expect(() => MvpSession.restore(data)).toThrow(); }
});

test('collection and last expedition persist in the archive, while old content is retained as incompatible', () => {
    const values = new Map<string, string>();
    const archive = new RunArchive({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
    const game = prepare(); const pet = cat(game); pet.mutations = ['longarm']; game.startBattle(); lastEnemy(game, 210); game.step();
    game.continueRoute();
    const lost = prepare(2); lost.heart = 0; lost.phase = 'lost';
    const profile = recordMutationProgress(recordMutationProgress({ guideSeen: [] }, game), lost);
    expect(archive.save(lost, profile).ok).toBe(true);
    expect(archive.load().data?.profile).toMatchObject({ mutationCollection: [{ species: 'cat', mutation: 'longarm' }],
        lastExpedition: { outcome: 'lost', nodes: 2 } });
    const raw = values.get(SAVE_KEYS.primary); if (!raw) throw new Error('Missing save');
    const envelope = JSON.parse(raw); envelope.content = 'mvp-2026-11-07-2'; const old = JSON.stringify(envelope);
    values.set(SAVE_KEYS.primary, old); expect(archive.load().status).toBe('incompatible'); expect(values.get(SAVE_KEYS.primary)).toBe(old);
});

test('earned opportunities are usable during real random campaigns and pending-choice restoration preserves results', () => {
    let uses = 0; let wins = 0;
    for (const build of ['focused', 'spores', 'lightning'] as Build[]) for (let seed = 0; seed < 20; seed++) {
        const run = playRandomExpedition(seed, build, 'shop', 0.5, false, true);
        const restored = playRandomExpedition(seed, build, 'shop', 0.5, true, true);
        expect(restored).toEqual(run); expect(run.metamorphoses).toBeLessThanOrEqual(2);
        uses += run.metamorphoses; if (run.won) wins++;
    }
    expect(uses).toBeGreaterThan(60); expect(wins).toBeGreaterThan(0);
});

test('merge preserves target attack count and cooldown and protects its inherited form', () => {
    const game = prepare(0, 3, 1);
    const a = game.summonPet('cat', 0); const b = game.summonPet('cat', 2);
    if (!a.ok || !b.ok) throw new Error('Missing cats');
    a.pet.attackCount = 2; a.pet.cooldown = 0.8; b.pet.cooldown = 0.4;
    const result = game.mergePets(b.pet.id, a.pet.id);
    expect(result.ok).toBe(true); expect(game.pets[0]).toMatchObject({ attackCount: 2, cooldown: 0.8 });
    expect(game.chooseMutation('power')).toBe(true); expect(game.pets[0].attackCount).toBe(2);
});

test('mutated deer is collected through actual effective support, never by querying its aura', () => {
    const game = new MvpSession(3, { carriedPets: ['cat', 'deer'], mutationChance: 1 }); game.chooseNode(game.available[0].id);
    game.dew = 90;
    const cat = game.summonPet('cat', 0); const deer = game.summonPet('deer', 4); const material = game.summonPet('deer', 2);
    if (!cat.ok || !deer.ok || !material.ok) throw new Error('Missing support fixture');
    game.mergePets(material.pet.id, deer.pet.id);
    expect(game.chooseMutation('resonance')).toBe(true);
    game.attackInterval(cat.pet); game.effectiveDamage(cat.pet); expect(game.snapshot().battleMutations).toEqual([]);
    game.startBattle(); lastEnemy(game, 260); game.step();
    expect(game.phase).toBe('won'); expect(game.usedMutations).toContainEqual({ species: 'deer', mutation: 'resonance' });
});
