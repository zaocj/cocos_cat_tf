import { expect, test } from 'vitest';
import { ECONOMY, MvpSession } from '../assets/scripts/domain/MvpSession.ts';

function squad() {
    const game = new MvpSession(31, { mutationChance: 1 });
    game.chooseNode(game.available[0].id);
    const cat = game.summonPet('cat', 0); const rabbit = game.summonPet('rabbit', 2);
    if (!cat.ok || !rabbit.ok) throw new Error('Expected two pets');
    return { game, cat: cat.pet, rabbit: rabbit.pet };
}

test('dropping different species swaps their slots without changing investments, traits, stars or random streams', () => {
    const { game, cat, rabbit } = squad();
    cat.star = 3; cat.mutation = 'power'; rabbit.mutation = 'resonance';
    const before = [game.dew, game.mutationRngState, game.summonRngState];
    expect(game.dropPet(cat.id, 2)).toEqual({ ok: true, pet: cat });
    expect(cat.slot).toBe(2); expect(rabbit.slot).toBe(0); expect(game.pets).toHaveLength(2);
    expect(cat.star).toBe(3); expect(cat.mutation).toBe('power'); expect(rabbit.mutation).toBe('resonance');
    expect(cat.purchaseCost).toBe(30); expect(rabbit.purchaseCost).toBe(30);
    expect([game.dew, game.mutationRngState, game.summonRngState]).toEqual(before);
    expect(game.pendingMutation).toBeNull();
});

test('a combat swap delays both pets for one second and retains their cooldowns', () => {
    const { game, cat, rabbit } = squad(); game.startBattle(); game.tick = 85;
    cat.cooldown = 0.5; rabbit.cooldown = 0.3;
    expect(game.dropPet(rabbit.id, 0).ok).toBe(true);
    expect(cat.slot).toBe(2); expect(rabbit.slot).toBe(0);
    expect(cat.readyTick).toBe(85 + ECONOMY.relocationTicks); expect(rabbit.readyTick).toBe(cat.readyTick);
    expect(cat.cooldown).toBe(0.5); expect(rabbit.cooldown).toBe(0.3);
});

test('same-species same-star drops still merge and enter the original mutation choice', () => {
    const { game, cat, rabbit } = squad(); game.releasePet(rabbit.id); game.dew = 30;
    const other = game.summonPet('cat', 2); if (!other.ok) throw new Error('Expected cat material');
    expect(game.dropPet(other.pet.id, 0)).toMatchObject({ ok: true, mutationRequired: true, pet: { id: cat.id, slot: 0, star: 2, purchaseCost: 60 } });
    expect(game.pets).toHaveLength(1); expect(game.dew).toBe(0); expect(game.phase).toBe('mutation');
});

test('same-species mismatched stars and max stars refuse instead of swapping or spending', () => {
    const { game, cat, rabbit } = squad(); game.releasePet(rabbit.id); game.dew = 30;
    const other = game.summonPet('cat', 2); if (!other.ok) throw new Error('Expected cat material');
    cat.star = 2; const rng = game.mutationRngState;
    expect(game.dropPet(other.pet.id, 0)).toEqual({ ok: false, reason: 'STAR_MISMATCH' });
    cat.star = 3; other.pet.star = 3;
    expect(game.dropPet(other.pet.id, 0)).toEqual({ ok: false, reason: 'MAX_STARS' });
    expect(cat.slot).toBe(0); expect(other.pet.slot).toBe(2); expect(game.pets).toHaveLength(2);
    expect(game.dew).toBe(0); expect(game.mutationRngState).toBe(rng);
});

test('drops support empty moves and origin cancellation but reject paused, locked and invalid operations', () => {
    const { game, cat, rabbit } = squad();
    expect(game.dropPet(cat.id, 4).ok).toBe(true); expect(cat.slot).toBe(4);
    expect(game.dropPet(cat.id, 4).ok).toBe(true); expect(cat.slot).toBe(4);
    expect(game.dropPet(cat.id, 1)).toEqual({ ok: false, reason: 'SLOT_LOCKED' });
    expect(game.dropPet(cat.id, -1)).toEqual({ ok: false, reason: 'INVALID_SLOT' });
    expect(game.dropPet(999, 2)).toEqual({ ok: false, reason: 'PET_NOT_FOUND' });
    game.startBattle(); game.setPaused(true);
    expect(game.dropPet(cat.id, 2)).toEqual({ ok: false, reason: 'PAUSED' });
    game.setPaused(false); game.phase = 'mutation';
    expect(game.dropPet(cat.id, 2)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
    expect(cat.slot).toBe(4); expect(rabbit.slot).toBe(2); expect(game.dew).toBe(0);
});
