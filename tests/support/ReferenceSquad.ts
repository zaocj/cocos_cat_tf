import { MvpSession, PetId, PetState } from '../../assets/scripts/domain/MvpSession.ts';

export const REFERENCE_SQUAD: readonly { species: PetId; slot: number }[] = [
    { species: 'cat', slot: 0 }, { species: 'rabbit', slot: 4 }, { species: 'deer', slot: 5 },
    { species: 'mushroom', slot: 9 }, { species: 'rabbit', slot: 6 }, { species: 'cat', slot: 8 },
];

/** Combat regression fixture: preloaded catalog via Session options; upgrades use earned dew and public commands. Not the default two-species purchase loop. */
export function developReferenceSquad(game: MvpSession, evolve = true): void {
    const summon = (species: PetId, slot: number): PetState => {
        const result = game.summonPet(species, slot);
        if (!result.ok) throw new Error(`Reference summon failed: ${result.reason}`);
        return result.pet;
    };
    const merge = (source: number, target: number): void => {
        const result = game.mergePets(source, target);
        if (!result.ok) throw new Error(`Reference merge failed: ${result.reason}`);
        if (game.pendingMutation)
            game.chooseMutation(result.pet.species === 'rabbit' || result.pet.species === 'deer' ? 'resonance' : 'power');
    };
    for (const plan of REFERENCE_SQUAD) if (!game.pets.some(p => p.slot === plan.slot)) {
        if (game.dew < 30) return;
        summon(plan.species, plan.slot);
    }
    if (!evolve) return;
    for (const slot of [5, 0, 4, 9, 6, 8]) {
        const main = game.pets.find(p => p.slot === slot);
        if (!main) throw new Error('Reference core is missing');
        if (main.star === 1 && game.dew >= 30) merge(summon(main.species, 2).id, main.id);
    }
    if (game.pets.some(p => p.star === 1)) return;
    for (const slot of [0, 4, 9, 5, 6, 8]) {
        const main = game.pets.find(p => p.slot === slot);
        if (!main) throw new Error('Reference core is missing');
        if (main.star === 2 && game.dew >= 60) {
            const a = summon(main.species, 2); const b = summon(main.species, 13);
            merge(b.id, a.id); merge(a.id, main.id);
        }
    }
}
