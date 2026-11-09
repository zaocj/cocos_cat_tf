import { expect, test } from 'vitest';
import { MvpSession, PET_ORDER, RunSnapshot } from '../assets/scripts/domain/MvpSession.ts';
import { RunArchive, SAVE_KEYS, CONTENT_VERSION } from '../assets/scripts/infrastructure/RunArchive.ts';
import { playRandomExpedition, Build } from './support/RandomExpedition.ts';
import { nextGuide, GUIDE_IDS } from '../assets/scripts/domain/FirstGuide.ts';

class MemoryStorage {
    values = new Map<string, string>(); writes = 0; failAt = Infinity;
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    setItem(key: string, value: string): void {
        if (++this.writes === this.failAt) throw new Error('quota'); this.values.set(key, value);
    }
}
function battle(): MvpSession {
    const game = new MvpSession(123); game.chooseNode(game.available[0].id);
    game.summonPet('cat', 0); game.summonPet('rabbit', 4); game.startBattle();
    return game;
}
function ticks(game: MvpSession, n: number): void { for (let i = 0; i < n; i++) game.step(); }

test('snapshot restores every counter, RNG stream, projectile and cooldown without advancing combat', () => {
    const game = battle(); ticks(game, 40);
    expect(game.enemies.length).toBeGreaterThan(0); expect(game.projectiles.length).toBeGreaterThan(0);
    const snapshot = game.snapshot(); const restored = MvpSession.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot); expect(restored.route).toEqual(game.route);
    snapshot.pets[0].slot = null; expect(game.pets[0].slot).toBe(0); expect(restored.pets[0].slot).toBe(0);
    for (let i = 0; i < 600; i++) { game.step(); restored.step(); expect(restored.snapshot()).toEqual(game.snapshot()); }
});

test('pending mutation is fixed across repeated loads, and choosing it preserves later draws and refunds', () => {
    let game = new MvpSession(1, { mutationChance: 1 });
    for (let seed = 0; seed < 30; seed++) {
        game = new MvpSession(seed, { mutationChance: 1 }); game.chooseNode(game.available[0].id);
        game.summonRandomPet(); game.summonRandomPet();
        if (game.pets[0].species === game.pets[1].species) break;
    }
    const id = game.pets[0].id; game.mergePets(game.pets[1].id, id);
    expect(game.phase).toBe('mutation'); const data = game.snapshot();
    for (let i = 0; i < 10; i++) expect(MvpSession.restore(data).pendingMutation).toEqual(game.pendingMutation);
    const other = MvpSession.restore(data); game.chooseMutation('power'); other.chooseMutation('power');
    game.releasePet(id); other.releasePet(id); expect(other.summonRandomPet()).toEqual(game.summonRandomPet());
    expect(other.snapshot()).toEqual(game.snapshot());
});

test('active vines and their remaining lifetime survive saving exactly, including release of the caster', () => {
    const game = new MvpSession(123, { carriedPets: PET_ORDER }); game.chooseNode(game.available[0].id);
    game.summonPet('vine', 0); game.startBattle(); ticks(game, 31);
    expect(game.vineWalls).toHaveLength(1); game.releasePet(game.pets[0].id);
    const restored = MvpSession.restore(game.snapshot());
    for (let i = 0; i < 90; i++) { game.step(); restored.step(); expect(restored.snapshot()).toEqual(game.snapshot()); }
});

test('map, rest, sanctuary, battle and terminal states restore without duplicate node rewards', () => {
    const game = battle(); ticks(game, 3000); expect(game.phase).toBe('won');
    expect(MvpSession.restore(game.snapshot()).phase).toBe('won'); game.continueRoute();
    expect(MvpSession.restore(game.snapshot()).visited).toEqual(game.visited);
    game.chooseNode(game.available[0].id); expect(game.phase).toBe('rest');
    const restored = MvpSession.restore(game.snapshot()); expect(restored.takeRest('dew')).toBe(true);
    expect(restored.takeRest('dew')).toBe(false); expect(restored.visited).toHaveLength(2);
    const shop = new MvpSession(123); shop.chooseNode(shop.available[1].id); shop.phase = 'won'; shop.continueRoute();
    const node = shop.available.find(n => n.kind === 'sanctuary'); if (!node) throw new Error('Missing station');
    shop.chooseNode(node.id); shop.buyPocketPet('vine'); shop.banishPocketPet('rabbit');
    const loaded = MvpSession.restore(shop.snapshot()); expect(loaded.carriedPets).toEqual(['cat', 'vine']);
    expect(loaded.banishedPets).toEqual(['rabbit']); expect(loaded.buyPocketPet('rabbit').ok).toBe(false);
    const lost = new MvpSession(1); lost.chooseNode(lost.available[0].id); lost.startBattle(); ticks(lost, 6000);
    expect(lost.phase).toBe('lost'); expect(MvpSession.restore(lost.snapshot()).phase).toBe('lost');
});

test('invalid values and broken relationships are rejected rather than silently repaired', () => {
    const base = battle(); ticks(base, 40);
    const changes: ((s: RunSnapshot) => void)[] = [s => { s.dew = -1; }, s => { s.nextId = 1; },
        s => { s.summonState = NaN; }, s => { s.pets[0].slot = 1; }, s => { s.pets[0].slot = s.pets[1].slot; },
        s => { s.pets[0] = { ...s.pets[0], purchaseCost: 999 }; }, s => { s.enemies[0].hp = Infinity; },
        s => { s.currentId = 'missing'; }, s => { s.visited = [s.currentId ?? '']; }, s => { s.pocket = ['vine']; }];
    for (const change of changes) { const data = base.snapshot(); change(data); expect(() => MvpSession.restore(data)).toThrow(); }
});

test('archive saves only its own keys, skips identical writes, and preserves the previous good snapshot', () => {
    const memory = new MemoryStorage(); memory.values.set('unrelated', 'keep'); const archive = new RunArchive(memory);
    expect(archive.load().status).toBe('empty'); const game = new MvpSession(1); const profile = { guideSeen: [] };
    expect(archive.save(game, profile).ok).toBe(true); const writes = memory.writes;
    archive.save(game, profile); expect(memory.writes).toBe(writes);
    game.chooseNode(game.available[0].id); game.summonRandomPet(); archive.save(game, profile);
    memory.values.set(SAVE_KEYS.primary, '{broken');
    const loaded = new RunArchive(memory).load(); expect(loaded.status).toBe('recovered'); expect(loaded.data?.run?.dew).toBe(60);
    expect(memory.values.get('unrelated')).toBe('keep');
    const repair = new RunArchive(memory); const backup = repair.load().data;
    if (!backup?.run) throw new Error('Missing backup snapshot');
    expect(repair.save(MvpSession.restore(backup.run), backup.profile).ok).toBe(true);
    expect(new RunArchive(memory).load().status).toBe('ready');
});

test('checksum corruption recovers backup, incompatible versions never auto-downgrade or overwrite data', () => {
    const memory = new MemoryStorage(); const archive = new RunArchive(memory); const game = new MvpSession(1);
    archive.save(game, { guideSeen: [] }); game.chooseNode(game.available[0].id); archive.save(game, { guideSeen: ['route'] });
    const raw = memory.getItem(SAVE_KEYS.primary); if (!raw) throw new Error('Missing archive');
    const envelope = JSON.parse(raw); envelope.body = envelope.body.replace('"dew":60', '"dew":600');
    memory.values.set(SAVE_KEYS.primary, JSON.stringify(envelope)); expect(new RunArchive(memory).load().status).toBe('recovered');
    envelope.content = CONTENT_VERSION + '-future'; memory.values.set(SAVE_KEYS.primary, JSON.stringify(envelope));
    const before = [...memory.values]; expect(new RunArchive(memory).load().status).toBe('incompatible'); expect([...memory.values]).toEqual(before);
});

test('failed writes leave a recoverable older save, retry commits once, and unreadable storage is explicit', () => {
    const memory = new MemoryStorage(); const archive = new RunArchive(memory); const game = new MvpSession(1);
    archive.save(game, { guideSeen: [] }); game.chooseNode(game.available[0].id); game.summonRandomPet();
    memory.failAt = memory.writes + 2; expect(archive.save(game, { guideSeen: [] }).ok).toBe(false);
    expect(new RunArchive(memory).load().data?.run?.dew).toBe(60);
    memory.failAt = Infinity; expect(archive.save(game, { guideSeen: [] }).ok).toBe(true);
    expect(new RunArchive(memory).load().data?.run?.dew).toBe(30);
    const unavailable = new RunArchive({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(unavailable.load().status).toBe('unavailable'); expect(unavailable.save(game, { guideSeen: [] }).ok).toBe(false);
});

test('guide progress persists independently of new runs, is contextual, and never consumes random numbers', () => {
    const game = new MvpSession(1); const rng = game.summonRngState;
    expect(nextGuide(game, [], null)).toBe('route'); expect(nextGuide(game, ['route'], null)).toBeNull();
    game.chooseNode(game.available[0].id); expect(nextGuide(game, ['route'], null)).toBe('summon');
    game.summonRandomPet(); expect(nextGuide(game, ['route', 'summon'], null)).toBe('position');
    expect(nextGuide(game, [...GUIDE_IDS], 'release')).toBeNull();
    const memory = new MemoryStorage(); const archive = new RunArchive(memory); archive.save(game, { guideSeen: [...GUIDE_IDS], speed: 2 });
    const profile = archive.load().data?.profile; expect(profile?.speed).toBe(2); expect(profile?.guideSeen).toEqual(GUIDE_IDS);
    expect(nextGuide(new MvpSession(2), profile?.guideSeen ?? [], null)).toBeNull();
    expect(rng).not.toBe(game.summonRngState);
});

 test('whole random expeditions give identical results when restored at every node, including completed runs', () => {
    let completed = 0;
    for (const build of ['focused', 'spores', 'lightning'] as Build[]) for (const seed of [0, 1, 2]) {
        const continuous = playRandomExpedition(seed, build, 'shop');
        const recovered = playRandomExpedition(seed, build, 'shop', 0.5, true);
        expect(recovered).toEqual(continuous); if (recovered.won) completed++;
    }
    expect(completed).toBeGreaterThan(0);
});
