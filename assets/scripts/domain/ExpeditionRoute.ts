import { ENEMY_BALANCE, EncounterKind, encounterAt, waveFor, EnemyKind } from './EnemyConfig';

export type RouteNodeKind = 'battle' | 'rest';
export interface RouteNode {
    id: string; name: string; detail: string; kind: RouteNodeKind; depth: number; x: number; y: number;
    count: number; hp: number; speed: number; children: string[];
    encounter: EncounterKind; wave: EnemyKind[];
}

export const ROUTE_NODE_COUNT = 30;
export const ROUTE_DEPTHS = 12;
export const ROUTE_BOUNDS = { left: -320, right: 320, bottom: 0, top: 2920 } as const;

/** Seeded map randomness is isolated from simulation and never changes during an expedition. */
export function generateRoute(seed: number): RouteNode[] {
    let state = seed >>> 0;
    const random = (): number => {
        state = (state + 0x6D2B79F5) >>> 0;
        let n = Math.imul(state ^ (state >>> 15), 1 | state);
        n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
    const middle = [2, 2, 2, 2, 3, 3, 3, 3, 3, 4];
    for (let i = middle.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1)); [middle[i], middle[j]] = [middle[j], middle[i]];
    }
    const widths = [2, ...middle, 1];
    const names = ['绒芽小径', '溪畔岔路', '回环林地', '疾风草坡', '晨露林道', '蘑菇浅滩', '风铃树径', '苔石隘口'];
    const layers = widths.map((width, depth) => {
        const spread = width === 2 ? 140 + random() * 40 : 210;
        return Array.from({ length: width }, (_, lane): RouteNode => {
            const final = depth === ROUTE_DEPTHS - 1;
            const encounter = encounterAt(depth, lane);
            const kind: RouteNodeKind = depth === 3 || (depth === 1 && lane === 0) || (depth === 7 && lane % 2 === 0) || (depth === 10 && lane === 0) ? 'rest' : 'battle';
            const battleCount = depth === 0 ? 6 + lane : Math.min(15, 6 + Math.floor(depth * 0.6) + Math.floor(random() * 3)) - (encounter === 'boss' ? 2 : 0);
            const count = kind === 'rest' ? 0 : battleCount;
            return {
                id: `route-${depth}-${lane}`, kind, name: kind === 'rest' ? '静露营地' : final ? '噬雾王座' : encounter === 'boss' ? '雾冠之巢' : names[Math.floor(random() * names.length)],
                depth, x: Math.round((width === 1 ? 0 : -spread + lane * spread * 2 / (width - 1)) + (random() - 0.5) * 32),
                y: 140 + depth * 240, count, encounter, wave: kind === 'rest' ? [] : waveFor(depth, count, encounter),
                hp: ENEMY_BALANCE.startHp + depth * ENEMY_BALANCE.hpPerDepth + (depth === 0 ? 0 : Math.floor(random() * 9)),
                speed: depth === 0 ? 65 : 65 + Math.min(20, depth + Math.floor(random() * 7)),
                detail: kind === 'rest' ? '灵露 / 树心' : `${encounter === 'boss' ? 'BOSS' : encounter === 'elite' ? '精英' : '混合'} · ${count} 只雾兽`, children: [],
            };
        });
    });
    for (let depth = 0; depth < layers.length - 1; depth++) {
        const parents = layers[depth]; const children = layers[depth + 1];
        const edges: { a: RouteNode; b: RouteNode }[] = [];
        const connect = (a: RouteNode, b: RouteNode): void => {
            if (a.children.includes(b.id)) return;
            if (edges.some(edge => (a.x - edge.a.x) * (b.x - edge.b.x) < 0)) return;
            a.children.push(b.id); edges.push({ a, b });
        };
        const closest = (point: RouteNode, choices: RouteNode[]): RouteNode =>
            choices.reduce((best, node) => Math.abs(node.x - point.x) < Math.abs(best.x - point.x) ? node : best);
        for (const a of parents) connect(a, closest(a, children));
        for (const b of children) if (!edges.some(edge => edge.b === b)) connect(closest(b, parents), b);
        for (const a of parents) if (random() < 0.7) {
            const candidates = children.filter(b => !a.children.includes(b.id));
            if (candidates.length) connect(a, closest(a, candidates));
        }
    }
    return ([] as RouteNode[]).concat(...layers);
}
