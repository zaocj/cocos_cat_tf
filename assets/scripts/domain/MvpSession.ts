/** The MVP intentionally ends on the first leak. Full V0.1 rules are separate. */
export type Phase = 'map' | 'prepare' | 'battle' | 'won' | 'lost' | 'complete';
export type PetId = 'cat' | 'rabbit';
export interface Point { x: number; y: number }
export interface RouteNode extends Point {
    id: string; name: string; detail: string; depth: number;
    count: number; hp: number; speed: number; children: string[];
}
export const STEP = 1 / 30;
export const PETS = {
    cat: { name: '爪爪猫', role: '近战', range: 94, damage: 24, interval: 0.65 },
    rabbit: { name: '星弹兔', role: '远程', range: 215, damage: 12, interval: 0.7 },
} as const;
export const PATH: readonly Point[] = [
    { x: -585, y: 95 }, { x: -405, y: 95 }, { x: -405, y: -130 },
    { x: -130, y: -130 }, { x: -130, y: 125 }, { x: 125, y: 125 },
    { x: 125, y: -90 }, { x: 290, y: -90 },
];
export const SLOTS: readonly Point[] = [
    { x: -465, y: 20 }, { x: -335, y: 15 }, { x: -270, y: -60 },
    { x: -205, y: -200 }, { x: -200, y: 60 }, { x: -60, y: 195 },
    { x: 35, y: 55 }, { x: 200, y: -15 },
];
export const ROUTE: readonly RouteNode[] = [
    { id: 'grove', name: '绒芽小径', detail: '6 只雾团 · 行进缓慢', depth: 0, x: 30, y: -175,
        count: 6, hp: 30, speed: 65, children: ['bend', 'rush'] },
    { id: 'creek', name: '溪畔岔路', detail: '7 只雾团 · 数量稍多', depth: 0, x: 270, y: -175,
        count: 7, hp: 28, speed: 70, children: ['rush'] },
    { id: 'bend', name: '回环林地', detail: '8 只雾团 · 生命增加', depth: 1, x: 30, y: 5,
        count: 8, hp: 40, speed: 68, children: ['heart'] },
    { id: 'rush', name: '疾风草坡', detail: '8 只雾团 · 行进更快', depth: 1, x: 270, y: 5,
        count: 8, hp: 34, speed: 85, children: ['heart'] },
    { id: 'heart', name: '树心守卫', detail: '10 只雾团 · 最终防守', depth: 2, x: 150, y: 185,
        count: 10, hp: 48, speed: 75, children: [] },
];
export interface PetState { id: PetId; slot: number | null; cooldown: number; lastAttack: number }
export interface EnemyState extends Point { id: number; distance: number; hp: number; maxHp: number }
export interface ProjectileState extends Point { id: number; targetId: number; damage: number }
export interface AttackMark { from: Point; to: Point; expires: number; kind: PetId }

export function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
export const PATH_LENGTH = PATH.slice(1).reduce((sum, p, i) => sum + distance(PATH[i], p), 0);
export function pointOnPath(travel: number): Point {
    let remaining = Math.max(0, travel);
    for (let i = 1; i < PATH.length; i++) {
        const a = PATH[i - 1]; const b = PATH[i]; const length = distance(a, b);
        if (remaining <= length) {
            const t = remaining / length;
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        remaining -= length;
    }
    return { ...PATH[PATH.length - 1] };
}

export class MvpSession {
    phase: Phase = 'map';
    heart = 1;
    tick = 0;
    kills = 0;
    spawned = 0;
    visited: string[] = [];
    current: RouteNode | null = null;
    pets: PetState[] = [];
    enemies: EnemyState[] = [];
    projectiles: ProjectileState[] = [];
    marks: AttackMark[] = [];
    private nextId = 1;
    private nextSpawn = 0;

    constructor() { this.resetPets(); }

    get available(): readonly RouteNode[] {
        if (this.phase !== 'map') return [];
        const last = ROUTE.find(n => n.id === this.visited[this.visited.length - 1]);
        return ROUTE.filter(n => last ? last.children.includes(n.id) : n.depth === 0);
    }

    chooseNode(id: string): boolean {
        const choice = this.available.find(n => n.id === id);
        if (!choice) return false;
        this.current = choice;
        this.phase = 'prepare';
        this.tick = 0; this.spawned = 0; this.kills = 0;
        this.nextSpawn = 1; this.enemies = []; this.projectiles = []; this.marks = [];
        this.resetPets();
        return true;
    }

    placePet(id: PetId, slot: number): boolean {
        if (this.phase !== 'prepare' || !Number.isInteger(slot) || !SLOTS[slot]) return false;
        const pet = this.pets.find(p => p.id === id);
        if (!pet) return false;
        if (pet.slot === slot) { pet.slot = null; return true; }
        const occupant = this.pets.find(p => p.slot === slot);
        if (occupant) occupant.slot = pet.slot;
        pet.slot = slot;
        return true;
    }

    startBattle(): boolean {
        if (this.phase !== 'prepare') return false;
        this.phase = 'battle';
        return true;
    }

    continueRoute(): boolean {
        if (this.phase !== 'won' || !this.current) return false;
        this.visited.push(this.current.id);
        this.phase = this.current.children.length === 0 ? 'complete' : 'map';
        return true;
    }

    step(): void {
        const encounter = this.current;
        if (this.phase !== 'battle' || !encounter) return;
        this.tick++;
        const time = this.tick * STEP;
        if (this.spawned < encounter.count && time >= this.nextSpawn) {
            this.enemies.push({ id: this.nextId++, distance: 0, ...PATH[0], hp: encounter.hp, maxHp: encounter.hp });
            this.spawned++; this.nextSpawn += 2;
        }
        for (const enemy of this.enemies) {
            enemy.distance += encounter.speed * STEP;
            const p = pointOnPath(enemy.distance); enemy.x = p.x; enemy.y = p.y;
            // MVP contract: reaching the base ends the run before any same-tick hit.
            if (enemy.distance >= PATH_LENGTH) {
                this.heart = 0; this.phase = 'lost'; return;
            }
        }
        for (const pet of this.pets) {
            if (pet.slot === null) continue;
            pet.cooldown = Math.max(0, pet.cooldown - STEP);
            if (pet.cooldown > 0) continue;
            const origin = SLOTS[pet.slot]; const spec = PETS[pet.id];
            let target: EnemyState | undefined;
            for (const enemy of this.enemies) {
                if (enemy.hp <= 0 || distance(origin, enemy) > spec.range) continue;
                if (!target || enemy.distance > target.distance ||
                    (enemy.distance === target.distance && enemy.id < target.id)) target = enemy;
            }
            if (!target) continue;
            pet.cooldown = spec.interval; pet.lastAttack = time;
            if (pet.id === 'cat') {
                target.hp -= spec.damage;
                this.marks.push({ from: { ...origin }, to: { x: target.x, y: target.y }, expires: time + 0.18, kind: 'cat' });
            } else {
                this.projectiles.push({ id: this.nextId++, targetId: target.id, ...origin, damage: spec.damage });
            }
        }
        for (const projectile of this.projectiles) {
            const target = this.enemies.find(e => e.id === projectile.targetId && e.hp > 0);
            if (!target) { projectile.targetId = -1; continue; }
            const length = distance(projectile, target); const travel = 510 * STEP;
            if (length <= travel) {
                target.hp -= projectile.damage; projectile.targetId = -1;
                this.marks.push({ from: { ...target }, to: { ...target }, expires: time + 0.12, kind: 'rabbit' });
            } else {
                projectile.x += (target.x - projectile.x) / length * travel;
                projectile.y += (target.y - projectile.y) / length * travel;
            }
        }
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0) { this.kills++; continue; }
        }
        this.enemies = this.enemies.filter(e => e.hp > 0);
        this.projectiles = this.projectiles.filter(p => p.targetId !== -1);
        this.marks = this.marks.filter(m => m.expires > time);
        if (this.phase === 'battle' && this.spawned === encounter.count && this.enemies.length === 0) this.phase = 'won';
    }

    private resetPets(): void {
        this.pets = (['cat', 'rabbit'] as PetId[]).map(id => ({ id, slot: null, cooldown: 0, lastAttack: -10 }));
    }
}
