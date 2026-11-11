import { STEP } from '../domain/MvpSession';

/** Actual imported sheet: 2172 x 724, six 362px cells per row. */
export const CAT_ANIMATION = {
    columns: 6, rows: 2, cellSize: 362, footY: 305,
    idleFrameTicks: 5, attackFrameTicks: 2,
} as const;

/** Read-only presentation query. Only an already-committed attack can select the attack row. */
export function catAnimationFrame(tick: number, lastAttack: number, attackCount: number,
    readyTick: number, idleTick = tick): number {
    const age = tick - Math.round(lastAttack / STEP);
    if (attackCount > 0 && tick >= readyTick && age >= 0 && age < CAT_ANIMATION.columns * CAT_ANIMATION.attackFrameTicks)
        return CAT_ANIMATION.columns + Math.floor(age / CAT_ANIMATION.attackFrameTicks);
    return Math.floor(idleTick / CAT_ANIMATION.idleFrameTicks) % CAT_ANIMATION.columns;
}
