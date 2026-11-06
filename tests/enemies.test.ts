import { expect, test } from 'vitest';
import { ENEMIES, EnemyKind } from '../assets/scripts/domain/EnemyConfig.ts';
import { generateRoute } from '../assets/scripts/domain/ExpeditionRoute.ts';
import { EnemyState, MvpSession, PATH, PETS, PetId, STEP, pointOnPath } from '../assets/scripts/domain/MvpSession.ts';

function fixture(kind: EnemyKind, hp = 200, travel = 210): EnemyState {
    return { id: 1000, kind, hp, maxHp: hp, distance: travel, ...pointOnPath(travel), lastDamageTick: 0 };
}
function arena(enemy: EnemyState): MvpSession {
    const game = new MvpSession(123); game.chooseNode(game.available[0].id);
    if (!game.current) throw new Error('Missing encounter');
    game.spawned = game.current.count; game.enemies = [enemy]; game.startBattle();
    return game;
}
function advance(game: MvpSession, ticks: number): void { for (let i = 0; i < ticks; i++) game.step(); }

test('starting mist has 96 HP and survives a regular attack instead of dying immediately', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id); game.startBattle(); advance(game, 30);
    const mist = game.enemies[0]; expect(mist.kind).toBe('mist'); expect(mist.maxHp).toBe(96);
    game.projectiles.push({ id: 2000, targetId: mist.id, x: mist.x, y: mist.y, damage: PETS.cat.damage });
    game.step(); expect(mist.hp).toBe(72); expect(game.kills).toBe(0);
});

test('runner moves faster and heavy units move slower on the same simulation clock', () => {
    const mist = fixture('mist', 200, 0); const runner = fixture('runner', 200, 0); const armor = fixture('armored', 200, 0);
    runner.id = 1001; armor.id = 1002;
    const game = arena(mist); game.enemies.push(runner, armor); game.step();
    expect(runner.distance).toBeGreaterThan(mist.distance); expect(armor.distance).toBeLessThan(mist.distance);
    expect(game.enemies.every(e => e.x === PATH[0].x)).toBe(true);
});

test('armor reduces direct hits by 35 percent, while continuous spores bypass armor', () => {
    const target = fixture('armored'); const game = arena(target);
    game.projectiles.push({ id: 2000, targetId: target.id, x: target.x, y: target.y, damage: 100 });
    game.step(); expect(target.hp).toBe(135);
    const sporeTarget = fixture('armored'); const sporeGame = arena(sporeTarget);
    expect(sporeGame.summonPet('mushroom', 0).ok).toBe(true); sporeGame.step();
    expect(sporeTarget.hp).toBe(192); expect(sporeTarget.lastDamageTick).toBe(1);
});

test('regeneration waits two seconds after damage, is capped, and freezes during pause', () => {
    const enemy = fixture('mender'); enemy.hp = 100;
    const game = arena(enemy); advance(game, 59); expect(enemy.hp).toBe(100);
    game.step(); expect(enemy.hp).toBeGreaterThan(100);
    game.projectiles.push({ id: 2000, targetId: enemy.id, x: enemy.x, y: enemy.y, damage: 10 }); game.step();
    const hp = enemy.hp; advance(game, 59); expect(enemy.hp).toBe(hp);
    game.setPaused(true); advance(game, 120); expect(enemy.hp).toBe(hp);
    game.setPaused(false); enemy.hp = 199.99; enemy.lastDamageTick = game.tick - 60;
    game.step(); expect(enemy.hp).toBe(enemy.maxHp);
});

test('elite and boss rewards are granted once and do not damage friendly pets', () => {
    for (const kind of ['elite', 'boss'] as const) {
        const enemy = fixture(kind, 1); const game = arena(enemy);
        expect(game.summonPet('deer', 0).ok).toBe(true); const dew = game.dew;
        game.projectiles.push({ id: 2000, targetId: enemy.id, x: enemy.x, y: enemy.y, damage: 100 });
        game.step(); expect(game.dew).toBe(dew + ENEMIES[kind].reward); expect(game.kills).toBe(1);
        const earned = game.dew; game.step(); expect(game.dew).toBe(earned);
        expect(game.pets).toHaveLength(1); expect('hp' in game.pets[0]).toBe(false);
    }
});

test('boss half-health enrage changes speed by 25 percent and pause freezes it', () => {
    const enemy = fixture('boss', 1000, 0); const game = arena(enemy); game.step();
    const first = enemy.distance; enemy.hp = 500; game.step();
    expect(enemy.distance - first).toBeCloseTo(first * 1.25);
    game.setPaused(true); const distance = enemy.distance; advance(game, 30); expect(enemy.distance).toBe(distance);
});

test('every generated path includes elite and boss checkpoints with a complete pre-generated wave', () => {
    for (let seed = 0; seed < 50; seed++) for (const node of generateRoute(seed)) {
        expect(node.wave).toHaveLength(node.count); expect(node.hp).toBeGreaterThanOrEqual(96 + node.depth * 7);
        if (node.depth === 2 || node.depth === 8) expect(node.wave).toContain('elite');
        if (node.depth === 5 || node.depth === 11) {
            expect(node.encounter).toBe('boss'); expect(node.wave.filter(k => k === 'boss')).toHaveLength(1);
            expect(node.wave[node.wave.length - 1]).toBe('boss');
        }
    }
});

test('a planned mixed squad can finish 100 seeded expeditions with normal earned income', () => {
    const squad: { species: PetId; slot: number }[] = [
        { species: 'cat', slot: 0 }, { species: 'rabbit', slot: 4 }, { species: 'deer', slot: 5 },
        { species: 'mushroom', slot: 9 }, { species: 'rabbit', slot: 6 }, { species: 'cat', slot: 8 },
    ];
    for (let seed = 0; seed < 100; seed++) {
        const game = new MvpSession(seed);
        for (let depth = 0; depth < game.routeDepths; depth++) {
            const node = game.available[seed % 2 ? game.available.length - 1 : 0];
            const carried = game.dew; expect(game.chooseNode(node.id)).toBe(true); expect(game.dew).toBe(carried);
            if (game.phase === 'rest') { expect(game.takeRest('dew')).toBe(true); continue; }
            const buy = (): void => {
                while (game.pets.length < squad.length && game.dew >= 30) {
                    const next = squad[game.pets.length]; expect(game.summonPet(next.species, next.slot).ok).toBe(true);
                }
            };
            buy(); game.startBattle();
            for (let tick = 0; tick < 90 / STEP && game.phase === 'battle'; tick++) {
                if (tick % 30 === 0) buy(); game.step();
            }
            expect(game.phase, `seed ${seed}, depth ${depth}, ${game.enemies.map(e => e.kind + ':' + Math.ceil(e.hp))}`).toBe('won');
            game.continueRoute();
        }
        expect(game.phase).toBe('complete');
    }
});

test('one cat alone leaks enemies without adding defenses', () => {
    const game = new MvpSession(); game.chooseNode(game.available[0].id); game.summonPet('cat', 0); game.startBattle();
    advance(game, 90 / STEP); expect(game.heart).toBeLessThan(game.maxHeart); expect(game.leaked).toBeGreaterThan(0);
});
