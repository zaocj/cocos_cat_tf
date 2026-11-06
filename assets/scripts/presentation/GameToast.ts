import { _decorator, Color, Component, Graphics, Label, Layers, Node, UIOpacity, UITransform } from 'cc';
import { ToastState, ToastTone } from './ToastState';

const { ccclass } = _decorator;
export interface ToastOptions { tone?: ToastTone; duration?: number }

/** One non-blocking, reusable toast layer. No touch listeners or gameplay timers. */
@ccclass('GameToast')
export class GameToast extends Component {
    private readonly state = new ToastState();
    private body: Label | null = null;
    private icon: Label | null = null;
    private background: Graphics | null = null;
    private fade: UIOpacity | null = null;
    private width = 616;

    onLoad(): void {
        this.node.layer = Layers.Enum.UI_2D;
        if (!this.getComponent(UITransform)) this.addComponent(UITransform);
        this.background = this.addComponent(Graphics);
        this.fade = this.addComponent(UIOpacity);
        this.icon = this.makeLabel('ToastIcon', 30, 44);
        this.body = this.makeLabel('ToastMessage', 26, this.width - 100);
        this.body.overflow = Label.Overflow.SHRINK;
        this.layout(this.width, this.node.position.y);
        this.dismiss();
    }

    layout(width: number, y: number): void {
        this.width = Math.max(240, Math.min(616, width));
        this.node.setPosition(0, y, 0);
        this.getComponent(UITransform)?.setContentSize(this.width, 88);
        this.icon?.node.setPosition(-this.width / 2 + 40, 0, 0);
        this.body?.node.setPosition(24, 0, 0);
        this.body?.getComponent(UITransform)?.setContentSize(this.width - 108, 72);
        this.paint();
    }

    show(message: string, options: ToastOptions = {}): void {
        if (!this.state.show(message, options.tone, options.duration)) return;
        if (this.body) this.body.string = this.state.message;
        this.paint(); this.syncOpacity();
    }

    dismiss(): void { this.state.dismiss(); this.syncOpacity(); }
    onDisable(): void { this.dismiss(); }
    update(dt: number): void { this.state.update(dt); this.syncOpacity(); }

    private syncOpacity(): void { if (this.fade) this.fade.opacity = this.state.opacity; }

    private paint(): void {
        const g = this.background; if (!g) return;
        const accent = this.state.tone === 'warning' ? new Color(241, 175, 100)
            : this.state.tone === 'success' ? new Color(169, 212, 163) : new Color(150, 203, 227);
        g.clear(); g.fillColor = new Color(35, 66, 53, 245);
        g.roundRect(-this.width / 2, -44, this.width, 88, 18); g.fill();
        g.strokeColor = accent; g.lineWidth = 2;
        g.roundRect(-this.width / 2, -44, this.width, 88, 18); g.stroke();
        if (this.icon) {
            this.icon.string = this.state.tone === 'warning' ? '!' : this.state.tone === 'success' ? '✓' : 'i';
            this.icon.color = accent;
        }
    }

    private makeLabel(name: string, size: number, width: number): Label {
        const node = new Node(name); node.layer = Layers.Enum.UI_2D; this.node.addChild(node);
        node.addComponent(UITransform).setContentSize(width, 72);
        const label = node.addComponent(Label);
        label.fontFamily = 'sans-serif'; label.fontSize = size; label.lineHeight = 34;
        label.isBold = true; label.enableWrapText = true; label.color = new Color(252, 253, 247);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return label;
    }
}
