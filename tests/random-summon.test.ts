import { expect, test } from 'vitest';
import { ECONOMY, LOCKED_SLOTS, MvpSession, PET_ORDER, PETS, PetId } from '../assets/scripts/domain/MvpSession.ts';

function prepare(seed = 1, carriedPets: readonly PetId[] = PET_ORDER): MvpSession {
    const game = new MvpSession(seed, { carriedPets, mutationChance: 1 });
    game.chooseNode(game.available[0].id);
    return game;
}

test('the live carried pool starts with cat and rabbit, with six species available and no tools', () => {
    const game = new MvpSession();
    expect(ECONOMY.carryLimit).toBe(6);
    expect(game.carriedPets).toEqual(['cat', 'rabbit']);
    expect(Object.isFrozen(game.carriedPets)).toBe(true);
    expect(Object.keys(PETS)).toEqual(PET_ORDER);
    const pool: PetId[] = ['rabbit', 'deer']; const other = prepare(2, pool);
    pool.pop(); expect(other.carriedPets).toEqual(['rabbit', 'deer']);
});

test('invalid, duplicate, empty and support-only carried pools are rejected', () => {
    for (const carriedPets of [[], ['deer'], ['cat', 'cat'], ['mole'], [...PET_ORDER, 'cat']] as PetId[][])
        expect(() => new MvpSession(1, { carriedPets })).toThrow(RangeError);
    expect(prepare(1, ['rabbit']).summonRandomPet()).toMatchObject({ ok: true, pet: { species: 'rabbit' } });
    expect(prepare(1, ['rabbit']).summonPet('cat', 0)).toEqual({ ok: false, reason: 'NOT_CARRIED' });
});

test('random summons spend 30 each and occupy open empty stumps, never vines or reserves', () => {
    const game = prepare(); const mutationState = game.mutationRngState;
    const first = game.summonRandomPet(); const second = game.summonRandomPet();
    expect(first).toMatchObject({ ok: true, pet: { slot: 0, star: 1, purchaseCost: 30 } });
    expect(second).toMatchObject({ ok: true, pet: { slot: 2, star: 1, purchaseCost: 30 } });
    expect(game.dew).toBe(0); expect(game.deployedCount).toBe(2);
    expect(game.mutationRngState).toBe(mutationState);
    const state = game.summonRngState;
    expect(game.summonRandomPet()).toEqual({ ok: false, reason: 'INSUFFICIENT_DEW' });
    expect(game.summonRngState).toBe(state); expect(game.pets).toHaveLength(2);
});

test('a full board reports no empty slot even at zero dew; failure spends and draws nothing', () => {
    const game = prepare(); game.dew = 240;
    for (let i = 0; i < 8; i++) expect(game.summonRandomPet().ok).toBe(true);
    const state = game.summonRngState; const pets = JSON.stringify(game.pets);
    expect(game.summonRandomPet()).toEqual({ ok: false, reason: 'NO_FREE_SLOT' });
    expect(game.dew).toBe(0); expect(game.summonRngState).toBe(state); expect(JSON.stringify(game.pets)).toBe(pets);
    // Clearing creates capacity, but does not create a pet or pay for the next summon.
    game.dew = 70; game.cultivate(LOCKED_SLOTS[0]);
    expect(game.summonRandomPet()).toMatchObject({ ok: true, pet: { slot: LOCKED_SLOTS[0] } });
    expect(game.pets).toHaveLength(9); expect(game.dew).toBe(0);
});

test('recalling frees a field slot but never bypasses the total roster limit', () => {
    const game = prepare(); game.dew = 1000;
    for (const slot of LOCKED_SLOTS) game.cultivate(slot);
    for (let i = 0; i < 16; i++) game.summonRandomPet();
    const pet = game.pets[0]; if (pet.slot === null) throw new Error('Expected deployment');
    game.movePet(pet.id, pet.slot);
    const before = [game.dew, game.summonRngState];
    expect(game.summonRandomPet()).toEqual({ ok: false, reason: 'ROSTER_FULL' });
    expect([game.dew, game.summonRngState]).toEqual(before);
});

test('random summon obeys phase, combat pause and pending mutation guards', () => {
    const game = prepare();
    for (const phase of ['map', 'rest', 'won', 'lost', 'complete', 'mutation'] as const) {
        game.phase = phase; const before = [game.dew, game.summonRngState];
        expect(game.summonRandomPet()).toEqual({ ok: false, reason: 'WRONG_PHASE' });
        expect([game.dew, game.summonRngState]).toEqual(before);
    }
    game.phase = 'prepare'; game.startBattle(); game.setPaused(true);
    const before = [game.dew, game.summonRngState];
    expect(game.summonRandomPet()).toEqual({ ok: false, reason: 'PAUSED' });
    expect([game.dew, game.summonRngState]).toEqual(before);
    game.setPaused(false); expect(game.summonRandomPet().ok).toBe(true);
});

test('randomness is seeded, confined to carried species, and independent of mutation and route', () => {
    const kinds = new Set<PetId>();
    for (let seed = 0; seed < 200; seed++) {
        const a = prepare(seed); const b = prepare(seed);
        a.dew = b.dew = 300;
        const aMut = a.mutationRngState;
        for (let i = 0; i < 8; i++) {
            const first = a.summonRandomPet(); const second = b.summonRandomPet();
            expect(first).toEqual(second);
            if (first.ok) kinds.add(first.pet.species);
        }
        expect(a.mutationRngState).toBe(aMut); expect(a.route).toEqual(b.route);
        const c = prepare(seed, ['rabbit', 'deer']); c.dew = 300;
        for (let i = 0; i < 8; i++) {
            const result = c.summonRandomPet();
            expect(result.ok && c.carriedPets.includes(result.pet.species)).toBe(true);
        }
    }
    expect(kinds).toEqual(new Set(PET_ORDER));
});

test('without any owned attacker a summon always produces an attacker, including after release', () => {
    for (let seed = 0; seed < 500; seed++) {
        const game = prepare(seed); const result = game.summonRandomPet();
        if (!result.ok) throw new Error('Expected initial summon');
        expect(PETS[result.pet.species].damage).toBeGreaterThan(0);
        game.releasePet(result.pet.id);
        game.summonPet('deer', 0); game.dew = 30;
        const next = game.summonRandomPet();
        expect(next.ok && PETS[next.pet.species].damage > 0).toBe(true);
    }
});

test('the pool and summon stream persist through map, rest and a new encounter', () => {
    const game = prepare(123, ['rabbit', 'deer']); game.summonRandomPet();
    const state = game.summonRngState; const route = game.route;
    game.phase = 'won'; game.continueRoute(); game.chooseNode(game.available[0].id);
    expect(game.phase).toBe('rest'); game.takeRest('dew'); game.chooseNode(game.available[0].id);
    expect(game.carriedPets).toEqual(['rabbit', 'deer']); expect(game.summonRngState).toBe(state);
    expect(game.dew).toBe(75); expect(game.route).toBe(route);
    expect(new MvpSession(123).summonRngState).not.toBe(state);
});

test('randomly summoned matching instances still merge for free with the existing mutation flow', () => {
    const game = prepare(42, ['rabbit']); const first = game.summonRandomPet(); const second = game.summonRandomPet();
    if (!first.ok || !second.ok) throw new Error('Expected two summons');
    const rng = game.summonRngState;
    expect(game.mergePets(second.pet.id, first.pet.id)).toMatchObject({ ok: true, mutationRequired: true, pet: { id: first.pet.id, slot: 0, star: 2, purchaseCost: 60 } });
    expect(game.phase).toBe('mutation'); expect(game.dew).toBe(0); expect(game.summonRngState).toBe(rng);
    expect(game.summonRandomPet().ok).toBe(false); game.chooseMutation('power');
    expect(game.releasePet(first.pet.id)).toEqual({ ok: true, refund: 36, species: 'rabbit' });
});
