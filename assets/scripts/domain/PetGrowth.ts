import type { PetId } from './MvpSession';

export type Star = 1 | 2 | 3;
export type MutationId = 'power' | 'resonance' | 'longarm' | 'adaptation';
export interface MutationRecord { species: PetId; mutation: MutationId }
/** Content tuning lives here. Chance is 0..1; sessions may override it for rules tests. */
export const PET_GROWTH = {
    mutationChance: 0.5,
    mutationsByStar: [0, 1, 3],
    damageByStar: [1, 1.9, 3.8],
    deerBoostByStar: [0.4, 0.6, 0.85],
    powerDamage: 2, powerInterval: 1.5, powerAura: 1.6, powerAuraRange: 0.7,
    resonanceEvery: 3, clawRadius: 90, clawDamage: 0.6, clawTargets: 3, clawBaseDamage: 0.85,
    longarmRange: 1.6, longarmDamage: 0.75,
    pursuitRange: 1.35, pursuitDamage: 0.8,
    broadcastRange: 1.4, broadcastBoost: 0.6,
    rapidSporeInterval: 0.6, rapidSporeDamage: 0.65,
    farVineRange: 1.5, farVineLife: 0.6,
    longChainRange: 1.6, longChainDamage: 0.85,
    metamorphosisRewardDepths: [2, 5],
    extraBoltDamage: 0.7, sporeRange: 1.35, auraSpeed: 1.2,
    vineIntervalByStar: [7, 6, 5], vineLifetime: 2,
    vineLongLife: 2, vineLongInterval: 1.5, vineQuickInterval: 0.65, vineQuickLife: 0.75,
    chainTargets: 3, chainExtraTargets: 2, chainRange: 160, chainDecay: 0.7,
} as const;

export interface MutationCard { id: MutationId; name: string; detail: string; summary: string }
const power: MutationCard = { id: 'power', name: '巨力异变', summary: '攻击×2，攻击间隔×1.5', detail: '攻击力翻倍，攻击间隔增加 50%。' };
const cards: Record<PetId, readonly MutationCard[]> = {
    cat: [power, { id: 'resonance', name: '震荡爪', summary: '伤害×0.85，每第3击溅射', detail: '常态伤害降低 15%。每第 3 击对周围最多 3 个敌人造成 60% 伤害，范围 90。' },
        { id: 'longarm', name: '长臂异变', summary: '射程×1.6，伤害×0.75', detail: '射程扩大 60%，伤害降低 25%。适合覆盖弯道和多段道路。' }],
    rabbit: [power, { id: 'resonance', name: '双星弹', summary: '每第3发追加70%伤害星弹', detail: '每第 3 次射击追加 70% 伤害星弹，优先另一名敌人。' },
        { id: 'adaptation', name: '追星异变', summary: '射程×1.35，伤害×0.8', detail: '射程扩大 35%，伤害降低 20%，适合远程补漏。' }],
    mushroom: [power, { id: 'resonance', name: '蔓延孢雾', summary: '每第3次脉冲范围+35%', detail: '每第 3 次孢子脉冲，施法范围扩大 35%。' },
        { id: 'adaptation', name: '急孢异变', summary: '间隔×0.6，伤害×0.65', detail: '脉冲间隔缩短 40%，每次伤害降低 35%。' }],
    deer: [{ id: 'power', name: '浓露异变', summary: '助威×1.6，范围×0.7', detail: '助威强度提高 60%，施法范围缩小 30%。' },
        { id: 'resonance', name: '灵铃共鸣', summary: '友军攻速+20%', detail: '助威同时使圈内友军攻速提高 20%，同类效果不叠加。' },
        { id: 'adaptation', name: '广播异变', summary: '范围×1.4，助威×0.6', detail: '光环范围扩大 40%，助威强度降低 40%。' }],
    vine: [{ id: 'power', name: '缠生异变', summary: '藤蔓存活×2，间隔×1.5', detail: '藤蔓存活时间翻倍，施放间隔增加 50%。' },
        { id: 'resonance', name: '迅芽异变', summary: '施放间隔×0.65，存活×0.75', detail: '施放间隔缩短 35%，藤蔓存活时间缩短 25%。' },
        { id: 'adaptation', name: '远藤异变', summary: '范围×1.5，存活×0.6', detail: '施放范围扩大 50%，藤蔓存活时间缩短 40%。' }],
    sparrow: [power, { id: 'resonance', name: '雷羽连鸣', summary: '每第3击多连锁2只敌人', detail: '每第 3 次闪电可额外连锁 2 只敌人，仍逐跳衰减。' },
        { id: 'adaptation', name: '远跳异变', summary: '跳距×1.6，伤害×0.85', detail: '连锁跳距扩大 60%，每跳伤害降低 15%。' }],
};
export function mutationCards(species: PetId): readonly MutationCard[] { return cards[species]; }
export function isMutationForSpecies(species: PetId, value: unknown): value is MutationId {
    return cards[species].some(card => card.id === value);
}
export function mutationKey(record: MutationRecord): string { return `${record.species}:${record.mutation}`; }
export const MUTATION_FORM_COUNT = Object.values(cards).reduce((total, pool) => total + pool.length, 0);
export function mutationNames(species: PetId, mutations: readonly MutationId[]): string {
    return mutations.map(id => cards[species].find(card => card.id === id)?.name ?? id).join(' / ') || '无变异';
}
export function mutationResult(current: readonly MutationId[], choice: MutationId, replacementIndex: number | null): readonly MutationId[] {
    const result = replacementIndex === null ? [...current, choice] : current.map((id, index) => index === replacementIndex ? choice : id);
    return Object.freeze(result.filter((id, index) => result.indexOf(id) === index));
}

/** One already-committed random draw supplies the pair; inspecting cards never samples. */
export function mutationChoices(species: PetId, current: readonly MutationId[], roll: number, replacementIndex: number | null = null): readonly MutationId[] {
    const pool = cards[species].map(card => card.id).filter(id => !current.includes(id));
    if (replacementIndex !== null) {
        const alternative = pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
        return Object.freeze(alternative ? [current[replacementIndex], alternative] : [current[replacementIndex]]);
    }
    if (pool.length <= 2) return Object.freeze(pool);
    const excluded = Math.min(pool.length - 1, Math.floor(roll * pool.length));
    return Object.freeze(pool.filter((_, index) => index !== excluded));
}
