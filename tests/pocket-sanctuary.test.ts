import { expect, test } from 'vitest';
import { ECONOMY, MvpSession, PET_ORDER, PETS, PetId } from '../assets/scripts/domain/MvpSession.ts';
import { generateRoute } from '../assets/scripts/domain/ExpeditionRoute.ts';

function sanctuary(withCat = false): MvpSession {
    const game = new MvpSession(123); game.chooseNode(game.available[1].id);
    if (withCat) game.summonPet('cat', 0);
    game.phase = 'won'; game.continueRoute();
    const station = game.available.find(node => node.kind === 'sanctuary');
    if (!station) throw new Error('Missing connected sanctuary');
    game.chooseNode(station.id); return game;
}

test('every map offers early and later sanctuary branches without replacing rest or boss checkpoints', () => {
    for (let seed = 0; seed < 200; seed++) {
        const route = generateRoute(seed);
        for (const depth of [1, 7]) {
            expect(route.some(n => n.depth === depth && n.kind === 'sanctuary')).toBe(true);
            expect(route.some(n => n.depth === depth && n.kind === 'rest')).toBe(true);
        }
        for (const node of route.filter(n => n.kind === 'sanctuary')) {
            expect(node.count).toBe(0); expect(node.wave).toEqual([]); expect(node.children.length).toBeGreaterThan(0);
        }
        expect(route.filter(n => n.depth === 3).every(n => n.kind === 'rest')).toBe(true);
        expect(route.filter(n => n.depth === 5 || n.depth === 11).every(n => n.kind === 'battle')).toBe(true);
    }
});

test('new runs carry only cat and rabbit; buying extends the pool, not the deployed squad', () => {
    const game = sanctuary(); game.dew = 200;
    expect(game.carriedPets).toEqual(['cat', 'rabbit']); const rng = [game.summonRngState, game.mutationRngState];
    for (const species of ['deer', 'mushroom', 'vine', 'sparrow'] as const)
        expect(game.buyPocketPet(species)).toEqual({ ok: true, species, cost: ECONOMY.petUnlockCost });
    expect(game.carriedPets).toEqual(PET_ORDER); expect(game.dew).toBe(80); expect(game.pets).toHaveLength(0);
    expect([game.summonRngState, game.mutationRngState]).toEqual(rng); expect(Object.isFrozen(game.carriedPets)).toBe(true);
});

test('buying twice, invalid species, insufficient money, wrong phase and pause never spend or change the pool', () => {
    const game = sanctuary(); const pool = game.carriedPets; const dew = game.dew;
    expect(game.buyPocketPet('cat')).toEqual({ ok: false, reason: 'ALREADY_CARRIED' });
    expect(game.buyPocketPet('shovel' as PetId)).toEqual({ ok: false, reason: 'INVALID_SPECIES' });
    game.dew = 29; expect(game.buyPocketPet('vine')).toEqual({ ok: false, reason: 'INSUFFICIENT_DEW' });
    expect(game.dew).toBe(29); expect(game.carriedPets).toBe(pool);
    game.dew = dew; game.paused = true;
    expect(game.buyPocketPet('vine')).toEqual({ ok: false, reason: 'PAUSED' });
    game.paused = false; game.phase = 'battle';
    expect(game.buyPocketPet('vine')).toEqual({ ok: false, reason: 'WRONG_PHASE' });
    expect(game.dew).toBe(dew); expect(game.carriedPets).toBe(pool);
});

test('paid pocket release excludes future draws, retains owned cats, and cannot buy the species back this run', () => {
    const game = sanctuary(true); game.dew = 200; const owned = game.pets[0];
    const rng = game.summonRngState;
    expect(game.banishPocketPet('cat')).toEqual({ ok: true, species: 'cat', cost: 20 });
    expect(game.dew).toBe(180); expect(game.carriedPets).toEqual(['rabbit']); expect(game.banishedPets).toEqual(['cat']);
    expect(game.pets[0]).toBe(owned); expect(owned.slot).toBe(0); expect(game.summonRngState).toBe(rng);
    expect(game.buyPocketPet('cat')).toEqual({ ok: false, reason: 'BANISHED' });
    expect(game.banishPocketPet('cat')).toEqual({ ok: false, reason: 'NOT_CARRIED' });
    game.leaveSanctuary(); game.chooseNode(game.available[0].id);
    expect(game.summonPet('cat', 2)).toEqual({ ok: false, reason: 'NOT_CARRIED' });
    for (let i = 0; i < 5; i++) expect(game.summonRandomPet()).toMatchObject({ ok: true, pet: { species: 'rabbit' } });
    expect(game.pets[0]).toBe(owned);
});

test('last output species is protected even when support species remain, and removing unowned support costs nothing', () => {
    const game = sanctuary(); game.dew = 200; game.buyPocketPet('vine'); game.buyPocketPet('deer'); game.banishPocketPet('cat');
    const dew = game.dew;
    expect(game.banishPocketPet('rabbit')).toEqual({ ok: false, reason: 'LAST_ATTACKER' });
    expect(game.banishPocketPet('sparrow')).toEqual({ ok: false, reason: 'NOT_CARRIED' }); expect(game.dew).toBe(dew);
    expect(game.banishPocketPet('vine').ok).toBe(true); expect(game.dew).toBe(dew - 20);
});

test('insufficient release funds never remove a species, and station exit advances exactly once', () => {
    const game = sanctuary(); game.dew = 19; const before = game.visited.length;
    expect(game.banishPocketPet('cat')).toEqual({ ok: false, reason: 'INSUFFICIENT_DEW' });
    expect(game.carriedPets).toEqual(['cat', 'rabbit']); expect(game.banishedPets).toEqual([]); expect(game.dew).toBe(19);
    expect(game.startBattle()).toBe(false); expect(game.summonRandomPet().ok).toBe(false);
    const tick = game.tick; game.step(); expect(game.tick).toBe(tick);
    expect(game.leaveSanctuary()).toBe(true); expect(game.visited.length).toBe(before + 1);
    expect(game.leaveSanctuary()).toBe(false); expect(game.dew).toBe(19);
});

test('both purchases and removals reset on a new expedition, without altering summon price or instance refunds', () => {
    const game = sanctuary(); game.buyPocketPet('sparrow'); game.banishPocketPet('cat');
    expect(new MvpSession(123).carriedPets).toEqual(['cat', 'rabbit']);
    expect(new MvpSession(123).banishedPets).toEqual([]);
    expect(game.leaveSanctuary()).toBe(true); game.chooseNode(game.available[0].id);
    game.dew = 30; expect(game.summonRandomPet().ok).toBe(true); expect(game.dew).toBe(0);
    const pet = game.pets[0]; expect(game.releasePet(pet.id)).toMatchObject({ ok: true, refund: 18 });
    expect(PETS[pet.species].cost).toBe(30);
});
