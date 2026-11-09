import { expect, test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { playRandomExpedition, Build } from './support/RandomExpedition.ts';

test('real two-pet random campaigns use earned income, purchased pools and instance merges', () => {
    const summaries = [];
    for (const build of ['focused', 'spores', 'lightning'] as Build[]) for (const route of ['rest', 'shop'] as const) {
        const runs = Array.from({ length: 100 }, (_, seed) => playRandomExpedition(seed, build, route));
        const summary = { build, route, runs: runs.length, wins: runs.filter(r => r.won).length,
            meanDepth: Number((runs.reduce((n, r) => n + r.depth + 1, 0) / runs.length).toFixed(2)),
            purchases: runs.reduce((n, r) => n + r.purchases.length, 0),
            banishes: runs.reduce((n, r) => n + r.banished.length, 0),
            newPetDraws: runs.reduce((n, r) => n + Object.entries(r.drawn).filter(([id]) => id !== 'cat' && id !== 'rabbit').reduce((a, [, count]) => a + (count ?? 0), 0), 0),
            meanMerges: Number((runs.reduce((n, r) => n + r.merges, 0) / runs.length).toFixed(2)),
            failures: runs.filter(r => !r.won).map(r => ({ seed: r.seed, depth: r.depth + 1 })) };
        summaries.push(summary);
        expect(runs.every(r => r.dew >= 0)).toBe(true);
        expect(summary.wins, `${build}/${route} must remain viable across random seeds`).toBeGreaterThanOrEqual(80);
        if (route === 'shop' && build !== 'focused') {
            expect(summary.purchases).toBeGreaterThanOrEqual(150);
            expect(summary.newPetDraws).toBeGreaterThanOrEqual(200);
        }
    }
    mkdirSync('.mvp', { recursive: true }); writeFileSync('.mvp/random-balance.json', JSON.stringify(summaries, null, 2));
    console.log(JSON.stringify(summaries.map(({ failures, ...summary }) => summary)));
}, 120000);

test('zero-mutation stress runs still use the same real random-purchase loop', () => {
    const report = ['focused', 'spores', 'lightning'].map(build => {
        const runs = Array.from({ length: 30 }, (_, seed) => playRandomExpedition(seed, build as Build, 'shop', 0));
        expect(runs.every(run => run.dew >= 0 && run.merges > 0)).toBe(true);
        return { build, mutationChance: 0, runs: runs.length, wins: runs.filter(run => run.won).length,
            failures: runs.filter(run => !run.won).map(run => ({ seed: run.seed, depth: run.depth + 1 })) };
    });
    mkdirSync('.mvp', { recursive: true }); writeFileSync('.mvp/random-balance-no-mutation.json', JSON.stringify(report, null, 2));
}, 120000);
