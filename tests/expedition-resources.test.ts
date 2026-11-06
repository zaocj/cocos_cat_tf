import { expect, test } from 'vitest';
import { ECONOMY, MvpSession, PATH_LENGTH, pointOnPath } from '../assets/scripts/domain/MvpSession.ts';
import { generateRoute } from '../assets/scripts/domain/ExpeditionRoute.ts';

function restStop(): MvpSession {
    const game = new MvpSession(123);
    // Complete the incoming edges to exercise the real route and choice guards.
    while (game.phase !== 'rest') {
        expect(game.chooseNode(game.available[0].id)).toBe(true);
        if (game.phase === 'sanctuary') game.leaveSanctuary();
        if (game.phase === 'prepare') { game.phase = 'won'; game.continueRoute(); }
    }
    return game;
}

test('all paths encounter a rest stop, while optional rests share layers with battles', () => {
    for (let seed = 0; seed < 100; seed++) {
        const route = generateRoute(seed);
        expect(route.filter(n => n.depth === 3).every(n => n.kind === 'rest')).toBe(true);
        expect(route.filter(n => n.depth === 1).some(n => n.kind === 'rest')).toBe(true);
        expect(route.filter(n => n.depth === 1).some(n => n.kind === 'sanctuary')).toBe(true);
        for (const node of route.filter(n => n.kind === 'rest')) {
            expect(node.wave).toEqual([]); expect(node.count).toBe(0); expect(node.children.length).toBeGreaterThan(0);
        }
        expect(route.filter(n => n.depth === 5 || n.depth === 11).every(n => n.kind === 'battle' && n.encounter === 'boss')).toBe(true);
    }
});

test('remaining dew carries exactly to the next node, including zero, and only a new run resets it', () => {
    for (const remaining of [0, 7, 137]) {
        const game = new MvpSession(123); game.chooseNode(game.available[0].id);
        game.dew = remaining; game.phase = 'won'; game.continueRoute();
        expect(game.dew).toBe(remaining); game.chooseNode(game.available[0].id);
        expect(game.dew).toBe(remaining);
    }
    expect(new MvpSession().dew).toBe(60);
});

test('rest dew is a single atomic choice and never also heals or starts combat', () => {
    const game = restStop(); game.heart = 2; game.dew = 7;
    const visited = game.visited.length; const id = game.current?.id;
    expect(game.startBattle()).toBe(false);
    expect(game.summonPet('cat', 0)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
    expect(game.takeRest('dew')).toBe(true); expect(game.dew).toBe(7 + ECONOMY.restDew);
    expect(game.heart).toBe(2); expect(game.phase).toBe('map'); expect(game.visited).toHaveLength(visited + 1);
    expect(game.visited[game.visited.length - 1]).toBe(id); expect(game.takeRest('dew')).toBe(false);
    expect(game.takeRest('heal')).toBe(false); expect(game.heart).toBe(2);
});

test('rest heals one heart, carries it forward, and full-health healing consumes nothing', () => {
    const game = restStop(); const visited = game.visited.length; const dew = game.dew;
    expect(game.takeRest('heal')).toBe(false); expect(game.phase).toBe('rest');
    expect(game.visited).toHaveLength(visited); expect(game.dew).toBe(dew);
    game.heart = 2; expect(game.takeRest('heal')).toBe(true);
    expect(game.heart).toBe(3); expect(game.dew).toBe(dew);
    expect(game.takeRest('dew')).toBe(false);
    game.chooseNode(game.available[0].id); expect(game.heart).toBe(3); expect(game.dew).toBe(dew);
});

test('nonfatal leaks remove enemies before attacks, give no loot and carry damage to the map', () => {
    const game = new MvpSession(123); game.chooseNode(game.available[0].id); game.startBattle();
    if (!game.current) throw new Error('Missing battle');
    game.spawned = game.current.count;
    game.enemies = [{ id: 1000, kind: 'boss', hp: 1, maxHp: 1000, lastDamageTick: 0,
        distance: PATH_LENGTH - 1, ...pointOnPath(PATH_LENGTH - 1) }];
    game.projectiles = [{ id: 2000, targetId: 1000, damage: 999, ...pointOnPath(PATH_LENGTH) }];
    const dew = game.dew; game.step();
    expect(game.heart).toBe(2); expect(game.leaked).toBe(1); expect(game.kills).toBe(0);
    expect(game.enemies).toHaveLength(0); expect(game.dew).toBe(dew); expect(game.phase).toBe('won');
    game.continueRoute(); game.chooseNode(game.available[0].id);
    expect(game.heart).toBe(2); expect(game.dew).toBe(dew);
});

test('three simultaneous leaks end the expedition and cannot be revived by rest', () => {
    const game = new MvpSession(123); game.chooseNode(game.available[0].id); game.startBattle();
    game.enemies = Array.from({ length: 3 }, (_, i) => ({ id: 1000 + i, kind: 'mist' as const,
        hp: 1, maxHp: 96, lastDamageTick: 0, distance: PATH_LENGTH - 1, ...pointOnPath(PATH_LENGTH - 1) }));
    game.step(); expect(game.heart).toBe(0); expect(game.phase).toBe('lost');
    const dew = game.dew; const tick = game.tick; game.step();
    expect(game.tick).toBe(tick); expect(game.dew).toBe(dew);
    expect(game.takeRest('heal')).toBe(false); expect(game.continueRoute()).toBe(false);
});
