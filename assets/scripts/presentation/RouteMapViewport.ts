export interface MapPoint { x: number; y: number }
export interface MapBounds { left: number; right: number; bottom: number; top: number }

/** Pure camera math shared by pointer dragging, pinch, wheel and zoom buttons. */
export class RouteMapViewport {
    zoom = 1;
    x = 0;
    y = 0;
    constructor(public width: number, public height: number, readonly bounds: MapBounds) { this.clamp(); }

    resize(width: number, height: number): void { this.width = width; this.height = height; this.clamp(); }
    pan(dx: number, dy: number): void { this.x += dx; this.y += dy; this.clamp(); }
    toWorld(point: MapPoint): MapPoint { return { x: (point.x - this.x) / this.zoom, y: (point.y - this.y) / this.zoom }; }
    toScreen(point: MapPoint): MapPoint { return { x: point.x * this.zoom + this.x, y: point.y * this.zoom + this.y }; }

    zoomAt(value: number, anchor: MapPoint = { x: 0, y: 0 }): void {
        const world = this.toWorld(anchor); this.zoom = Math.max(0.55, Math.min(1.5, value));
        this.x = anchor.x - world.x * this.zoom; this.y = anchor.y - world.y * this.zoom; this.clamp();
    }

    focus(point: MapPoint, completed = false): void {
        this.x = -point.x * this.zoom;
        this.y = (completed ? 0 : -this.height / 2 + 180) - point.y * this.zoom;
        this.clamp();
    }

    private clamp(): void {
        const axis = (offset: number, min: number, max: number, size: number): number =>
            (max - min) * this.zoom <= size ? -(min + max) * this.zoom / 2
                : Math.max(size / 2 - max * this.zoom, Math.min(-size / 2 - min * this.zoom, offset));
        this.x = axis(this.x, this.bounds.left, this.bounds.right, this.width);
        this.y = axis(this.y, this.bounds.bottom, this.bounds.top, this.height);
    }
}
