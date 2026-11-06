import { _decorator, Color, Component, EventMouse, EventTouch, Graphics, Label, Layers, Mask, Node, UITransform, Vec3 } from 'cc';
import type { RouteNode } from '../domain/ExpeditionRoute';
import { MapPoint, RouteMapViewport } from './RouteMapViewport';

const { ccclass } = _decorator;
const tint = (hex: string): Color => new Color().fromHEX(hex);

/** A single clipped input surface keeps map dragging from accidentally selecting nodes. */
@ccclass('RouteMapView')
export class RouteMapView extends Component {
    private camera: RouteMapViewport | null = null;
    private content: Node | null = null;
    private route: readonly RouteNode[] = [];
    private available = new Set<string>();
    private onChoose: ((id: string) => void) | null = null;
    private onZoom: ((zoom: number) => void) | null = null;
    private touches = new Map<number, MapPoint>();
    private first: MapPoint = { x: 0, y: 0 };
    private moved = false;
    private multiTouch = false;

    onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this.startTouch, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.moveTouch, this);
        this.node.on(Node.EventType.TOUCH_END, this.endTouch, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.endTouch, this);
        this.node.on(Node.EventType.MOUSE_WHEEL, this.wheel, this);
    }
    onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.startTouch, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this.moveTouch, this);
        this.node.off(Node.EventType.TOUCH_END, this.endTouch, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.endTouch, this);
        this.node.off(Node.EventType.MOUSE_WHEEL, this.wheel, this);
        this.touches.clear();
    }

    setup(camera: RouteMapViewport, route: readonly RouteNode[], visited: readonly string[], available: readonly string[],
        choose: (id: string) => void, zoom: (value: number) => void): void {
        this.camera = camera; this.route = route; this.available = new Set(available);
        this.onChoose = choose; this.onZoom = zoom;
        this.node.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const content = new Node('RouteContent'); content.layer = Layers.Enum.UI_2D;
        content.addComponent(UITransform); this.node.addChild(content); this.content = content;
        const g = content.addComponent(Graphics); const walked = new Set(visited);
        const byId = new Map(route.map(node => [node.id, node]));
        for (const a of route) for (const id of a.children) {
            const b = byId.get(id); if (!b) continue;
            g.strokeColor = tint(walked.has(a.id) && walked.has(id) ? '#337354' : '#A5B89C');
            g.lineWidth = walked.has(a.id) && walked.has(id) ? 5 : 2;
            g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
        for (const node of route) {
            const open = this.available.has(node.id); const done = walked.has(node.id);
            const encounterColor = node.kind === 'sanctuary' ? '#87539D' : node.kind === 'rest' ? '#286A9C' : node.encounter === 'boss' ? '#9B4963' : node.encounter === 'elite' ? '#A66B42' : '#337354';
            g.fillColor = tint(done ? '#337354' : open ? '#FCFDF7' : '#C6D4BD');
            g.circle(node.x, node.y, 40); g.fill();
            if (open) { g.strokeColor = tint(encounterColor); g.lineWidth = 3; g.circle(node.x, node.y, 43); g.stroke(); }
            this.label(content, done ? '✓' : `${node.depth + 1}`, node.x, node.y, 28, 80, done ? '#FCFDF7' : encounterColor);
            this.label(content, node.name, node.x, node.y - 66, 24, 158, '#234235');
            const type = node.encounter === 'boss' ? 'BOSS' : node.encounter === 'elite' ? '精英' : '混合';
            this.label(content, done ? '已完成' : node.kind === 'sanctuary' ? '购宠 / 放生' : node.kind === 'rest' ? '灵露 / 树心' : `${type}·${node.count}只`, node.x, node.y - 99, 19, 132, node.kind === 'battle' && node.encounter === 'normal' ? '#526A58' : encounterColor);
        }
        this.apply();
    }

    zoomBy(amount: number): void {
        if (!this.camera) return;
        this.moved = true; this.camera.zoomAt(this.camera.zoom + amount); this.apply();
    }

    focus(point: MapPoint, completed = false): void {
        this.moved = true; this.camera?.focus(point, completed); this.apply();
    }

    private local(event: EventTouch | EventMouse): MapPoint {
        const p = event.getUILocation();
        const local = this.getComponent(UITransform)?.convertToNodeSpaceAR(new Vec3(p.x, p.y, 0));
        return local ? { x: local.x, y: local.y } : { x: 0, y: 0 };
    }

    private startTouch(event: EventTouch): void {
        const id = event.getID(); if (id === null) return;
        const point = this.local(event);
        if (this.touches.size === 0) { this.first = point; this.moved = false; this.multiTouch = false; }
        this.touches.set(id, point);
        if (this.touches.size > 1) { this.multiTouch = true; this.moved = true; }
    }

    private moveTouch(event: EventTouch): void {
        const id = event.getID(); if (id === null || !this.camera) return;
        const previous = this.touches.get(id); if (!previous) return;
        const before = Array.from(this.touches.values());
        const point = this.local(event); this.touches.set(id, point);
        if (Math.hypot(point.x - this.first.x, point.y - this.first.y) >= 12) this.moved = true;
        if (this.touches.size >= 2) {
            const after = Array.from(this.touches.values());
            const midpoint = (points: MapPoint[]): MapPoint => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
            const a = midpoint(before); const b = midpoint(after);
            const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
            const newDistance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
            this.camera.pan(b.x - a.x, b.y - a.y);
            if (oldDistance > 1) this.camera.zoomAt(this.camera.zoom * newDistance / oldDistance, b);
        } else if (this.moved) this.camera.pan(point.x - previous.x, point.y - previous.y);
        this.apply();
    }

    private endTouch(event: EventTouch): void {
        const id = event.getID(); if (id === null || !this.touches.has(id)) return;
        const point = this.local(event); this.touches.delete(id);
        const cancelled = event.getEventCode() !== Node.EventType.TOUCH_END;
        if (cancelled) this.moved = true;
        if (this.touches.size || this.moved || this.multiTouch || cancelled || !this.camera) return;
        if (Math.hypot(point.x - this.first.x, point.y - this.first.y) >= 12) return;
        const world = this.camera.toWorld(point);
        const radius = Math.max(58, 44 / this.camera.zoom);
        let best: RouteNode | null = null; let bestDistance = radius;
        for (const node of this.route) {
            const distance = Math.hypot(world.x - node.x, world.y - node.y);
            if (distance < bestDistance) { best = node; bestDistance = distance; }
        }
        if (best && this.available.has(best.id)) this.onChoose?.(best.id);
    }

    private wheel(event: EventMouse): void {
        if (!this.camera) return;
        this.moved = true;
        this.camera.zoomAt(this.camera.zoom * Math.exp(event.getScrollY() * 0.001), this.local(event));
        this.apply(); event.propagationStopped = true;
    }

    private apply(): void {
        if (!this.camera || !this.content) return;
        this.content.setPosition(this.camera.x, this.camera.y, 0);
        this.content.setScale(this.camera.zoom, this.camera.zoom, 1);
        this.onZoom?.(this.camera.zoom);
    }

    private label(parent: Node, value: string, x: number, y: number, size: number, width: number, color: string): void {
        const node = new Node('RouteLabel'); node.layer = Layers.Enum.UI_2D; parent.addChild(node);
        node.setPosition(x, y, 0); node.addComponent(UITransform).setContentSize(width, 42);
        const label = node.addComponent(Label); label.string = value;
        label.fontFamily = 'sans-serif'; label.fontSize = size; label.lineHeight = size * 1.2;
        label.isBold = size >= 24; label.color = tint(color); label.enableWrapText = false;
        label.overflow = Label.Overflow.SHRINK;
        label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER;
    }
}
