export type ToastTone = 'info' | 'warning' | 'success';

/** UI time only: independent of battle pause and speed, with no engine dependency. */
export class ToastState {
    message = '';
    tone: ToastTone = 'info';
    private elapsed = 0;
    private duration = 0;

    get visible(): boolean { return this.elapsed < this.duration; }
    get opacity(): number {
        if (!this.visible) return 0;
        return Math.round(255 * Math.min(1, this.elapsed / 0.12, (this.duration - this.elapsed) / 0.22));
    }

    show(message: string, tone: ToastTone = 'info', duration = 2.4): boolean {
        const text = message.trim();
        if (!text || (this.visible && text === this.message && tone === this.tone)) return false;
        this.message = text; this.tone = tone;
        this.duration = Number.isFinite(duration) ? Math.max(0.6, duration) : 2.4;
        this.elapsed = 0;
        return true;
    }

    update(dt: number): void {
        if (Number.isFinite(dt) && dt > 0) this.elapsed = Math.min(this.duration, this.elapsed + dt);
    }

    dismiss(): void { this.elapsed = this.duration; }
}
