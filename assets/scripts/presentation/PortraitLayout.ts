import type { Point } from '../domain/MvpSession';
import { SLOTS } from '../domain/MvpSession';

export const PORTRAIT_WIDTH = 720;
export const PORTRAIT_MIN_HEIGHT = 1280;
export interface PortraitLayout {
    height: number; top: number; bottom: number;
    arenaTop: number; arenaBottom: number; arenaHeight: number; arenaCenter: number; scale: number;
}

export function isPortrait(width: number, height: number): boolean { return height > width; }

export function portraitLayout(visibleHeight: number): PortraitLayout {
    const height = Math.max(PORTRAIT_MIN_HEIGHT, visibleHeight);
    const top = height / 2; const bottom = -top;
    const arenaTop = top - 370; const arenaBottom = bottom + 340;
    const arenaHeight = arenaTop - arenaBottom;
    return { height, top, bottom, arenaTop, arenaBottom, arenaHeight,
        arenaCenter: (arenaTop + arenaBottom) / 2, scale: Math.min(1.08, (arenaHeight - 88) / 600) };
}

/** Uniformly project portrait logical coordinates; range, speed and targeting share this transform. */
export function toPortraitBoard(point: Point, layout: PortraitLayout): Point {
    return { x: point.x * layout.scale, y: layout.arenaCenter + point.y * layout.scale };
}

/** Resolve nearby touch regions by distance, rather than letting the last overlapping node win. */
export function portraitSlotAt(point: Point, layout: PortraitLayout): number | null {
    let nearest: number | null = null; let best = 44 * 44;
    SLOTS.forEach((slot, i) => {
        const p = toPortraitBoard(slot, layout);
        const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
        if (d <= best && (nearest === null || d < best)) { nearest = i; best = d; }
    });
    return nearest;
}
