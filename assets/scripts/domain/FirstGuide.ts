import { ECONOMY, MvpSession } from './MvpSession';
import { MutationRecord, mutationKey } from './PetGrowth';

export const GUIDE_IDS = ['route', 'summon', 'position', 'merge', 'mutation', 'cultivate', 'release', 'rest', 'sanctuary'] as const;
export type GuideId = typeof GUIDE_IDS[number];
export interface ExpeditionRecord { seed: number; outcome: 'won' | 'lost'; nodes: number; debugModified: boolean; forms: MutationRecord[] }
export interface PlayerProfile {
    guideSeen: GuideId[]; speed?: 1 | 2;
    mutationCollection?: MutationRecord[]; lastExpedition?: ExpeditionRecord;
}
/** Derive idempotent archive updates only from domain-confirmed completed battles. */
export function recordMutationProgress(profile: PlayerProfile, game: MvpSession): PlayerProfile {
    const forms = [...(profile.mutationCollection ?? []), ...game.usedMutations];
    const mutationCollection = forms.filter((form, i) => forms.findIndex(other => mutationKey(other) === mutationKey(form)) === i)
        .map(form => ({ ...form }));
    const terminal = game.phase === 'complete' || game.phase === 'lost';
    return { ...profile, mutationCollection, ...(terminal ? { lastExpedition: {
        seed: game.seed, outcome: game.phase === 'complete' ? 'won' as const : 'lost' as const,
        nodes: game.visited.length, debugModified: game.debugModified, forms: game.usedMutations.map(form => ({ ...form })),
    } } : {}) };
}
export const GUIDES: Record<GuideId, { title: string; text: string }> = {
    route: { title: '选择你的远征路线', text: '点击亮起的节点前进。\n路上有战斗、营地和伙伴驿站。\n每漏一只扣 1 树心，归零后远征结束。' },
    summon: { title: '先召唤两位伙伴', text: `每次花 ${ECONOMY.summonCost} 灵露，随机召唤一只。\n初始只有猫、兔，头像只供查看资料。\n先召唤两只，再点「开始防守」。\n击杀和营地给灵露，不会每秒产出。` },
    position: { title: '把伙伴放在合适的位置', text: '点击伙伴，再点开放空位可以搬迁。\n也可以长按后拖动；异种伙伴会交换。\n战中搬迁有 1 秒停手，准备时可自由布阵。' },
    merge: { title: '同种同星，两只合一', text: '点资料卡「合成」，再选同种同星素材。\n也可长按拖到同种同星伙伴身上。\n最高 3 星，合成不额外收费。\n默认 50% 概率触发变异。' },
    mutation: { title: '变异会改变你的打法', text: '合成继承双方的变异，同名去重。\n新变异追加，二星最多 1 种、三星最多 3 种。\n第 3/6 站完成各得一次主动蜕变，\n准备时用于二星或三星。候选不会重抽。' },
    cultivate: { title: '用林地铲清除荒藤', text: `拖铲子到荒藤树桩，每次 ${ECONOMY.cultivateCost} 灵露。\n也可以选铲子后点击目标。\n只开放位置，不赠宠物，本局持续有效。` },
    release: { title: '绳索放生的是一只实例', text: '拖绳索到伙伴，移除这一只实例。\n返还总投入的 60%，口袋仍能抽到它。\n要缩小召唤池，请到驿站定向放生。' },
    rest: { title: '营地补给，只能二选一', text: `收集 ${ECONOMY.restDew} 灵露，或恢复 ${ECONOMY.restHeal} 树心。\n满血时不能回血，奖励只能领取一次。\n选择后直接继续路线。` },
    sanctuary: { title: '驿站会改变随机召唤池', text: `花 ${ECONOMY.petUnlockCost} 灵露加入一种，不赠场上实例。\n定向放生 ${ECONOMY.banishCost} 灵露：本局禁抽、禁重购。\n已经召唤的伙伴保留，新远征重置猫兔。\n先留召唤预算，扩池会分散合成。` },
};

/** Contextual, one-time hints; inspecting them never changes a random stream or spends resources. */
export function nextGuide(game: MvpSession, seen: readonly GuideId[], tool: 'cultivate' | 'release' | null): GuideId | null {
    const available = (id: GuideId, condition: boolean): GuideId | null => condition && !seen.includes(id) ? id : null;
    const field = game.phase === 'prepare' || game.phase === 'battle';
    return available('mutation', game.phase === 'mutation')
        ?? available('route', game.phase === 'map')
        ?? available('summon', game.phase === 'prepare' && game.pets.length === 0)
        ?? available('position', field && game.deployedCount > 0)
        ?? available('merge', field && game.pets.some(a => game.pets.some(b => game.mergeError(a.id, b.id) === null)))
        ?? available('cultivate', field && tool === 'cultivate')
        ?? available('release', field && tool === 'release')
        ?? available('rest', game.phase === 'rest')
        ?? available('sanctuary', game.phase === 'sanctuary');
}
