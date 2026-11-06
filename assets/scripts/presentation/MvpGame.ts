import {
    _decorator, BlockInputEvents, Color, Component, EventKeyboard, EventTouch, game, Game, Graphics, input, Input,
    KeyCode, Label, Layers, Mask, Node, profiler, ResolutionPolicy, screen, UITransform, Vec3, view,
} from 'cc';
import { ActionError, ECONOMY, MvpSession, PATH, PETS, SUMMON_ORDER, PetActionResult, PetId, SummonId, SLOTS, STEP, EnemyState, RestChoice } from '../domain/MvpSession';
import { isPortrait, PortraitLayout, portraitLayout, portraitSlotAt, PORTRAIT_MIN_HEIGHT, PORTRAIT_WIDTH, toPortraitBoard } from './PortraitLayout';

import { GameToast } from './GameToast';
import { ENEMIES, ENEMY_BALANCE } from '../domain/EnemyConfig';
import { PET_GROWTH, MutationId, mutationCards } from '../domain/PetGrowth';
import { ROUTE_BOUNDS } from '../domain/ExpeditionRoute';
import { RouteMapViewport } from './RouteMapViewport';
import { RouteMapView } from './RouteMapView';

const { ccclass } = _decorator;
type Selection = { kind: 'summon'; species: SummonId } | { kind: 'pet'; id: number } | { kind: 'release' };
interface SummonDrag {
    touchId: number; species: SummonId;
    start: { x: number; y: number }; point: { x: number; y: number }; moved: boolean;
    selection: Selection | null; originSlot: number | null; elapsed: number; active: boolean; startedAt: number;
}
const C = {
    bg: '#EDF3E7', ink: '#234235', muted: '#526A58', green: '#337354', pale: '#D9E6D0',
    board: '#DDE9D3', roadEdge: '#B9C8A8', road: '#F5EED9', white: '#FCFDF7',
    orange: '#B85C20', cat: '#F1AF64', blue: '#286A9C', rabbit: '#96CBE3',
    deer: '#C9AD77', leaf: '#4D8251', mushroom: '#CE9DD1', spore: '#87539D',
    mole: '#9C7452', rope: '#B4874F',
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
    private summonMasks = new Map<SummonId, Node>();
    private status: Label | null = null;
    private counter: Label | null = null;
    private selected: Selection = { kind: 'summon', species: 'cat' };
    private inspectedPetId: number | null = null;
    private inspectedEnemyId: number | null = null;
    private starLabels = new Map<number, Label>();
    private mergeSourceId: number | null = null;
    private infoMergeButton: Node | null = null;
    private enemyLabels = new Map<number, Label>();
    private announcedEnemies = new Set<number>();
    private bossStatus: Label | null = null;
    private heartLabel: Label | null = null;
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
        this.mergeSourceId = null;
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
        const heartBefore = this.session.heart;
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
        if (this.session.heart > 0 && this.session.heart < heartBefore)
            this.toast?.show(`雾兽突破，树心 -${heartBefore - this.session.heart}（${this.session.heart}/${this.session.maxHeart}）`, { tone: 'warning' });
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
        this.mergeSourceId = null;
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
        if (event.keyCode === KeyCode.DIGIT_5) this.selectPet('mole');
        if (event.keyCode === KeyCode.SPACE) {
            if (this.session.phase === 'prepare') this.begin();
            else if (this.session.phase === 'battle') this.togglePause();
        }
    }
    private selectPet(id: SummonId): void {
        this.mergeSourceId = null;
        this.inspectedEnemyId = null;
        if (this.session.phase !== 'prepare' && this.session.phase !== 'battle') return;
        this.inspectedPetId = null;
        this.selected = { kind: 'summon', species: id }; this.clearFeedback(); this.renderScreen();
    }
    private begin(): void {
        this.mergeSourceId = null;
        this.inspectedPetId = null;
        if (this.session.startBattle()) { this.accumulator = 0; this.clearFeedback(); this.renderScreen(); }
    }
    private togglePause(): void {
        this.mergeSourceId = null;
        this.inspectedPetId = null;
        this.session.setPaused(!this.session.paused); this.accumulator = 0; this.clearFeedback(); this.renderScreen();
    }
    private restart(): void {
        this.mergeSourceId = null;
        this.inspectedEnemyId = null; this.announcedEnemies.clear();
        this.inspectedPetId = null;
        this.session = freshSession(); this.mapCamera = null; this.selected = { kind: 'summon', species: 'cat' }; this.clearFeedback();
        this.accumulator = 0; this.speed = 1; this.reservesOpen = false; this.renderScreen();
    }

    private clearFeedback(): void { this.feedback = ''; this.feedbackError = null; }

    private handleSlot(slot: number): void {
        if (this.orientationBlocked || this.reservesOpen || this.summonDrag) return;
        if (this.session.phase !== 'prepare' && this.session.phase !== 'battle') return;
        if (this.mergeSourceId !== null) {
            const material = this.session.pets.find(p => p.slot === slot);
            if (material) this.performMerge(material.id, this.mergeSourceId);
            else this.toast?.show('请选择另一只同种同星伙伴作为素材', { tone: 'warning' });
            return;
        }
        if (this.selected.kind === 'release') { this.releaseAtSlot(slot); return; }
        const occupant = this.session.pets.find(p => p.slot === slot);
        if (occupant) {
            this.inspectedPetId = occupant.id;
            this.selected = { kind: 'pet', id: occupant.id }; this.clearFeedback(); this.renderScreen(); return;
        }
        if (this.session.paused) { this.feedback = '暂停期间不能召唤或搬迁，请先继续战斗'; return; }
        if (this.selected.kind === 'pet') this.handlePetAction(this.session.movePet(this.selected.id, slot), false);
        else if (this.selected.species === 'mole') this.handleCultivation(slot);
        else this.handlePetAction(this.session.summonPet(this.selected.species, slot), true);
    }

    private handlePetAction(result: PetActionResult, summoned: boolean): void {
        this.inspectedPetId = null;
        if (result.ok === false) {
            const messages: Record<ActionError, string> = {
                WRONG_PHASE: '当前阶段不能放置宠物', PAUSED: '请先继续战斗', INVALID_SLOT: '请选择有效树桩',
                INVALID_SPECIES: '未知宠物种类', SLOT_OCCUPIED: '树桩已被占用，请选择空位',
                INSUFFICIENT_DEW: this.insufficientDewMessage(),
                SLOT_LOCKED: '荒藤缠住了树桩，请先用掘芽鼹开垦', SLOT_OPEN: '这里已开垦，请选择荒藤树桩',
                ROSTER_FULL: `本局最多持有 ${this.session.rosterLimit} 只伙伴，可用归林绳索放生`,
                PET_NOT_FOUND: '宠物不存在，请重新选择', SAME_PET: '请选择另一只同种同星伙伴',
                SPECIES_MISMATCH: '只有同种宠物才能合成', STAR_MISMATCH: '只有同星宠物才能合成', MAX_STARS: '已达 3 星上限',
            };
            this.feedback = messages[result.reason];
            this.feedbackError = result.reason;
            this.toast?.show(this.feedback, { tone: 'warning' });
            this.renderScreen();
        } else {
            this.feedbackError = null;
            this.feedback = summoned ? `召唤${PETS[result.pet.species].name}，消耗 ${result.pet.purchaseCost} 灵露`
                : result.pet.slot === null ? '已收回后备，重新部署免费，不返还灵露'
                    : this.session.phase === 'battle' ? '搬迁完成，1 秒后恢复攻击或施法' : '';
            this.renderScreen();
        }
    }

    private beginMerge(): void {
        if (this.mergeSourceId !== null) { this.mergeSourceId = null; this.renderScreen(); return; }
        const id = this.selectedPetId(); const pet = this.session.pets.find(p => p.id === id);
        if (!pet) return;
        if (this.session.paused) { this.toast?.show('请先继续战斗', { tone: 'warning' }); return; }
        if (pet.star === 3) { this.toast?.show('已达 3 星上限', { tone: 'warning' }); return; }
        if (!this.session.pets.some(p => this.session.mergeError(p.id, pet.id) === null)) {
            this.toast?.show(`需要另一只 ${pet.star} 星${PETS[pet.species].name}`, { tone: 'warning' }); return;
        }
        this.mergeSourceId = pet.id; this.clearFeedback(); this.renderScreen();
    }

    private performMerge(sourceId: number, targetId: number): void {
        const result = this.session.mergePets(sourceId, targetId);
        if (result.ok === false) { this.handlePetAction(result, false); return; }
        this.mergeSourceId = null; this.reservesOpen = false; this.accumulator = 0;
        this.selected = { kind: 'pet', id: result.pet.id }; this.inspectedPetId = result.pet.id;
        this.clearFeedback(); this.renderScreen();
        if (!result.mutationRequired) this.toast?.show(`${PETS[result.pet.species].name}升至 ${result.pet.star} 星`, { tone: 'success' });
    }

    private chooseMutation(choice: MutationId): void {
        const pending = this.session.pendingMutation;
        if (!pending || !this.session.chooseMutation(choice)) return;
        this.accumulator = 0; this.clearFeedback(); this.renderScreen();
        const pet = this.session.pets.find(p => p.id === pending.petId);
        if (pet) this.toast?.show(`获得 ${mutationCards(pet.species).find(card => card.id === choice)?.name ?? '变异'}`, { tone: 'success' });
    }

    private handleCultivation(slot: number): void {
        const result = this.session.cultivate(slot);
        if (result.ok === false) { this.handlePetAction(result, false); return; }
        this.inspectedPetId = null; this.clearFeedback(); this.renderScreen();
        this.toast?.show(`开垦成功！掘芽鼹已归林 · -${PETS.mole.cost} 灵露`, { tone: 'success' });
    }

    private releaseAtSlot(slot: number | null): void {
        const pet = this.session.pets.find(p => slot !== null && p.slot === slot);
        if (!pet) { this.toast?.show('请将归林绳索用于场上宠物', { tone: 'warning' }); this.renderScreen(); return; }
        this.releasePet(pet.id);
    }

    private releasePet(id: number): void {
        const result = this.session.releasePet(id);
        if (result.ok === false) { this.handlePetAction(result, false); return; }
        this.selected = { kind: 'summon', species: result.species };
        this.inspectedPetId = null; this.inspectedEnemyId = null;
        this.clearFeedback(); this.renderScreen();
        this.toast?.show(`${PETS[result.species].name}已归林 · +${result.refund} 灵露`, { tone: 'success' });
    }

    private overRope(point: { x: number; y: number }): boolean {
        return Math.abs(point.x - 280) <= 48 && Math.abs(point.y - (this.layout.bottom + 216)) <= 53;
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
        if (selection?.kind === 'summon' || selection?.kind === 'release') this.mergeSourceId = null;
        this.inspectedEnemyId = null;
        this.inspectedPetId = selection?.kind === 'pet' ? selection.id : null;
        // Keep the source alive: range and data labels update without rebuilding its touch node.
        this.summonDrag = { touchId, species, selection, originSlot: slot,
            start: point, point, moved: false, elapsed: 0, active: false, startedAt: this.gestureTime() };
        this.clearFeedback();
    }

    private startBoardGesture(event: EventTouch): void {
        const point = this.touchPoint(event); if (!point) return;
        if (this.mergeSourceId !== null) { this.startGesture(null, portraitSlotAt(point, this.layout), event); return; }
        if (this.selected.kind === 'release') {
            this.startGesture(this.selected, portraitSlotAt(point, this.layout), event); return;
        }
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
        if ((drag.selection?.kind === 'summon' || drag.selection?.kind === 'release') && drag.moved && this.canDrag(drag)) drag.active = true;
        if (!this.canDrag(drag)) drag.active = false;
    }

    private finishSummonDrag(event: EventTouch): void {
        const drag = this.summonDrag;
        if (!drag || event.getID() !== drag.touchId) return;
        // An outside release is node CANCEL in 3.8.8; inspect the original event code.
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
        if (drag.selection.kind === 'release' && !drag.moved) {
            if (drag.originSlot !== null) this.releaseAtSlot(drag.originSlot);
            else this.renderScreen();
            return;
        }
        if (!drag.active || !drag.moved || this.session.paused) {
            if (drag.selection.kind === 'summon' && drag.moved && !this.session.paused
                && this.session.dew < PETS[drag.species].cost)
                this.toast?.show(this.insufficientDewMessage(drag.species), { tone: 'warning' });
            this.renderScreen(); return;
        }
        if (drag.selection.kind === 'pet' && this.overRope(drag.point)) { this.releasePet(drag.selection.id); return; }
        const slot = portraitSlotAt(drag.point, this.layout);
        if (drag.selection.kind === 'release') { this.releaseAtSlot(slot); return; }
        if (slot === null) { this.feedback = '已取消，请拖到树桩'; this.renderScreen(); return; }
        if (slot === drag.originSlot) { this.renderScreen(); return; }
        const occupant = this.session.pets.find(p => p.slot === slot);
        if (occupant && drag.selection.kind === 'pet') { this.performMerge(drag.selection.id, occupant.id); return; }
        if (occupant) {
            this.handlePetAction({ ok: false, reason: 'SLOT_OCCUPIED' }, false); return;
        }
        if (drag.selection.kind === 'summon') {
            if (drag.species === 'mole') this.handleCultivation(slot);
            else this.handlePetAction(this.session.summonPet(drag.species, slot), true);
        } else this.handlePetAction(this.session.movePet(drag.selection.id, slot), false);
    }

    private canDrag(drag: SummonDrag): boolean {
        return !!drag.selection && !this.session.paused
            && (drag.selection.kind !== 'summon' || this.session.dew >= PETS[drag.species].cost);
    }

    private insufficientDewMessage(species?: SummonId): string {
        const id = species ?? (this.selected.kind === 'summon' ? this.selected.species : 'cat');
        return `灵露不足，还差 ${Math.max(0, PETS[id].cost - this.session.dew)} 灵露`;
    }

    private bindGesture(node: Node): void {
        node.on(Node.EventType.TOUCH_MOVE, this.moveSummonDrag, this);
        node.on(Node.EventType.TOUCH_END, this.finishSummonDrag, this);
        node.on(Node.EventType.TOUCH_CANCEL, this.finishSummonDrag, this);
    }

    private petTint(id: SummonId): string {
        return id === 'mole' ? C.mole : id === 'cat' ? C.orange : id === 'rabbit' ? C.blue : id === 'deer' ? C.leaf : C.spore;
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
        action: () => void, fill = C.green, textTint = C.white, active = true, fontSize = 26): Node {
        const node = this.uiNode(title, parent, x, y, w, h);
        const g = node.addComponent(Graphics); this.rect(g, 0, 0, w, h, active ? fill : C.pale);
        this.text(node, title, 0, 0, fontSize, w - 20, active ? textTint : C.muted, false, true, h);
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
        this.mergeSourceId = null;
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
        this.summonMasks.clear(); this.starLabels.clear(); this.infoMergeButton = null; this.enemyLabels.clear(); this.bossStatus = null;
        if (this.reservesOpen || this.orientationBlocked
            || (this.session.phase !== 'prepare' && this.session.phase !== 'battle')) this.toast?.dismiss();
        this.summonDrag = null;
        if (this.screenRoot) { this.screenRoot.removeFromParent(); this.screenRoot.destroy(); }
        this.dynamic = null; this.dragVisual = null; this.status = null; this.counter = null; this.lastStatus = ''; this.lastCounter = '';
        this.heartLabel = null; this.dewLabel = null; this.deploymentLabel = null;
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
        this.heartLabel = this.text(root, `树心 ${this.session.heart}/${this.session.maxHeart}`, 240, this.layout.top - 46, 24, 170, this.session.heart <= 1 ? C.red : C.green);
        if (this.session.phase === 'map' || this.session.phase === 'complete') this.drawMap(root, g);
        else if (this.session.phase === 'rest') this.drawRest(root, g);
        else this.drawBattle(root, g);
    }

    private drawMap(root: Node, g: Graphics): void {
        const { top, bottom } = this.layout;
        const complete = this.session.phase === 'complete';
        this.text(root, `${complete ? '远征完成' : '远征路线'}  ${this.session.visited.length} / ${this.session.routeDepths} · 30 节点`,
            -110, top - 92, 24, 420, C.muted, false, false, 40);
        this.text(root, `灵露 ${this.session.dew}`, 236, top - 92, 26, 180, C.green, false, true, 40);
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

    private drawRest(root: Node, g: Graphics): void {
        this.text(root, `静露营地 · 第 ${this.session.visited.length + 1} 站`, 0, 360, 38, 656, C.green, false, true, 70);
        this.text(root, '选择一项补给', 0, 295, 26, 600, C.muted);
        this.circle(g, 0, 140, 100, C.board);
        this.tree(g, 0, 110, 1.5);
        this.text(root, `灵露 ${this.session.dew} · 树心 ${this.session.heart}/${this.session.maxHeart}`, 0, 15, 28, 600, C.ink, false, true);
        const choose = (choice: RestChoice): void => {
            const before = this.session.heart;
            if (!this.session.takeRest(choice)) return;
            this.mapCamera = null; this.clearFeedback(); this.renderScreen();
            this.toast?.show(choice === 'dew' ? `获得 ${ECONOMY.restDew} 灵露` : `树心恢复 +${this.session.heart - before}`, { tone: 'success' });
        };
        this.button(root, `收集灵露\n获得 ${ECONOMY.restDew} 灵露`, 0, -110, 600, 144, () => choose('dew'));
        const injured = this.session.heart < this.session.maxHeart;
        this.button(root, injured ? `滋养树心\n恢复 ${ECONOMY.restHeal} 点树心` : '滋养树心\n树心已满',
            0, -295, 600, 144, () => choose('heal'), C.white, C.green, injured);
        this.text(root, '每处营地只能选择一次', 0, -410, 24, 600, C.muted);
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
        this.text(root, `击杀 +${ENEMIES.mist.reward}～${ENEMIES.boss.reward} 灵露`, 140, top - 169, 22, 330, C.muted, false, false, 32);
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
            if (session.isSlotOpen(i)) {
                this.line(g, p.x - 8, p.y, p.x + 8, p.y, '#899C79', 2);
                this.line(g, p.x, p.y - 8, p.x, p.y + 8, '#899C79', 2);
            } else this.vines(g, p.x, p.y);
        }
        const board = this.uiNode('BattlePlacement', root, 0, arenaCenter, 656, arenaHeight);
        board.on(Node.EventType.TOUCH_START, this.startBoardGesture, this); this.bindGesture(board);
        const base = points[points.length - 1]; const entry = points[0];
        this.tree(g, base.x, base.y, 0.66);
        this.text(root, '摇篮树', base.x - 112, base.y - 12, 22, 140, C.green, false, true, 38);
        SUMMON_ORDER.forEach((id, i) => this.petCard(root, id, -280 + i * 112, bottom + 216));
        this.ropeCard(root, 280, bottom + 216);
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
        else if (session.phase === 'mutation') this.mutationOverlay(root);
        else if (this.reservesOpen) this.reserveOverlay(root);
    }

    private mutationOverlay(root: Node): void {
        const pending = this.session.pendingMutation;
        const pet = this.session.pets.find(p => p.id === pending?.petId);
        if (!pending || !pet) return;
        const modal = this.uiNode('MutationChoice', root); modal.addComponent(BlockInputEvents);
        const g = this.graphics(modal); g.fillColor = color(C.ink, 170);
        g.rect(-360, -this.layout.top, 720, this.layout.height); g.fill();
        this.rect(g, 0, 0, 656, 760, C.bg, 22);
        this.text(modal, '发生变异！', 0, 310, 38, 600, C.spore, false, true, 70);
        this.text(modal, `${PETS[pet.species].name} · ${pet.star}星`, 0, 248, 28, 600, C.ink, false, true, 48);
        this.text(modal, '选择一个特性 · 战斗已冻结', 0, 203, 23, 600, C.muted, false, false, 40);
        mutationCards(pet.species).forEach((card, i) => {
            const y = 76 - i * 220;
            const button = this.button(modal, '', 0, y, 600, 180, () => this.chooseMutation(card.id), C.white, C.ink);
            this.text(button, card.name, 0, 52, 30, 540, i === 0 ? C.orange : C.spore, false, true, 48);
            this.text(button, card.detail, 0, -12, 23, 540, C.ink, false, false, 90);
            this.text(button, i === 0 ? '属性取舍' : '特性共鸣', 0, -66, 20, 540, C.muted, false, false, 30);
        });
        this.text(modal, '选择后生效，替换已有变异；不会叠加或重抽。', 0, -306, 22, 600, C.muted, false, false, 70);
    }

    private petCard(root: Node, id: SummonId, x: number, y: number): void {
        const node = this.uiNode(`Pet-${id}`, root, x, y, 96, 106);
        const g = node.addComponent(Graphics);
        this.rect(g, 0, 0, 96, 106, C.white, 22);
        this.petIcon(g, 0, -3, id, 1.05);
        const mask = this.uiNode(`Unaffordable-${id}`, node, 0, 0, 96, 106);
        const shade = mask.addComponent(Graphics); shade.fillColor = color(C.ink, 150);
        shade.roundRect(-48, -53, 96, 106, 22); shade.fill();
        mask.active = this.session.dew < PETS[id].cost;
        this.summonMasks.set(id, mask);
        node.on(Node.EventType.TOUCH_START,
            (event: EventTouch) => this.startGesture({ kind: 'summon', species: id }, null, event), this);
        this.bindGesture(node);
    }

    private ropeCard(root: Node, x: number, y: number): void {
        const node = this.uiNode('归林绳索', root, x, y, 96, 106);
        const g = node.addComponent(Graphics); this.rect(g, 0, 0, 96, 106, C.white, 22);
        this.ropeIcon(g, 0, 0);
        node.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.startGesture({ kind: 'release' }, null, event), this);
        this.bindGesture(node);
    }

    private ropeIcon(g: Graphics, x: number, y: number): void {
        g.strokeColor = color(C.rope); g.lineWidth = 6;
        g.ellipse(x - 3, y + 9, 23, 26); g.stroke();
        this.line(g, x + 12, y - 12, x + 22, y - 29, C.rope, 6);
        this.line(g, x + 22, y - 29, x + 9, y - 37, C.rope, 6);
        this.circle(g, x + 10, y - 13, 5, C.orange);
    }

    private vines(g: Graphics, x: number, y: number): void {
        this.circle(g, x, y, 29, '#C5C6AD');
        for (const sign of [-1, 1]) {
            this.line(g, x - 25, y + sign * 20, x + 25, y - sign * 20, '#647D50', 7);
            this.line(g, x + sign * 11, y + 10, x + sign * 22, y + 29, '#647D50', 4);
            this.circle(g, x + sign * 13, y - sign * 9, 7, '#8C6991');
        }
        this.circle(g, x, y, 8, '#87539D');
    }

    private drawInfoCard(root: Node, g: Graphics): void {
        const y = this.layout.top - 278;
        this.rect(g, 0, y, 656, 152, C.white, 16);
        this.infoTitle = this.text(root, '', -120, y + 46, 26, 360, C.ink, true, true, 42);
        this.infoStats = this.text(root, '', 0, y + 6, 23, 616, C.ink, true, false, 34);
        this.infoEffect = this.text(root, '', 0, y - 30, 23, 616, C.muted, true, false, 34);
        this.infoMeta = this.text(root, '', 0, y - 61, 21, 616, C.muted, true, false, 30);
        const action = this.button(root, '30 灵露', 140, y + 43, 116, 54, () => {
            this.mergeSourceId = null;
            if (this.selected.kind === 'release') { this.selected = { kind: 'summon', species: 'cat' }; this.renderScreen(); return; }
            if (this.inspectedEnemyId !== null || this.selected.kind !== 'pet') return;
            const pet = this.session.pets.find(p => p.id === this.selectedPetId());
            if (!pet) return;
            if (pet.slot === null) this.releasePet(pet.id);
            else this.handlePetAction(this.session.movePet(pet.id, pet.slot), false);
        }, C.pale, C.ink, true, 22);
        this.infoAction = action.getComponentInChildren(Label);
        this.infoMergeButton = this.button(root, '合成', 268, y + 43, 116, 54, () => this.beginMerge(), C.pale, C.ink, true, 22);
        this.infoMergeButton.active = false;
    }

    private selectedPetId(): number | null { return this.selected.kind === 'pet' ? this.selected.id : null; }

    private reserveOverlay(root: Node): void {
        const modal = this.uiNode('ReserveSelection', root); modal.addComponent(BlockInputEvents);
        const g = this.graphics(modal); g.fillColor = color(C.ink, 145);
        g.rect(-360, -this.layout.top, 720, this.layout.height); g.fill();
        this.rect(g, 0, 0, 656, 650, C.white, 20);
        this.text(modal, '后备伙伴', 0, 268, 32, 600, C.ink, false, true, 60);
        this.text(modal, this.mergeSourceId !== null ? '选择同种同星素材，合入已选伙伴' : this.selected.kind === 'release' ? '选择后备伙伴放生，返还 60% 灵露' : '选择伙伴，再点击树桩免费部署', 0, 211, 24, 600, C.muted, false, false, 46);
        const releasing = this.selected.kind === 'release';
        this.session.pets.filter(p => p.slot === null).forEach((pet, i) => {
            const refund = Math.floor(pet.purchaseCost * ECONOMY.releaseRate);
            this.button(modal, `${PETS[pet.species].name} ${pet.star}星\n${this.mergeSourceId !== null ? '合入主宠' : releasing ? `放生 +${refund}` : '免费部署'}`,
                -228 + (i % 4) * 152, 130 - Math.floor(i / 4) * 92, 140, 78, () => {
                    this.reservesOpen = false;
                    if (this.mergeSourceId !== null) this.performMerge(pet.id, this.mergeSourceId);
                    else if (releasing) this.releasePet(pet.id);
                    else { this.selected = { kind: 'pet', id: pet.id }; this.clearFeedback(); this.renderScreen(); }
                }, C.pale, C.ink, this.mergeSourceId === null || this.session.mergeError(pet.id, this.mergeSourceId) === null, 21);
        });
        this.button(modal, '返回战场', 0, -278, 560, 76,
            () => { this.reservesOpen = false; this.renderScreen(); });
    }

    private updateHud(): void {
        const heartText = `树心 ${this.session.heart}/${this.session.maxHeart}`;
        if (this.heartLabel && this.heartLabel.string !== heartText) {
            this.heartLabel.string = heartText;
            this.heartLabel.color = color(this.session.heart <= 1 ? C.red : C.green);
        }
        if (!this.status || !this.counter || !this.session.current) return;
        const phase = this.session.phase;
        for (const [id, mask] of this.summonMasks) {
            const unaffordable = this.session.dew < PETS[id].cost;
            if (mask.active !== unaffordable) mask.active = unaffordable;
        }
        if (this.feedbackError === 'INSUFFICIENT_DEW' && this.session.dew >= (this.selected.kind === 'summon' ? PETS[this.selected.species].cost : 0)) this.clearFeedback();
        const selected = this.selected;
        const pet = selected.kind === 'pet' ? this.session.pets.find(p => p.id === selected.id) : undefined;
        const action = this.mergeSourceId !== null ? '选择另一只同种同星素材合入，也可从后备中选择' : selected.kind === 'release' ? '拖动绳索到宠物，或点击宠物放生 · 返还 60%'
            : selected.kind === 'summon' ? selected.species === 'mole' ? `拖动掘芽鼹到荒藤树桩 · ${PETS.mole.cost} 灵露开垦`
                : `拖动${PETS[selected.species].name}到空树桩 · ${PETS[selected.species].cost} 灵露`
                : pet ? '长按拖到同种同星伙伴上合成，也可点卡片合成' : '请选择伙伴';
        const text = phase === 'lost' ? '树心耗尽，本次远征结束。'
                : phase === 'won' ? '这一站守住了，准备前往下一段旅程。'
                    : this.session.paused ? '已暂停，请继续后再召唤或搬迁'
                        : this.summonDrag?.active ? '范围随落点预览，拖到空树桩后松手放置'
                            : this.feedback || action;
        const count = phase === 'prepare' ? `即将来袭 ${this.session.current.count} 只 · ${this.session.current.encounter === "boss" ? "BOSS 压轴" : this.session.current.encounter === "elite" ? "精英压阵" : "混合雾兽"}`
            : `击退 ${this.session.kills}/${this.session.current.count} · 漏过 ${this.session.leaked} · 场上 ${this.session.enemies.length}`;
        if (text !== this.lastStatus) { this.status.string = text; this.lastStatus = text; }
        if (count !== this.lastCounter) { this.counter.string = count; this.lastCounter = count; }
        const dewText = `灵露  ${this.session.dew}`;
        if (this.dewLabel && this.dewLabel.string !== dewText) this.dewLabel.string = dewText;
        const deployment = `场上 ${this.session.deployedCount} / ${this.session.deploymentLimit} · 待开垦 ${SLOTS.length - this.session.deploymentLimit} · 后备 ${this.session.pets.length - this.session.deployedCount}`;
        if (this.deploymentLabel && this.deploymentLabel.string !== deployment) this.deploymentLabel.string = deployment;
        if (this.infoMergeButton) {
            this.infoMergeButton.active = !!pet && this.inspectedEnemyId === null;
            const mergeLabel = this.infoMergeButton.getComponentInChildren(Label);
            const mergeText = this.mergeSourceId !== null ? '取消' : pet?.star === 3 ? '满星' : '合成';
            if (mergeLabel && mergeLabel.string !== mergeText) mergeLabel.string = mergeText;
        }
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
        if (selected.kind === 'release' || (selected.kind === 'summon' && selected.species === 'mole')) {
            const release = selected.kind === 'release';
            const values: [Label | null, string][] = [
                [this.infoTitle, release ? '归林绳索 · 放生' : '掘芽鼹 · 一次性开垦'],
                [this.infoStats, release ? '返还原召唤消耗的 60% 灵露' : `${PETS.mole.cost} 灵露 · 解锁一个荒藤树桩`],
                [this.infoEffect, release ? '拖到宠物身上，或选绳索再点宠物' : '清除荒藤后钻回森林，不占树桩'],
                [this.infoMeta, release ? '1星伙伴返18 · 合成后按总投入返还' : '开垦在本次远征内保留 · 不进入后备'],
                [this.infoAction, release ? '退出工具' : `${PETS.mole.cost} 灵露`],
            ];
            if (this.infoTitle) this.infoTitle.color = color(release ? C.orange : C.mole);
            if (this.infoStats) this.infoStats.color = color(C.ink);
            for (const [label, value] of values) if (label && label.string !== value) label.string = value;
            return;
        }
        const species = pet?.species ?? (selected.kind === 'summon' ? selected.species : 'cat');
        const spec = PETS[species]; const base = pet ? this.session.petStats(pet) : spec;
        const damage = pet ? this.session.effectiveDamage(pet) : spec.damage;
        const range = pet ? this.session.attackRange(pet) : spec.range;
        const interval = pet ? this.session.attackInterval(pet) : spec.interval;
        const fmt = (n: number): string => Number(n.toFixed(2)).toString();
        const boosted = pet && this.session.attackMultiplier(pet) > 1;
        const stats = species === 'deer' ? `施法范围 ${fmt(base.range)} · 攻击力 +${fmt(base.boost * 100)}% · 不攻击`
            : species === 'mushroom' ? `范围 ${fmt(range)} · 每 ${fmt(interval)} 秒 ${fmt(damage)} 伤害${boosted ? ' ↑' : ''}`
                : `攻击 ${fmt(damage)}${boosted ? ' ↑' : ''} · 间隔 ${fmt(interval)} 秒 · 范围 ${fmt(range)}`;
        let effect = species === 'deer' ? '范围内友军获得增益，同类光环不叠加'
            : species === 'mushroom' ? '孢子只伤害范围内敌人，离开范围即停止'
                : species === 'cat' ? '挥爪攻击最接近摇篮树的单个敌人' : '发射星弹，追踪范围内最靠前的敌人';
        const mutation = pet?.mutation ? mutationCards(pet.species).find(card => card.id === pet.mutation) : undefined;
        if (mutation) effect = `${mutation.name} · ${mutation.summary}`;
        const meta = pet ? `${pet.slot === null ? '后备' : '已部署'} #${pet.id} · 搬迁 / 放生 +${Math.floor(pet.purchaseCost * ECONOMY.releaseRate)} 灵露`
            : `未部署 · ${spec.cost} 灵露 · ${this.session.dew < spec.cost ? '灵露不足' : '点击空位或拖动头像'}`;
        if (this.infoTitle) this.infoTitle.color = color(this.petTint(species));
        if (this.infoStats) this.infoStats.color = color(boosted ? C.leaf : C.ink);
        const labels: [Label | null, string][] = [
            [this.infoTitle, pet ? `${spec.name} · ${pet.star}星` : `${spec.name} · ${spec.role}`], [this.infoStats, stats],
            [this.infoEffect, effect], [this.infoMeta, meta], [this.infoAction, pet ? pet.slot === null ? `放生+${Math.floor(pet.purchaseCost * ECONOMY.releaseRate)}` : '收回' : `${spec.cost} 灵露`],
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
            if (drag?.active && drag.selection && drag.selection.kind !== 'release' && !this.overRope(drag.point)) {
                const slot = portraitSlotAt(drag.point, this.layout);
                p = slot === null ? drag.point : this.boardPoint(SLOTS[slot]);
            }
            const tint = this.petTint(species); const range = (pet ? this.session.attackRange(pet) : PETS[species].range) * this.layout.scale;
            if (p && selected.kind !== 'release' && species !== 'mole') {
                this.circle(g, p.x, p.y, range, tint, 24);
                g.strokeColor = color(tint, 150); g.lineWidth = 2; g.circle(p.x, p.y, range); g.stroke();
            }
            if ((selected.kind === 'summon' || selected.kind === 'release') && this.dragVisual) {
                const x = selected.kind === 'release' ? 280 : -280 + SUMMON_ORDER.indexOf(selected.species) * 112;
                const outline = this.dragVisual; outline.strokeColor = color(tint); outline.lineWidth = 4;
                outline.roundRect(x - 48, this.layout.bottom + 163, 96, 106, 22); outline.stroke();
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
        for (const [id, badge] of this.starLabels) if (!s.pets.some(pet => pet.id === id && pet.slot !== null)) {
            badge.node.destroy(); this.starLabels.delete(id);
        }
        for (const pet of s.pets) {
            if (pet.slot === null) continue;
            const p = this.boardPoint(SLOTS[pet.slot]); this.petIcon(g, p.x, p.y + 4, pet.species, 0.95);
            let badge = this.starLabels.get(pet.id);
            if (!badge) {
                badge = this.text(g.node, '', 0, 0, 24, 40, C.ink, false, true, 36);
                this.starLabels.set(pet.id, badge);
            }
            this.circle(g, p.x, p.y + 60, 15, C.white);
            badge.node.setPosition(p.x, p.y + 60);
            if (badge.string !== `${pet.star}`) badge.string = `${pet.star}`;
            badge.color = color(pet.mutation ? C.spore : pet.star > 1 ? C.orange : C.green);
            if (this.mergeSourceId !== null && s.mergeError(pet.id, this.mergeSourceId) === null) {
                g.strokeColor = color(C.orange); g.lineWidth = 4; g.circle(p.x, p.y, 36); g.stroke();
            }
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
            if (mark.radius) { g.strokeColor = color(C.orange, 170); g.lineWidth = 3; g.circle(p.x, p.y, mark.radius * this.layout.scale); g.stroke(); }
            if (mark.kind === 'cat') {
                for (let i = -1; i <= 1; i++) this.line(g, p.x - 10 + i * 5, p.y - 11, p.x + 5 + i * 5, p.y + 12, C.orange, 3);
            } else { g.strokeColor = color(mark.kind === 'mushroom' ? C.spore : C.blue, 160); g.lineWidth = 2; g.circle(p.x, p.y, mark.kind === 'mushroom' ? 20 : 12); g.stroke(); }
        }
        const drag = this.summonDrag;
        if (drag?.active && drag.selection) {
            const slot = portraitSlotAt(drag.point, this.layout);
            const release = drag.selection.kind === 'release';
            const mole = drag.selection.kind === 'summon' && drag.species === 'mole';
            const affordable = drag.selection.kind !== 'summon' || (s.dew >= PETS[drag.species].cost
                && (mole || s.pets.length < s.rosterLimit));
            for (let i = 0; i < SLOTS.length; i++) {
                const occupant = s.pets.find(p => p.slot === i); const empty = !occupant;
                const mergeable = !!occupant && drag.selection.kind === 'pet' && s.mergeError(drag.selection.id, occupant.id) === null;
                const valid = release ? !empty : mergeable || empty && affordable && (mole ? !s.isSlotOpen(i) : s.isSlotOpen(i));
                if (!valid && slot !== i) continue;
                const p = this.boardPoint(SLOTS[i]); const tint = valid ? release ? C.orange : C.green : C.red;
                if (slot === i) this.circle(g, p.x, p.y, 37, tint, 65);
                g.strokeColor = color(tint, slot === i ? 255 : 150);
                g.lineWidth = slot === i ? 5 : 2; g.circle(p.x, p.y, 36); g.stroke();
            }
            const x = drag.point.x; const y = drag.point.y + 54;
            const avatar = this.dragVisual ?? g;
            this.circle(avatar, x, y, 35, C.white, 230);
            if (release) this.ropeIcon(avatar, x, y);
            else this.petIcon(avatar, x, y, drag.species, 1);
            if (drag.selection.kind === 'pet' && this.overRope(drag.point)) {
                avatar.strokeColor = color(C.orange); avatar.lineWidth = 4;
                avatar.roundRect(232, this.layout.bottom + 163, 96, 106, 22); avatar.stroke();
            }
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

    private petIcon(g: Graphics, x: number, y: number, id: SummonId, scale: number): void {
        const r = 27 * scale;
        const fill = id === 'mole' ? C.mole : id === 'cat' ? C.cat : id === 'rabbit' ? C.rabbit : id === 'deer' ? C.deer : C.mushroom;
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
        if (id === 'mole') {
            this.circle(g, x, y - r * 0.25, r * 0.65, '#D5B48A');
            this.circle(g, x, y - r * 0.15, r * 0.25, '#D39197');
            for (const sign of [-1, 1]) {
                this.circle(g, x + sign * r * 0.9, y - r * 0.6, r * 0.35, '#D5B48A');
                for (let i = 0; i < 3; i++) this.line(g, x + sign * r * (0.7 + i * 0.2), y - r * 0.7,
                    x + sign * r * (0.7 + i * 0.2), y - r, '#FCFDF7', 2 * scale);
            }
        }
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
        this.text(modal, won ? '这一站，守住了。' : '树心耗尽了。', 0, 128, 36, 590, won ? C.green : C.red, false, true, 84);
        this.text(modal, won ? `击退 ${this.session.kills} 只 · 漏过 ${this.session.leaked} 只\n树心 ${this.session.heart}/${this.session.maxHeart} · 灵露 ${this.session.dew}`
            : '雾兽突破防线，摇篮树失去生机。\n整理阵容，再次出发。', 0, 20, 26, 580, C.muted, false, false, 110);
        this.button(modal, won ? (this.session.current?.children.length ? '继续选择路线' : '抵达净土') : '重新选择路线',
            0, -134, 560, 84, () => {
                if (won) { this.session.continueRoute(); this.mapCamera = null; this.reservesOpen = false; this.clearFeedback(); this.renderScreen(); }
                else this.restart();
            });
    }
}
