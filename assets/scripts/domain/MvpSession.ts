import { ENEMIES, ENEMY_BALANCE, EnemyKind } from './EnemyConfig';
import { generateRoute, RouteNode, ROUTE_DEPTHS } from './ExpeditionRoute';
export type { RouteNode } from './ExpeditionRoute';

/** The MVP intentionally ends on the first leak. Full V0.1 rules are separate. */
export type Phase = 'map' | 'prepare' | 'battle' | 'won' | 'lost' | 'complete';
export type PetId = 'cat' | 'rabbit' | 'deer' | 'mushroom';
export interface Point { x: number; y: number }
export const STEP = 1 / 30;
export const ECONOMY = {
    startingDew: 60, summonCost: 30, dewPerSecond: 2,
    deploymentLimit: 6, rosterLimit: 12, relocationTicks: 30,
} as const;
export const PET_ORDER: readonly PetId[] = ['cat', 'rabbit', 'deer', 'mushroom'];
export const PETS = {
    cat: { name: '爪爪猫', role: '近战', range: 94, damage: 24, interval: 0.65, boost: 0 },
    rabbit: { name: '星弹兔', role: '远程', range: 215, damage: 12, interval: 0.7, boost: 0 },
    deer: { name: '铃芽鹿', role: '增益', range: 185, damage: 0, interval: 0, boost: 0.4 },
    mushroom: { name: '茸茸菇', role: '持续伤害', range: 145, damage: 8, interval: 0.5, boost: 0 },
} as const;
/** Portrait battlefield: upper-left entrance, three cross-field turns, lower-right tree. */
export const PATH: readonly Point[] = [
    { x: -250, y: 300 }, { x: -250, y: 160 }, { x: 250, y: 160 },
    { x: 250, y: 0 }, { x: -250, y: 0 }, { x: -250, y: -160 },
    { x: 250, y: -160 }, { x: 250, y: -300 },
];
export const SLOTS: readonly Point[] = [
    { x: -160, y: 240 }, { x: -40, y: 240 }, { x: 80, y: 240 }, { x: 200, y: 240 },
    { x: -200, y: 80 }, { x: -80, y: 80 }, { x: 40, y: 80 }, { x: 160, y: 80 },
    { x: -160, y: -80 }, { x: -40, y: -80 }, { x: 80, y: -80 }, { x: 200, y: -80 },
    { x: -200, y: -240 }, { x: -80, y: -240 }, { x: 40, y: -240 }, { x: 160, y: -240 },
];
export interface PetState {
    id: number; species: PetId; slot: number | null;
    cooldown: number; lastAttack: number; readyTick: number;
}
export type ActionError = 'WRONG_PHASE' | 'PAUSED' | 'INVALID_SLOT' | 'INVALID_SPECIES'
    | 'SLOT_OCCUPIED' | 'INSUFFICIENT_DEW' | 'DEPLOYMENT_FULL' | 'ROSTER_FULL' | 'PET_NOT_FOUND';
export type PetActionResult = { ok: true; pet: PetState } | { ok: false; reason: ActionError };
export interface EnemyState extends Point { id: number; kind: EnemyKind; distance: number; hp: number; maxHp: number; lastDamageTick: number }
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
    readonly route: readonly RouteNode[];
    readonly routeDepths = ROUTE_DEPTHS;
    constructor(readonly seed = 1) { this.route = generateRoute(seed); }

    phase: Phase = 'map';
    heart = 1;
    dew: number = ECONOMY.startingDew;
    paused = false;
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

    get available(): readonly RouteNode[] {
        if (this.phase !== 'map') return [];
        const last = this.route.find(n => n.id === this.visited[this.visited.length - 1]);
        return this.route.filter(n => last ? last.children.includes(n.id) : n.depth === 0);
    }

    chooseNode(id: string): boolean {
        const choice = this.available.find(n => n.id === id);
        if (!choice) return false;
        this.current = choice;
        this.phase = 'prepare';
        this.tick = 0; this.spawned = 0; this.kills = 0;
        this.nextSpawn = 1; this.enemies = []; this.projectiles = []; this.marks = [];
        this.dew = ECONOMY.startingDew; this.paused = false;
        // The MVP uses the same battlefield in every encounter: keep the squad and its slots.
        for (const pet of this.pets) { pet.cooldown = 0; pet.lastAttack = -10; pet.readyTick = 0; }
        return true;
    }

    get deployedCount(): number { return this.pets.filter(p => p.slot !== null).length; }

    summonPet(species: PetId, slot: number): PetActionResult {
        const error = this.checkPlacement(slot);
        if (error) return { ok: false, reason: error };
        if (!PET_ORDER.includes(species)) return { ok: false, reason: 'INVALID_SPECIES' };
        if (this.pets.some(p => p.slot === slot)) return { ok: false, reason: 'SLOT_OCCUPIED' };
        if (this.deployedCount >= ECONOMY.deploymentLimit) return { ok: false, reason: 'DEPLOYMENT_FULL' };
        if (this.pets.length >= ECONOMY.rosterLimit) return { ok: false, reason: 'ROSTER_FULL' };
        if (this.dew < ECONOMY.summonCost) return { ok: false, reason: 'INSUFFICIENT_DEW' };
        // Deduct only after every check. Each successful summon creates a distinct instance.
        this.dew -= ECONOMY.summonCost;
        const pet: PetState = { id: this.nextId++, species, slot, cooldown: 0, lastAttack: -10, readyTick: this.tick };
        this.pets.push(pet);
        return { ok: true, pet };
    }

    movePet(id: number, slot: number): PetActionResult {
        const error = this.checkPlacement(slot);
        if (error) return { ok: false, reason: error };
        const pet = this.pets.find(p => p.id === id);
        if (!pet) return { ok: false, reason: 'PET_NOT_FOUND' };
        if (pet.slot === slot) {
            pet.slot = null; this.markRelocation(pet);
            return { ok: true, pet };
        }
        const occupant = this.pets.find(p => p.slot === slot);
        if (!occupant && pet.slot === null && this.deployedCount >= ECONOMY.deploymentLimit)
            return { ok: false, reason: 'DEPLOYMENT_FULL' };
        if (occupant) { occupant.slot = pet.slot; this.markRelocation(occupant); }
        pet.slot = slot;
        this.markRelocation(pet);
        return { ok: true, pet };
    }

    setPaused(paused: boolean): boolean {
        if (this.phase !== 'battle') return false;
        this.paused = paused;
        return true;
    }

    private checkPlacement(slot: number): ActionError | null {
        if (this.phase !== 'prepare' && this.phase !== 'battle') return 'WRONG_PHASE';
        if (this.paused) return 'PAUSED';
        if (!Number.isInteger(slot) || !SLOTS[slot]) return 'INVALID_SLOT';
        return null;
    }

    private markRelocation(pet: PetState): void {
        if (this.phase === 'battle') pet.readyTick = this.tick + ECONOMY.relocationTicks;
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

    /** Only the strongest ready, deployed support applies; leaving its radius removes the bonus. */
    attackMultiplier(pet: PetState): number {
        if (pet.slot === null || pet.species === 'deer') return 1;
        const origin = SLOTS[pet.slot]; let boost = 0;
        for (const support of this.pets) {
            if (support.id === pet.id || support.species !== 'deer' || support.slot === null
                || this.tick < support.readyTick) continue;
            if (distance(origin, SLOTS[support.slot]) <= PETS.deer.range) boost = Math.max(boost, PETS.deer.boost);
        }
        return 1 + boost;
    }

    effectiveDamage(pet: PetState): number { return PETS[pet.species].damage * this.attackMultiplier(pet); }

    private damageEnemy(enemy: EnemyState, amount: number, source: 'direct' | 'spore'): void {
        if (enemy.hp <= 0) return;
        enemy.hp -= amount * (source === 'spore' ? 1 : 1 - ENEMIES[enemy.kind].armor);
        enemy.lastDamageTick = this.tick;
    }

    step(): void {
        const encounter = this.current;
        if (this.phase !== 'battle' || this.paused || !encounter) return;
        this.tick++;
        const time = this.tick * STEP;
        if (this.spawned < encounter.count && time >= this.nextSpawn) {
            const kind = encounter.wave[this.spawned];
            const hp = Math.round(encounter.hp * ENEMIES[kind].hp);
            this.enemies.push({ id: this.nextId++, kind, distance: 0, ...PATH[0], hp, maxHp: hp, lastDamageTick: this.tick });
            this.spawned++;
            this.nextSpawn += encounter.wave[this.spawned] === 'boss' ? ENEMY_BALANCE.bossGap : ENEMY_BALANCE.spawnGap;
        }
        for (const enemy of this.enemies) {
            const spec = ENEMIES[enemy.kind];
            const rage = enemy.kind === 'boss' && enemy.hp <= enemy.maxHp * 0.5 ? ENEMY_BALANCE.bossRageSpeed : 1;
            enemy.distance += encounter.speed * spec.speed * rage * STEP;
            const p = pointOnPath(enemy.distance); enemy.x = p.x; enemy.y = p.y;
            // MVP contract: reaching the base ends the run before any same-tick hit.
            if (enemy.distance >= PATH_LENGTH) {
                this.heart = 0; this.phase = 'lost'; return;
            }
        }
        for (const enemy of this.enemies) {
            const regen = ENEMIES[enemy.kind].regeneration;
            if (enemy.hp > 0 && regen && this.tick - enemy.lastDamageTick >= ENEMY_BALANCE.regenDelayTicks)
                enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * regen * STEP);
        }
        // Integer tick boundaries avoid floating-point drift and grant no income while paused/preparing.
        if (this.tick % 30 === 0) this.dew += ECONOMY.dewPerSecond;
        for (const pet of this.pets) {
            if (pet.slot === null || pet.species === 'deer') continue;
            pet.cooldown = Math.max(0, pet.cooldown - STEP);
            if (pet.cooldown > 1e-8 || this.tick < pet.readyTick) continue;
            const origin = SLOTS[pet.slot]; const spec = PETS[pet.species];
            const damage = this.effectiveDamage(pet);
            if (pet.species === 'mushroom') {
                let hit = false;
                for (const enemy of this.enemies) {
                    if (enemy.hp <= 0 || distance(origin, enemy) > spec.range) continue;
                    this.damageEnemy(enemy, damage, 'spore'); hit = true;
                    this.marks.push({ from: { ...origin }, to: { x: enemy.x, y: enemy.y },
                        expires: time + 0.22, kind: 'mushroom' });
                }
                if (hit) { pet.cooldown = spec.interval; pet.lastAttack = time; }
                continue;
            }
            let target: EnemyState | undefined;
            for (const enemy of this.enemies) {
                if (enemy.hp <= 0 || distance(origin, enemy) > spec.range) continue;
                if (!target || enemy.distance > target.distance ||
                    (enemy.distance === target.distance && enemy.id < target.id)) target = enemy;
            }
            if (!target) continue;
            pet.cooldown = spec.interval; pet.lastAttack = time;
            if (pet.species === 'cat') {
                this.damageEnemy(target, damage, 'direct');
                this.marks.push({ from: { ...origin }, to: { x: target.x, y: target.y }, expires: time + 0.18, kind: 'cat' });
            } else {
                this.projectiles.push({ id: this.nextId++, targetId: target.id, ...origin, damage });
            }
        }
        for (const projectile of this.projectiles) {
            const target = this.enemies.find(e => e.id === projectile.targetId && e.hp > 0);
            if (!target) { projectile.targetId = -1; continue; }
            const length = distance(projectile, target); const travel = 510 * STEP;
            if (length <= travel) {
                this.damageEnemy(target, projectile.damage, 'direct'); projectile.targetId = -1;
                this.marks.push({ from: { ...target }, to: { ...target }, expires: time + 0.12, kind: 'rabbit' });
            } else {
                projectile.x += (target.x - projectile.x) / length * travel;
                projectile.y += (target.y - projectile.y) / length * travel;
            }
        }
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0) { this.kills++; this.dew += ENEMIES[enemy.kind].reward; }
        }
        this.enemies = this.enemies.filter(e => e.hp > 0);
        this.projectiles = this.projectiles.filter(p => p.targetId !== -1);
        this.marks = this.marks.filter(m => m.expires > time);
        if (this.phase === 'battle' && this.spawned === encounter.count && this.enemies.length === 0) this.phase = 'won';
    }
}
