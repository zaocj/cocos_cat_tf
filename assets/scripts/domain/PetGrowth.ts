import type { PetId } from './MvpSession';

export type Star = 1 | 2 | 3;
export type MutationId = 'power' | 'resonance';
/** Content tuning lives here. Chance is 0..1; sessions may override it for rules tests. */
export const PET_GROWTH = {
    mutationChance: 0.5,
    damageByStar: [1, 1.9, 3.8],
    deerBoostByStar: [0.4, 0.6, 0.85],
    powerDamage: 2, powerInterval: 1.5, powerAura: 1.6, powerAuraRange: 0.7,
    resonanceEvery: 3, clawRadius: 90, clawDamage: 0.5,
    extraBoltDamage: 0.7, sporeRange: 1.35, auraSpeed: 1.2,
} as const;

export interface MutationCard { id: MutationId; name: string; detail: string; summary: string }
const power: MutationCard = { id: 'power', name: '巨力异变', summary: '攻击×2，攻击间隔×1.5', detail: '攻击力翻倍，攻击间隔增加 50%。' };
const cards: Record<PetId, readonly MutationCard[]> = {
    cat: [power, { id: 'resonance', name: '震荡爪', summary: '每第3击震伤周围敌人', detail: '每第 3 次挥爪，对目标周围 90 范围的其他敌人造成 50% 攻击伤害。' }],
    rabbit: [power, { id: 'resonance', name: '双星弹', summary: '每第3发追加70%伤害星弹', detail: '每第 3 次射击追加 70% 伤害星弹，优先另一名敌人。' }],
    mushroom: [power, { id: 'resonance', name: '蔓延孢雾', summary: '每第3次脉冲范围+35%', detail: '每第 3 次孢子脉冲，施法范围扩大 35%。' }],
    deer: [{ id: 'power', name: '浓露异变', summary: '助威×1.6，范围×0.7', detail: '助威强度提高 60%，施法范围缩小 30%。' },
        { id: 'resonance', name: '灵铃共鸣', summary: '友军攻速+20%', detail: '助威同时使圈内友军攻速提高 20%，同类效果不叠加。' }],
};
export function mutationCards(species: PetId): readonly MutationCard[] { return cards[species]; }
