import {
    _decorator, BlockInputEvents, Color, Component, EventKeyboard, EventTouch, game, Game, Graphics, input, Input,
    KeyCode, Label, Layers, Mask, Node, profiler, ResolutionPolicy, screen, UITransform, Vec3, view,
} from 'cc';
import { ActionError, ECONOMY, MvpSession, PATH, PETS, PET_ORDER, PetActionResult, PetId, ROUTE, SLOTS, STEP } from '../domain/MvpSession';
import { isPortrait, PortraitLayout, portraitLayout, portraitSlotAt, PORTRAIT_MIN_HEIGHT, PORTRAIT_WIDTH, toPortraitBoard } from './PortraitLayout';

import { GameToast } from './GameToast';

const { ccclass } = _decorator;
type Selection = { kind: 'summon'; species: PetId } | { kind: 'pet'; id: number };
interface SummonDrag {
    touchId: number; species: PetId;
    start: { x: number; y: number }; point: { x: number; y: number }; moved: boolean;
    selection: Selection | null; originSlot: number | null; elapsed: number; active: boolean; startedAt: number; warnedInsufficientDew: boolean;
}
const C = {
    bg: '#EDF3E7', ink: '#234235', muted: '#526A58', green: '#337354', pale: '#D9E6D0',
    board: '#DDE9D3', roadEdge: '#B9C8A8', road: '#F5EED9', white: '#FCFDF7',
    orange: '#B85C20', cat: '#F1AF64', blue: '#286A9C', rabbit: '#96CBE3',
    deer: '#C9AD77', leaf: '#4D8251', mushroom: '#CE9DD1', spore: '#87539D',
    red: '#A64243', enemy: '#A46D9F', enemyDark: '#6F4A72', line: '#A5B89C',
};
function color(hex: string, alpha = 255): Color {
    return new Color(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha);
}

/** Asset-free playable slice. All gameplay decisions live in MvpSession. */
@ccclass('MvpGame')
export class MvpGame extends Component {
    private session = new MvpSession();
    private screenRoot: Node | null = null;
    private dynamic: Graphics | null = null;
    private dragVisual: Graphics | null = null;
    private toast: GameToast | null = null;
    private summonMasks = new Map<PetId, Node>();
    private status: Label | null = null;
    private counter: Label | null = null;
    private selected: Selection = { kind: 'summon', species: 'cat' };
    private inspectedPetId: number | null = null;
    private dewLabel: Label | null = null;
    private deploymentLabel: Label | null = null;
    private infoTitle: Label | null = null;
    private infoStats: Label | null = null;
    private infoEffect: Label | null = null;
    private infoMeta: Label | null = null;
    private infoAction: Label | null = null;
    private feedback = '';
    private feedbackError: ActionError | null = null;
    private accumulator = 0;
    private speed = 1;
    private lastStatus = '';
    private lastCounter = '';
    private layout: PortraitLayout = portraitLayout(PORTRAIT_MIN_HEIGHT);
    private orientationBlocked = false;
    private resumeAfterPortrait = false;
    private orientationGate: HTMLDivElement | null = null;
    private reservesOpen = false;
    private summonDrag: SummonDrag | null = null;

    onEnable(): void {
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        game.on(Game.EVENT_HIDE, this.onHide, this);
        screen.on('window-resize', this.onViewportResize, this);
        if (this.screenRoot) this.onViewportResize();
    }
    onDisable(): void {
        this.toast?.dismiss();
        this.inspectedPetId = null;
        this.summonDrag = null;
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
        game.off(Game.EVENT_HIDE, this.onHide, this);
        screen.off('window-resize', this.onViewportResize, this);
        if (this.orientationGate) this.orientationGate.style.display = 'none';
    }
    onDestroy(): void { this.toast?.node?.destroy(); this.toast = null; this.orientationGate?.remove(); }
    start(): void {
        profiler.hideStats();
        this.onViewportResize();
    }
    update(dt: number): void {
        const drag = this.summonDrag;
        if (drag) {
            drag.elapsed = Math.max(drag.elapsed + Math.min(dt, 0.1), (this.gestureTime() - drag.startedAt) / 1000);
            if (drag.selection && !this.session.paused && drag.elapsed >= 0.3) drag.active = true;
        }
        if (!this.orientationBlocked && this.session.phase === 'battle' && !this.session.paused) {
            this.accumulator += Math.min(dt, 0.1) * this.speed;
            let steps = 0;
            while (this.accumulator >= STEP && steps++ < 12) {
                this.session.step(); this.accumulator -= STEP;
                if (this.session.phase !== 'battle') { this.accumulator = 0; this.renderScreen(); break; }
            }
        }
        this.warnIfSummonUnaffordable();
        if (this.dynamic) this.drawDynamic(this.dynamic);
        this.updateHud();
    }
    private onHide(): void {
        this.toast?.dismiss();
        this.inspectedPetId = null;
        this.summonDrag = null;
        this.resumeAfterPortrait = false;
        if (this.session.setPaused(true)) { this.accumulator = 0; this.renderScreen(); }
    }
    private onKey(event: EventKeyboard): void {
        if (this.orientationBlocked || this.reservesOpen || this.summonDrag) return;
        if (event.keyCode === KeyCode.DIGIT_1) this.selectPet('cat');
        if (event.keyCode === KeyCode.DIGIT_2) this.selectPet('rabbit');
        if (event.keyCode === KeyCode.DIGIT_3) this.selectPet('deer');
        if (event.keyCode === KeyCode.DIGIT_4) this.selectPet('mushroom');
        if (event.keyCode === KeyCode.SPACE) {
            if (this.session.phase === 'prepare') this.begin();
            else if (this.session.phase === 'battle') this.togglePause();
        }
    }
    private selectPet(id: PetId): void {
        if (this.session.phase !== 'prepare' && this.session.phase !== 'battle') return;
        this.inspectedPetId = null;
        this.selected = { kind: 'summon', species: id }; this.clearFeedback(); this.renderScreen();
    }
    private begin(): void {
        this.inspectedPetId = null;
        if (this.session.startBattle()) { this.accumulator = 0; this.clearFeedback(); this.renderScreen(); }
    }
    private togglePause(): void {
        this.inspectedPetId = null;
        this.session.setPaused(!this.session.paused); this.accumulator = 0; this.clearFeedback(); this.renderScreen();
    }
    private restart(): void {
        this.inspectedPetId = null;
        this.session = new MvpSession(); this.selected = { kind: 'summon', species: 'cat' }; this.clearFeedback();
        this.accumulator = 0; this.speed = 1; this.reservesOpen = false; this.renderScreen();
    }

    private clearFeedback(): void { this.feedback = ''; this.feedbackError = null; }

    private handleSlot(slot: number): void {
        if (this.orientationBlocked || this.reservesOpen || this.summonDrag) return;
        if (this.session.phase !== 'prepare' && this.session.phase !== 'battle') return;
        const occupant = this.session.pets.find(p => p.slot === slot);
        if (occupant) {
            this.inspectedPetId = occupant.id;
            this.selected = { kind: 'pet', id: occupant.id }; this.clearFeedback(); this.renderScreen(); return;
        }
        if (this.session.paused) { this.feedback = '暂停期间不能召唤或搬迁，请先继续战斗'; return; }
        if (this.selected.kind === 'pet') this.handlePetAction(this.session.movePet(this.selected.id, slot), false);
        else this.handlePetAction(this.session.summonPet(this.selected.species, slot), true);
    }

    private handlePetAction(result: PetActionResult, summoned: boolean, alreadyWarned = false): void {
        this.inspectedPetId = null;
        if (result.ok === false) {
            const messages: Record<ActionError, string> = {
                WRONG_PHASE: '当前阶段不能放置宠物', PAUSED: '请先继续战斗', INVALID_SLOT: '请选择有效树桩',
                INVALID_SPECIES: '未知宠物种类', SLOT_OCCUPIED: '树桩已被占用，请选择空位',
                INSUFFICIENT_DEW: this.insufficientDewMessage(),
                DEPLOYMENT_FULL: '场上最多 6 只，可先撤下一只宠物', ROSTER_FULL: '本局最多持有 12 只宠物',
                PET_NOT_FOUND: '宠物不存在，请重新选择',
            };
            this.feedback = messages[result.reason];
            this.feedbackError = result.reason;
            if (result.reason !== 'INSUFFICIENT_DEW' || !alreadyWarned)
                this.toast?.show(this.feedback, { tone: 'warning' });
            this.renderScreen();
        } else {
            this.feedbackError = null;
            this.feedback = summoned ? `召唤${PETS[result.pet.species].name}，消耗 ${ECONOMY.summonCost} 灵露`
                : result.pet.slot === null ? '已收回后备，重新部署免费，不返还灵露'
                    : this.session.phase === 'battle' ? '搬迁完成，1 秒后恢复攻击或施法' : '';
            this.renderScreen();
        }
    }

    private touchPoint(event: EventTouch): { x: number; y: number } | null {
        const transform = this.screenRoot?.getComponent(UITransform);
        if (!transform) return null;
        const touch = event.getUILocation();
        const point = transform.convertToNodeSpaceAR(new Vec3(touch.x, touch.y, 0));
        return { x: point.x, y: point.y };
    }

    private startGesture(selection: Selection | null, slot: number | null, event: EventTouch): void {
        if (this.summonDrag || this.orientationBlocked || this.reservesOpen) return;
        if (this.session.phase !== 'prepare' && this.session.phase !== 'battle') return;
        const touchId = event.getID(); const point = this.touchPoint(event);
        if (touchId === null || !point) return;
        const pet = selection?.kind === 'pet' ? this.session.pets.find(p => p.id === selection.id) : undefined;
        const species = selection?.kind === 'summon' ? selection.species : pet?.species ?? 'cat';
        if (selection) this.selected = selection;
        this.inspectedPetId = selection?.kind === 'pet' ? selection.id : null;
        // Keep the source alive: range and data labels update without rebuilding its touch node.
        this.summonDrag = { touchId, species, selection, originSlot: slot,
            start: point, point, moved: false, elapsed: 0, active: false, startedAt: this.gestureTime(), warnedInsufficientDew: false };
        this.clearFeedback();
    }

    private startBoardGesture(event: EventTouch): void {
        const point = this.touchPoint(event); if (!point) return;
        const slot = portraitSlotAt(point, this.layout);
        if (slot === null) { this.inspectedPetId = null; return; }
        const pet = this.session.pets.find(p => p.slot === slot);
        this.startGesture(pet ? { kind: 'pet', id: pet.id } : null, slot, event);
    }

    // This clock measures a UI hold only; combat, income and cooldowns remain fixed-step.
    private gestureTime(): number { return typeof performance === 'undefined' ? Date.now() : performance.now(); }

    private moveSummonDrag(event: EventTouch): void {
        const drag = this.summonDrag;
        if (!drag || event.getID() !== drag.touchId) return;
        const point = this.touchPoint(event); if (!point) return;
        drag.point = point;
        drag.elapsed = Math.max(drag.elapsed, (this.gestureTime() - drag.startedAt) / 1000);
        if (drag.selection && drag.elapsed >= 0.3 && !this.session.paused) drag.active = true;
        if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >= 12) drag.moved = true;
        // Summon avatars retain immediate dragging. Deployed pets require a 0.3-second hold.
        if (drag.selection?.kind === 'summon' && drag.moved && !this.session.paused) drag.active = true;
        this.warnIfSummonUnaffordable();
    }

    private finishSummonDrag(event: EventTouch): void {
        const drag = this.summonDrag;
        if (!drag || event.getID() !== drag.touchId) return;
        // 3.8.8 changes an outside release into node CANCEL; retain the original event code.
        if (event.getEventCode() !== Input.EventType.TOUCH_END) {
            this.summonDrag = null; this.inspectedPetId = null; this.clearFeedback(); return;
        }
        this.moveSummonDrag(event); this.summonDrag = null;
        if (drag.moved) this.inspectedPetId = null;
        if (this.orientationBlocked || this.reservesOpen) return;
        if (!drag.selection) {
            if (!drag.moved && drag.originSlot !== null) this.handleSlot(drag.originSlot);
            return;
        }
        if (!drag.active || !drag.moved || this.session.paused) { this.renderScreen(); return; }
        const slot = portraitSlotAt(drag.point, this.layout);
        if (slot === null) { this.feedback = '已取消放置，请拖到空树桩'; this.renderScreen(); return; }
        if (slot === drag.originSlot) { this.renderScreen(); return; }
        if (this.session.pets.some(p => p.slot === slot)) {
            this.handlePetAction({ ok: false, reason: 'SLOT_OCCUPIED' }, false); return;
        }
        // Preview changes neither roster nor balance. Commit exactly once on a valid release.
        this.handlePetAction(drag.selection.kind === 'summon'
            ? this.session.summonPet(drag.species, slot) : this.session.movePet(drag.selection.id, slot),
        drag.selection.kind === 'summon', drag.warnedInsufficientDew);
    }

    private insufficientDewMessage(): string {
        return `灵露不足，还差 ${Math.max(0, ECONOMY.summonCost - this.session.dew)} 灵露`;
    }

    private warnIfSummonUnaffordable(): void {
        const drag = this.summonDrag;
        if (!drag?.active || !drag.moved || drag.selection?.kind !== 'summon' || drag.warnedInsufficientDew
            || this.session.paused || this.orientationBlocked || this.session.dew >= ECONOMY.summonCost) return;
        if (Math.abs(drag.point.x) > 328 || drag.point.y < this.layout.arenaBottom
            || drag.point.y > this.layout.arenaTop) return;
        drag.warnedInsufficientDew = true;
        this.toast?.show(this.insufficientDewMessage(), { tone: 'warning' });
    }

    private bindGesture(node: Node): void {
        node.on(Node.EventType.TOUCH_MOVE, this.moveSummonDrag, this);
        node.on(Node.EventType.TOUCH_END, this.finishSummonDrag, this);
        node.on(Node.EventType.TOUCH_CANCEL, this.finishSummonDrag, this);
    }

    private petTint(id: PetId): string {
        return id === 'cat' ? C.orange : id === 'rabbit' ? C.blue : id === 'deer' ? C.leaf : C.spore;
    }

    private uiNode(name: string, parent: Node, x = 0, y = 0, width = PORTRAIT_WIDTH, height = this.layout.height): Node {
        const node = new Node(name); node.layer = Layers.Enum.UI_2D;
        parent.addChild(node); node.setPosition(x, y);
        node.addComponent(UITransform).setContentSize(width, height);
        return node;
    }
    private text(parent: Node, value: string, x: number, y: number, size = 20,
        width = 300, tint = C.ink, left = false, bold = false, height = 60): Label {
        const node = this.uiNode(value.slice(0, 20), parent, x, y, width, height);
        const label = node.addComponent(Label); label.string = value; label.fontSize = size;
        label.lineHeight = size * 1.45; label.color = color(tint); label.isBold = bold;
        label.fontFamily = 'sans-serif'; label.enableWrapText = true;
        label.horizontalAlign = left ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return label;
    }
    private graphics(parent: Node, name = 'Graphics'): Graphics { return this.uiNode(name, parent).addComponent(Graphics); }
    private rect(g: Graphics, x: number, y: number, w: number, h: number, fill: string, radius = 12): void {
        g.fillColor = color(fill); g.roundRect(x - w / 2, y - h / 2, w, h, radius); g.fill();
    }
    private circle(g: Graphics, x: number, y: number, r: number, fill: string, alpha = 255): void {
        g.fillColor = color(fill, alpha); g.circle(x, y, r); g.fill();
    }
    private line(g: Graphics, ax: number, ay: number, bx: number, by: number, tint: string, width = 2): void {
        g.strokeColor = color(tint); g.lineWidth = width; g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
    private button(parent: Node, title: string, x: number, y: number, w: number, h: number,
        action: () => void, fill = C.green, textTint = C.white, active = true): Node {
        const node = this.uiNode(title, parent, x, y, w, h);
        const g = node.addComponent(Graphics); this.rect(g, 0, 0, w, h, active ? fill : C.pale);
        this.text(node, title, 0, 0, 26, w - 20, active ? textTint : C.muted, false, true, h);
        if (active) {
            node.on(Node.EventType.TOUCH_END, () => {
                if (!this.summonDrag) { this.inspectedPetId = null; action(); }
            }, this);
            node.on(Node.EventType.MOUSE_ENTER, () => { node.setScale(1.025, 1.025, 1); }, this);
            node.on(Node.EventType.MOUSE_LEAVE, () => { node.setScale(1, 1, 1); }, this);
        }
        return node;
    }

    private onViewportResize(): void {
        this.toast?.dismiss();
        this.inspectedPetId = null;
        this.summonDrag = null;
        const size = typeof window !== 'undefined'
            ? { width: window.innerWidth, height: window.innerHeight } : screen.windowSize;
        if (size.width <= 0 || size.height <= 0) return;
        const blocked = !isPortrait(size.width, size.height);
        if (blocked && !this.orientationBlocked) {
            this.resumeAfterPortrait = this.session.phase === 'battle' && !this.session.paused;
            if (this.resumeAfterPortrait) this.session.setPaused(true);
            this.reservesOpen = false;
        } else if (!blocked && this.orientationBlocked && this.resumeAfterPortrait) {
            this.session.setPaused(false); this.resumeAfterPortrait = false;
        }
        this.orientationBlocked = blocked; this.accumulator = 0;
        const tall = !blocked && size.height / size.width >= PORTRAIT_MIN_HEIGHT / PORTRAIT_WIDTH;
        view.setDesignResolutionSize(PORTRAIT_WIDTH, PORTRAIT_MIN_HEIGHT,
            tall ? ResolutionPolicy.FIXED_WIDTH : ResolutionPolicy.SHOW_ALL);
        this.layout = portraitLayout(view.getVisibleSize().height);
        if (!this.toast) this.toast = this.uiNode('ToastLayer', this.node, 0, 0, 616, 88).addComponent(GameToast);
        this.toast.layout(616, this.layout.arenaTop - 48);
        this.updateOrientationGate();
        this.renderScreen();
    }

    private updateOrientationGate(): void {
        // Web browsers may rotate the Cocos canvas automatically. Keep this gate in physical screen space.
        if (typeof document === 'undefined') return;
        if (!this.orientationGate) {
            const gate = document.createElement('div');
            gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-label', '请竖屏游玩');
            gate.setAttribute('aria-modal', 'true');
            gate.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#EDF3E7;color:#234235;display:none;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:32px;box-sizing:border-box;text-align:center;font-family:sans-serif;touch-action:none;';
            const phone = document.createElement('div');
            phone.style.cssText = 'width:52px;height:88px;border:3px solid #337354;border-radius:12px;margin-bottom:8px;';
            const title = document.createElement('strong'); title.textContent = '请竖屏游玩'; title.style.fontSize = '30px';
            const body = document.createElement('div'); body.textContent = '本游戏仅支持竖屏。请旋转设备，或将窗口调成竖向。';
            body.style.cssText = 'font-size:16px;line-height:1.7;max-width:420px;';
            gate.append(phone, title, body); document.body.appendChild(gate); this.orientationGate = gate;
        }
        this.orientationGate.style.display = this.orientationBlocked ? 'flex' : 'none';
    }

    private boardPoint(point: { x: number; y: number }): { x: number; y: number } {
        return toPortraitBoard(point, this.layout);
    }

    private renderScreen(): void {
        this.summonMasks.clear();
        if (this.reservesOpen || this.orientationBlocked
            || (this.session.phase !== 'prepare' && this.session.phase !== 'battle')) this.toast?.dismiss();
        this.summonDrag = null;
        if (this.screenRoot) { this.screenRoot.removeFromParent(); this.screenRoot.destroy(); }
        this.dynamic = null; this.dragVisual = null; this.status = null; this.counter = null; this.lastStatus = ''; this.lastCounter = '';
        this.dewLabel = null; this.deploymentLabel = null;
        this.infoTitle = null; this.infoStats = null; this.infoEffect = null; this.infoMeta = null; this.infoAction = null;
        const root = this.uiNode('PortraitMVP', this.node); this.screenRoot = root;
        this.toast?.node.setSiblingIndex(this.node.children.length - 1);
        const g = this.graphics(root, 'Background'); this.rect(g, 0, 0, PORTRAIT_WIDTH, this.layout.height, C.bg, 0);
        if (this.orientationBlocked) {
            root.addComponent(BlockInputEvents);
            this.text(root, '请竖屏游玩', 0, 30, 44, 640, C.green, false, true, 90);
            this.text(root, '本游戏仅支持竖屏\n调整设备或窗口方向后继续', 0, -70, 28, 640, C.muted, false, false, 110);
            return;
        }
        this.text(root, '萌宠变异录', -110, this.layout.top - 46, 32, 420, C.ink, true, true);
        this.text(root, `树心 ${this.session.heart}/1`, 240, this.layout.top - 46, 24, 170, C.green);
        if (this.session.phase === 'map' || this.session.phase === 'complete') this.drawMap(root, g);
        else this.drawBattle(root, g);
    }

    private drawMap(root: Node, g: Graphics): void {
        const { top, bottom, height } = this.layout;
        const complete = this.session.phase === 'complete';
        this.text(root, `远征路线  ${this.session.visited.length} / 3`, 0, top - 92, 24, 640, C.muted);
        this.text(root, complete ? '家园，抵达了。' : '选一条路，护送我们的家。', 0, top - 170, 36, 650, C.ink, false, true, 90);
        this.text(root, complete ? '三场防守完成，萌宠小队守住了摇篮树。' : '每场 60 灵露，选择伙伴守住防线。\n已召唤的小队会陪你继续远征。',
            0, top - 256, 24, 640, C.muted, false, false, 76);
        const routeBottom = bottom + 260; const routeHeight = height - 582;
        this.rect(g, 0, routeBottom + routeHeight / 2, 656, routeHeight, C.board, 22);
        const positions = new Map(ROUTE.map(n => [n.id, {
            x: n.depth === 2 ? 0 : n.x < 150 ? -150 : 150,
            y: routeBottom + 130 + n.depth * (routeHeight - 240) / 2,
        }]));
        const available = this.session.available;
        for (const n of ROUTE) {
            const a = positions.get(n.id); if (!a) continue;
            for (const id of n.children) {
                const b = positions.get(id); if (!b) continue;
                const walked = this.session.visited.includes(n.id) && this.session.visited.includes(id);
                this.line(g, a.x, a.y, b.x, b.y, walked ? C.green : C.line, walked ? 5 : 2);
            }
        }
        for (const n of ROUTE) {
            const point = positions.get(n.id); if (!point) continue;
            const { x, y } = point; const open = available.some(a => a.id === n.id);
            const done = this.session.visited.includes(n.id);
            this.circle(g, x, y, 48, done ? C.green : open ? C.white : '#C6D4BD');
            if (open) { g.strokeColor = color(C.green); g.lineWidth = 3; g.circle(x, y, 48); g.stroke(); }
            if (done) {
                this.line(g, x - 17, y, x - 3, y - 13, C.white, 4); this.line(g, x - 3, y - 13, x + 21, y + 16, C.white, 4);
            } else if (n.depth === 2) this.tree(g, x, y - 3, 0.6);
            else { this.circle(g, x, y, 15, open ? C.green : C.muted); this.line(g, x - 22, y + 18, x + 22, y - 18, open ? C.green : C.muted, 3); }
            this.text(root, n.name, x, y - 69, 26, 270, done || open ? C.ink : C.muted, false, true, 42);
            const detail = done ? '已守住' : open ? `${n.count} 只雾团` : '沿连线解锁';
            this.text(root, detail, x, y - 105, 22, 270, C.muted, false, false, 36);
            if (open) {
                const hit = this.uiNode(`Route-${n.id}`, root, x, y - 30, 260, 164);
                hit.on(Node.EventType.TOUCH_END, () => {
                    if (this.session.chooseNode(n.id)) { this.inspectedPetId = null; this.reservesOpen = false; this.clearFeedback(); this.renderScreen(); }
                }, this);
            }
        }
        PET_ORDER.forEach((id, i) => {
            const x = -240 + i * 160;
            this.petIcon(g, x, bottom + 198, id, 0.95);
            this.text(root, PETS[id].name, x, bottom + 141, 22, 155, this.petTint(id), false, true, 36);
        });
        if (complete) this.button(root, '再出发一次', 0, bottom + 64, 640, 84, () => this.restart());
        else {
            this.text(root, '基地一旦受伤，本局立即结束', 0, bottom + 92, 24, 656, C.red);
            this.text(root, '点击亮起的节点，开始防守', 0, bottom + 40, 22, 656, C.muted);
        }
    }

    private drawBattle(root: Node, g: Graphics): void {
        const session = this.session; const current = session.current;
        if (!current) return;
        const { top, bottom, arenaHeight, arenaCenter } = this.layout;
        this.counter = this.text(root, '', 0, top - 91, 24, 656, C.muted, false, false, 40);
        this.rect(g, 0, top - 152, 656, 76, C.white, 16);
        this.text(root, '受伤即结束', -185, top - 167, 22, 250, C.red, false, false, 32);
        this.text(root, `${current.name} · 第 ${session.visited.length + 1} 站`, -185, top - 132, 22, 250, C.ink, false, true, 36);
        this.dewLabel = this.text(root, '', 140, top - 134, 32, 330, C.green, false, true, 48);
        this.text(root, `战斗 +${ECONOMY.dewPerSecond}/秒 · 击杀 +${ECONOMY.dewPerKill}`, 140, top - 169, 22, 330, C.muted, false, false, 32);
        this.rect(g, 0, arenaCenter, 656, arenaHeight, C.board, 22);
        for (let i = 0; i < 18; i++) {
            this.circle(g, i % 2 === 0 ? -290 : 290, this.layout.arenaBottom + 38 + (i * 97 % (arenaHeight - 76)), 4 + i % 3, '#BCCFAC');
        }
        const points = PATH.map(p => this.boardPoint(p));
        for (let i = 1; i < points.length; i++) {
            this.line(g, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, C.roadEdge, 52);
            this.line(g, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, C.road, 44);
        }
        for (const p of points) this.circle(g, p.x, p.y, 22, C.road);
        for (let i = 0; i < SLOTS.length; i++) {
            const p = this.boardPoint(SLOTS[i]);
            this.circle(g, p.x, p.y, 35, '#BED0AE'); this.circle(g, p.x, p.y, 29, '#F9F5E7');
            this.line(g, p.x - 8, p.y, p.x + 8, p.y, '#899C79', 2);
            this.line(g, p.x, p.y - 8, p.x, p.y + 8, '#899C79', 2);
        }
        const board = this.uiNode('BattlePlacement', root, 0, arenaCenter, 656, arenaHeight);
        board.on(Node.EventType.TOUCH_START, this.startBoardGesture, this); this.bindGesture(board);
        const base = points[points.length - 1]; const entry = points[0];
        this.tree(g, base.x, base.y, 0.66);
        this.text(root, '摇篮树', base.x - 112, base.y - 12, 22, 140, C.green, false, true, 38);
        this.text(root, '雾兽入口', entry.x + 104, entry.y, 22, 150, C.muted);
        PET_ORDER.forEach((id, i) => this.petCard(root, id, -240 + i * 160, bottom + 216));
        this.deploymentLabel = this.text(root, '', 0, bottom + 312, 22, 640, C.ink, false, false, 32);
        this.drawInfoCard(root, g);
        if (session.phase === 'prepare') {
            this.button(root, '开始防守', -110, bottom + 112, 420, 84, () => this.begin());
        } else if (session.phase === 'battle') {
            this.button(root, session.paused ? '继续战斗' : '暂停', -220, bottom + 112, 200, 84, () => this.togglePause());
            this.button(root, `${this.speed} 倍速`, 0, bottom + 112, 200, 84,
                () => { this.speed = this.speed === 1 ? 2 : 1; this.renderScreen(); }, C.pale, C.ink);
        }
        const count = session.pets.filter(p => p.slot === null).length;
        this.button(root, `后备 ${count}`, 220, bottom + 112, 200, 84,
            () => { this.reservesOpen = true; this.renderScreen(); }, C.pale, C.ink, count > 0);
        this.status = this.text(root, '', 0, bottom + 33, 24, 656, C.ink, false, false, 64);
        this.status.lineHeight = 30;
        const clipped = this.uiNode('BattleClip', root, 0, arenaCenter, 656, arenaHeight);
        clipped.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.dynamic = this.graphics(clipped, 'LiveBattle');
        this.dynamic.node.setPosition(0, -arenaCenter);
        this.dragVisual = this.graphics(root, 'DragAvatar');
        if (session.phase === 'won' || session.phase === 'lost') this.resultOverlay(root);
        else if (this.reservesOpen) this.reserveOverlay(root);
    }

    private petCard(root: Node, id: PetId, x: number, y: number): void {
        const node = this.uiNode(`Pet-${id}`, root, x, y, 120, 106);
        const g = node.addComponent(Graphics);
        this.rect(g, 0, 0, 120, 106, C.white, 22);
        this.petIcon(g, 0, -3, id, 1.25);
        const mask = this.uiNode(`Unaffordable-${id}`, node, 0, 0, 120, 106);
        const shade = mask.addComponent(Graphics); shade.fillColor = color(C.ink, 150);
        shade.roundRect(-60, -53, 120, 106, 22); shade.fill();
        mask.active = this.session.dew < ECONOMY.summonCost;
        this.summonMasks.set(id, mask);
        node.on(Node.EventType.TOUCH_START,
            (event: EventTouch) => this.startGesture({ kind: 'summon', species: id }, null, event), this);
        this.bindGesture(node);
    }

    private drawInfoCard(root: Node, g: Graphics): void {
        const y = this.layout.top - 278;
        this.rect(g, 0, y, 656, 152, C.white, 16);
        this.infoTitle = this.text(root, '', -80, y + 46, 28, 450, C.ink, true, true, 42);
        this.infoStats = this.text(root, '', 0, y + 6, 23, 616, C.ink, true, false, 34);
        this.infoEffect = this.text(root, '', 0, y - 30, 23, 616, C.muted, true, false, 34);
        this.infoMeta = this.text(root, '', 0, y - 61, 21, 616, C.muted, true, false, 30);
        const action = this.button(root, '30 灵露', 246, y + 43, 132, 54, () => {
            if (this.selected.kind !== 'pet') return;
            const pet = this.session.pets.find(p => p.id === this.selectedPetId());
            if (pet?.slot !== null && pet?.slot !== undefined)
                this.handlePetAction(this.session.movePet(pet.id, pet.slot), false);
        }, C.pale, C.ink);
        this.infoAction = action.getComponentInChildren(Label);
    }

    private selectedPetId(): number | null { return this.selected.kind === 'pet' ? this.selected.id : null; }

    private reserveOverlay(root: Node): void {
        const modal = this.uiNode('ReserveSelection', root); modal.addComponent(BlockInputEvents);
        const g = this.graphics(modal); g.fillColor = color(C.ink, 145);
        g.rect(-360, -this.layout.top, 720, this.layout.height); g.fill();
        this.rect(g, 0, 0, 656, 650, C.white, 20);
        this.text(modal, '后备伙伴', 0, 268, 32, 600, C.ink, false, true, 60);
        this.text(modal, '选择伙伴，再点击树桩免费部署', 0, 211, 24, 600, C.muted, false, false, 46);
        this.session.pets.filter(p => p.slot === null).forEach((pet, i) => {
            this.button(modal, `${PETS[pet.species].name} #${pet.id}\n免费部署`,
                -204 + (i % 3) * 204, 130 - Math.floor(i / 3) * 104, 188, 86, () => {
                    this.selected = { kind: 'pet', id: pet.id }; this.reservesOpen = false;
                    this.clearFeedback(); this.renderScreen();
                }, C.pale, C.ink);
        });
        this.button(modal, '返回战场', 0, -278, 560, 76,
            () => { this.reservesOpen = false; this.renderScreen(); });
    }

    private updateHud(): void {
        if (!this.status || !this.counter || !this.session.current) return;
        const phase = this.session.phase;
        const unaffordable = this.session.dew < ECONOMY.summonCost;
        for (const mask of this.summonMasks.values()) if (mask.active !== unaffordable) mask.active = unaffordable;
        if (this.feedbackError === 'INSUFFICIENT_DEW' && this.session.dew >= ECONOMY.summonCost) this.clearFeedback();
        const selected = this.selected;
        const pet = selected.kind === 'pet' ? this.session.pets.find(p => p.id === selected.id) : undefined;
        const action = this.selected.kind === 'summon'
            ? `拖动${PETS[this.selected.species].name}头像到空树桩，或点击树桩召唤 · ${ECONOMY.summonCost} 灵露`
            : pet ? `已选${PETS[pet.species].name} #${pet.id}：长按拖到空位搬迁，卡片可收回后备` : '请选择召唤卡片或场上宠物';
        const text = phase === 'lost' ? '树心受损，本次远征结束。'
                : phase === 'won' ? '这一站守住了，准备前往下一段旅程。'
                    : this.session.paused ? '已暂停：灵露和战斗均冻结，请继续后再召唤或搬迁'
                        : this.summonDrag?.active ? '范围随落点预览，拖到空树桩后松手放置'
                            : this.feedback || action;
        const count = phase === 'prepare' ? `即将来袭  ${this.session.current.count} 只雾团`
            : `已击退 ${this.session.kills} / ${this.session.current.count} · 场上 ${this.session.enemies.length}`;
        if (text !== this.lastStatus) { this.status.string = text; this.lastStatus = text; }
        if (count !== this.lastCounter) { this.counter.string = count; this.lastCounter = count; }
        const dewText = `灵露  ${this.session.dew}`;
        if (this.dewLabel && this.dewLabel.string !== dewText) this.dewLabel.string = dewText;
        const deployment = `场上 ${this.session.deployedCount} / ${ECONOMY.deploymentLimit} · 后备 ${this.session.pets.length - this.session.deployedCount}`;
        if (this.deploymentLabel && this.deploymentLabel.string !== deployment) this.deploymentLabel.string = deployment;
        const species = pet?.species ?? (selected.kind === 'summon' ? selected.species : 'cat');
        const spec = PETS[species]; const damage = pet ? this.session.effectiveDamage(pet) : spec.damage;
        const fmt = (n: number): string => Number(n.toFixed(1)).toString();
        const boosted = pet && this.session.attackMultiplier(pet) > 1;
        const stats = species === 'deer' ? `施法范围 ${spec.range} · 友军攻击力 +${spec.boost * 100}% · 不攻击`
            : species === 'mushroom' ? `施法范围 ${spec.range} · 每 ${spec.interval} 秒 ${fmt(damage)} 伤害${boosted ? ' ↑' : ''}`
                : `攻击 ${fmt(damage)}${boosted ? ' ↑40%' : ''} · 攻击间隔 ${spec.interval} 秒 · 范围 ${spec.range}`;
        const effect = species === 'deer' ? '范围内友军获得增益，同类光环不叠加'
            : species === 'mushroom' ? '孢子只伤害范围内敌人，离开范围即停止'
                : species === 'cat' ? '挥爪攻击最接近摇篮树的单个敌人' : '发射星弹，追踪范围内最靠前的敌人';
        const meta = pet ? `${pet.slot === null ? '后备' : '已部署'} #${pet.id} · 长按拖动，或点击空位调整`
            : `未部署 · ${ECONOMY.summonCost} 灵露 · ${this.session.dew < ECONOMY.summonCost ? '灵露不足' : '点击空位或拖动头像'}`;
        if (this.infoTitle) this.infoTitle.color = color(this.petTint(species));
        if (this.infoStats) this.infoStats.color = color(boosted ? C.leaf : C.ink);
        const labels: [Label | null, string][] = [
            [this.infoTitle, `${spec.name} · ${spec.role}`], [this.infoStats, stats],
            [this.infoEffect, effect], [this.infoMeta, meta], [this.infoAction, pet ? '收回' : '30 灵露'],
        ];
        for (const [label, value] of labels) if (label && label.string !== value) label.string = value;
    }

    private drawDynamic(g: Graphics): void {
        g.clear(); this.dragVisual?.clear(); const s = this.session;
        if (s.phase === 'prepare' || s.phase === 'battle') {
            const selected = this.selected;
            const pet = selected.kind === 'pet' ? s.pets.find(p => p.id === selected.id) : undefined;
            const species = pet?.species ?? (selected.kind === 'summon' ? selected.species : 'cat');
            const drag = this.summonDrag;
            // A summon selection has no world position: never invent a center-screen range.
            let p = pet && pet.id === this.inspectedPetId && pet.slot !== null
                ? this.boardPoint(SLOTS[pet.slot]) : null;
            if (drag?.active && drag.selection) {
                const slot = portraitSlotAt(drag.point, this.layout);
                p = slot === null ? drag.point : this.boardPoint(SLOTS[slot]);
            }
            const tint = this.petTint(species); const range = PETS[species].range * this.layout.scale;
            if (p) {
                this.circle(g, p.x, p.y, range, tint, 24);
                g.strokeColor = color(tint, 150); g.lineWidth = 2; g.circle(p.x, p.y, range); g.stroke();
            }
            if (selected.kind === 'summon' && this.dragVisual) {
                const x = -240 + PET_ORDER.indexOf(selected.species) * 160;
                const outline = this.dragVisual; outline.strokeColor = color(tint); outline.lineWidth = 4;
                outline.roundRect(x - 60, this.layout.bottom + 163, 120, 106, 22); outline.stroke();
            }
        }
        for (const enemy of s.enemies) {
            const p = this.boardPoint(enemy); const pulse = Math.sin(s.tick * 0.22 + enemy.id) * 2;
            this.circle(g, p.x, p.y - 10, 16, C.roadEdge, 100);
            this.circle(g, p.x, p.y + pulse, 17, C.enemy);
            this.circle(g, p.x - 9, p.y + 8 + pulse, 9, C.enemy);
            this.circle(g, p.x + 8, p.y + 8 + pulse, 10, C.enemy);
            this.circle(g, p.x - 5, p.y + 3 + pulse, 2.3, C.enemyDark);
            this.circle(g, p.x + 5, p.y + 3 + pulse, 2.3, C.enemyDark);
            this.rect(g, p.x, p.y + 30, 34, 5, '#A7B59B', 2);
            const width = 34 * Math.max(0, enemy.hp / enemy.maxHp);
            if (width > 0) this.rect(g, p.x - 17 + width / 2, p.y + 30, width, 5, C.green, 2);
        }
        for (const pet of s.pets) {
            if (pet.slot === null) continue;
            const p = this.boardPoint(SLOTS[pet.slot]); this.petIcon(g, p.x, p.y + 4, pet.species, 0.95);
            if (s.attackMultiplier(pet) > 1) {
                g.strokeColor = color(C.leaf); g.lineWidth = 3; g.circle(p.x, p.y, 32); g.stroke();
            }
            if (s.phase === 'battle' && s.tick < pet.readyTick) {
                g.strokeColor = color(C.muted); g.lineWidth = 3; g.circle(p.x, p.y, 33); g.stroke();
            }
        }
        for (const projectile of s.projectiles) {
            const p = this.boardPoint(projectile);
            this.circle(g, p.x, p.y, 6, C.blue); this.circle(g, p.x - 1, p.y + 1, 2.5, C.white);
        }
        for (const mark of s.marks) {
            const p = this.boardPoint(mark.to);
            if (mark.kind === 'cat') {
                for (let i = -1; i <= 1; i++) this.line(g, p.x - 10 + i * 5, p.y - 11, p.x + 5 + i * 5, p.y + 12, C.orange, 3);
            } else { g.strokeColor = color(mark.kind === 'mushroom' ? C.spore : C.blue, 160); g.lineWidth = 2; g.circle(p.x, p.y, mark.kind === 'mushroom' ? 20 : 12); g.stroke(); }
        }
        const drag = this.summonDrag;
        if (drag?.active && drag.selection) {
            const slot = portraitSlotAt(drag.point, this.layout);
            const affordable = drag.selection.kind === 'pet' || (s.dew >= ECONOMY.summonCost
                && s.deployedCount < ECONOMY.deploymentLimit && s.pets.length < ECONOMY.rosterLimit);
            for (let i = 0; i < SLOTS.length; i++) {
                const empty = !s.pets.some(p => p.slot === i);
                if (!empty && slot !== i) continue;
                const p = this.boardPoint(SLOTS[i]);
                const valid = empty && affordable; const tint = valid ? C.green : C.red;
                if (slot === i) {
                    this.circle(g, p.x, p.y, 37, tint, 65);
                }
                g.strokeColor = color(tint, slot === i ? 255 : 150);
                g.lineWidth = slot === i ? 5 : 2; g.circle(p.x, p.y, 36); g.stroke();
            }
            const x = drag.point.x; const y = drag.point.y + 54;
            const avatar = this.dragVisual ?? g;
            this.circle(avatar, x, y, 35, C.white, 230);
            this.petIcon(avatar, x, y, drag.species, 1);
        }
    }

    private petIcon(g: Graphics, x: number, y: number, id: PetId, scale: number): void {
        const r = 27 * scale;
        const fill = id === 'cat' ? C.cat : id === 'rabbit' ? C.rabbit : id === 'deer' ? C.deer : C.mushroom;
        if (id === 'cat') {
            g.fillColor = color(fill);
            g.moveTo(x - r, y + r * 0.4); g.lineTo(x - r * 0.8, y + r * 1.5); g.lineTo(x - r * 0.1, y + r * 0.7); g.close(); g.fill();
            g.moveTo(x + r, y + r * 0.4); g.lineTo(x + r * 0.8, y + r * 1.5); g.lineTo(x + r * 0.1, y + r * 0.7); g.close(); g.fill();
        } else if (id === 'rabbit') {
            g.fillColor = color(fill);
            g.ellipse(x - r * 0.45, y + r, r * 0.27, r * 0.95); g.ellipse(x + r * 0.45, y + r, r * 0.27, r * 0.95); g.fill();
        }
        if (id === 'deer') {
            for (const sign of [-1, 1]) {
                this.line(g, x + sign * r * 0.5, y + r * 0.6, x + sign * r * 0.7, y + r * 1.8, C.leaf, 4 * scale);
                this.line(g, x + sign * r * 0.65, y + r * 1.3, x + sign * r * 1.1, y + r * 1.65, C.leaf, 3 * scale);
                this.circle(g, x + sign * r * 0.7, y + r * 1.8, 5 * scale, C.leaf);
            }
        }
        this.circle(g, x, y, r, fill);
        if (id === 'mushroom') {
            g.fillColor = color(C.spore); g.ellipse(x, y + r * 0.6, r * 1.2, r * 0.65); g.fill();
            this.circle(g, x - r * 0.5, y + r * 0.75, 4 * scale, C.white);
            this.circle(g, x + r * 0.35, y + r * 0.9, 5 * scale, C.white);
        }
        this.circle(g, x - r * 0.34, y + r * 0.1, 2.8 * scale, C.ink);
        this.circle(g, x + r * 0.34, y + r * 0.1, 2.8 * scale, C.ink);
        this.circle(g, x, y - r * 0.2, 2.5 * scale, this.petTint(id));
        this.line(g, x - r * 0.17, y - r * 0.4, x + r * 0.17, y - r * 0.4, C.ink, 1.4);
    }
    private tree(g: Graphics, x: number, y: number, scale: number): void {
        this.rect(g, x, y - 22 * scale, 21 * scale, 65 * scale, '#967347', 5);
        this.circle(g, x - 24 * scale, y + 15 * scale, 31 * scale, '#6F9D62');
        this.circle(g, x + 24 * scale, y + 15 * scale, 31 * scale, '#6F9D62');
        this.circle(g, x, y + 37 * scale, 37 * scale, '#4C8455');
        this.circle(g, x, y + 15 * scale, 9 * scale, '#D9E99C');
    }
    private resultOverlay(root: Node): void {
        const won = this.session.phase === 'won';
        const modal = this.uiNode('Result', root); modal.addComponent(BlockInputEvents);
        const shade = this.graphics(modal); shade.fillColor = color(C.ink, 145);
        shade.rect(-360, -this.layout.top, 720, this.layout.height); shade.fill();
        this.rect(shade, 0, 0, 640, 440, C.white, 20);
        this.text(modal, won ? '这一站，守住了。' : '树心受伤了。', 0, 128, 36, 590, won ? C.green : C.red, false, true, 84);
        this.text(modal, won ? `击退 ${this.session.kills} 只雾团\n带着萌宠小队，继续出发。`
            : '敌人突破防线，树心 1 → 0。\n换个位置，再试一次。', 0, 20, 26, 580, C.muted, false, false, 110);
        this.button(modal, won ? (this.session.current?.children.length ? '继续选择路线' : '抵达净土') : '重新选择路线',
            0, -134, 560, 84, () => {
                if (won) { this.session.continueRoute(); this.reservesOpen = false; this.clearFeedback(); this.renderScreen(); }
                else this.restart();
            });
    }
}
