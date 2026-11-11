import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CAT_ANIMATION, catAnimationFrame } from '../assets/scripts/presentation/CatAnimation.ts';
import { MvpSession } from '../assets/scripts/domain/MvpSession.ts';

test('cat sheet dimensions agree with the actual twelve-cell source image', () => {
    const png = readFileSync(new URL('../assets/resources/art/pets/cat_sheet.png', import.meta.url));
    expect(png.readUInt32BE(16)).toBe(CAT_ANIMATION.cellSize * CAT_ANIMATION.columns);
    expect(png.readUInt32BE(20)).toBe(CAT_ANIMATION.cellSize * CAT_ANIMATION.rows);
});

test('idle loops smoothly without treating a new pet as having attacked', () => {
    expect([0, 4, 5, 24, 25, 29, 30].map(tick => catAnimationFrame(tick, -10, 0, 0)))
        .toEqual([0, 0, 1, 4, 5, 5, 0]);
    expect(catAnimationFrame(60, 2, 0, 0)).toBeLessThan(6);
    // Preparing can breathe without advancing the world clock.
    expect(catAnimationFrame(0, -10, 0, 0, 15)).toBe(3);
});

test('only a committed attack plays one attack cycle and relocation suppresses its stale pose', () => {
    expect([150, 151, 152, 156, 160, 161].map(tick => catAnimationFrame(tick, 5, 1, 0)))
        .toEqual([6, 6, 7, 9, 11, 11]);
    expect(catAnimationFrame(162, 5, 1, 0)).toBeLessThan(6);
    expect(catAnimationFrame(150, 5, 1, 180)).toBeLessThan(6);
    expect(catAnimationFrame(149, 5, 1, 0)).toBeLessThan(6);
});

test('actual battle attack, paused simulation and snapshot restoration select the same frame without side effects', () => {
    const game = new MvpSession(3);
    const node = game.available.find(item => item.kind === 'battle');
    if (!node) throw new Error('Missing battle');
    game.chooseNode(node.id);
    const summoned = game.summonPet('cat', 0);
    if (!summoned.ok) throw new Error('Missing cat');
    game.startBattle();
    for (let i = 0; i < 600 && summoned.pet.attackCount === 0; i++) game.step();
    expect(summoned.pet.attackCount).toBeGreaterThan(0);
    const frameFor = (session: MvpSession): number => {
        const pet = session.pets[0];
        return catAnimationFrame(session.tick, pet.lastAttack, pet.attackCount, pet.readyTick);
    };
    const frame = frameFor(game); expect(frame).toBe(6);
    game.setPaused(true); const snapshot = game.snapshot();
    for (let i = 0; i < 60; i++) { game.step(); expect(frameFor(game)).toBe(frame); }
    expect(game.snapshot()).toEqual(snapshot);
    const restored = MvpSession.restore(snapshot);
    expect(frameFor(restored)).toBe(frame);
    expect(restored.snapshot()).toEqual(snapshot);
});
