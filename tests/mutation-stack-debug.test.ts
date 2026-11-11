import { expect, test } from 'vitest';
import { MvpSession, PetId, PetState, pointOnPath, RunSnapshot } from '../assets/scripts/domain/MvpSession.ts';
import { MutationId, mutationCards, MUTATION_FORM_COUNT, PET_GROWTH } from '../assets/scripts/domain/PetGrowth.ts';
import { recordMutationProgress } from '../assets/scripts/domain/FirstGuide.ts';
import { RunArchive } from '../assets/scripts/infrastructure/RunArchive.ts';

function setup(species: PetId = 'cat', depth = 0): MvpSession {
    const game = new MvpSession(3, { carriedPets: [species === 'vine' || species === 'deer' ? 'cat' : species, ...(species === 'vine' || species === 'deer' ? [species] : [])], mutationChance: 1 });
    for (let i = 0; i <= depth; i++) {
        const node = game.available.find(n => n.kind === 'battle') ?? game.available[0]; game.chooseNode(node.id);
        if (i !== depth) { game.phase = 'won'; game.continueRoute(); }
    }
    // Isolated rule fixtures fund exact compositions; campaign regressions still use normal income.
    game.dew = 1000;
    return game;
}
function pair(game: MvpSession, species: PetId, a: number, b: number, mutation: MutationId): PetState {
    const first = game.summonPet(species, a); const second = game.summonPet(species, b);
    if (!first.ok || !second.ok) throw new Error('Missing pair');
    const result = game.mergePets(second.pet.id, first.pet.id); if (!result.ok) throw new Error('Missing merge');
    expect(game.chooseMutation(mutation)).toBe(true); return result.pet;
}
function triple(species: PetId): { game: MvpSession; pet: PetState } {
    const game = setup(species); const target = pair(game, species, 0, 2, 'power'); const material = pair(game, species, 4, 6, 'resonance');
    target.cooldown = 0.7; target.attackCount = 2; material.cooldown = 0.4;
    const dew = game.dew; const rng = game.mutationRngState;
    const result = game.mergePets(material.id, target.id); if (!result.ok) throw new Error('Missing three-star');
    expect(result.pet.id).toBe(target.id); expect(result.pet.slot).toBe(0); expect(result.pet.purchaseCost).toBe(120);
    expect(result.pet.mutations).toEqual(['power', 'resonance']); expect(result.pet.cooldown).toBe(0.7); expect(result.pet.attackCount).toBe(2);
    expect(game.dew).toBe(dew); expect(game.mutationRngState).toBe((rng + 0x6D2B79F5) >>> 0);
    const third = species === 'cat' ? 'longarm' : 'adaptation';
    expect(game.pendingMutation?.choices).toEqual([third]); expect(game.pendingMutation?.replacementIndex).toBeNull();
    const recovered = MvpSession.restore(game.snapshot()); expect(recovered.pendingMutation).toEqual(game.pendingMutation);
    expect(game.chooseMutation(third)).toBe(true); expect(game.chooseMutation(third)).toBe(false);
    expect(result.pet.mutations).toEqual(['power', 'resonance', third]); expect(Object.isFrozen(result.pet.mutations)).toBe(true);
    return { game, pet: result.pet };
}

test('all six species have three valid distinct mutations and can inherit two plus gain the third', () => {
    expect(MUTATION_FORM_COUNT).toBe(18);
    for (const species of ['cat', 'rabbit', 'deer', 'mushroom', 'vine', 'sparrow'] as const) {
        expect(mutationCards(species)).toHaveLength(3);
        const { game, pet } = triple(species);
        expect(pet.star).toBe(3); expect(game.pets).toHaveLength(1);
        expect(MvpSession.restore(game.snapshot()).pets[0].mutations).toEqual(pet.mutations);
    }
});

test('identical inherited mutations deduplicate and remain single strength, with or without another mutation', () => {
    for (const chance of [0, 1]) {
        const game = setup(); const a = pair(game, 'cat', 0, 2, 'resonance'); const b = pair(game, 'cat', 4, 6, 'resonance');
        game.applyDebugSettings(game.dew, chance); const merged = game.mergePets(b.id, a.id);
        if (!merged.ok) throw new Error('Missing result');
        expect(merged.pet.mutations).toEqual(['resonance']);
        expect(game.petStats(merged.pet).damage).toBeCloseTo(24 * 3.8 * 0.85);
        if (chance) { expect(game.pendingMutation?.choices).not.toContain('resonance'); game.chooseMutation('power'); }
        expect(merged.pet.mutations).toEqual(chance ? ['resonance', 'power'] : ['resonance']);
    }
});

test('without a new mutation both different inherited mutations survive in target-first order', () => {
    const game = setup(); const a = pair(game, 'cat', 0, 2, 'power'); const b = pair(game, 'cat', 4, 6, 'resonance');
    game.applyDebugSettings(game.dew, 0); game.mergePets(a.id, b.id);
    expect(game.phase).toBe('prepare'); expect(game.pendingMutation).toBeNull();
    expect(game.pets[0].mutations).toEqual(['resonance', 'power']);
});

test('combined statistics apply every distinct tradeoff exactly once', () => {
    const cat = triple('cat'); expect(cat.game.petStats(cat.pet)).toMatchObject({ range: 150.4 });
    expect(cat.game.petStats(cat.pet).damage).toBeCloseTo(24 * 3.8 * 2 * 0.85 * 0.75);
    expect(cat.game.attackInterval(cat.pet)).toBeCloseTo(0.65 * 1.5);
    const rabbit = triple('rabbit'); expect(rabbit.game.petStats(rabbit.pet).damage).toBeCloseTo(12 * 3.8 * 2 * 0.8);
    expect(rabbit.game.attackRange(rabbit.pet)).toBeCloseTo(215 * 1.35);
    const mushroom = triple('mushroom'); expect(mushroom.game.petStats(mushroom.pet).damage).toBeCloseTo(8 * 3.8 * 2 * 0.65);
    expect(mushroom.game.attackInterval(mushroom.pet)).toBeCloseTo(0.5 * 1.5 * 0.6);
    expect(mushroom.game.attackRange(mushroom.pet)).toBeCloseTo(145 * 1.35);
    const deer = triple('deer'); expect(deer.game.petStats(deer.pet).boost).toBeCloseTo(0.85 * 1.6 * 0.6);
    expect(deer.game.attackRange(deer.pet)).toBeCloseTo(185 * 0.7 * 1.4);
    const vine = triple('vine'); expect(vine.game.attackInterval(vine.pet)).toBeCloseTo(5 * 1.5 * 0.65);
    expect(vine.game.vineLifetime(vine.pet)).toBeCloseTo(2 * 2 * 0.75 * 0.6);
    expect(vine.game.attackRange(vine.pet)).toBeCloseTo(165 * 1.5);
});

test('combined cat really splashes, and combined rabbit launches its additional bolt', () => {
    for (const species of ['cat', 'rabbit'] as const) {
        const { game, pet } = triple(species); pet.cooldown = 0; pet.attackCount = 2;
        if (!game.current) throw new Error('Missing encounter');
        game.current = { ...game.current, speed: 0 }; game.spawned = game.current.count;
        game.enemies = [260, 230].map((travel, i) => ({ id: 1000 + i, kind: 'mist', distance: travel, ...pointOnPath(travel), hp: 10000, maxHp: 10000, lastDamageTick: 0 }));
        game.startBattle(); game.step();
        if (species === 'cat') {
            expect(game.enemies[1].hp).toBeCloseTo(10000 - game.effectiveDamage(pet) * 0.6);
            expect(game.marks.some(mark => mark.radius === 90)).toBe(true);
        } else expect(game.projectiles).toHaveLength(2);
    }
});

test('active metamorphosis replaces only the selected full two-star slot and adds into free three-star slots', () => {
    const game = setup('cat', 4); const pet = pair(game, 'cat', 0, 2, 'power');
    expect(game.beginMetamorphosis(pet.id, 9)).toEqual({ ok: false, reason: 'INVALID_MUTATION_INDEX' });
    expect(game.beginMetamorphosis(pet.id, 0).ok).toBe(true); expect(game.pendingMutation?.replacementIndex).toBe(0);
    expect(game.chooseMutation('power')).toBe(true); expect(pet.mutations).toEqual(['power']);
    const full = triple('cat'); const before = full.game.snapshot();
    expect(full.game.beginMetamorphosis(full.pet.id)).toEqual({ ok: false, reason: 'NO_NEW_MUTATION' });
    expect(full.game.snapshot()).toEqual(before);
});

test('snapshots reject duplicates, invalid species, over-capacity lists and already-owned append candidates', () => {
    const game = setup(); const a = pair(game, 'cat', 0, 2, 'power'); const b = pair(game, 'cat', 4, 6, 'resonance'); game.mergePets(b.id, a.id);
    const changes: ((s: RunSnapshot) => void)[] = [
        s => { s.pets[0].mutations = ['power', 'power']; },
        s => { s.pets[0].mutations = ['power', 'resonance', 'longarm', 'adaptation']; },
        s => { s.pets[0].mutations = ['adaptation']; },
        s => { if (s.pendingMutation) s.pendingMutation.choices = ['power']; },
        s => { s.pets[0].star = 2; }, s => { s.debugModified = 'yes' as unknown as boolean; },
    ];
    for (const change of changes) { const data = game.snapshot(); change(data); expect(() => MvpSession.restore(data)).toThrow(); }
});

test('debug settings validate atomically, affect no random stream and do not advance battle', () => {
    const game = setup(); game.startBattle(); game.setPaused(true);
    for (const [dew, chance] of [[-1, 0.5], [1.5, 0.5], [1000001, 0.5], [NaN, 1], [500, -0.1], [500, 1.1], [500, NaN]]) {
        const before = game.snapshot(); expect(game.applyDebugSettings(dew, chance).ok).toBe(false); expect(game.snapshot()).toEqual(before);
    }
    const before = game.snapshot(); expect(game.applyDebugSettings(0, 1)).toEqual({ ok: true });
    expect(game.snapshot()).toEqual({ ...before, dew: 0, mutationChance: 1, debugModified: true });
    expect(game.paused).toBe(true); expect(game.applyDebugSettings(500, 0)).toEqual({ ok: true });
    expect(game.mutationChance).toBe(0);
});

test('debug edits never redraw pending choices and persist with stacked mutations across saving', () => {
    const { game } = triple('cat'); const profile = { guideSeen: [], speed: 2 as const };
    game.applyDebugSettings(12345, 0.375);
    const values = new Map<string, string>(); const archive = new RunArchive({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } });
    expect(archive.save(game, profile).ok).toBe(true);
    const snapshot = archive.load().data?.run; if (!snapshot) throw new Error('Missing save');
    const recovered = MvpSession.restore(snapshot); expect(recovered.snapshot()).toEqual(game.snapshot());
    expect(recovered.mutationChance).toBe(0.375); expect(recovered.debugModified).toBe(true);
    const pending = setup(); const a = pending.summonPet('cat', 0); const b = pending.summonPet('cat', 2);
    if (!a.ok || !b.ok) throw new Error('Missing pair'); pending.mergePets(b.pet.id, a.pet.id);
    const before = pending.snapshot(); expect(pending.applyDebugSettings(999, 0)).toEqual({ ok: false, reason: 'WRONG_PHASE' }); expect(pending.snapshot()).toEqual(before);
    const fresh = new MvpSession(3); expect(fresh.dew).toBe(60); expect(fresh.mutationChance).toBe(PET_GROWTH.mutationChance); expect(fresh.debugModified).toBe(false);
    recovered.phase = 'lost'; recovered.heart = 0;
    expect(recordMutationProgress(profile, recovered).lastExpedition?.debugModified).toBe(true);
});
