import { expect, test } from 'vitest';
import { ENEMIES, ENEMY_BALANCE, enemyTier } from '../assets/scripts/domain/EnemyConfig.ts';
import { generateRoute } from '../assets/scripts/domain/ExpeditionRoute.ts';
import { MvpSession, PET_ORDER, STEP } from '../assets/scripts/domain/MvpSession.ts';
import { developReferenceSquad } from './support/ReferenceSquad.ts';

function enterDepth(depth: number): MvpSession {
    const game = new MvpSession(123, { carriedPets: PET_ORDER });
    for (let d = 0; d <= depth; d++) {
        game.chooseNode(game.available[0].id);
        if (d === depth) break;
        if (game.phase === 'rest') game.takeRest('dew');
        else if (game.phase === 'sanctuary') game.leaveSanctuary();
        else { game.phase = 'won'; game.continueRoute(); }
    }
    return game;
}

test('later battle layers always have higher health and speed despite random jitter, with denser bounded waves', () => {
    for (let seed = 0; seed < 100; seed++) {
        const route = generateRoute(seed); let hp = 0; let speed = 0; let gap = Infinity;
        for (let depth = 0; depth < 12; depth++) {
            const battles = route.filter(n => n.depth === depth && n.kind === 'battle');
            if (!battles.length) continue;
            expect(Math.min(...battles.map(n => n.hp))).toBeGreaterThan(hp);
            expect(Math.min(...battles.map(n => n.speed))).toBeGreaterThan(speed);
            expect(battles[0].spawnGap).toBeLessThan(gap);
            for (const node of battles) {
                expect(node.hp).toBeGreaterThanOrEqual(enemyTier(depth).hp);
                expect(node.hp).toBeLessThanOrEqual(enemyTier(depth).hp + ENEMY_BALANCE.hpJitter);
                expect(node.spawnGap).toBeGreaterThanOrEqual(ENEMY_BALANCE.minSpawnGap);
            }
            hp = Math.max(...battles.map(n => n.hp)); speed = Math.max(...battles.map(n => n.speed)); gap = battles[0].spawnGap;
        }
    }
    expect(enemyTier(0)).toEqual({ hp: 96, speed: 65, spawnGap: 2.2 });
    expect(enemyTier(11)).toEqual({ hp: 713, speed: 87, spawnGap: 1.54 });
    expect(enemyTier(100).spawnGap).toBe(1.5);
});

test('real spawned mid and final bosses use their layer health once, reaching over 1300 and 3900 HP', () => {
    for (const depth of [5, 11]) {
        const game = enterDepth(depth); const node = game.current;
        if (!node) throw new Error('Missing node');
        game.spawned = node.count - 1; game.startBattle();
        for (let tick = 0; tick < 30; tick++) game.step();
        const boss = game.enemies[0]; expect(boss.kind).toBe('boss');
        expect(boss.maxHp).toBe(Math.round(node.hp * ENEMIES.boss.hp));
        expect(boss.maxHp).toBeGreaterThan(depth === 5 ? 1300 : 3900);
    }
});

test('late spawning uses the faster node gap, freezes on pause, and still gives the boss a 4.5 second entrance gap', () => {
    const game = enterDepth(11);
    if (!game.current) throw new Error('Missing node');
    game.current = { ...game.current, speed: 0 }; game.startBattle();
    for (let tick = 0; tick < 30; tick++) game.step();
    expect(game.spawned).toBe(1);
    for (let tick = 0; tick < 46; tick++) game.step();
    expect(game.spawned).toBe(1); game.step(); expect(game.spawned).toBe(2);
    game.setPaused(true); const clock = game.tick;
    for (let tick = 0; tick < 100; tick++) game.step();
    expect(game.tick).toBe(clock); expect(game.spawned).toBe(2); game.setPaused(false);
    const times: number[] = [];
    while (game.spawned < game.current.count) {
        const before = game.spawned; game.step(); if (game.spawned !== before) times.push(game.tick * STEP);
    }
    const bossGap = times[times.length - 1] - times[times.length - 2];
    expect(Math.abs(bossGap - 4.5)).toBeLessThanOrEqual(STEP + 1e-8);
});

test('leaving the reference squad at six one-star pets no longer clears the late expedition', () => {
    for (let seed = 0; seed < 20; seed++) {
        const game = new MvpSession(seed, { carriedPets: PET_ORDER }); let stoppedDepth = -1;
        for (let depth = 0; depth < 12; depth++) {
            game.chooseNode(game.available[seed % 2 ? game.available.length - 1 : 0].id);
            if (game.phase === 'rest') { game.takeRest('dew'); continue; }
            if (game.phase === 'sanctuary') { game.leaveSanctuary(); continue; }
            developReferenceSquad(game, false); game.startBattle();
            for (let tick = 0; tick < 120 / STEP && game.phase === 'battle'; tick++) {
                if (tick % 30 === 0) developReferenceSquad(game, false); game.step();
            }
            if (game.phase !== 'won') { stoppedDepth = depth; break; }
            game.continueRoute();
        }
        expect(game.phase).toBe('lost'); expect(stoppedDepth).toBeGreaterThanOrEqual(5);
        expect(game.pets.every(p => p.star === 1)).toBe(true);
    }
});
