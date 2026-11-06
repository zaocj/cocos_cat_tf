import { expect, test } from 'vitest';
import { ECONOMY, MvpSession, PETS, PetId, STEP, PATH, PATH_LENGTH, pointOnPath } from '../assets/scripts/domain/MvpSession.ts';

function advance(game: MvpSession, seconds: number): void {
    for (let i = 0; i < Math.round(seconds / STEP) && game.phase === 'battle'; i++) game.step();
}
function summon(game: MvpSession, species: PetId, slot: number) {
    const result = game.summonPet(species, slot);
    if (result.ok === false) throw new Error(`Cannot summon: ${result.reason}`);
    return result.pet;
}

test('route starts with two choices and rejects locked or already entered nodes', () => {
    const game = new MvpSession(123);
    expect(game.available).toHaveLength(2);
    const choice = game.available[0];
    expect(game.chooseNode(game.route[game.route.length - 1].id)).toBe(false);
    expect(game.chooseNode(choice.id)).toBe(true);
    expect(game.chooseNode(choice.id)).toBe(false);
    summon(game, 'rabbit', 4); summon(game, 'cat', 0); game.startBattle(); advance(game, 70);
    expect(game.phase).toBe('won'); expect(game.continueRoute()).toBe(true);
    expect(game.available.map(n => n.id)).toStrictEqual(choice.children);
    expect(game.chooseNode(choice.id)).toBe(false);
});

test('60 starting dew pays for two distinct same-species pets; rejected summons are atomic', () => {
    const game = new MvpSession();
    expect(game.dew).toBe(60); expect(game.pets.length).toBe(0);
    expect(game.summonPet('cat', 0)).toStrictEqual({ ok: false, reason: 'WRONG_PHASE' });
    game.chooseNode(game.available[0].id);
    expect(game.summonPet('cat', -1)).toStrictEqual({ ok: false, reason: 'INVALID_SLOT' });
    expect(game.summonPet('cat', 0.5)).toStrictEqual({ ok: false, reason: 'INVALID_SLOT' });
    const a = summon(game, 'cat', 0); const b = summon(game, 'cat', 1);
    expect(a.id).not.toBe(b.id); expect(game.dew).toBe(0); expect(game.pets.length).toBe(2);
    expect(game.summonPet('rabbit', 2)).toStrictEqual({ ok: false, reason: 'INSUFFICIENT_DEW' });
    expect(game.summonPet('rabbit', 0)).toStrictEqual({ ok: false, reason: 'SLOT_OCCUPIED' });
    expect(game.dew).toBe(0); expect(game.pets.length).toBe(2);
});

test('passive income grants 2 dew per simulation second, never during preparation or pause', () => {
    const game = new MvpSession(); game.step(); expect(game.dew).toBe(60);
    game.chooseNode(game.available[0].id); game.step(); expect(game.tick).toBe(0);
    game.startBattle(); advance(game, 29 * STEP); expect(game.dew).toBe(60);
    game.step(); expect(game.dew).toBe(62);
    game.setPaused(true); const tick = game.tick; advance(game, 4);
    expect(game.dew).toBe(62); expect(game.tick).toBe(tick);
    expect(game.summonPet('cat', 0)).toStrictEqual({ ok: false, reason: 'PAUSED' });
    game.setPaused(false); advance(game, 1); expect(game.dew).toBe(64);
});

test('a kill awards exactly 2 dew and cannot be collected again', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id); summon(game, 'cat', 0); game.startBattle();
    game.enemies = [{ id: 100, kind: 'mist', lastDamageTick: 0, distance: 210, ...pointOnPath(210), hp: 24, maxHp: 24 }];
    game.step(); expect(game.kills).toBe(1); expect(game.dew).toBe(32);
    game.step(); expect(game.kills).toBe(1); expect(game.dew).toBe(32);
});

test('earned dew can summon another pet during combat', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id);
    summon(game, 'cat', 0); summon(game, 'rabbit', 4); game.startBattle();
    for (let i = 0; i < 900 && game.dew < 30 && game.phase === 'battle'; i++) game.step();
    expect(game.phase).toBe('battle'); expect(game.dew >= 30).toBeTruthy();
    const before = game.dew; const third = summon(game, 'rabbit', 1);
    expect(third.slot).toBe(1); expect(game.dew).toBe(before - 30); expect(game.deployedCount).toBe(3);
});

test('moving and swapping cost nothing; combat relocation pauses attacks for one second', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id);
    const cat = summon(game, 'cat', 0); const rabbit = summon(game, 'rabbit', 1);
    expect(game.movePet(cat.id, 1).ok).toBe(true);
    expect(cat.slot).toBe(1); expect(rabbit.slot).toBe(0); expect(game.dew).toBe(0);
    game.startBattle(); expect(game.movePet(cat.id, 0).ok).toBe(true);
    expect(cat.readyTick).toBe(30); expect(rabbit.readyTick).toBe(30);
    game.enemies = [{ id: 100, kind: 'mist', lastDamageTick: 0, distance: 100, ...pointOnPath(100), hp: 1000, maxHp: 1000 }];
    advance(game, 29 * STEP); expect(game.enemies[0].hp).toBe(1000);
    game.step(); expect(game.enemies[0].hp < 1000 || game.projectiles.length > 0).toBeTruthy();
    game.setPaused(true); const slot = cat.slot;
    expect(game.movePet(cat.id, 3)).toStrictEqual({ ok: false, reason: 'PAUSED' }); expect(cat.slot).toBe(slot);
});

test('recall grants no refund; redeploy and reserve swap do not charge another summon', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id); const cat = summon(game, 'cat', 0);
    game.movePet(cat.id, 0); expect(cat.slot).toBe(null); expect(game.dew).toBe(30);
    game.movePet(cat.id, 3); expect(cat.slot).toBe(3); expect(game.dew).toBe(30);
});

test('six deployed pets is a hard limit and reserve swaps keep that limit', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id); game.dew = 300;
    for (let i = 0; i < 6; i++) summon(game, 'cat', i);
    const before = game.dew;
    expect(game.summonPet('rabbit', 6)).toStrictEqual({ ok: false, reason: 'DEPLOYMENT_FULL' });
    expect(game.dew).toBe(before);
    const reserve = game.pets[0]; game.movePet(reserve.id, 0); summon(game, 'rabbit', 6);
    expect(game.movePet(reserve.id, 7)).toStrictEqual({ ok: false, reason: 'DEPLOYMENT_FULL' });
    const paid = game.dew; expect(game.movePet(reserve.id, 1).ok).toBe(true);
    expect(game.deployedCount).toBe(6); expect(game.dew).toBe(paid); expect(game.pets[1].slot).toBe(null);
});

test('the roster limit cannot be bypassed by recalling existing pets', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id); game.dew = 1000;
    for (let i = 0; i < 6; i++) summon(game, 'cat', i);
    for (const p of game.pets) game.movePet(p.id, p.slot ?? 0);
    for (let i = 0; i < 6; i++) summon(game, 'rabbit', i);
    const pet = game.pets[6]; game.movePet(pet.id, 0);
    const before = game.dew;
    expect(game.summonPet('cat', 0)).toStrictEqual({ ok: false, reason: 'ROSTER_FULL' });
    expect(game.dew).toBe(before); expect(game.pets.length).toBe(ECONOMY.rosterLimit);
});

test('first leak ends the game; further steps and purchases cannot generate or consume dew', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id); game.startBattle(); advance(game, 70);
    expect(game.heart).toBe(0); expect(game.phase).toBe('lost');
    const tick = game.tick; const dew = game.dew; advance(game, 10); game.step();
    expect(game.tick).toBe(tick); expect(game.dew).toBe(dew);
    expect(game.summonPet('cat', 0)).toStrictEqual({ ok: false, reason: 'WRONG_PHASE' });
    expect(game.continueRoute()).toBe(false);
});

test('ranged pet fires tracking projectiles; melee deals damage without a projectile', () => {
    expect(PETS.rabbit.range > PETS.cat.range * 2).toBeTruthy();
    const ranged = new MvpSession(); ranged.chooseNode(ranged.available[0].id); summon(ranged, 'rabbit', 0); ranged.startBattle(); advance(ranged, 1.05);
    expect(ranged.projectiles.length > 0).toBeTruthy();
    const melee = new MvpSession(); melee.chooseNode(melee.available[0].id); summon(melee, 'cat', 0); melee.startBattle(); advance(melee, 2.5);
    expect(melee.projectiles.length).toBe(0);
    expect(melee.marks.length > 0 || melee.kills > 0 || melee.enemies.some(e => e.hp < e.maxHp)).toBeTruthy();
});

test('arriving at the base takes priority over a lethal projectile in the same tick', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id); game.startBattle();
    game.spawned = 6;
    game.enemies = [{ id: 100, kind: 'mist', lastDamageTick: 0, distance: PATH_LENGTH - 1, ...pointOnPath(PATH_LENGTH - 1), hp: 12, maxHp: 30 }];
    game.projectiles = [{ id: 101, targetId: 100, ...pointOnPath(PATH_LENGTH), damage: 12 }]; game.step();
    expect(game.phase).toBe('lost'); expect(game.heart).toBe(0); expect(game.continueRoute()).toBe(false);
});

test('pets persist across every layer of a 30-node expedition while dew resets to 60', () => {
    const game = new MvpSession(123); let previousIds: number[] = [];
    const squad: { species: PetId; slot: number }[] = [
        { species: 'cat', slot: 0 }, { species: 'rabbit', slot: 4 }, { species: 'deer', slot: 5 },
        { species: 'mushroom', slot: 9 }, { species: 'rabbit', slot: 6 }, { species: 'cat', slot: 8 },
    ];
    for (let depth = 0; depth < game.routeDepths; depth++) {
        const id = game.available[0].id;
        expect(game.chooseNode(id)).toBe(true); expect(game.dew).toBe(60);
        expect(game.pets.map(p => p.id)).toStrictEqual(previousIds);
        while (game.pets.length < squad.length && game.dew >= ECONOMY.summonCost) {
            const next = squad[game.pets.length]; summon(game, next.species, next.slot);
        }
        previousIds = game.pets.map(p => p.id);
        game.startBattle(); advance(game, 90);
        expect(game.phase, `${id}: ${game.enemies.map(e => e.kind + '=' + Math.round(e.hp)).join(',')}`).toBe('won'); expect(game.heart).toBe(1);
        const dew = game.dew; game.step(); expect(game.dew).toBe(dew); game.continueRoute();
    }
    expect(game.phase).toBe('complete'); expect(game.visited).toHaveLength(game.routeDepths);
    expect(game.route).toHaveLength(30); expect(game.deployedCount).toBe(6);
});

test('path clamps at shared endpoint and traverses multiple segments correctly', () => {
    expect(pointOnPath(PATH_LENGTH + 100)).toStrictEqual(PATH[PATH.length - 1]);
    expect(pointOnPath(200)).toStrictEqual({ x: -190, y: 160 });
});

function auraArena(): MvpSession {
    const game = new MvpSession(); game.chooseNode(game.available[0].id); game.dew = 300;
    if (!game.current) throw new Error('Test encounter was not initialized');
    game.current = { ...game.current, speed: 0 };
    game.spawned = game.current.count;
    game.enemies = [210, 330, 600].map((travel, i) =>
        ({ id: 100 + i, kind: 'mist' as const, lastDamageTick: 0, distance: travel, ...pointOnPath(travel), hp: 100, maxHp: 100 }));
    return game;
}

test('support deer does not attack or create projectiles and pets have no health', () => {
    const game = auraArena(); const deer = summon(game, 'deer', 0); game.startBattle(); advance(game, 2);
    expect(game.enemies.map(e => e.hp)).toStrictEqual([100, 100, 100]);
    expect(game.projectiles.length).toBe(0); expect(deer.lastAttack).toBe(-10);
    expect('hp' in deer).toBe(false);
});

test('ready support grants 40 percent once, updates with position and excludes reserves', () => {
    const game = auraArena(); const cat = summon(game, 'cat', 0);
    const a = summon(game, 'deer', 1); const b = summon(game, 'deer', 4);
    expect(game.effectiveDamage(cat)).toBe(24 * 1.4);
    expect(game.attackMultiplier(a)).toBe(1);
    game.movePet(a.id, 15); expect(game.attackMultiplier(cat)).toBe(1.4);
    game.movePet(b.id, 4); expect(game.attackMultiplier(cat)).toBe(1);
    game.movePet(a.id, 1); game.startBattle(); game.movePet(a.id, 15); game.movePet(a.id, 1);
    expect(game.attackMultiplier(cat)).toBe(1);
    advance(game, 30 * STEP); expect(game.attackMultiplier(cat)).toBe(1.4);
    game.movePet(cat.id, 14); expect(game.attackMultiplier(cat)).toBe(1);
});

test('mushroom pulses every half second against all enemies inside its radius only', () => {
    const game = auraArena(); const mushroom = summon(game, 'mushroom', 0); game.startBattle(); game.step();
    expect(game.enemies.map(e => e.hp)).toStrictEqual([92, 92, 100]);
    advance(game, 14 * STEP); expect(game.enemies.map(e => e.hp)).toStrictEqual([92, 92, 100]);
    game.step(); expect(game.enemies.map(e => e.hp)).toStrictEqual([84, 84, 100]);
    expect(game.projectiles.length).toBe(0); expect('hp' in mushroom).toBe(false);
    const outside = game.enemies[0]; outside.distance = 600; Object.assign(outside, pointOnPath(600));
    advance(game, 15 * STEP); expect(outside.hp).toBe(84); expect(game.enemies[1].hp).toBe(76);
});

test('support boosts mushroom damage and pause or relocation freezes its effect', () => {
    const game = auraArena(); const mushroom = summon(game, 'mushroom', 0); summon(game, 'deer', 1);
    game.startBattle(); game.step(); expect(Math.abs(game.enemies[0].hp - 88.8) < 1e-8).toBeTruthy();
    game.setPaused(true); const hp = game.enemies[0].hp; advance(game, 3); expect(game.enemies[0].hp).toBe(hp);
    game.setPaused(false); game.movePet(mushroom.id, 4); advance(game, 29 * STEP);
    expect(game.enemies[0].hp).toBe(hp); game.step(); expect(game.enemies[0].hp < hp).toBeTruthy();
});

test('aura kills award dew once per enemy and never remove the caster', () => {
    const game = auraArena(); const mushroom = summon(game, 'mushroom', 0);
    game.enemies[0].hp = 8; game.enemies[1].hp = 8; game.startBattle();
    const before = game.dew; game.step(); expect(game.kills).toBe(2); expect(game.dew).toBe(before + 4);
    game.step(); expect(game.dew).toBe(before + 4); expect(game.pets.includes(mushroom)).toBeTruthy();
});

test('ranged projectiles snapshot the supported attack at launch', () => {
    const game = auraArena(); const rabbit = summon(game, 'rabbit', 0); const deer = summon(game, 'deer', 1);
    game.startBattle(); game.step(); expect(game.projectiles[0].damage).toBe(PETS.rabbit.damage * 1.4);
    game.movePet(deer.id, 15); expect(game.effectiveDamage(rabbit)).toBe(PETS.rabbit.damage);
    expect(game.projectiles[0].damage).toBe(PETS.rabbit.damage * 1.4);
});
