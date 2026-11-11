import { expect, test } from 'vitest';
import { PATH, SLOTS, distance } from '../assets/scripts/domain/MvpSession.ts';
import { isPortrait, portraitLayout, portraitSlotAt, toPortraitBoard } from '../assets/scripts/presentation/PortraitLayout.ts';

test('only tall windows are playable; landscape and square windows are blocked', () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(360, 640)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
    expect(isPortrait(720, 720)).toBe(false);
});

test('roads and 88-unit touch regions fit inside the portrait arena and select the intended stump', () => {
    for (const height of [1280, 1440, 1558, 1700]) {
        const layout = portraitLayout(height);
        expect(layout.arenaCenter + layout.arenaHeight / 2).toBe(layout.arenaTop);
        expect(layout.arenaCenter - layout.arenaHeight / 2).toBe(layout.arenaBottom);
        for (const p of [...PATH, ...SLOTS]) {
            const q = toPortraitBoard(p, layout);
            expect(q.x - 44 >= -328 && q.x + 44 <= 328).toBeTruthy();
            expect(q.y - 44 >= layout.arenaBottom && q.y + 44 <= layout.arenaTop).toBeTruthy();
        }
        expect(layout.arenaBottom > layout.bottom + 253, 'arena must not overlap the compact summon dock').toBeTruthy();
        SLOTS.forEach((slot, i) => expect(portraitSlotAt(toPortraitBoard(slot, layout), layout)).toBe(i));
        const a = toPortraitBoard(SLOTS[1], layout); const b = toPortraitBoard(SLOTS[2], layout);
        expect(portraitSlotAt({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 }, layout)).toBe(2);
        expect(portraitSlotAt({ x: 355, y: 0 }, layout)).toBe(null);
    }
});

test('uniform portrait projection preserves logical attack distances', () => {
    const layout = portraitLayout(1558);
    for (const slot of SLOTS) for (const p of PATH) {
        const a = toPortraitBoard(slot, layout); const b = toPortraitBoard(p, layout);
        expect(Math.hypot((a.x - b.x) / layout.scale, (a.y - b.y) / layout.scaleY)).toBeCloseTo(distance(slot, p), 8);
    }
    const entry = toPortraitBoard(PATH[0], layout); const base = toPortraitBoard(PATH[PATH.length - 1], layout);
    expect(entry.x < 0 && entry.y > layout.arenaCenter).toBeTruthy();
    expect(base.x > 0 && base.y < layout.arenaCenter).toBeTruthy();
    expect(SLOTS.length).toBe(16);
    for (let i = 0; i < SLOTS.length; i++) for (let j = i + 1; j < SLOTS.length; j++)
        expect(distance(toPortraitBoard(SLOTS[i], layout), toPortraitBoard(SLOTS[j], layout)) >= 88).toBeTruthy();
});

test('range boundaries stay circular and agree with gameplay distances on short and tall portraits', () => {
    for (const height of [1280, 1440, 1558, 1700, 2200]) {
        const layout = portraitLayout(height);
        expect(layout.scaleY).toBe(layout.scale);
        for (const slot of SLOTS) for (const radius of [94, 150.4, 185, 215]) {
            const center = toPortraitBoard(slot, layout);
            for (let step = 0; step < 24; step++) {
                const angle = step * Math.PI / 12;
                for (const ratio of [0.99, 1, 1.01]) {
                    const target = { x: slot.x + Math.cos(angle) * radius * ratio, y: slot.y + Math.sin(angle) * radius * ratio };
                    const displayedDistance = distance(center, toPortraitBoard(target, layout));
                    expect(displayedDistance).toBeCloseTo(radius * layout.scale * ratio, 8);
                    if (ratio !== 1) expect(displayedDistance < radius * layout.scale).toBe(distance(slot, target) < radius);
                }
            }
        }
    }
});
