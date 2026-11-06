import {
    _decorator, BlockInputEvents, Color, Component, EventKeyboard, EventTouch, game, Game, Graphics, input, Input,
    KeyCode, Label, Layers, Mask, Node, profiler, ResolutionPolicy, screen, UITransform, Vec3, view,
} from 'cc';
import { ActionError, ECONOMY, MvpSession, PATH, PETS, PET_ORDER, PetActionResult, PetId, SLOTS, STEP, EnemyState } from '../domain/MvpSession';
import { isPortrait, PortraitLayout, portraitLayout, portraitSlotAt, PORTRAIT_MIN_HEIGHT, PORTRAIT_WIDTH, toPortraitBoard } from './PortraitLayout';

import { GameToast } from './GameToast';
import { ENEMIES, ENEMY_BALANCE } from '../domain/EnemyConfig';
import { ROUTE_BOUNDS } from '../domain/ExpeditionRoute';
import { RouteMapViewport } from './RouteMapViewport';
import { RouteMapView } from './RouteMapView';

const { ccclass } = _decorator;
type Selection = { kind: 'summon'; species: PetId } | { kind: 'pet'; id: number };
interface SummonDrag {
    touchId: number; species: PetId;
    start: { x: number; y: number }; point: { x: number; y: number }; moved: boolean;
    selection: Selection | null; originSlot: number | null; elapsed: number; active: boolean; startedAt: number;
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

let lastRunSeed = 0;
function freshSession(): MvpSession {
    // Entropy is chosen only at the UI boundary, never from battle timing or random attacks.
    const data = new Uint32Array(1);
    let seed = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
        ? crypto.getRandomValues(data)[0] : Date.now() >>> 0;
    if (seed === lastRunSeed) seed = (seed + 1) >>> 0;
    lastRunSeed = seed;
    return new MvpSession(seed);
}

/** Asset-free playable slice. All gameplay decisions live in MvpSession. */
@ccclass('MvpGame')
export class MvpGame extends Component {
    private session = freshSession();
    private mapCamera: RouteMapViewport | null = null;
    private screenRoot: Node | null = null;
    private dynamic: Graphics | null = null;
    private dragVisual: Graphics | null = null;
    private toast: GameToast | null = null;
    private summonMasks = new Map<PetId, Node>();
    private status: Label | null = null;
    private counter: Label | null = null;
    private selected: Selection = { kind: 'summon', species: 'cat' };
    private inspectedPetId: number | null = null;
    private inspectedEnemyId: number | null = null;
    private enemyLabels = new Map<number, Label>();
    private announcedEnemies = new Set<number>();
    private bossStatus: Label | null = null;
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
            if (!this.canDrag(drag)) drag.active = false;
            else if (drag.elapsed >= 0.3) drag.active = true;
        }
        if (!this.orientationBlocked && this.session.phase === 'battle' && !this.session.paused) {
            this.accumulator += Math.min(dt, 0.1) * this.speed;
            let steps = 0;
            while (this.accumulator >= STEP && steps++ < 12) {
                this.session.step(); this.accumulator -= STEP;
                if (this.session.phase !== 'battle') { this.accumulator = 0; this.renderScreen(); break; }
            }
        }
        for (const enemy of this.session.enemies) {
            if ((enemy.kind === 'elite' || enemy.kind === 'boss') && !this.announcedEnemies.has(enemy.id)) {
                this.announcedEnemies.add(enemy.id);
                this.toast?.show(`${enemy.kind === 'boss' ? 'BOSS' : '精英'} ${ENEMIES[enemy.kind].name}来袭`, { tone: 'warning', duration: 3 });
            }
        }
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
        this.inspectedEnemyId = null;
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
        this.inspectedEnemyId = null; this.announcedEnemies.clear();
        this.inspectedPetId = null;
        this.session = freshSession(); this.mapCamera = null; this.selected = { kind: 'summon', species: 'cat' }; this.clearFeedback();
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

    private handlePetAction(result: PetActionResult, summoned: boolean): void {
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
        this.inspectedEnemyId = null;
        this.inspectedPetId = selection?.kind === 'pet' ? selection.id : null;
        // Keep the source alive: range and data labels update without rebuilding its touch node.
        this.summonDrag = { touchId, species, selection, originSlot: slot,
            start: point, point, moved: false, elapsed: 0, active: false, startedAt: this.gestureTime() };
        this.clearFeedback();
    }

    private startBoardGesture(event: EventTouch): void {
        const point = this.touchPoint(event); if (!point) return;
        const enemy = this.session.enemies.find(e => {
            const p = this.boardPoint(e); return Math.hypot(point.x - p.x, point.y - p.y) <= ENEMIES[e.kind].radius + 8;
        });
        if (enemy) { this.inspectedEnemyId = enemy.id; this.inspectedPetId = null; return; }
        this.inspectedEnemyId = null;
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
        if (this.canDrag(drag) && drag.elapsed >= 0.3) drag.active = true;
        if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >= 12) drag.moved = true;
        // Summon avatars retain immediate dragging. Deployed pets require a 0.3-second hold.
        if (drag.selection?.kind === 'summon' && drag.moved && this.canDrag(drag)) drag.active = true;
        if (!this.canDrag(drag)) drag.active = false;
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
        if (!drag.active || !drag.moved || this.session.paused) {
            if (drag.selection.kind === 'summon' && drag.moved && !this.session.paused
                && this.session.dew < ECONOMY.summonCost) this.toast?.show(this.insufficientDewMessage(), { tone: 'warning' });
            this.renderScreen(); return;
        }
        const slot = portraitSlotAt(drag.point, this.layout);
        if (slot === null) { this.feedback = '已取消放置，请拖到空树桩'; this.renderScreen(); return; }
        if (slot === drag.originSlot) { this.renderScreen(); return; }
        if (this.session.pets.some(p => p.slot === slot)) {
            this.handlePetAction({ ok: false, reason: 'SLOT_OCCUPIED' }, false); return;
        }
        // Preview changes neither roster nor balance. Commit exactly once on a valid release.
        this.handlePetAction(drag.selection.kind === 'summon'
            ? this.session.summonPet(drag.species, slot) : this.session.movePet(drag.selection.id, slot),
        drag.selection.kind === 'summon');
    }

    private canDrag(drag: SummonDrag): boolean {
        return !!drag.selection && !this.session.paused
            && (drag.selection.kind === 'pet' || this.session.dew >= ECONOMY.summonCost);
    }

    private insufficientDewMessage(): string {
        return `灵露不足，还差 ${Math.max(0, ECONOMY.summonCost - this.session.dew)} 灵露`;
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
        this.summonMasks.clear(); this.enemyLabels.clear(); this.bossStatus = null;
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
        const { top, bottom } = this.layout;
        const complete = this.session.phase === 'complete';
        this.text(root, `${complete ? '远征完成' : '远征路线'}  ${this.session.visited.length} / ${this.session.routeDepths} · 30 节点`,
            0, top - 92, 24, 656, C.muted, false, false, 40);
        const mapTop = top - 206; const mapBottom = bottom + 28;
        const height = mapTop - mapBottom; const center = (mapTop + mapBottom) / 2;
        this.rect(g, 0, center, 656, height, C.board, 22);
        const focusNodes = this.session.available;
        const last = this.session.route.find(n => n.id === this.session.visited[this.session.visited.length - 1]);
        const focus = focusNodes.length ? {
            x: focusNodes.reduce((sum, n) => sum + n.x, 0) / focusNodes.length, y: focusNodes[0].y,
        } : last ?? this.session.route[0];
        if (!this.mapCamera) {
            this.mapCamera = new RouteMapViewport(656, height, ROUTE_BOUNDS);
            this.mapCamera.focus(focus, complete);
        } else this.mapCamera.resize(656, height);
        const viewNode = this.uiNode('ExpeditionMap', root, 0, center, 656, height);
        const map = viewNode.addComponent(RouteMapView);
        const zoomLabel = this.text(root, '', 190, top - 151, 24, 100, C.ink, false, true, 64);
        map.setup(this.mapCamera, this.session.route, this.session.visited, focusNodes.map(n => n.id), id => {
            if (!this.session.chooseNode(id)) return;
            this.inspectedEnemyId = null; this.announcedEnemies.clear();
            this.inspectedPetId = null; this.reservesOpen = false; this.clearFeedback(); this.renderScreen();
        }, zoom => { zoomLabel.string = `${Math.round(zoom * 100)}%`; });
        this.button(root, complete ? '重新出发' : '定位当前', -214, top - 151, 200, 80,
            () => complete ? this.restart() : map.focus(focus, complete), C.pale, C.ink);
        this.button(root, '−', 94, top - 151, 80, 80, () => map.zoomBy(-0.15), C.pale, C.ink);
        this.button(root, '+', 282, top - 151, 80, 80, () => map.zoomBy(0.15), C.pale, C.ink);
    }

    private drawBattle(root: Node, g: Graphics): void {
        const session = this.session; const current = session.current;
        if (!current) return;
        const { top, bottom, arenaHeight, arenaCenter } = this.layout;
        this.counter = this.text(root, '', 0, top - 91, 24, 656, C.muted, false, false, 40);
        this.rect(g, 0, top - 152, 656, 76, C.white, 16);
        this.text(root, current.encounter === 'boss' ? 'BOSS 战 · 半血狂暴' : current.encounter === 'elite' ? '精英战 · 大型雾兽' : '雾团 / 疾风 / 岩甲', -185, top - 167, 19, 260, current.encounter === 'normal' ? C.muted : C.red, false, false, 32);
        this.text(root, `${current.name} · 第 ${session.visited.length + 1} 站`, -185, top - 132, 22, 250, C.ink, false, true, 36);
        this.dewLabel = this.text(root, '', 140, top - 134, 32, 330, C.green, false, true, 48);
        this.text(root, `战斗 +${ECONOMY.dewPerSecond}/秒 · 击杀 +${ENEMIES.mist.reward}～${ENEMIES.boss.reward}`, 140, top - 169, 22, 330, C.muted, false, false, 32);
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
        this.bossStatus = this.text(root, '', 120, this.layout.arenaTop - 30, 22, 400, C.red, false, true, 36);
        this.bossStatus.node.active = false;
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
            if (this.inspectedEnemyId !== null || this.selected.kind !== 'pet') return;
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
        const count = phase === 'prepare' ? `即将来袭 ${this.session.current.count} 只 · ${this.session.current.encounter === "boss" ? "BOSS 压轴" : this.session.current.encounter === "elite" ? "精英压阵" : "混合雾兽"}`
            : `已击退 ${this.session.kills} / ${this.session.current.count} · 场上 ${this.session.enemies.length}`;
        if (text !== this.lastStatus) { this.status.string = text; this.lastStatus = text; }
        if (count !== this.lastCounter) { this.counter.string = count; this.lastCounter = count; }
        const dewText = `灵露  ${this.session.dew}`;
        if (this.dewLabel && this.dewLabel.string !== dewText) this.dewLabel.string = dewText;
        const deployment = `场上 ${this.session.deployedCount} / ${ECONOMY.deploymentLimit} · 后备 ${this.session.pets.length - this.session.deployedCount}`;
        if (this.deploymentLabel && this.deploymentLabel.string !== deployment) this.deploymentLabel.string = deployment;
        const enemy = this.session.enemies.find(e => e.id === this.inspectedEnemyId);
        if (enemy) {
            const spec = ENEMIES[enemy.kind]; const rage = enemy.kind === 'boss' && enemy.hp <= enemy.maxHp * 0.5;
            const values: [Label | null, string][] = [
                [this.infoTitle, `${spec.name} · ${enemy.kind === 'boss' ? 'BOSS' : enemy.kind === 'elite' ? '精英' : '雾兽'}`],
                [this.infoStats, `生命 ${Math.ceil(enemy.hp)} / ${enemy.maxHp} · 移速 ${Math.round(this.session.current.speed * spec.speed * (rage ? ENEMY_BALANCE.bossRageSpeed : 1))}`],
                [this.infoEffect, rage ? '狂暴中！移速提升 25%' : spec.trait],
                [this.infoMeta, `击败 +${spec.reward} 灵露 · 点击头像切回伙伴资料`], [this.infoAction, '敌人'],
            ];
            for (const [label, value] of values) if (label && label.string !== value) label.string = value;
            if (this.infoTitle) this.infoTitle.color = color(spec.tint);
            if (this.infoStats) this.infoStats.color = color(C.ink);
            return;
        }
        this.inspectedEnemyId = null;
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
        const liveIds = new Set(s.enemies.map(e => e.id));
        for (const [id, label] of this.enemyLabels) if (!liveIds.has(id)) {
            label.node.destroy(); this.enemyLabels.delete(id);
        }
        for (const enemy of s.enemies) this.drawEnemy(g, enemy);
        const boss = s.enemies.find(e => e.kind === 'boss');
        if (this.bossStatus) {
            this.bossStatus.node.active = !!boss;
            if (boss) {
                const title = `BOSS ${ENEMIES.boss.name}  ${Math.ceil(boss.hp)} / ${boss.maxHp}${boss.hp <= boss.maxHp * 0.5 ? ' · 狂暴' : ''}`;
                if (this.bossStatus.string !== title) this.bossStatus.string = title;
                const y = this.layout.arenaTop - 57; const width = 400 * Math.max(0, boss.hp / boss.maxHp);
                this.rect(g, 120, y, 400, 10, '#B9C8A8', 4);
                if (width > 0) this.rect(g, -80 + width / 2, y, width, 10, C.red, 4);
            }
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

    private drawEnemy(g: Graphics, enemy: EnemyState): void {
        const p = this.boardPoint(enemy); const spec = ENEMIES[enemy.kind]; const r = spec.radius;
        const y = p.y + Math.sin(this.session.tick * 0.18 + enemy.id) * 2;
        const rage = enemy.kind === 'boss' && enemy.hp <= enemy.maxHp * 0.5;
        this.circle(g, p.x, y - r * 0.6, r * 0.9, C.roadEdge, 120);
        if (rage) this.circle(g, p.x, y, r + 9, C.red, 55);
        this.circle(g, p.x, y, r, spec.tint);
        if (enemy.kind === 'mist' || enemy.kind === 'mender') {
            this.circle(g, p.x - r * 0.6, y + r * 0.5, r * 0.55, spec.tint);
            this.circle(g, p.x + r * 0.5, y + r * 0.5, r * 0.6, spec.tint);
        }
        if (enemy.kind === 'runner' || enemy.kind === 'elite') {
            g.fillColor = color(enemy.kind === 'elite' ? '#F5EED9' : spec.tint);
            for (const sign of [-1, 1]) {
                g.moveTo(p.x + sign * r * 0.25, y + r * 0.6);
                g.lineTo(p.x + sign * r * 0.9, y + r * 1.5);
                g.lineTo(p.x + sign * r * 0.85, y + r * 0.3); g.close(); g.fill();
            }
        }
        if (enemy.kind === 'armored') {
            g.strokeColor = color('#D9E6D0'); g.lineWidth = 3;
            for (let i = 0; i <= 6; i++) {
                const angle = i * Math.PI / 3; const x = p.x + Math.cos(angle) * r * 0.75;
                const sy = y + Math.sin(angle) * r * 0.75;
                if (i === 0) g.moveTo(x, sy); else g.lineTo(x, sy);
            }
            g.stroke(); this.line(g, p.x - r * 0.7, y, p.x + r * 0.7, y, '#D9E6D0', 2);
        }
        if (enemy.kind === 'mender') {
            this.line(g, p.x - 6, y + r + 8, p.x + 6, y + r + 8, '#FCFDF7', 3);
            this.line(g, p.x, y + r + 2, p.x, y + r + 14, '#FCFDF7', 3);
        }
        if (enemy.kind === 'boss') {
            g.fillColor = color('#EDC365');
            g.moveTo(p.x - r * 0.8, y + r * 0.6); g.lineTo(p.x - r, y + r * 1.4);
            g.lineTo(p.x - r * 0.35, y + r); g.lineTo(p.x, y + r * 1.6);
            g.lineTo(p.x + r * 0.35, y + r); g.lineTo(p.x + r, y + r * 1.4);
            g.lineTo(p.x + r * 0.8, y + r * 0.6); g.close(); g.fill();
        }
        this.circle(g, p.x - r * 0.3, y + r * 0.1, Math.max(2.2, r * 0.11), rage ? '#EDC365' : '#234235');
        this.circle(g, p.x + r * 0.3, y + r * 0.1, Math.max(2.2, r * 0.11), rage ? '#EDC365' : '#234235');
        const large = enemy.kind === 'elite' || enemy.kind === 'boss';
        const bar = large ? 72 : 40; const hpY = p.y + r + (large ? 27 : 21);
        this.rect(g, p.x, hpY, bar, 6, '#A7B59B', 2);
        const remaining = bar * Math.max(0, enemy.hp / enemy.maxHp);
        if (remaining > 0) this.rect(g, p.x - bar / 2 + remaining / 2, hpY, remaining, 6, large ? C.red : C.green, 2);
        let label = this.enemyLabels.get(enemy.id);
        if (!label) {
            label = this.text(g.node, '', 0, 0, large ? 20 : 16, large ? 180 : 120, large ? C.red : C.ink, false, large, 28);
            this.enemyLabels.set(enemy.id, label);
        }
        const halfWidth = large ? 90 : 60;
        label.node.setPosition(Math.max(-324 + halfWidth, Math.min(324 - halfWidth, p.x)), hpY + 19);
        const tag = enemy.kind === 'boss' ? 'BOSS' : enemy.kind === 'elite' ? '精英' : enemy.kind === 'mist' ? '' : spec.name.slice(0, 2);
        const title = `${tag}${tag ? ' ' : ''}${Math.ceil(enemy.hp)}`;
        if (label.string !== title) label.string = title;
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
        this.text(modal, won ? `击退 ${this.session.kills} 只雾兽\n带着萌宠小队，继续出发。`
            : '敌人突破防线，树心 1 → 0。\n换个位置，再试一次。', 0, 20, 26, 580, C.muted, false, false, 110);
        this.button(modal, won ? (this.session.current?.children.length ? '继续选择路线' : '抵达净土') : '重新选择路线',
            0, -134, 560, 84, () => {
                if (won) { this.session.continueRoute(); this.mapCamera = null; this.reservesOpen = false; this.clearFeedback(); this.renderScreen(); }
                else this.restart();
            });
    }
}
