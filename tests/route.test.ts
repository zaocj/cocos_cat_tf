import { expect, test } from 'vitest';
import { generateRoute, ROUTE_BOUNDS, ROUTE_DEPTHS } from '../assets/scripts/domain/ExpeditionRoute.ts';
import { RouteMapViewport } from '../assets/scripts/presentation/RouteMapViewport.ts';

test('route seed reproduces the entire map; different expeditions have different maps', () => {
    expect(generateRoute(123)).toStrictEqual(generateRoute(123));
    const signatures = new Set(Array.from({ length: 100 }, (_, seed) => JSON.stringify(generateRoute(seed))));
    expect(signatures.size).toBe(100);
});

test('500 generated maps each have 30 connected nodes, one endpoint and non-crossing forward links', () => {
    for (let seed = 0; seed < 500; seed++) {
        const route = generateRoute(seed); const byId = new Map(route.map(n => [n.id, n]));
        expect(route).toHaveLength(30); expect(byId.size).toBe(30);
        const start = route.filter(n => n.depth === 0); const end = route.filter(n => !n.children.length);
        expect(start).toHaveLength(2); expect(end).toHaveLength(1); expect(end[0].depth).toBe(ROUTE_DEPTHS - 1);
        const reachable = new Set(start.map(n => n.id));
        for (const node of route) {
            expect(reachable.has(node.id), `seed ${seed}, ${node.id}`).toBe(true);
            expect(node.x).toBeGreaterThan(ROUTE_BOUNDS.left + 60);
            expect(node.x).toBeLessThan(ROUTE_BOUNDS.right - 60);
            if (node.depth !== ROUTE_DEPTHS - 1) expect(node.children.length).toBeGreaterThan(0);
            for (const id of node.children) {
                const child = byId.get(id); expect(child).toBeDefined();
                expect(child?.depth).toBe(node.depth + 1); reachable.add(id);
            }
        }
        expect(reachable.size).toBe(30);
        for (let depth = 0; depth < ROUTE_DEPTHS - 1; depth++) {
            const edges = route.filter(n => n.depth === depth).map(a => a.children.map(id => ({ a, b: byId.get(id) })));
            for (const groupA of edges) for (const a of groupA) for (const groupB of edges) for (const b of groupB) {
                if (!a.b || !b.b) throw new Error('Missing edge target');
                expect((a.a.x - b.a.x) * (a.b.x - b.b.x)).toBeGreaterThanOrEqual(0);
            }
        }
    }
});

test('map pan clamps to content, and focusing a later node reveals it without changing the map', () => {
    const camera = new RouteMapViewport(656, 1000, ROUTE_BOUNDS);
    camera.pan(100000, 100000); expect(camera.x).toBeCloseTo(0); expect(camera.y).toBe(-500);
    camera.pan(-100000, -100000); expect(camera.y).toBe(500 - ROUTE_BOUNDS.top);
    const node = generateRoute(4)[15]; camera.focus(node);
    const screen = camera.toScreen(node);
    expect(screen.y).toBeGreaterThan(-500); expect(screen.y).toBeLessThan(500);
});

test('map zoom preserves its anchor, clamps scale, and round-trips touch coordinates', () => {
    const camera = new RouteMapViewport(656, 1000, ROUTE_BOUNDS);
    camera.focus({ x: 0, y: 1500 }, true);
    const anchor = { x: 0, y: 100 }; const world = camera.toWorld(anchor);
    camera.zoomAt(1.3, anchor);
    expect(camera.toScreen(world).y).toBeCloseTo(anchor.y);
    const point = { x: 120, y: 1300 };
    expect(camera.toWorld(camera.toScreen(point)).x).toBeCloseTo(point.x);
    expect(camera.toWorld(camera.toScreen(point)).y).toBeCloseTo(point.y);
    camera.zoomAt(10); expect(camera.zoom).toBe(1.5);
    camera.zoomAt(0.01); expect(camera.zoom).toBe(0.55);
    camera.resize(720, 1400); expect(camera.x).toBeCloseTo(0);
});
