import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MvpSession, PETS, STEP, PATH_LENGTH, pointOnPath } from '../assets/scripts/domain/MvpSession.ts';

function advance(game: MvpSession, seconds: number): void {
    for (let i = 0; i < seconds / STEP && game.phase === 'battle'; i++) game.step();
}

test('route starts with two choices and rejects a locked/future node', () => {
    const game = new MvpSession();
    assert.deepEqual(game.available.map(n => n.id), ['grove', 'creek']);
    assert.equal(game.chooseNode('heart'), false);
    assert.equal(game.chooseNode('creek'), true);
    assert.equal(game.chooseNode('grove'), false);
    game.placePet('rabbit', 4); game.placePet('cat', 0); game.startBattle(); advance(game, 70);
    assert.equal(game.phase, 'won');
    assert.equal(game.continueRoute(), true);
    assert.deepEqual(game.available.map(n => n.id), ['rush']);
});

test('placing moves and swaps the same two pets; battle locks placement', () => {
    const game = new MvpSession(); game.chooseNode('grove');
    assert.equal(game.placePet('cat', -1), false);
    assert.equal(game.placePet('cat', 0), true); game.placePet('rabbit', 1);
    game.placePet('cat', 1);
    assert.equal(game.pets[0].slot, 1); assert.equal(game.pets[1].slot, 0);
    assert.equal(game.pets.length, 2);
    game.startBattle(); assert.equal(game.placePet('rabbit', 4), false);
});

test('first leak decreases heart and immediately ends; further ticks are inert', () => {
    const game = new MvpSession(); game.chooseNode('grove'); game.startBattle(); advance(game, 70);
    assert.equal(game.heart, 0); assert.equal(game.phase, 'lost');
    const tick = game.tick; game.step(); assert.equal(game.tick, tick);
    assert.equal(game.continueRoute(), false);
});

test('ranged pet fires tracking projectiles; melee deals damage without a projectile', () => {
    assert.ok(PETS.rabbit.range > PETS.cat.range * 2);
    const ranged = new MvpSession(); ranged.chooseNode('grove'); ranged.placePet('rabbit', 0); ranged.startBattle(); advance(ranged, 1.05);
    assert.ok(ranged.projectiles.length > 0);
    const melee = new MvpSession(); melee.chooseNode('grove'); melee.placePet('cat', 0); melee.startBattle(); advance(melee, 2.5);
    assert.equal(melee.projectiles.length, 0);
    assert.ok(melee.marks.length > 0 || melee.kills > 0 || melee.enemies.some(e => e.hp < e.maxHp));
});

test('arriving at the base takes priority over a lethal projectile in the same tick', () => {
    const game = new MvpSession(); game.chooseNode('grove'); game.startBattle();
    game.spawned = 6;
    game.enemies = [{ id: 100, distance: PATH_LENGTH - 1, x: 289, y: -90, hp: 12, maxHp: 30 }];
    game.projectiles = [{ id: 101, targetId: 100, x: 289, y: -90, damage: 12 }];
    game.step();
    assert.equal(game.phase, 'lost'); assert.equal(game.heart, 0);
    assert.equal(game.continueRoute(), false);
});

test('a properly placed pair can clear all three encounters and complete a run', () => {
    const game = new MvpSession();
    for (const id of ['grove', 'bend', 'heart']) {
        assert.equal(game.chooseNode(id), true);
        game.placePet('rabbit', 4); game.placePet('cat', 0); game.startBattle(); advance(game, 80);
        assert.equal(game.phase, 'won', id); assert.equal(game.heart, 1);
        game.continueRoute();
    }
    assert.equal(game.phase, 'complete'); assert.equal(game.visited.length, 3);
});

test('path clamps at shared endpoint and traverses multiple segments correctly', () => {
    assert.deepEqual(pointOnPath(PATH_LENGTH + 100), { x: 290, y: -90 });
    assert.deepEqual(pointOnPath(200), { x: -405, y: 75 });
});
