import { expect, test } from 'vitest';
import { ECONOMY, LOCKED_SLOTS, MvpSession, PETS, SLOTS } from '../assets/scripts/domain/MvpSession.ts';

function prepare(): MvpSession {
    const game = new MvpSession(123); game.chooseNode(game.available[0].id); return game;
}

test('exactly half of the stumps are locked and reject summons and relocation atomically', () => {
    const game = prepare(); const pet = game.summonPet('cat', 0);
    if (!pet.ok) throw new Error('Missing cat');
    expect(LOCKED_SLOTS).toHaveLength(SLOTS.length / 2); expect(game.deploymentLimit).toBe(8);
    for (const slot of LOCKED_SLOTS) {
        expect(game.summonPet('rabbit', slot)).toEqual({ ok: false, reason: 'SLOT_LOCKED' });
        expect(game.movePet(pet.pet.id, slot)).toEqual({ ok: false, reason: 'SLOT_LOCKED' });
    }
    expect(game.dew).toBe(30); expect(game.pets).toHaveLength(1); expect(pet.pet.slot).toBe(0);
});

test('the one-use mole costs 20, opens one stump, and leaves no deployed or reserve pet', () => {
    const game = prepare(); const slot = LOCKED_SLOTS[0];
    expect(game.cultivate(slot)).toEqual({ ok: true, slot });
    expect(game.dew).toBe(60 - PETS.mole.cost); expect(game.deploymentLimit).toBe(9);
    expect(game.pets).toHaveLength(0); expect(game.deployedCount).toBe(0);
    expect(game.summonPet('rabbit', slot).ok).toBe(true); expect(game.dew).toBe(10);
    expect(game.pets[0].purchaseCost).toBe(30);
});

test('failed cultivation never spends dew or opens a stump, including duplicate, pause and phase guards', () => {
    const game = prepare(); const slot = LOCKED_SLOTS[0];
    expect(game.cultivate(0)).toEqual({ ok: false, reason: 'SLOT_OPEN' });
    expect(game.cultivate(-1)).toEqual({ ok: false, reason: 'INVALID_SLOT' });
    expect(game.cultivate(1.5)).toEqual({ ok: false, reason: 'INVALID_SLOT' });
    game.dew = 19; expect(game.cultivate(slot)).toEqual({ ok: false, reason: 'INSUFFICIENT_DEW' });
    expect(game.dew).toBe(19); expect(game.isSlotOpen(slot)).toBe(false);
    game.dew = 60; game.startBattle(); game.setPaused(true);
    expect(game.cultivate(slot)).toEqual({ ok: false, reason: 'PAUSED' });
    game.setPaused(false); expect(game.cultivate(slot).ok).toBe(true);
    expect(game.cultivate(slot)).toEqual({ ok: false, reason: 'SLOT_OPEN' }); expect(game.dew).toBe(40);
    game.phase = 'won'; expect(game.cultivate(3)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
    expect(game.deploymentLimit).toBe(9);
});

test('cultivation persists through battle, map and rest while a new expedition resets vines', () => {
    const game = prepare(); const slot = LOCKED_SLOTS[0]; game.cultivate(slot);
    game.phase = 'won'; game.continueRoute(); game.chooseNode(game.available[0].id);
    expect(game.phase).toBe('rest'); expect(game.isSlotOpen(slot)).toBe(true);
    game.takeRest('dew'); game.chooseNode(game.available[0].id);
    expect(game.isSlotOpen(slot)).toBe(true); expect(game.deploymentLimit).toBe(9);
    expect(new MvpSession(123).isSlotOpen(slot)).toBe(false);
});

test('releasing a deployed pet gives 60 percent once, keeps the stump open, and never refunds cultivation', () => {
    const game = prepare(); const slot = LOCKED_SLOTS[0]; game.cultivate(slot);
    const result = game.summonPet('cat', slot); if (!result.ok) throw new Error('Missing cat');
    expect(game.dew).toBe(10);
    expect(game.releasePet(result.pet.id)).toEqual({ ok: true, refund: 18, species: 'cat' });
    expect(game.dew).toBe(28); expect(game.pets).toHaveLength(0); expect(game.isSlotOpen(slot)).toBe(true);
    expect(game.releasePet(result.pet.id)).toEqual({ ok: false, reason: 'PET_NOT_FOUND' });
    expect(game.dew).toBe(28); expect(game.cultivate(slot).ok).toBe(false);
});

test('reserve pets can be released but recall and free redeployment grant no refund', () => {
    const game = prepare(); const result = game.summonPet('rabbit', 0); if (!result.ok) throw new Error('Missing rabbit');
    const id = result.pet.id; game.movePet(id, 0); expect(game.dew).toBe(30);
    game.movePet(id, 4); game.movePet(id, 4); expect(game.dew).toBe(30);
    expect(game.releasePet(id).ok).toBe(true); expect(game.dew).toBe(48); expect(game.pets).toHaveLength(0);
});

test('release follows combat pause and phase guards and removes support effects immediately', () => {
    const game = prepare(); const cat = game.summonPet('cat', 0); const deer = game.summonPet('deer', 5);
    if (!cat.ok || !deer.ok) throw new Error('Missing squad');
    expect(game.effectiveDamage(cat.pet)).toBeCloseTo(33.6);
    game.startBattle(); game.setPaused(true);
    expect(game.releasePet(deer.pet.id)).toEqual({ ok: false, reason: 'PAUSED' }); expect(game.dew).toBe(0);
    game.setPaused(false); expect(game.releasePet(deer.pet.id).ok).toBe(true);
    expect(game.effectiveDamage(cat.pet)).toBe(24); expect(game.dew).toBe(18);
    for (const phase of ['map', 'rest', 'won', 'lost', 'complete'] as const) {
        game.phase = phase; expect(game.releasePet(cat.pet.id)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
    }
    expect(game.pets).toHaveLength(1); expect(game.dew).toBe(18);
});

test('buy-release cycles always cost dew rather than generating free currency', () => {
    const game = prepare();
    for (let i = 0; i < 3; i++) {
        const before = game.dew; const result = game.summonPet('cat', 0);
        if (!result.ok) throw new Error('Missing cat');
        game.releasePet(result.pet.id); expect(game.dew).toBe(before - 12);
    }
    expect(game.dew).toBe(24); expect(game.summonPet('cat', 0).ok).toBe(false);
    expect(ECONOMY.releaseRate).toBe(0.6);
});
