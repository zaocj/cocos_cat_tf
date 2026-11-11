import { expect, test } from 'vitest';
import { MvpSession, PET_ORDER, PetId, PetState, EnemyState, pointOnPath, STEP } from '../assets/scripts/domain/MvpSession.ts';
import { PET_GROWTH, mutationCards, MutationId } from '../assets/scripts/domain/PetGrowth.ts';

function prepare(chance = 0, seed = 3): MvpSession {
    const g = new MvpSession(seed, { mutationChance: chance, carriedPets: PET_ORDER }); g.chooseNode(g.available[0].id); g.dew = 1000; return g;
}
function summon(g: MvpSession, species: PetId, slot: number): PetState {
    const r = g.summonPet(species, slot); if (!r.ok) throw new Error('Could not summon'); return r.pet;
}
function evolve(g: MvpSession, species: PetId, mutation: MutationId, slot = 0): PetState {
    const a = summon(g, species, slot); const b = summon(g, species, slot === 2 ? 4 : 2);
    const r = g.mergePets(b.id, a.id); if (!r.ok) throw new Error('Could not merge');
    expect(g.chooseMutation(mutation)).toBe(true); return r.pet;
}
function enemy(id: number, travel: number): EnemyState {
    return { id, kind: 'mist', hp: 1000, maxHp: 1000, distance: travel, ...pointOnPath(travel), lastDamageTick: 0 };
}
function battle(g: MvpSession, foes: EnemyState[]): void {
    if (!g.current) throw new Error('Missing encounter');
    g.current = { ...g.current, speed: 0 }; g.spawned = g.current.count; g.enemies = foes; g.startBattle();
}
function ticks(g: MvpSession, n: number): void { for (let i = 0; i < n; i++) g.step(); }

test('new pets start at one star; free merge consumes two and keeps target ID, position and total investment', () => {
    const g = prepare(); const a = summon(g, 'cat', 0); const b = summon(g, 'cat', 4); const dew = g.dew;
    expect(a.star).toBe(1); expect(a.mutations).toEqual([]);
    g.movePet(a.id, 0); // A reserve material may merge into a deployed target.
    const r = g.mergePets(a.id, b.id); if (!r.ok) throw new Error('Missing result');
    expect(g.pets).toHaveLength(1); expect(r.pet.id).toBe(b.id); expect(r.pet.slot).toBe(4);
    expect(r.pet.star).toBe(2); expect(r.pet.purchaseCost).toBe(60); expect(g.dew).toBe(dew);
    expect(g.petStats(r.pet).damage).toBeCloseTo(45.6); expect(g.pendingMutation).toBeNull();
    expect(g.releasePet(r.pet.id)).toEqual({ ok: true, refund: 36, species: 'cat' });
});

test('equal-star merges reach three stars and reject any fourth-star merge without consuming inputs or random state', () => {
    const g = prepare(); const ids = g.unlockedSlots.map(slot => summon(g, 'cat', slot).id);
    const twos: number[] = [];
    for (let i = 0; i < ids.length; i += 2) { const r = g.mergePets(ids[i], ids[i + 1]); if (!r.ok) throw new Error('Missing two'); twos.push(r.pet.id); }
    g.mergePets(twos[0], twos[1]); g.mergePets(twos[2], twos[3]);
    expect(g.pets.map(p => p.star)).toEqual([3, 3]); expect(g.pets[0].purchaseCost).toBe(120);
    const before = JSON.stringify(g.pets); const state = g.mutationRngState;
    expect(g.mergePets(twos[1], twos[3])).toEqual({ ok: false, reason: 'MAX_STARS' });
    expect(JSON.stringify(g.pets)).toBe(before); expect(g.mutationRngState).toBe(state);
    expect(g.petStats(g.pets[0]).damage).toBeCloseTo(91.2);
});

test('self, species, star, missing ID and paused merges are atomic; previews never advance randomness', () => {
    const g = prepare(); const a = summon(g, 'cat', 0); const b = summon(g, 'rabbit', 2); const c = summon(g, 'cat', 4);
    const state = g.mutationRngState;
    for (let i = 0; i < 20; i++) expect(g.mergeError(a.id, c.id)).toBeNull();
    expect(g.mergePets(a.id, a.id)).toEqual({ ok: false, reason: 'SAME_PET' });
    expect(g.mergePets(a.id, b.id)).toEqual({ ok: false, reason: 'SPECIES_MISMATCH' });
    expect(g.mergePets(a.id, 9999)).toEqual({ ok: false, reason: 'PET_NOT_FOUND' });
    expect(g.mutationRngState).toBe(state); expect(g.pets).toHaveLength(3);
    g.mergePets(a.id, c.id); const d = summon(g, 'cat', 0);
    const nextState = g.mutationRngState;
    expect(g.mergePets(d.id, c.id)).toEqual({ ok: false, reason: 'STAR_MISMATCH' });
    g.startBattle(); g.setPaused(true);
    expect(g.mergePets(d.id, c.id)).toEqual({ ok: false, reason: 'PAUSED' });
    expect(g.mutationRngState).toBe(nextState);
});

test('mutation offers exactly two stable cards, locks the simulation and transactions, and resolves once', () => {
    const g = prepare(1); const a = summon(g, 'rabbit', 0); const b = summon(g, 'rabbit', 4);
    g.startBattle(); ticks(g, 45); const tick = g.tick; const distance = g.enemies[0].distance; const dew = g.dew;
    const r = g.mergePets(a.id, b.id); if (!r.ok) throw new Error('Missing result');
    expect(g.phase).toBe('mutation'); expect(g.pendingMutation?.choices).toEqual(['power', 'resonance']);
    expect(r.pet.readyTick).toBe(tick + 30); const state = g.mutationRngState;
    ticks(g, 300); expect(g.tick).toBe(tick); expect(g.enemies[0].distance).toBe(distance);
    expect(g.dew).toBe(dew); expect(g.releasePet(b.id).ok).toBe(false); expect(g.cultivate(1).ok).toBe(false);
    expect(g.mergePets(a.id, b.id).ok).toBe(false); expect(g.summonPet('cat', 0).ok).toBe(false);
    expect(g.setPaused(false)).toBe(false); expect(g.continueRoute()).toBe(false);
    expect(g.chooseMutation('power')).toBe(true); expect(g.phase).toBe('battle'); expect(g.paused).toBe(false);
    expect(g.chooseMutation('resonance')).toBe(false); expect(r.pet.mutations).toEqual(['power']);
    expect(g.mutationRngState).toBe(state);
});

test('background pause survives a pending choice while inherited mutations are retained and a third is added', () => {
    const g = prepare(1); const a = evolve(g, 'cat', 'power'); const b = evolve(g, 'cat', 'resonance', 4);
    g.startBattle(); const r = g.mergePets(a.id, b.id); if (!r.ok) throw new Error('Missing merge');
    expect(r.pet.star).toBe(3); expect(r.pet.mutations).toEqual(['resonance', 'power']);
    expect(g.setPaused(true)).toBe(true); expect(g.chooseMutation('longarm')).toBe(true);
    expect(g.paused).toBe(true); expect(g.petStats(r.pet).damage).toBeCloseTo(91.2 * 2 * 0.85 * 0.75);
    expect(r.pet.purchaseCost).toBe(120); expect(g.pets).toHaveLength(1);
    g.setPaused(false); const before = g.tick; g.step(); expect(g.tick).toBe(before + 1);
});

test('chance is configurable, defaults to 50 percent, reproduces by seed, and is independent of map generation', () => {
    expect(new MvpSession(1, { carriedPets: PET_ORDER }).mutationChance).toBe(0.5); expect(PET_GROWTH.mutationChance).toBe(0.5);
    expect(() => new MvpSession(1, { mutationChance: 2 })).toThrow(RangeError);
    expect(() => new MvpSession(1, { mutationChance: NaN })).toThrow(RangeError);
    let mutations = 0;
    for (let seed = 0; seed < 1000; seed++) {
        const g = prepare(0.5, seed); const copy = prepare(0.5, seed);
        for (const s of [g, copy]) { const a = summon(s, 'cat', 0); const b = summon(s, 'cat', 4); s.mergePets(a.id, b.id); }
        expect(g.pendingMutation).toEqual(copy.pendingMutation); expect(g.route).toEqual(copy.route);
        if (g.pendingMutation) mutations++;
    }
    expect(mutations).toBeGreaterThan(450); expect(mutations).toBeLessThan(550);
});

test('power mutation changes real direct damage and attack interval with no extra multiplier stacking', () => {
    const g = prepare(1); const pet = evolve(g, 'cat', 'power'); const foe = enemy(1000, 210);
    battle(g, [foe]); g.step(); expect(foe.hp).toBeCloseTo(1000 - 91.2);
    expect(g.attackInterval(pet)).toBeCloseTo(0.975); expect(pet.cooldown).toBeCloseTo(0.975);
});

test('resonant cat splashes other nearby enemies only on each third real attack', () => {
    const g = prepare(1); const pet = evolve(g, 'cat', 'resonance');
    const other = enemy(1000, 210); const target = enemy(1001, 260); battle(g, [other, target]);
    ticks(g, 21); expect(pet.attackCount).toBe(2); expect(other.hp).toBe(1000);
    ticks(g, 20); expect(pet.attackCount).toBe(3); expect(other.hp).toBeCloseTo(1000 - 45.6 * 0.85 * 0.6);
    expect(target.hp).toBeCloseTo(1000 - 45.6 * 0.85 * 3); expect(g.marks.some(m => m.radius === 90)).toBe(true);
});

test('resonant rabbit fires an additional snapshotted bolt at a different target, or the same lone target', () => {
    for (const count of [1, 2]) {
        const g = prepare(1); const pet = evolve(g, 'rabbit', 'resonance'); pet.attackCount = 2;
        battle(g, [enemy(1000, 210), ...(count === 2 ? [enemy(1001, 260)] : [])]); g.step();
        expect(g.projectiles).toHaveLength(2); expect(g.projectiles[0].damage).toBeCloseTo(22.8);
        expect(g.projectiles[1].damage).toBeCloseTo(15.96);
        expect(new Set(g.projectiles.map(p => p.targetId)).size).toBe(count);
    }
});

test('resonant mushroom expands only the third pulse and retains half-second fixed-step timing', () => {
    const g = prepare(1); const pet = evolve(g, 'mushroom', 'resonance');
    const inner = enemy(1000, 260); const outer = enemy(1001, 400); battle(g, [inner, outer]);
    ticks(g, 16); expect(pet.attackCount).toBe(2); expect(outer.hp).toBe(1000);
    expect(g.attackRange(pet)).toBeCloseTo(145 * 1.35); ticks(g, 15);
    expect(pet.attackCount).toBe(3); expect(outer.hp).toBeCloseTo(984.8);
    expect(inner.hp).toBeCloseTo(1000 - 15.2 * 3); expect(g.attackRange(pet)).toBe(145);
});

test('deer power trades radius for aura strength, while resonance speeds allies without stacking', () => {
    const power = prepare(1); const deer = evolve(power, 'deer', 'power', 5);
    const near = summon(power, 'cat', 4); const far = summon(power, 'cat', 0);
    expect(power.petStats(deer).boost).toBeCloseTo(0.96); expect(power.petStats(deer).range).toBeCloseTo(129.5);
    expect(power.effectiveDamage(near)).toBeCloseTo(47.04); expect(power.effectiveDamage(far)).toBe(24);
    const resonance = prepare(1); evolve(resonance, 'deer', 'resonance', 5);
    const cat = summon(resonance, 'cat', 0);
    expect(resonance.effectiveDamage(cat)).toBeCloseTo(38.4); expect(resonance.attackInterval(cat)).toBeCloseTo(0.65 / 1.2);
    const second = summon(resonance, 'deer', 4); second.mutations = ['resonance'];
    expect(resonance.attackInterval(cat)).toBeCloseTo(0.65 / 1.2);
});

test('star, mutation, invested cost and placement persist across nodes and pending choices cannot advance the route', () => {
    const g = prepare(1); const a = summon(g, 'cat', 0); const b = summon(g, 'cat', 4);
    g.mergePets(a.id, b.id); expect(g.chooseNode(g.route[1].id)).toBe(false);
    g.chooseMutation('resonance'); g.pets[0].attackCount = 2; g.phase = 'won'; g.continueRoute(); g.chooseNode(g.available[0].id);
    expect(g.pets[0]).toMatchObject({ id: b.id, star: 2, mutations: ['resonance'], purchaseCost: 60, slot: 4, attackCount: 0 });
    const before = g.tick; g.step(); expect(g.tick).toBe(before); // Rest/prepare never simulate.
    expect(STEP).toBe(1 / 30); expect(mutationCards('cat').map(c => c.id)).toEqual(['power', 'resonance', 'longarm']);
});
