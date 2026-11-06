export type EnemyKind = 'mist' | 'runner' | 'armored' | 'mender' | 'elite' | 'boss';
export type EncounterKind = 'normal' | 'elite' | 'boss';
export const ENEMY_ORDER: readonly EnemyKind[] = ['mist', 'runner', 'armored', 'mender', 'elite', 'boss'];
export const ENEMIES = {
    mist: { name: '雾团', trait: '均衡雾兽', hp: 1, speed: 1, armor: 0, regeneration: 0, reward: 6, radius: 17, tint: '#A46D9F' },
    runner: { name: '疾风雾狐', trait: '快速突进', hp: 0.72, speed: 1.45, armor: 0, regeneration: 0, reward: 6, radius: 15, tint: '#D09556' },
    armored: { name: '岩甲雾龟', trait: '直击减伤 35% · 孢子可穿甲', hp: 1.65, speed: 0.7, armor: 0.35, regeneration: 0, reward: 8, radius: 21, tint: '#698A9D' },
    mender: { name: '回春雾灵', trait: '脱离伤害 2 秒后每秒回复 2.5%', hp: 1.25, speed: 0.9, armor: 0, regeneration: 0.025, reward: 8, radius: 19, tint: '#79A880' },
    elite: { name: '巨角雾犀', trait: '大型精英 · 直击减伤 20%', hp: 3.8, speed: 0.62, armor: 0.2, regeneration: 0, reward: 25, radius: 31, tint: '#A66B42' },
    boss: { name: '噬雾之王', trait: '半血狂暴 · 移速 +25% · 直击减伤 10%', hp: 5.5, speed: 0.55, armor: 0.1, regeneration: 0, reward: 60, radius: 41, tint: '#9B4963' },
} as const;

export function encounterAt(depth: number, lane: number): EncounterKind {
    if (depth === 5 || depth === 11) return 'boss';
    if (depth === 2 || depth === 8 || (depth === 0 && lane === 1) || (depth > 0 && (depth + lane) % 4 === 0)) return 'elite';
    return 'normal';
}

export function waveFor(depth: number, count: number, encounter: EncounterKind): EnemyKind[] {
    const cycle: EnemyKind[] = depth < 2 ? ['mist', 'mist', 'runner', 'mist', 'armored']
        : ['mist', 'runner', 'armored', 'mist', 'mender', 'runner'];
    const wave = Array.from({ length: count }, (_, i) => cycle[i % cycle.length]);
    if (encounter === 'elite') wave[wave.length - 1] = 'elite';
    if (encounter === 'boss') {
        wave[wave.length - 1] = 'boss';
        if (count >= 7) wave[wave.length - 4] = 'elite';
    }
    return wave;
}

export const ENEMY_BALANCE = {
    startHp: 96, hpGrowth: 1.2, hpJitter: 8,
    startSpeed: 65, speedPerDepth: 2, speedJitter: 1,
    spawnGap: 2.2, gapReductionPerDepth: 0.06, minSpawnGap: 1.5,
    bossGap: 4.5, regenDelayTicks: 60, bossRageSpeed: 1.25,
} as const;

/** Depth is the expedition layer (including rest), not the number of completed fights. */
export function enemyTier(depth: number): { hp: number; speed: number; spawnGap: number } {
    const d = Math.max(0, Math.floor(depth));
    return {
        hp: Math.round(ENEMY_BALANCE.startHp * ENEMY_BALANCE.hpGrowth ** d),
        speed: ENEMY_BALANCE.startSpeed + ENEMY_BALANCE.speedPerDepth * d,
        spawnGap: Math.max(ENEMY_BALANCE.minSpawnGap, Number((ENEMY_BALANCE.spawnGap - ENEMY_BALANCE.gapReductionPerDepth * d).toFixed(2))),
    };
}
