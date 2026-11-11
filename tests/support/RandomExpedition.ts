import { MvpSession, PetId, PetState, STEP, ECONOMY, SLOTS, distance } from '../../assets/scripts/domain/MvpSession.ts';

export type Build = 'focused' | 'spores' | 'lightning';
export interface CampaignResult {
    seed: number; build: Build; route: 'rest' | 'shop'; won: boolean; depth: number; heart: number;
    dew: number; purchases: PetId[]; banished: PetId[]; summons: number; merges: number; metamorphoses: number; leaks: number; drawn: Partial<Record<PetId, number>>;
}
const POSITIONS: Record<PetId, readonly number[]> = {
    cat: [0, 6, 8, 9, 4, 2, 13, 5], rabbit: [4, 6, 9, 0, 8, 2, 13, 5],
    deer: [5, 9, 6, 4, 8, 0, 2, 13], mushroom: [9, 4, 8, 6, 0, 2, 13, 5],
    vine: [8, 0, 4, 9, 6, 2, 13, 5], sparrow: [4, 9, 6, 0, 8, 2, 13, 5],
};

/** All actions are player-facing commands. No funds, pet types, stars or RNG state are injected. */
export function playRandomExpedition(seed: number, build: Build, route: 'rest' | 'shop', mutationChance = 0.5, restoreAtNodes = false, useMetamorphosis = false): CampaignResult {
    let game = new MvpSession(seed, { mutationChance });
    const report: CampaignResult = { seed, build, route, won: false, depth: 0, heart: 3, dew: 60,
        purchases: [], banished: [], summons: 0, merges: 0, metamorphoses: 0, leaks: 0, drawn: {} };
    const arrange = (): void => {
        const pets = [...game.pets].sort((a, b) => (a.species === 'deer' ? -1 : 0) - (b.species === 'deer' ? -1 : 0)
            || b.star - a.star || a.id - b.id);
        for (const pet of pets) if (pet.slot !== null) game.movePet(pet.id, pet.slot);
        for (const pet of pets) {
            const slot = POSITIONS[pet.species].find(i => !game.pets.some(p => p.slot === i));
            if (slot !== undefined) game.movePet(pet.id, slot);
        }
    };
    const settleMutation = (): void => {
        if (!game.pendingMutation) return;
        const pet = game.pets.find(p => p.id === game.pendingMutation?.petId);
        const preferred = pet?.species === 'deer' || pet?.species === 'rabbit' || pet?.species === 'sparrow' ? 'resonance' : 'power';
        game.chooseMutation(game.pendingMutation.choices.includes(preferred) ? preferred : game.pendingMutation.choices[0]);
    };
    const shoppingList: PetId[] = build === 'spores' ? ['mushroom', 'deer'] : build === 'lightning' ? ['sparrow', 'vine'] : [];
    const develop = (): void => {
        if (game.phase !== 'prepare' && game.phase !== 'battle') return;
        if (game.phase === 'battle' && game.current && game.spawned === game.current.count
            && game.enemies.length && game.enemies.every(enemy => enemy.distance > 650)) {
            for (const pet of game.pets) if ((pet.slot === 0 || pet.slot === 2) && pet.species !== 'vine' && pet.species !== 'deer'
                && game.enemies.every(enemy => distance(SLOTS[pet.slot ?? 0], enemy) > game.attackRange(pet))) {
                const rear = [9, 8, 13].find(slot => !game.pets.some(p => p.slot === slot));
                if (rear !== undefined) game.movePet(pet.id, rear);
            }
        }
        // Preserve broad coverage first; then merge duplicates to make room for more random draws.
        const children = game.route.filter(node => game.current?.children.includes(node.id));
        const nextKind = children.find(node => node.kind === (route === 'shop' ? 'sanctuary' : 'rest'))?.kind;
        const nextStation = nextKind === 'sanctuary';
        const wantsShopping = shoppingList.some(id => !game.carriedPets.includes(id));
        const reserve = game.pets.length >= 2 && nextStation ? wantsShopping ? ECONOMY.petUnlockCost + 15 : build === 'focused' && game.carriedPets.includes('cat') ? 50 : 0 : 0;
        const minimum = game.current?.depth === 0 ? 4 : 5;
        for (let attempt = 0; attempt < 12; attempt++) {
            const pair = game.pets.map(target => ({ target,
                source: game.pets.find(source => game.mergeError(source.id, target.id) === null) }))
                .find(candidate => candidate.source && candidate.target.slot !== null
                    && (game.pets.length >= minimum || candidate.target.species === 'vine' || candidate.target.species === 'deer'));
            if (pair?.source) {
                if (game.mergePets(pair.source.id, pair.target.id).ok) { report.merges++; settleMutation(); }
                else break;
            } else if (game.dew >= 30 + reserve && game.pets.length < game.deploymentLimit) {
                const summoned = game.summonRandomPet(); if (!summoned.ok) break;
                report.summons++; report.drawn[summoned.pet.species] = (report.drawn[summoned.pet.species] ?? 0) + 1;
                const pet: PetState = summoned.pet;
                const slot = POSITIONS[pet.species].find(i => !game.pets.some(p => p.slot === i));
                if (slot !== undefined && slot !== pet.slot) game.movePet(pet.id, slot);
            } else break;
        }
    };
    for (let depth = 0; depth < game.routeDepths; depth++) {
        report.depth = depth;
        const available = [...game.available];
        const desired = route === 'shop' ? 'sanctuary' : 'rest';
        const node = available.find(n => n.kind === desired) ?? (depth === 0 && route === 'shop' ? available[available.length - 1] : available.find(n => n.encounter === 'normal')) ?? available[0];
        if (!node || !game.chooseNode(node.id)) break;
        if (restoreAtNodes) game = MvpSession.restore(game.snapshot());
        if (game.phase === 'rest') { game.takeRest(game.heart <= 1 ? 'heal' : 'dew'); if (restoreAtNodes) game = MvpSession.restore(game.snapshot()); continue; }
        if (game.phase === 'sanctuary') {
            const priorities = shoppingList;
            for (const id of priorities) if (!game.carriedPets.includes(id) && game.dew >= ECONOMY.petUnlockCost + 15) {
                if (game.buyPocketPet(id).ok) { report.purchases.push(id); break; }
            }
            const support = build === 'lightning' ? 'vine' : build === 'spores' ? 'deer' : null;
            if (support && game.current && game.current.depth >= 7 && game.pets.some(p => p.species === support)
                && game.dew >= 50 && game.banishPocketPet(support).ok) report.banished.push(support);
            if (build === 'focused' && game.dew >= 50 && game.banishPocketPet('cat').ok) report.banished.push('cat');
            game.leaveSanctuary(); if (restoreAtNodes) game = MvpSession.restore(game.snapshot()); continue;
        }
        develop(); arrange();
        if (useMetamorphosis) for (let attempt = 0; attempt < 2 && game.mutationCredits > 0; attempt++) {
            const priorities: PetId[] = build === 'spores' ? ['mushroom', 'deer', 'cat', 'rabbit']
                : build === 'lightning' ? ['sparrow', 'vine', 'cat', 'rabbit'] : ['cat', 'rabbit'];
            const target = [...game.pets].filter(pet => game.metamorphosisError(pet.id) === null)
                .sort((a, b) => priorities.indexOf(a.species) - priorities.indexOf(b.species) || b.star - a.star || a.id - b.id)[0];
            if (!target || !game.beginMetamorphosis(target.id).ok) break;
            report.metamorphoses++; if (restoreAtNodes) game = MvpSession.restore(game.snapshot());
            settleMutation();
        }
        game.startBattle();
        for (let tick = 0; tick < 180 / STEP && game.phase === 'battle'; tick++) {
            if (tick % 30 === 0) develop();
            game.step();
        }
        report.leaks += game.leaked;
        if (game.phase !== 'won') break;
        game.continueRoute(); if (restoreAtNodes) game = MvpSession.restore(game.snapshot());
    }
    return { ...report, won: game.phase === 'complete', heart: game.heart, dew: game.dew };
}
