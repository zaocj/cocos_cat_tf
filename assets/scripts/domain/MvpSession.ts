import { PET_GROWTH, Star, MutationId } from './PetGrowth';
import { ENEMIES, ENEMY_BALANCE, EnemyKind } from './EnemyConfig';
import { generateRoute, RouteNode, ROUTE_DEPTHS } from './ExpeditionRoute';
export type { RouteNode } from './ExpeditionRoute';

/** Expedition resources persist until a new run; only zero tree health ends the run. */
export type Phase = 'map' | 'rest' | 'prepare' | 'battle' | 'mutation' | 'won' | 'lost' | 'complete';
export type RestChoice = 'dew' | 'heal';
export type PetId = 'cat' | 'rabbit' | 'deer' | 'mushroom';
export type SummonId = PetId | 'mole';
export interface Point { x: number; y: number }
export const STEP = 1 / 30;
export const ECONOMY = {
    startingDew: 60, summonCost: 30, restDew: 45, restHeal: 1, maxHeart: 3,
    cultivateCost: 20, releaseRate: 0.6, relocationTicks: 30,
} as const;
export const PET_ORDER: readonly PetId[] = ['cat', 'rabbit', 'deer', 'mushroom'];
export const SUMMON_ORDER: readonly SummonId[] = [...PET_ORDER, 'mole'];
export const PETS = {
    cat: { name: '爪爪猫', role: '近战', cost: ECONOMY.summonCost, range: 94, damage: 24, interval: 0.65, boost: 0 },
    rabbit: { name: '星弹兔', role: '远程', cost: ECONOMY.summonCost, range: 215, damage: 12, interval: 0.7, boost: 0 },
    deer: { name: '铃芽鹿', role: '增益', cost: ECONOMY.summonCost, range: 185, damage: 0, interval: 0, boost: 0.4 },
    mushroom: { name: '茸茸菇', role: '持续伤害', cost: ECONOMY.summonCost, range: 145, damage: 8, interval: 0.5, boost: 0 },
    mole: { name: '掘芽鼹', role: '一次性开垦', cost: ECONOMY.cultivateCost, range: 0, damage: 0, interval: 0, boost: 0 },
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
/** Half the stumps begin covered by mist vines; opening is permanent within the run. */
export const LOCKED_SLOTS: readonly number[] = [1, 3, 7, 10, 11, 12, 14, 15];
export interface PetState {
    id: number; species: PetId; slot: number | null;
    star: Star; mutation: MutationId | null; attackCount: number;
    readonly purchaseCost: number; cooldown: number; lastAttack: number; readyTick: number;
}
export type ActionError = 'WRONG_PHASE' | 'PAUSED' | 'INVALID_SLOT' | 'INVALID_SPECIES'
    | 'SLOT_OCCUPIED' | 'SLOT_LOCKED' | 'SLOT_OPEN' | 'INSUFFICIENT_DEW' | 'ROSTER_FULL' | 'PET_NOT_FOUND' | 'SAME_PET' | 'SPECIES_MISMATCH' | 'STAR_MISMATCH' | 'MAX_STARS';
export type PetActionResult = { ok: true; pet: PetState } | { ok: false; reason: ActionError };
export type CultivationResult = { ok: true; slot: number } | { ok: false; reason: ActionError };
export type ReleaseResult = { ok: true; refund: number; species: PetId } | { ok: false; reason: ActionError };
export type MergeResult = { ok: true; pet: PetState; mutationRequired: boolean } | { ok: false; reason: ActionError };
export interface PendingMutation { petId: number; choices: readonly MutationId[]; resumePhase: 'prepare' | 'battle'; pauseAfterChoice: boolean }
export interface PetStats { damage: number; interval: number; range: number; boost: number }
export interface EnemyState extends Point { id: number; kind: EnemyKind; distance: number; hp: number; maxHp: number; lastDamageTick: number }
export interface ProjectileState extends Point { id: number; targetId: number; damage: number }
export interface AttackMark { from: Point; to: Point; expires: number; kind: PetId; radius?: number }

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
    readonly mutationChance: number;
    private mutationState: number;
    constructor(readonly seed = 1, options: { mutationChance?: number } = {}) {
        this.route = generateRoute(seed);
        this.mutationChance = options.mutationChance ?? PET_GROWTH.mutationChance;
        if (!Number.isFinite(this.mutationChance) || this.mutationChance < 0 || this.mutationChance > 1)
            throw new RangeError('mutationChance must be between 0 and 1');
        this.mutationState = (seed ^ 0x9E3779B9) >>> 0;
    }
    get mutationRngState(): number { return this.mutationState; }

    phase: Phase = 'map';
    pendingMutation: PendingMutation | null = null;
    readonly maxHeart = ECONOMY.maxHeart;
    heart: number = this.maxHeart;
    dew: number = ECONOMY.startingDew;
    paused = false;
    tick = 0;
    kills = 0;
    leaked = 0;
    spawned = 0;
    visited: string[] = [];
    current: RouteNode | null = null;
    readonly unlockedSlots: number[] = SLOTS.map((_, i) => i).filter(i => !LOCKED_SLOTS.includes(i));
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
        this.phase = choice.kind === 'rest' ? 'rest' : 'prepare';
        this.tick = 0; this.spawned = 0; this.kills = 0; this.leaked = 0;
        this.nextSpawn = 1; this.enemies = []; this.projectiles = []; this.marks = [];
        this.paused = false;
        // The MVP uses the same battlefield in every encounter: keep the squad and its slots.
        for (const pet of this.pets) { pet.cooldown = 0; pet.lastAttack = -10; pet.readyTick = 0; pet.attackCount = 0; }
        return true;
    }

    takeRest(choice: RestChoice): boolean {
        if (this.phase !== 'rest' || this.current?.kind !== 'rest' || this.heart <= 0) return false;
        if (choice === 'dew') this.dew += ECONOMY.restDew;
        else if (choice === 'heal' && this.heart < this.maxHeart)
            this.heart = Math.min(this.maxHeart, this.heart + ECONOMY.restHeal);
        else return false;
        // Resolve the choice and visit atomically. A repeated click cannot receive both rewards.
        this.phase = 'won';
        return this.continueRoute();
    }

    get deploymentLimit(): number { return this.unlockedSlots.length; }
    get rosterLimit(): number { return SLOTS.length; }
    isSlotOpen(slot: number): boolean { return this.unlockedSlots.includes(slot); }

    get deployedCount(): number { return this.pets.filter(p => p.slot !== null).length; }

    summonPet(species: PetId, slot: number): PetActionResult {
        const error = this.checkPlacement(slot);
        if (error) return { ok: false, reason: error };
        if (!PET_ORDER.includes(species)) return { ok: false, reason: 'INVALID_SPECIES' };
        if (!this.isSlotOpen(slot)) return { ok: false, reason: 'SLOT_LOCKED' };
        if (this.pets.some(p => p.slot === slot)) return { ok: false, reason: 'SLOT_OCCUPIED' };
        if (this.pets.length >= this.rosterLimit) return { ok: false, reason: 'ROSTER_FULL' };
        if (this.dew < PETS[species].cost) return { ok: false, reason: 'INSUFFICIENT_DEW' };
        // Deduct only after every check. Each successful summon creates a distinct instance.
        this.dew -= PETS[species].cost;
        const pet: PetState = { id: this.nextId++, species, slot, star: 1, mutation: null, attackCount: 0, purchaseCost: PETS[species].cost, cooldown: 0, lastAttack: -10, readyTick: this.tick };
        this.pets.push(pet);
        return { ok: true, pet };
    }

    movePet(id: number, slot: number): PetActionResult {
        const error = this.checkPlacement(slot);
        if (error) return { ok: false, reason: error };
        if (!this.isSlotOpen(slot)) return { ok: false, reason: 'SLOT_LOCKED' };
        const pet = this.pets.find(p => p.id === id);
        if (!pet) return { ok: false, reason: 'PET_NOT_FOUND' };
        if (pet.slot === slot) {
            pet.slot = null; this.markRelocation(pet);
            return { ok: true, pet };
        }
        const occupant = this.pets.find(p => p.slot === slot);
        if (occupant) { occupant.slot = pet.slot; this.markRelocation(occupant); }
        pet.slot = slot;
        this.markRelocation(pet);
        return { ok: true, pet };
    }

    cultivate(slot: number): CultivationResult {
        const error = this.checkPlacement(slot);
        if (error) return { ok: false, reason: error };
        if (this.isSlotOpen(slot)) return { ok: false, reason: 'SLOT_OPEN' };
        if (this.dew < PETS.mole.cost) return { ok: false, reason: 'INSUFFICIENT_DEW' };
        this.dew -= PETS.mole.cost;
        this.unlockedSlots.push(slot);
        // The mole leaves immediately: it never becomes a deployed/reserve pet or consumes an ID.
        return { ok: true, slot };
    }

    releasePet(id: number): ReleaseResult {
        if (this.phase !== 'prepare' && this.phase !== 'battle') return { ok: false, reason: 'WRONG_PHASE' };
        if (this.paused) return { ok: false, reason: 'PAUSED' };
        const index = this.pets.findIndex(p => p.id === id);
        if (index < 0) return { ok: false, reason: 'PET_NOT_FOUND' };
        const pet = this.pets[index];
        const refund = Math.floor(pet.purchaseCost * ECONOMY.releaseRate);
        this.pets.splice(index, 1);
        this.dew += refund;
        return { ok: true, refund, species: pet.species };
    }

    mergeError(sourceId: number, targetId: number): ActionError | null {
        if (this.phase !== 'prepare' && this.phase !== 'battle') return 'WRONG_PHASE';
        if (this.paused) return 'PAUSED';
        if (sourceId === targetId) return 'SAME_PET';
        const source = this.pets.find(p => p.id === sourceId); const target = this.pets.find(p => p.id === targetId);
        if (!source || !target) return 'PET_NOT_FOUND';
        if (source.species !== target.species) return 'SPECIES_MISMATCH';
        if (source.star !== target.star) return 'STAR_MISMATCH';
        if (target.star >= 3) return 'MAX_STARS';
        return null;
    }

    mergePets(sourceId: number, targetId: number): MergeResult {
        const error = this.mergeError(sourceId, targetId);
        if (error) return { ok: false, reason: error };
        const source = this.pets.find(p => p.id === sourceId); const target = this.pets.find(p => p.id === targetId);
        if (!source || !target) return { ok: false, reason: 'PET_NOT_FOUND' };
        const resumePhase = this.phase === 'battle' ? 'battle' : 'prepare';
        const pet: PetState = { ...target, star: target.star === 1 ? 2 : 3,
            purchaseCost: source.purchaseCost + target.purchaseCost,
            mutation: target.mutation ?? source.mutation, attackCount: 0,
            cooldown: Math.max(source.cooldown, target.cooldown), lastAttack: Math.max(source.lastAttack, target.lastAttack),
            readyTick: Math.max(source.readyTick, target.readyTick, this.phase === 'battle' ? this.tick + ECONOMY.relocationTicks : 0) };
        this.pets = this.pets.filter(p => p.id !== sourceId).map(p => p.id === targetId ? pet : p);
        // One independent draw after a valid commit; previews/invalid commands never draw.
        this.mutationState = (this.mutationState + 0x6D2B79F5) >>> 0;
        let n = Math.imul(this.mutationState ^ (this.mutationState >>> 15), 1 | this.mutationState);
        n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
        const roll = ((n ^ (n >>> 14)) >>> 0) / 4294967296;
        const mutationRequired = roll < this.mutationChance;
        if (mutationRequired) {
            this.pendingMutation = { petId: pet.id, choices: ['power', 'resonance'], resumePhase, pauseAfterChoice: false };
            this.phase = 'mutation'; this.paused = true;
        }
        return { ok: true, pet, mutationRequired };
    }

    chooseMutation(choice: MutationId): boolean {
        const pending = this.pendingMutation;
        if (this.phase !== 'mutation' || !pending || !pending.choices.includes(choice)) return false;
        const pet = this.pets.find(p => p.id === pending.petId);
        if (!pet) return false;
        pet.mutation = choice;
        this.phase = pending.resumePhase;
        this.paused = pending.resumePhase === 'battle' && pending.pauseAfterChoice;
        this.pendingMutation = null;
        return true;
    }

    setPaused(paused: boolean): boolean {
        if (this.phase === 'mutation' && this.pendingMutation && paused) { this.pendingMutation.pauseAfterChoice = true; return true; }
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
            if (distance(origin, SLOTS[support.slot]) <= this.petStats(support).range) boost = Math.max(boost, this.petStats(support).boost);
        }
        return 1 + boost;
    }

    petStats(pet: PetState): PetStats {
        const spec = PETS[pet.species]; const power = pet.mutation === 'power';
        return { damage: spec.damage * PET_GROWTH.damageByStar[pet.star - 1] * (power ? PET_GROWTH.powerDamage : 1),
            interval: spec.interval * (power ? PET_GROWTH.powerInterval : 1),
            range: spec.range * (power && pet.species === 'deer' ? PET_GROWTH.powerAuraRange : 1),
            boost: pet.species === 'deer' ? PET_GROWTH.deerBoostByStar[pet.star - 1] * (power ? PET_GROWTH.powerAura : 1) : 0 };
    }

    attackRange(pet: PetState): number {
        return this.petStats(pet).range * (pet.species === 'mushroom' && pet.mutation === 'resonance'
            && (pet.attackCount + 1) % PET_GROWTH.resonanceEvery === 0 ? PET_GROWTH.sporeRange : 1);
    }

    attackInterval(pet: PetState): number {
        const interval = this.petStats(pet).interval;
        if (pet.slot === null) return interval;
        const origin = SLOTS[pet.slot];
        const accelerated = this.pets.some(support => support.species === 'deer' && support.mutation === 'resonance'
            && support.slot !== null && this.tick >= support.readyTick && support.id !== pet.id
            && distance(origin, SLOTS[support.slot]) <= this.petStats(support).range);
        return interval / (accelerated ? PET_GROWTH.auraSpeed : 1);
    }

    effectiveDamage(pet: PetState): number { return this.petStats(pet).damage * this.attackMultiplier(pet); }

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
            // Escaped enemies damage the tree before any same-tick hit, and grant no loot.
            if (enemy.distance >= PATH_LENGTH) {
                this.heart = Math.max(0, this.heart - 1); this.leaked++;
                if (this.heart === 0) {
                    this.enemies = this.enemies.filter(e => e.distance < PATH_LENGTH);
                    this.phase = 'lost'; return;
                }
            }
        }
        this.enemies = this.enemies.filter(e => e.distance < PATH_LENGTH);
        for (const enemy of this.enemies) {
            const regen = ENEMIES[enemy.kind].regeneration;
            if (enemy.hp > 0 && regen && this.tick - enemy.lastDamageTick >= ENEMY_BALANCE.regenDelayTicks)
                enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * regen * STEP);
        }
        for (const pet of this.pets) {
            if (pet.slot === null || pet.species === 'deer') continue;
            pet.cooldown = Math.max(0, pet.cooldown - STEP);
            if (pet.cooldown > 1e-8 || this.tick < pet.readyTick) continue;
            const origin = SLOTS[pet.slot]; const range = this.attackRange(pet);
            const damage = this.effectiveDamage(pet);
            if (pet.species === 'mushroom') {
                let hit = false;
                for (const enemy of this.enemies) {
                    if (enemy.hp <= 0 || distance(origin, enemy) > range) continue;
                    this.damageEnemy(enemy, damage, 'spore'); hit = true;
                    this.marks.push({ from: { ...origin }, to: { x: enemy.x, y: enemy.y },
                        expires: time + 0.22, kind: 'mushroom' });
                }
                if (hit) { pet.attackCount++; pet.cooldown = this.attackInterval(pet); pet.lastAttack = time; }
                continue;
            }
            let target: EnemyState | undefined;
            for (const enemy of this.enemies) {
                if (enemy.hp <= 0 || distance(origin, enemy) > range) continue;
                if (!target || enemy.distance > target.distance ||
                    (enemy.distance === target.distance && enemy.id < target.id)) target = enemy;
            }
            if (!target) continue;
            pet.attackCount++;
            const resonant = pet.mutation === 'resonance' && pet.attackCount % PET_GROWTH.resonanceEvery === 0;
            pet.cooldown = this.attackInterval(pet); pet.lastAttack = time;
            if (pet.species === 'cat') {
                this.damageEnemy(target, damage, 'direct');
                if (resonant) for (const other of this.enemies) {
                    if (other.id !== target.id && other.hp > 0 && distance(target, other) <= PET_GROWTH.clawRadius)
                        this.damageEnemy(other, damage * PET_GROWTH.clawDamage, 'direct');
                }
                this.marks.push({ from: { ...origin }, to: { x: target.x, y: target.y }, expires: time + 0.18, kind: 'cat', radius: resonant ? PET_GROWTH.clawRadius : undefined });
            } else {
                this.projectiles.push({ id: this.nextId++, targetId: target.id, ...origin, damage });
                if (resonant) {
                    let second: EnemyState | undefined;
                    for (const other of this.enemies) {
                        if (other.id === target.id || other.hp <= 0 || distance(origin, other) > range) continue;
                        if (!second || other.distance > second.distance || (other.distance === second.distance && other.id < second.id)) second = other;
                    }
                    this.projectiles.push({ id: this.nextId++, targetId: (second ?? target).id, ...origin, damage: damage * PET_GROWTH.extraBoltDamage });
                }
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
