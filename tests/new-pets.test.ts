import { expect, test } from 'vitest';
import { MvpSession, PET_ORDER, PetId, PetState, EnemyState, STEP, pointOnPath } from '../assets/scripts/domain/MvpSession.ts';
import { mutationCards } from '../assets/scripts/domain/PetGrowth.ts';

function prepare(species: PetId, mutation?: 'power' | 'resonance'): { game: MvpSession; pet: PetState } {
    const game = new MvpSession(123, { carriedPets: PET_ORDER, mutationChance: 1 });
    game.chooseNode(game.available[0].id); game.dew = 1000;
    const r = game.summonPet(species, 0); if (!r.ok) throw new Error('Missing pet');
    if (mutation) {
        const material = game.summonPet(species, 2); if (!material.ok) throw new Error('Missing material');
        const merged = game.mergePets(material.pet.id, r.pet.id); if (!merged.ok) throw new Error('Missing merge');
        game.chooseMutation(mutation); return { game, pet: merged.pet };
    }
    return { game, pet: r.pet };
}
function enemy(id: number, travel: number): EnemyState {
    return { id, kind: 'mist', hp: 1000, maxHp: 1000, lastDamageTick: 0, distance: travel, ...pointOnPath(travel) };
}
function battle(game: MvpSession, foes: EnemyState[], speed = 60): void {
    if (!game.current) throw new Error('Missing encounter');
    game.current = { ...game.current, speed }; game.spawned = game.current.count;
    game.enemies = foes; game.startBattle();
}
function ticks(game: MvpSession, count: number): void { for (let i = 0; i < count; i++) game.step(); }

test('vines block the front and followers for exactly two seconds, while enemies already ahead keep moving', () => {
    const { game, pet } = prepare('vine');
    const front = enemy(100, 210); const follower = enemy(101, 150); const ahead = enemy(102, 700);
    battle(game, [front, follower, ahead]); game.step();
    expect(game.vineWalls).toHaveLength(1); const line = front.distance;
    expect(game.vineWalls[0].distance).toBe(line); expect(game.vineWalls[0].durationTicks).toBe(60);
    const previous = ahead.distance; ticks(game, 60);
    expect(front.distance).toBe(line); expect(follower.distance).toBe(line); expect(ahead.distance).toBeGreaterThan(previous);
    expect(front.hp).toBe(1000); expect(pet.attackCount).toBe(1); expect(game.kills).toBe(0);
    game.step(); expect(front.distance).toBeGreaterThan(line); expect(game.vineWalls).toHaveLength(0);
});

test('a vine wall stops a BOSS too, and cannot damage or create kill rewards', () => {
    const { game } = prepare('vine'); const boss = enemy(100, 210); boss.kind = 'boss';
    battle(game, [boss]); const dew = game.dew; game.step(); const progress = boss.distance;
    ticks(game, 60); expect(boss.distance).toBe(progress); expect(boss.hp).toBe(1000);
    expect(game.dew).toBe(dew); expect(game.kills).toBe(0);
});

test('two wall beasts relay their control instead of spending both cooldowns on the same stopped target', () => {
    const { game, pet } = prepare('vine'); const second = game.summonPet('vine', 4);
    if (!second.ok) throw new Error('Missing second wall beast');
    const foe = enemy(100, 210); battle(game, [foe]); game.step(); const progress = foe.distance;
    expect(game.vineWalls).toHaveLength(1); expect(pet.attackCount).toBe(1); expect(second.pet.attackCount).toBe(0);
    ticks(game, 60); expect(foe.distance).toBe(progress); expect(second.pet.attackCount).toBe(0);
    game.step(); expect(game.vineWalls).toHaveLength(1); expect(game.vineWalls[0].ownerId).toBe(second.pet.id);
    const next = foe.distance; ticks(game, 60); expect(foe.distance).toBe(next);
});

test('vines require a target, respect cooldown and relocation, and freeze with combat pause', () => {
    const { game, pet } = prepare('vine'); const foe = enemy(100, 1000);
    battle(game, [foe], 0); game.step(); expect(game.vineWalls).toHaveLength(0); expect(pet.attackCount).toBe(0);
    game.enemies = [enemy(101, 210)]; game.step(); expect(game.vineWalls).toHaveLength(1);
    const tick = game.tick; const expiry = game.vineWalls[0].expiresTick; const progress = game.enemies[0].distance;
    game.setPaused(true); ticks(game, 90); expect(game.tick).toBe(tick); expect(game.vineWalls[0].expiresTick).toBe(expiry);
    game.setPaused(false); ticks(game, 61); expect(game.vineWalls).toHaveLength(0); expect(pet.attackCount).toBe(1);
    expect(game.enemies[0].distance).toBe(progress); // stationary fixture, not an infinite wall
    pet.cooldown = 0; game.movePet(pet.id, 4); ticks(game, 29); expect(game.vineWalls).toHaveLength(0);
    game.step(); expect(game.vineWalls).toHaveLength(1);
});

test('vine mutations trade lifetime against interval and their actual cast duration matches the card', () => {
    for (const mutation of ['power', 'resonance'] as const) {
        const { game, pet } = prepare('vine', mutation); battle(game, [enemy(100, 210)], 0); game.step();
        expect(pet.star).toBe(2); expect(game.vineLifetime(pet)).toBe(mutation === 'power' ? 4 : 1.5);
        expect(game.attackInterval(pet)).toBeCloseTo(mutation === 'power' ? 9 : 3.9);
        expect(game.vineWalls[0].durationTicks).toBe(mutation === 'power' ? 120 : 45);
        ticks(game, mutation === 'power' ? 120 : 45); expect(game.vineWalls).toHaveLength(1);
        game.step(); expect(game.vineWalls).toHaveLength(0);
        expect(mutationCards('vine')).toHaveLength(2);
    }
});

test('existing vines retain their cast lifetime when the owner is released, and clear at a new node', () => {
    const { game, pet } = prepare('vine'); battle(game, [enemy(100, 210)]); game.step();
    game.releasePet(pet.id); ticks(game, 20); expect(game.vineWalls).toHaveLength(1);
    game.phase = 'won'; game.continueRoute(); game.chooseNode(game.available[0].id);
    expect(game.vineWalls).toHaveLength(0);
});

test('sparrow lightning hits at most three distinct enemies with 70 percent decay and no projectile', () => {
    const { game } = prepare('sparrow'); const foes = [enemy(100, 200), enemy(101, 240), enemy(102, 280), enemy(103, 1000)];
    battle(game, foes, 0); game.step();
    expect(foes[2].hp).toBeCloseTo(976); expect(foes[1].hp).toBeCloseTo(983.2); expect(foes[0].hp).toBeCloseTo(988.24);
    expect(foes[3].hp).toBe(1000); expect(game.projectiles).toHaveLength(0); expect(game.marks).toHaveLength(3);
    expect(game.marks.every(mark => mark.kind === 'sparrow')).toBe(true);
});

test('sparrow resonance expands only every third real chain to five targets', () => {
    const { game, pet } = prepare('sparrow', 'resonance');
    const foes = [200, 225, 250, 275, 300].map((travel, i) => enemy(100 + i, travel));
    battle(game, foes, 0); ticks(game, 72);
    expect(pet.attackCount).toBe(2); expect(foes[0].hp).toBe(1000); expect(foes[1].hp).toBe(1000);
    game.step(); expect(pet.attackCount).toBe(3); expect(game.marks).toHaveLength(5);
    expect(foes.every(foe => foe.hp < 1000)).toBe(true);
});

test('sparrow damage uses armor and deer amplification, while death rewards still occur once', () => {
    const { game } = prepare('sparrow'); game.summonPet('deer', 5);
    const target = enemy(100, 210); target.kind = 'armored'; target.hp = 10;
    battle(game, [target], 0); const dew = game.dew; game.step();
    expect(game.kills).toBe(1); expect(game.dew).toBe(dew + 8); expect(target.hp).toBeCloseTo(10 - 24 * 1.4 * 0.65);
    game.step(); expect(game.dew).toBe(dew + 8); expect(game.kills).toBe(1);
});
