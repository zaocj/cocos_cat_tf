import {
    _decorator, BlockInputEvents, Color, Component, EditBox, EventKeyboard, EventTouch, game, Game, Graphics, input, Input,
    isValid, KeyCode, Label, Layers, Mask, Node, profiler, Rect, resources, ResolutionPolicy, screen, Size, Sprite, SpriteFrame, sys, UITransform, Vec2, Vec3, view,
} from 'cc';
import { ActionError, ECONOMY, MvpSession, PATH, PETS, PET_ORDER, PetActionResult, MergeResult, PocketResult, PetId, SLOTS, STEP, EnemyState, RestChoice, pointOnPath } from '../domain/MvpSession';
import { isPortrait, PortraitLayout, portraitLayout, portraitSlotAt, PORTRAIT_MIN_HEIGHT, PORTRAIT_WIDTH, toPortraitBoard } from './PortraitLayout';

import { GameToast } from './GameToast';
import { ENEMIES, ENEMY_BALANCE } from '../domain/EnemyConfig';
import { PET_GROWTH, MutationId, mutationCards, mutationResult, mutationNames, MUTATION_FORM_COUNT } from '../domain/PetGrowth';
import { ROUTE_BOUNDS } from '../domain/ExpeditionRoute';
import { RouteMapViewport } from './RouteMapViewport';
import { RouteMapView } from './RouteMapView';
import { ArchiveLoad, RunArchive } from '../infrastructure/RunArchive';
import { GuideId, GUIDE_IDS, GUIDES, nextGuide, PlayerProfile, recordMutationProgress } from '../domain/FirstGuide';

const { ccclass } = _decorator;
type Selection = { kind: 'none' } | { kind: 'carried'; species: PetId } | { kind: 'pet'; id: number } | { kind: 'release' } | { kind: 'cultivate' };
type UiSkin = 'button_primary' | 'button_secondary' | 'panel_standard' | 'panel_mutation';
type BattleArt = 'forest_floor' | 'road_sand' | 'stump_open' | 'stump_locked' | 'cradle_tree';
type ArtKey = UiSkin | BattleArt;
const BATTLE_ART: Record<BattleArt, { asset: string; rect: readonly [number, number, number, number] }> = {
    forest_floor: { asset: 'forest_floor', rect: [0, 0, 941, 1672] },
    road_sand: { asset: 'forest_source', rect: [400, 420, 48, 48] },
    stump_open: { asset: 'stump_open', rect: [242, 373, 770, 508] },
    stump_locked: { asset: 'stump_locked', rect: [146, 190, 944, 801] },
    cradle_tree: { asset: 'cradle_tree', rect: [93, 82, 1070, 1069] },
};
function isUiSkin(key: ArtKey): key is UiSkin { return key in UI_SKINS; }
const UI_SKINS: Record<UiSkin, readonly [number, number, number, number]> = {
    // Source-pixel insets: left, right, top, bottom. Borders scale uniformly with the art node.
    button_primary: [350, 350, 120, 140], button_secondary: [220, 220, 100, 100],
    panel_standard: [240, 220, 240, 240], panel_mutation: [240, 240, 300, 320],
};
// Source rectangles exclude near-transparent generation speckles; PNGs and importer metadata stay untouched.
const UI_CROPS: Record<UiSkin, readonly [number, number, number, number]> = {
    button_primary: [49, 92, 2070, 524], button_secondary: [39, 209, 1686, 467],
    panel_standard: [21, 12, 1047, 1418], panel_mutation: [22, 32, 979, 1478],
};
interface SummonDrag {
    touchId: number; species: PetId;
    start: { x: number; y: number }; point: { x: number; y: number }; moved: boolean;
    selection: Selection | null; originSlot: number | null; elapsed: number; active: boolean; startedAt: number;
    releaseOnTap: boolean;
    toggleToolOnTap: boolean;
}
const C = {
    bg: '#EDF3E7', ink: '#234235', muted: '#526A58', green: '#337354', pale: '#D9E6D0',
    board: '#DDE9D3', roadEdge: '#B9C8A8', road: '#F5EED9', white: '#FCFDF7',
    orange: '#B85C20', cat: '#F1AF64', blue: '#286A9C', rabbit: '#96CBE3',
    deer: '#C9AD77', leaf: '#4D8251', mushroom: '#CE9DD1', spore: '#87539D',
    vine: '#7EBB6B', sparrow: '#F5D579', electric: '#BD8515',
    tool: '#9C7452', rope: '#B4874F',
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

/** Playable MVP. All gameplay decisions live in MvpSession. */
@ccclass('MvpGame')
export class MvpGame extends Component {
    private session = freshSession();
    private archive: RunArchive | null = null;
    private saved: ArchiveLoad = { status: 'empty', data: null, message: '' };
    private profile: PlayerProfile = { guideSeen: [] };
    private atHome = true;
    private menuOpen = false;
    private debugOpen = false;
    private metamorphosisLayer = 0;
    private confirmNew = false;
    private collectionOpen = false;
    private metamorphosisOpen = false;
    private metamorphosisTarget: number | null = null;
    private sessionOnly = false;
    private saveProblem = '';
    private lastSavedTick = 0;
    private guideActive: GuideId | null = null;
    private mapCamera: RouteMapViewport | null = null;
    private screenRoot: Node | null = null;
    private dynamic: Graphics | null = null;
    private dragVisual: Graphics | null = null;
    private toast: GameToast | null = null;
    private shovelMask: Node | null = null;
    private randomMask: Node | null = null;
    private infoOpen = false;
    private infoRoot: Node | null = null;
    private counter: Label | null = null;
    private selected: Selection = { kind: 'carried', species: 'cat' };
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
    private speed: 1 | 2 = 1;
    private lastCounter = '';
    private layout: PortraitLayout = portraitLayout(PORTRAIT_MIN_HEIGHT);
    private orientationBlocked = false;
    private resumeAfterPortrait = false;
    private orientationGate: HTMLDivElement | null = null;
    private reservesOpen = false;
    private banishCandidate: PetId | null = null;
    private summonDrag: SummonDrag | null = null;
    private uiArtReady = false;
    private uiArtError = '';
    private uiArtRequest = 0;
    private uiFrames = new Map<ArtKey, { frame: SpriteFrame; source: SpriteFrame }>();

    onEnable(): void {
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        game.on(Game.EVENT_HIDE, this.onHide, this);
        screen.on('window-resize', this.onViewportResize, this);
        if (typeof window !== 'undefined') window.addEventListener('pagehide', this.pageHide);
        if (this.screenRoot) this.onViewportResize();
    }
    onDisable(): void {
        this.clearToolSelection();
        this.metamorphosisOpen = false; this.metamorphosisTarget = null;
        this.infoOpen = false;
        this.mergeSourceId = null;
        this.toast?.dismiss();
        this.inspectedPetId = null;
        this.summonDrag = null;
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
        game.off(Game.EVENT_HIDE, this.onHide, this);
        screen.off('window-resize', this.onViewportResize, this);
        if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.pageHide);
        if (this.orientationGate) this.orientationGate.style.display = 'none';
    }
    onDestroy(): void {
        this.uiArtRequest++;
        this.uiFrames.forEach(({ frame, source }) => { frame.destroy(); source.decRef(); });
        this.uiFrames.clear();
        this.toast?.node?.destroy(); this.toast = null; this.orientationGate?.remove();
    }
    start(): void {
        profiler.hideStats();
        this.archive = new RunArchive(sys.localStorage);
        this.saved = this.archive.load();
        this.profile = this.saved.data?.profile ?? { guideSeen: [] };
        this.speed = this.profile.speed ?? 1;
        this.onViewportResize();
        this.loadUiArt();
    }

    private loadUiArt(): void {
        const request = ++this.uiArtRequest;
        this.uiArtError = ''; this.renderScreen();
        const keys: ArtKey[] = [...Object.keys(UI_SKINS) as UiSkin[], ...Object.keys(BATTLE_ART) as BattleArt[]];
        void Promise.all(keys.map(key => new Promise<{ key: ArtKey; frame: SpriteFrame | null; error: string }>(resolve => {
            const path = isUiSkin(key) ? `art/ui/${key}/spriteFrame` : `art/environment/${BATTLE_ART[key].asset}/spriteFrame`;
            resources.load(path, SpriteFrame, (error, frame) => {
                if (!error && frame) frame.addRef();
                resolve({ key, frame: !error && frame ? frame : null,
                    error: error ? `${path}: ${error.message}` : frame ? '' : `${path}: 未返回 SpriteFrame` });
            });
        }))).then(results => {
            if (!isValid(this.node) || request !== this.uiArtRequest) {
                results.forEach(result => result.frame?.decRef()); return;
            }
            this.uiArtError = results.filter(result => result.error).map(result => result.error).join('\n');
            if (this.uiArtError) {
                results.forEach(result => result.frame?.decRef());
                console.error(`[Game art] ${this.uiArtError}`); this.renderScreen(); return;
            }
            results.forEach(({ key, frame: source }) => {
                if (!source) return;
                const frame = source.clone();
                frame.rect = new Rect(...(isUiSkin(key) ? UI_CROPS[key] : BATTLE_ART[key].rect));
                // Normalize the cropped frame so transparent canvas padding cannot shrink the visible button.
                frame.originalSize = new Size(frame.rect.width, frame.rect.height);
                frame.offset = new Vec2(0, 0);
                const [left, right, top, bottom] = isUiSkin(key) ? UI_SKINS[key] : [0, 0, 0, 0];
                frame.insetLeft = left; frame.insetRight = right; frame.insetTop = top; frame.insetBottom = bottom;
                frame.packable = false;
                this.uiFrames.set(key, { frame, source });
            });
            this.uiArtReady = true; this.renderScreen();
        });
    }

    private skinImage(parent: Node, key: UiSkin, x: number, y: number, width: number, height: number, tint = '#FFFFFF'): boolean {
        const frame = this.uiFrames.get(key)?.frame;
        if (!frame) return false;
        const scale = Math.min(width / frame.rect.width, height / frame.rect.height);
        const node = this.uiNode(`Art-${key}`, parent, x, y, width / scale, height / scale);
        node.setScale(scale, scale, 1);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.type = Sprite.Type.SLICED;
        sprite.spriteFrame = frame; sprite.color = color(tint);
        return true;
    }

    private battleImage(parent: Node, key: BattleArt, x: number, y: number, width: number, height: number,
        type = Sprite.Type.SIMPLE): Sprite {
        const frame = this.uiFrames.get(key)?.frame;
        if (!frame) throw new Error(`Battle art not loaded: ${key}`);
        const node = this.uiNode(`Art-${key}`, parent, x, y, width, height);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.type = type; sprite.spriteFrame = frame;
        return sprite;
    }

    private drawBattleArt(root: Node): void {
        const { arenaCenter, arenaHeight, scale } = this.layout;
        const field = this.uiNode('BattlefieldArt', root, 0, arenaCenter, 656, arenaHeight);
        field.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        // Only the noninteractive background uses cover; every gameplay position keeps the same uniform projection.
        const cover = Math.max(656 / 941, arenaHeight / 1672);
        this.battleImage(field, 'forest_floor', 0, 0, 941 * cover, 1672 * cover);
        const points = PATH.map(point => {
            const p = this.boardPoint(point); return { x: p.x, y: p.y - arenaCenter };
        });
        const roadShape = (g: Graphics, width: number, tint: string): void => {
            for (let i = 1; i < points.length; i++) this.line(g, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, tint, width * scale);
            for (const point of points) this.circle(g, point.x, point.y, width * scale / 2, tint);
        };
        roadShape(this.graphics(field, 'RoadGrassEdge'), 52, '#A6B55B');
        const road = this.uiNode('RoadTextureMask', field, 0, 0, 656, arenaHeight);
        const mask = road.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_STENCIL;
        const stencil = mask.subComp;
        if (!(stencil instanceof Graphics)) throw new Error('Road stencil requires Cocos 3.8.8 Graphics mask');
        stencil.clear(); roadShape(stencil, 44, '#FFFFFF');
        this.battleImage(road, 'road_sand', 0, 0, 656, arenaHeight, Sprite.Type.TILED);
        SLOTS.forEach((slot, index) => {
            const p = this.boardPoint(slot); const open = this.session.isSlotOpen(index);
            const key = open ? 'stump_open' : 'stump_locked';
            const rect = BATTLE_ART[key].rect; const width = (open ? 90 : 96) * scale;
            this.battleImage(field, key, p.x, p.y - arenaCenter - (open ? 30 : 18) * scale, width, width * rect[3] / rect[2]);
        });
        const base = points[points.length - 1];
        this.battleImage(field, 'cradle_tree', base.x - 6 * scale, base.y - 24 * scale, 112 * scale, 112 * scale * 1069 / 1070);
    }
    update(dt: number): void {
        const heartBefore = this.session.heart; const killsBefore = this.session.kills;
        const drag = this.summonDrag;
        if (drag) {
            drag.elapsed = Math.max(drag.elapsed + Math.min(dt, 0.1), (this.gestureTime() - drag.startedAt) / 1000);
            if (!this.canDrag(drag)) drag.active = false;
            else if (drag.elapsed >= 0.3) drag.active = true;
        }
        if (!this.atHome && !this.menuOpen && !this.guideActive && !this.saveProblem
            && !this.orientationBlocked && this.session.phase === 'battle' && !this.session.paused) {
            this.accumulator += Math.min(dt, 0.1) * this.speed;
            let steps = 0;
            while (this.accumulator >= STEP && steps++ < 12) {
                this.session.step(); this.accumulator -= STEP;
                if (this.session.phase !== 'battle') { this.accumulator = 0; this.renderScreen(); break; }
            }
        }
        if (!this.atHome && !this.saveProblem && (this.session.tick - this.lastSavedTick >= 30 || this.session.heart !== heartBefore || this.session.kills !== killsBefore)) {
            if (!this.checkpoint()) this.renderScreen();
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
        this.clearToolSelection();
        this.metamorphosisOpen = false; this.metamorphosisTarget = null;
        this.infoOpen = false;
        this.mergeSourceId = null;
        this.toast?.dismiss();
        this.inspectedPetId = null;
        this.summonDrag = null;
        this.resumeAfterPortrait = false;
        if (!this.atHome) { this.session.setPaused(true); this.accumulator = 0; this.checkpoint(); this.renderScreen(); }
    }
    private pageHide = (): void => { this.onHide(); };
    private onKey(event: EventKeyboard): void {
        if (this.atHome || this.menuOpen || this.collectionOpen || this.metamorphosisOpen || this.guideActive || this.saveProblem || this.orientationBlocked || this.reservesOpen || this.summonDrag) return;
        if (event.keyCode === KeyCode.DIGIT_1) this.selectPet('cat');
        if (event.keyCode === KeyCode.DIGIT_2) this.selectPet('rabbit');
        if (event.keyCode === KeyCode.DIGIT_3) this.selectPet('deer');
        if (event.keyCode === KeyCode.DIGIT_4) this.selectPet('mushroom');
        if (event.keyCode === KeyCode.DIGIT_5) this.selectShovel();
        if (event.keyCode === KeyCode.DIGIT_6) this.selectPet('vine');
        if (event.keyCode === KeyCode.DIGIT_7) this.selectPet('sparrow');
        if (event.keyCode === KeyCode.KEY_R) this.randomSummon();
        if (event.keyCode === KeyCode.SPACE) {
            if (this.session.phase === 'prepare') this.begin();
            else if (this.session.phase === 'battle') this.openMenu();
        }
    }
    private selectPet(id: PetId): void {
        if (!this.session.carriedPets.includes(id)) return;
        this.mergeSourceId = null;
        this.inspectedEnemyId = null;
        if (this.session.phase !== 'prepare' && this.session.phase !== 'battle') return;
        this.inspectedPetId = null;
        this.selected = { kind: 'none' }; this.infoOpen = false; this.clearFeedback(); this.renderScreen();
    }
    private selectShovel(): void {
        if (this.session.phase !== 'prepare' && this.session.phase !== 'battle') return;
        this.mergeSourceId = null; this.inspectedEnemyId = null; this.inspectedPetId = null;
        this.selected = { kind: this.selected.kind === 'cultivate' ? 'none' : 'cultivate' };
        this.infoOpen = false; this.clearFeedback(); this.renderScreen();
    }

    private randomSummon(): void {
        this.infoOpen = false;
        if (this.session.phase !== 'prepare' && this.session.phase !== 'battle') return;
        this.mergeSourceId = null; this.inspectedPetId = null; this.inspectedEnemyId = null;
        this.selected = { kind: 'carried', species: this.session.carriedPets[0] };
        const result = this.session.summonRandomPet();
        this.handlePetAction(result, true);
        if (result.ok) this.toast?.show(`${PETS[result.pet.species].name}加入防线 · -${ECONOMY.summonCost} 灵露`, { tone: 'success' });
    }

    private begin(): void {
        this.infoOpen = false;
        this.mergeSourceId = null;
        this.inspectedPetId = null;
        if (this.session.startBattle()) { this.accumulator = 0; this.clearFeedback(); this.renderScreen(); }
    }
    private restart(): void {
        this.debugOpen = false;
        this.collectionOpen = false; this.metamorphosisOpen = false; this.metamorphosisTarget = null;
        this.atHome = false; this.menuOpen = false; this.confirmNew = false; this.guideActive = null;
        this.banishCandidate = null;
        this.infoOpen = false;
        this.mergeSourceId = null;
        this.inspectedEnemyId = null; this.announcedEnemies.clear();
        this.inspectedPetId = null;
        this.session = freshSession(); this.mapCamera = null; this.selected = { kind: 'carried', species: 'cat' }; this.clearFeedback();
        this.accumulator = 0; this.speed = this.profile.speed ?? 1; this.reservesOpen = false; this.renderScreen();
    }

    private checkpoint(): boolean {
        if (this.atHome) return true;
        this.profile = recordMutationProgress(this.profile, this.session);
        if (this.sessionOnly || !this.archive) return true;
        const result = this.archive.save(this.session, this.profile);
        if (result.ok === false) {
            this.saveProblem = result.message; this.session.setPaused(true); this.accumulator = 0; return false;
        }
        this.lastSavedTick = this.session.tick; return true;
    }

    private continueSaved(): void {
        const snapshot = this.saved.data?.run; if (!snapshot) return;
        this.session = MvpSession.restore(snapshot);
        // Cold restoration never advances combat until the player explicitly resumes.
        this.session.setPaused(true);
        this.atHome = false; this.menuOpen = false; this.confirmNew = false; this.saveProblem = '';
        this.accumulator = 0; this.mapCamera = null; this.reservesOpen = false;
        this.selected = { kind: 'carried', species: this.session.carriedPets[0] };
        this.inspectedPetId = null; this.inspectedEnemyId = null; this.clearFeedback(); this.renderScreen();
    }

    private openMenu(): void {
        this.session.setPaused(true); this.menuOpen = true; this.infoOpen = false;
        this.accumulator = 0; this.renderScreen();
    }

    private home(): void {
        if (!this.checkpoint()) { this.renderScreen(); return; }
        this.saved = this.sessionOnly ? { status: 'ready', data: { run: this.session.snapshot(), profile: this.profile }, message: '本次试玩仅保留在内存中，关闭页面后不能恢复。' }
            : this.archive?.load() ?? this.saved;
        this.atHome = true; this.menuOpen = false; this.reservesOpen = false; this.mapCamera = null;
        this.accumulator = 0; this.renderScreen();
    }

    private panel(root: Node, name: string, height: number): Node {
        const modal = this.uiNode(name, root); modal.addComponent(BlockInputEvents);
        const art = modal.addComponent(Graphics); art.fillColor = color(C.ink, 170);
        art.rect(-360, this.layout.bottom, 720, this.layout.height); art.fill();
        if (!this.skinImage(modal, 'panel_standard', 0, 0, 656, height)) this.rect(art, 0, 0, 656, height, C.white, 22);
        return modal;
    }

    private drawHome(root: Node): void {
        const g = this.graphics(root, 'HomeTree'); this.tree(g, 0, 240, 1.5);
        this.text(root, '萌宠变异录', 0, 410, 46, 640, C.green, false, true, 90);
        const run = this.saved.data?.run;
        const resumable = !!run && run.phase !== 'lost' && run.phase !== 'complete';
        const phaseNames: Record<string, string> = { map: '选路中', rest: '营地', sanctuary: '伙伴驿站', prepare: '准备防守', battle: '战斗中', mutation: '变异待选择', won: '节点已完成' };
        this.text(root, resumable && run ? `第 ${run.visited.length + 1} 站 · ${phaseNames[run.phase] ?? run.phase}\n树心 ${run.heart}/3 · 灵露 ${run.dew} · 口袋 ${run.pocket.length}/6`
            : '从猫与兔开始，守护摇篮树的远征。', 0, 90, 26, 620, C.ink, false, false, 100);
        this.button(root, '继续远征', 0, -40, 580, 92, () => this.continueSaved(), C.green, C.white, resumable);
        this.button(root, '新远征', 0, -165, 580, 92, () => {
            if (resumable || ['corrupt', 'incompatible', 'unavailable'].includes(this.saved.status)) { this.confirmNew = true; this.renderScreen(); }
            else this.restart();
        }, C.pale, C.ink);
        this.button(root, `形态记录 · ${this.profile.mutationCollection?.length ?? 0}/${MUTATION_FORM_COUNT}`, 0, -278, 580, 76,
            () => { this.collectionOpen = true; this.renderScreen(); }, C.pale, C.ink, true, 24);
        this.text(root, this.saved.message || (run?.phase === 'complete' ? '上一次远征已完成，开始新的旅途吧。' : '自动保存本局进度；新远征会重置口袋与灵露。'),
            0, -397, 23, 610, this.saved.message ? C.orange : C.muted, false, false, 140);
        if (this.collectionOpen) this.collectionOverlay(root);
        if (this.confirmNew) {
            const modal = this.panel(root, 'ConfirmNewRun', 420);
            this.text(modal, '开始新远征？', 0, 122, 34, 600, C.ink, false, true, 70);
            this.text(modal, '当前远征将被新局替换。\n首次引导的已读进度保留。', 0, 20, 25, 580, C.muted, false, false, 110);
            this.button(modal, '取消', -154, -127, 276, 84, () => { this.confirmNew = false; this.renderScreen(); }, C.pale, C.ink);
            this.button(modal, '开始新远征', 154, -127, 276, 84, () => this.restart(), C.orange, C.white, true, 24);
        }
    }

    private drawRunMenu(root: Node): void {
        const modal = this.panel(root, 'RunMenu', 780);
        this.text(modal, '远征菜单', 0, 303, 36, 600, C.ink, false, true);
        this.text(modal, this.sessionOnly ? '本次不保存 · 关闭后进度会丢失' : this.session.debugModified ? '本局已使用修改器 · 进度自动保存' : '进度自动保存，战斗已暂停', 0, 232, 23, 600, this.sessionOnly ? C.orange : C.muted);
        this.button(modal, '继续远征', 0, 119, 560, 88, () => {
            this.menuOpen = false; this.session.setPaused(false); this.accumulator = 0; this.renderScreen();
        });
        this.button(modal, this.sessionOnly ? '返回首页（仅本次保留）' : '保存并返回首页', 0, 0, 560, 88, () => this.home(), C.pale, C.ink, true, 24);
        this.button(modal, '调试修改器', 0, -119, 560, 88, () => { this.debugOpen = true; this.renderScreen(); }, C.pale, C.spore, true, 25);
        this.button(modal, '重新显示首次引导', 0, -238, 560, 88, () => {
            this.profile = { ...this.profile, guideSeen: [] }; this.menuOpen = false; this.renderScreen();
        }, C.pale, C.ink, true, 24);
    }

    private debugInput(parent: Node, name: string, value: string, y: number): EditBox {
        const node = this.uiNode(name, parent, 0, y, 560, 80);
        // Configure labels before EditBox.__preload can create its default children.
        node.active = false;
        const art = node.addComponent(Graphics); this.rect(art, 0, 0, 560, 80, C.pale, 12);
        const label = this.text(node, value, 0, 0, 28, 528, C.ink, false, true, 66);
        const placeholder = this.text(node, '', 0, 0, 25, 528, C.muted, false, false, 66);
        label.getComponent(UITransform)?.setAnchorPoint(0, 1);
        placeholder.getComponent(UITransform)?.setAnchorPoint(0, 1);
        const edit = node.addComponent(EditBox); edit.textLabel = label; edit.placeholderLabel = placeholder;
        edit.inputMode = EditBox.InputMode.DECIMAL; edit.returnType = EditBox.KeyboardReturnType.DONE;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        edit.maxLength = 10; edit.string = value;
        node.active = true;
        return edit;
    }

    private drawDebugModifier(root: Node): void {
        const modal = this.panel(root, 'DebugModifier', 860);
        this.text(modal, '调试修改器', 0, 354, 36, 600, C.spore, false, true, 70);
        this.text(modal, '仅修改当前远征，确认后保存；新远征恢复默认。', 0, 278, 23, 592, C.muted, false, false, 70);
        this.text(modal, '灵露 · 0～1000000 整数', 0, 210, 24, 560, C.ink, true, true, 42);
        const dew = this.debugInput(modal, 'DebugDewInput', `${this.session.dew}`, 143);
        ['0', '+100', '+1000', '10000'].forEach((title, i) => this.button(modal, title, -210 + i * 140, 62, 130, 56, () => {
            dew.string = title.startsWith('+') ? `${Math.min(1000000, (Number(dew.string) || 0) + Number(title.slice(1)))}` : title;
        }, C.pale, C.ink, true, 23));
        this.text(modal, '自然变异概率 · 0～100%', 0, -21, 24, 560, C.ink, true, true, 42);
        const chance = this.debugInput(modal, 'DebugChanceInput', `${Number((this.session.mutationChance * 100).toFixed(4))}`, -86);
        [0, 50, 100].forEach((value, i) => this.button(modal, `${value}%`, -184 + i * 184, -168, 172, 56,
            () => { chance.string = `${value}`; }, C.pale, C.ink, true, 23));
        const error = this.text(modal, '调整不会推进随机流，已生成的候选不会改变。', 0, -252, 23, 584, C.muted, false, false, 78);
        this.button(modal, '取消', -146, -355, 268, 82, () => { this.debugOpen = false; this.renderScreen(); }, C.pale, C.ink, true, 25);
        this.button(modal, '确认修改', 146, -355, 268, 82, () => {
            const dewText = dew.string.trim(); const chanceText = chance.string.trim();
            if (!/^\d+$/.test(dewText) || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(chanceText)) {
                error.string = '请输入灵露整数和有效的概率百分比。'; error.color = color(C.red); return;
            }
            const result = this.session.applyDebugSettings(Number(dewText), Number(chanceText) / 100);
            if (result.ok === false) {
                error.string = result.reason === 'INVALID_DEW' ? '灵露须为 0～1000000 的整数。'
                    : result.reason === 'INVALID_CHANCE' ? '概率须在 0～100% 之间。' : '当前阶段不能修改，请先完成变异选择。';
                error.color = color(C.red); return;
            }
            this.debugOpen = false; this.renderScreen();
            if (!this.saveProblem) this.toast?.show('本局调试参数已保存', { tone: 'success' });
        }, C.spore, C.white, true, 25);
    }

    private drawGuide(root: Node, id: GuideId): void {
        const modal = this.panel(root, 'FirstGuide', 550);
        this.text(modal, `首次指引 · ${GUIDE_IDS.indexOf(id) + 1}/${GUIDE_IDS.length}`, 0, 208, 22, 600, C.green);
        this.text(modal, GUIDES[id].title, 0, 140, 33, 592, C.ink, false, true, 80);
        this.text(modal, GUIDES[id].text, 0, 5, 25, 584, C.muted, false, false, 180);
        this.button(modal, '知道了，试一试', 0, -139, 560, 80, () => {
            this.profile.guideSeen = [...this.profile.guideSeen, id]; this.renderScreen();
        }, C.green, C.white, true, 25);
        this.button(modal, '跳过全部引导', 0, -227, 400, 56, () => {
            this.profile.guideSeen = [...GUIDE_IDS]; this.renderScreen();
        }, C.white, C.muted, true, 22);
        // Visual anchors stay visible through the shade. Commands remain blocked until acknowledgement.
        const art = modal.getComponent(Graphics);
        if (art && (id === 'summon' || id === 'cultivate' || id === 'release')) {
            const x = id === 'summon' ? -206 : id === 'cultivate' ? 200 : 280;
            const y = this.layout.bottom + (id === 'summon' ? 52 : 164);
            art.strokeColor = color(C.orange); art.lineWidth = 5;
            art.roundRect(x - (id === 'summon' ? 122 : 42), y - 57, id === 'summon' ? 244 : 84, 114, 18); art.stroke();
        }
    }

    private drawSaveFailure(root: Node): void {
        const modal = this.panel(root, 'SaveFailure', 570);
        this.text(modal, '存档未写入，已暂停', 0, 206, 32, 600, C.red, false, true, 80);
        this.text(modal, this.saveProblem, 0, 74, 25, 580, C.ink, false, false, 140);
        this.button(modal, '重试保存', 0, -72, 560, 88, () => { this.saveProblem = ''; this.checkpoint(); this.renderScreen(); });
        this.button(modal, '本次不保存，继续试玩', 0, -197, 560, 88, () => {
            this.sessionOnly = true; this.saveProblem = ''; this.renderScreen();
        }, C.pale, C.ink, true, 24);
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
            this.infoOpen = true;
            this.inspectedPetId = occupant.id;
            this.selected = { kind: 'pet', id: occupant.id }; this.clearFeedback(); this.renderScreen(); return;
        }
        if (this.selected.kind === 'none') return;
        if (this.session.paused) { this.feedback = '暂停期间不能召唤或搬迁，请先继续战斗'; return; }
        if (this.selected.kind === 'pet') this.handlePetAction(this.session.movePet(this.selected.id, slot), false);
        else if (this.selected.kind === 'cultivate') this.handleCultivation(slot);
        else this.toast?.show('点击随机召唤，让携带伙伴加入防线', { tone: 'info' });
    }

    private handlePetAction(result: PetActionResult, summoned: boolean,
        cost = this.selected.kind === 'cultivate' ? ECONOMY.cultivateCost : ECONOMY.summonCost): void {
        this.infoOpen = false;
        this.inspectedPetId = null;
        if (result.ok === false) {
            const messages: Record<ActionError, string> = {
                WRONG_PHASE: '当前阶段不能放置宠物', PAUSED: '请先继续战斗', INVALID_SLOT: '请选择有效树桩',
                INVALID_SPECIES: '未知宠物种类', SLOT_OCCUPIED: '树桩已被占用，请选择空位',
                INSUFFICIENT_DEW: this.insufficientDewMessage(cost),
                SLOT_LOCKED: '荒藤缠住了树桩，请先用铲子开垦', SLOT_OPEN: '这里已开垦，请选择荒藤树桩',
                NO_FREE_SLOT: '没有可放置的空位，请先合成、放生或用铲子开垦',
                NOT_CARRIED: '这只宠物未加入本局携带池',
                ALREADY_CARRIED: '这只宠物已经在口袋中', CARRY_FULL: '口袋已满，请先定向放生一种宠物',
                BANISHED: '这只宠物已在本局放生，不能重新购买', LAST_ATTACKER: '口袋中至少保留一种输出宠物',
                ROSTER_FULL: `本局最多持有 ${this.session.rosterLimit} 只伙伴，可用归林绳索放生`,
                PET_NOT_FOUND: '宠物不存在，请重新选择', SAME_PET: '请选择另一只同种同星伙伴',
                SPECIES_MISMATCH: '只有同种宠物才能合成', STAR_MISMATCH: '只有同星宠物才能合成', MAX_STARS: '已达 3 星上限',
                NO_MUTATION_CREDIT: '主动蜕变次数不足，完成第 3/6 站各获得一次', STAR_TOO_LOW: '主动蜕变需要二星或三星伙伴',
                INVALID_MUTATION_INDEX: '请选择有效的变异层', NO_NEW_MUTATION: '已拥有该宠物的全部变异，无需蜕变',
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
        this.handleMergeResult(this.session.mergePets(sourceId, targetId));
    }

    private handleMergeResult(result: MergeResult, inspect = true): void {
        if (result.ok === false) { this.handlePetAction(result, false); return; }
        this.mergeSourceId = null; this.reservesOpen = false; this.accumulator = 0;
        this.selected = { kind: 'pet', id: result.pet.id }; this.inspectedPetId = inspect ? result.pet.id : null;
        this.infoOpen = inspect;
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
        this.infoOpen = false;
        const result = this.session.cultivate(slot);
        this.clearToolSelection();
        if (result.ok === false) { this.handlePetAction(result, false, ECONOMY.cultivateCost); return; }
        this.inspectedPetId = null; this.clearFeedback(); this.renderScreen();
        this.toast?.show(`开垦成功！荒藤已清除 · -${ECONOMY.cultivateCost} 灵露`, { tone: 'success' });
    }

    private releaseAtSlot(slot: number | null): void {
        const pet = this.session.pets.find(p => slot !== null && p.slot === slot);
        this.clearToolSelection();
        if (!pet) { this.toast?.show('请将归林绳索用于场上宠物', { tone: 'warning' }); this.renderScreen(); return; }
        this.releasePet(pet.id);
    }

    private releasePet(id: number): void {
        this.infoOpen = false;
        const result = this.session.releasePet(id);
        this.clearToolSelection();
        if (result.ok === false) { this.handlePetAction(result, false); return; }
        this.selected = { kind: 'none' };
        this.inspectedPetId = null; this.inspectedEnemyId = null;
        this.clearFeedback(); this.renderScreen();
        this.toast?.show(`${PETS[result.species].name}已归林 · +${result.refund} 灵露`, { tone: 'success' });
    }

    private overRope(point: { x: number; y: number }): boolean {
        return Math.abs(point.x - 280) <= 36 && Math.abs(point.y - (this.layout.bottom + 164)) <= 53;
    }

    private clearToolSelection(): void {
        if (this.selected.kind === 'cultivate' || this.selected.kind === 'release') this.selected = { kind: 'none' };
        this.infoOpen = false;
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
        const species = selection?.kind === 'carried' ? selection.species : pet?.species ?? 'cat';
        const toggleToolOnTap = (selection?.kind === 'release' || selection?.kind === 'cultivate') && this.selected.kind === selection.kind;
        if (selection) this.selected = selection;
        // A press may become a drag: only a completed pet tap opens inspection.
        this.infoOpen = false;
        if (selection?.kind === 'carried' || selection?.kind === 'release' || selection?.kind === 'cultivate') this.mergeSourceId = null;
        this.inspectedEnemyId = null;
        this.inspectedPetId = null;
        // Keep the source alive: range and data labels update without rebuilding its touch node.
        this.summonDrag = { touchId, species, selection, originSlot: slot,
            start: point, point, moved: false, elapsed: 0, active: false, startedAt: this.gestureTime(), releaseOnTap: false, toggleToolOnTap };
        this.clearFeedback();
    }

    private startBoardGesture(event: EventTouch): void {
        if (this.summonDrag || this.orientationBlocked || this.reservesOpen) return;
        const point = this.touchPoint(event); if (!point) return;
        const slot = portraitSlotAt(point, this.layout);
        if (this.mergeSourceId !== null) { this.startGesture(null, slot, event); return; }
        const pet = this.session.pets.find(p => p.slot !== null && p.slot === slot);
        if (pet) {
            // The object under the finger owns the drag, even while a tool is selected.
            // Keep rope tap-to-release separate from holding and dragging this pet.
            const releaseOnTap = this.selected.kind === 'release';
            this.startGesture({ kind: 'pet', id: pet.id }, slot, event);
            if (this.summonDrag) this.summonDrag.releaseOnTap = releaseOnTap;
            return;
        }
        if (this.selected.kind === 'release' || this.selected.kind === 'cultivate') {
            this.startGesture(this.selected, slot, event); return;
        }
        const enemy = this.session.enemies.find(e => {
            const p = this.boardPoint(e); return Math.hypot(point.x - p.x, point.y - p.y) <= ENEMIES[e.kind].radius + 8;
        });
        if (enemy) { this.inspectedEnemyId = enemy.id; this.inspectedPetId = null; this.infoOpen = true; return; }
        this.inspectedEnemyId = null;
        if (slot === null) { this.inspectedPetId = null; this.infoOpen = false; return; }
        this.startGesture(null, slot, event);
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
        // Tools drag immediately. Deployed pets require a 0.3-second hold.
        if ((drag.selection?.kind === 'release' || drag.selection?.kind === 'cultivate') && drag.moved && this.canDrag(drag)) drag.active = true;
        if (!this.canDrag(drag)) drag.active = false;
    }

    private finishSummonDrag(event: EventTouch): void {
        const drag = this.summonDrag;
        if (!drag || event.getID() !== drag.touchId) return;
        // An outside release is node CANCEL in 3.8.8; inspect the original event code.
        if (event.getEventCode() !== Input.EventType.TOUCH_END) {
            this.clearToolSelection();
            this.summonDrag = null; this.inspectedPetId = null; this.infoOpen = false; this.clearFeedback(); return;
        }
        this.moveSummonDrag(event); this.summonDrag = null;
        if (drag.moved) { this.inspectedPetId = null; this.infoOpen = false; }
        if (drag.moved && (drag.selection?.kind === 'cultivate' || drag.selection?.kind === 'release')) this.clearToolSelection();
        if (this.orientationBlocked || this.reservesOpen) return;
        if (drag.releaseOnTap && !drag.moved && drag.elapsed < 0.3 && drag.originSlot !== null) {
            this.releaseAtSlot(drag.originSlot); return;
        }
        if (drag.selection?.kind === 'pet' && !drag.moved && drag.elapsed < 0.3) {
            this.inspectedPetId = drag.selection.id; this.infoOpen = true; this.renderScreen(); return;
        }
        if (!drag.selection) {
            if (!drag.moved && drag.originSlot !== null) this.handleSlot(drag.originSlot);
            return;
        }
        if ((drag.selection.kind === 'release' || drag.selection.kind === 'cultivate') && !drag.moved) {
            if (drag.originSlot !== null) {
                if (drag.selection.kind === 'release') this.releaseAtSlot(drag.originSlot);
                else this.handleCultivation(drag.originSlot);
            }
            else {
                // Tap an armed toolbar icon again, or empty ground, to dismiss it without a panel.
                const toolbarTap = drag.selection.kind === 'cultivate'
                    ? Math.abs(drag.start.x - 200) <= 36 && Math.abs(drag.start.y - (this.layout.bottom + 164)) <= 53
                    : this.overRope(drag.start);
                if (drag.toggleToolOnTap || !toolbarTap) this.clearToolSelection();
                this.renderScreen();
            }
            return;
        }
        if (!drag.active || !drag.moved || this.session.paused) {
            if (drag.selection.kind === 'cultivate' && drag.moved && !this.session.paused
                && this.session.dew < ECONOMY.cultivateCost)
                this.toast?.show(this.insufficientDewMessage(ECONOMY.cultivateCost), { tone: 'warning' });
            this.renderScreen(); return;
        }
        if (drag.selection.kind === 'pet' && this.overRope(drag.point)) { this.releasePet(drag.selection.id); return; }
        const slot = portraitSlotAt(drag.point, this.layout);
        if (drag.selection.kind === 'release') { this.releaseAtSlot(slot); return; }
        if (slot === null) { this.feedback = '已取消，请拖到树桩'; this.renderScreen(); return; }
        if (slot === drag.originSlot) { this.renderScreen(); return; }
        const occupant = this.session.pets.find(p => p.slot === slot);
        if (drag.selection.kind === 'pet') {
            const result = this.session.dropPet(drag.selection.id, slot);
            if (result.ok && 'mutationRequired' in result) this.handleMergeResult(result, false);
            else this.handlePetAction(result, false);
            return;
        }
        if (occupant) {
            this.handlePetAction({ ok: false, reason: 'SLOT_OCCUPIED' }, false); return;
        }
        if (drag.selection.kind === 'cultivate') this.handleCultivation(slot);
    }

    private canDrag(drag: SummonDrag): boolean {
        return !!drag.selection && !this.session.paused && drag.selection.kind !== 'carried' && drag.selection.kind !== 'none'
            && (drag.selection.kind !== 'cultivate' || this.session.dew >= ECONOMY.cultivateCost);
    }

    private insufficientDewMessage(cost = this.selected.kind === 'cultivate' ? ECONOMY.cultivateCost : ECONOMY.summonCost): string {
        return `灵露不足，还差 ${Math.max(0, cost - this.session.dew)} 灵露`;
    }

    private bindGesture(node: Node): void {
        node.on(Node.EventType.TOUCH_MOVE, this.moveSummonDrag, this);
        node.on(Node.EventType.TOUCH_END, this.finishSummonDrag, this);
        node.on(Node.EventType.TOUCH_CANCEL, this.finishSummonDrag, this);
    }

    private petTint(id: PetId): string {
        return id === 'cat' ? C.orange : id === 'rabbit' ? C.blue : id === 'deer' ? C.leaf
            : id === 'vine' ? C.green : id === 'sparrow' ? C.electric : C.spore;
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
        label.fontFamily = 'sans-serif'; label.enableWrapText = true; label.overflow = Label.Overflow.SHRINK;
        label.horizontalAlign = left ? Label.HorizontalAlign.LEFT : Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        node.getComponent(UITransform)?.setContentSize(width, height);
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
        const primary = active && fill === C.green;
        const artTint = !active ? '#CCD3C6' : fill === C.spore ? '#D8B7E8' : fill === C.orange ? '#F3C18F' : '#FFFFFF';
        const skinned = w >= 110 && h >= 50 && this.skinImage(node, primary ? 'button_primary' : 'button_secondary', 0, 0, w, h, artTint);
        if (!skinned) { const g = node.addComponent(Graphics); this.rect(g, 0, 0, w, h, active ? fill : C.pale); }
        const labelTint = skinned && !primary && textTint === C.white ? fill : textTint;
        this.text(node, title, 0, 0, fontSize, w - 20, active ? labelTint : C.muted, false, true, h);
        if (active) {
            node.on(Node.EventType.TOUCH_END, () => {
                if (!this.summonDrag) { this.inspectedPetId = null; this.infoOpen = false; action(); }
            }, this);
            node.on(Node.EventType.MOUSE_ENTER, () => { node.setScale(1.025, 1.025, 1); }, this);
            node.on(Node.EventType.MOUSE_LEAVE, () => { node.setScale(1, 1, 1); }, this);
        }
        return node;
    }

    private onViewportResize(): void {
        this.clearToolSelection();
        this.metamorphosisOpen = false; this.metamorphosisTarget = null;
        this.infoOpen = false;
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
        this.guideActive = null;
        // Paused runs resume through the menu now that the HUD has no pause control.
        if (!this.atHome && !this.orientationBlocked && this.session.paused
            && (this.session.phase === 'prepare' || this.session.phase === 'battle')) this.menuOpen = true;
        if (!this.atHome && !this.saveProblem) this.checkpoint();
        this.shovelMask = null; this.randomMask = null; this.starLabels.clear(); this.infoMergeButton = null; this.enemyLabels.clear(); this.bossStatus = null;
        if (this.reservesOpen || this.orientationBlocked
            || (this.session.phase !== 'prepare' && this.session.phase !== 'battle')) this.toast?.dismiss();
        this.summonDrag = null;
        if (this.screenRoot) { this.screenRoot.removeFromParent(); this.screenRoot.destroy(); }
        this.dynamic = null; this.dragVisual = null; this.counter = null; this.lastCounter = ''; this.infoRoot = null;
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
        if (!this.uiArtReady) {
            root.addComponent(BlockInputEvents);
            this.text(root, this.uiArtError ? '美术素材加载失败' : '正在载入森林…', 0, 80, 34, 620, C.green, false, true, 80);
            if (this.uiArtError) {
                this.text(root, this.uiArtError, 0, -50, 21, 600, C.red, false, false, 180);
                this.button(root, '重试加载', 0, -220, 360, 84, () => this.loadUiArt());
            }
            return;
        }
        if (this.atHome) { this.drawHome(root); return; }
        this.heartLabel = this.text(root, `树心 ${this.session.heart}/${this.session.maxHeart}`, 185, this.layout.top - 46, 24, 170, this.session.heart <= 1 ? C.red : C.green);
        this.button(root, '≡', 304, this.layout.top - 46, 48, 46, () => this.openMenu(), C.pale, C.ink, true, 26);
        if (this.session.phase === 'map' || this.session.phase === 'complete') this.drawMap(root, g);
        else if (this.session.phase === 'rest') this.drawRest(root, g);
        else if (this.session.phase === 'sanctuary') this.drawSanctuary(root, g);
        else this.drawBattle(root, g);
        if (this.session.phase === 'complete') this.expeditionOverlay(root);
        if (this.menuOpen) { if (this.debugOpen) this.drawDebugModifier(root); else this.drawRunMenu(root); }
        else if (!this.saveProblem && !this.metamorphosisOpen && !this.collectionOpen) {
            const tool = this.selected.kind === 'cultivate' || this.selected.kind === 'release' ? this.selected.kind : null;
            this.guideActive = nextGuide(this.session, this.profile.guideSeen, tool);
            if (this.guideActive) this.drawGuide(root, this.guideActive);
        }
        if (this.collectionOpen) this.collectionOverlay(root);
        if (this.saveProblem) this.drawSaveFailure(root);
    }

    private drawMap(root: Node, g: Graphics): void {
        const { top, bottom } = this.layout;
        const complete = this.session.phase === 'complete';
        this.text(root, `${complete ? '远征完成' : '远征路线'}  ${this.session.visited.length} / ${this.session.routeDepths} · 30 节点`,
            -110, top - 46, 24, 420, C.muted, false, false, 40);
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

    private pocketResult(result: PocketResult, banished: boolean): void {
        this.banishCandidate = null;
        if (result.ok === false) { this.handlePetAction(result, false); return; }
        this.renderScreen();
        this.toast?.show(banished ? `${PETS[result.species].name}已移出本局召唤池 · -${result.cost} 灵露`
            : `${PETS[result.species].name}加入召唤池 · -${result.cost} 灵露`, { tone: 'success' });
    }

    private drawSanctuary(root: Node, g: Graphics): void {
        const session = this.session; const { top, bottom } = this.layout;
        this.text(root, '伙伴驿站', -110, top - 46, 32, 420, C.green, true, true);
        this.text(root, `口袋 ${session.carriedPets.length}/${ECONOMY.carryLimit} · 灵露 ${session.dew}`, 0, top - 115, 28, 656, C.ink, false, true);
        this.text(root, '购买加入随机召唤池；定向放生只影响本次远征', 0, top - 171, 22, 656, C.muted);
        const descriptions: Record<PetId, string> = {
            cat: '近战挥爪，攻击前方雾兽', rabbit: '远程追踪星弹', deer: '附近伙伴攻击力提高',
            mushroom: '孢雾持续伤害范围内敌人', vine: '每 7 秒伸出藤蔓拦路 2 秒', sparrow: '闪电依次连锁 3 只敌人',
        };
        const rowHeight = Math.min(260, (this.layout.height - 440) / 3);
        PET_ORDER.forEach((id, i) => {
            const x = i % 2 === 0 ? -166 : 166;
            const y = top - 230 - (Math.floor(i / 2) + 0.5) * rowHeight;
            const card = this.uiNode(`Pocket-${id}`, root, x, y, 312, rowHeight - 16);
            const art = card.addComponent(Graphics); this.rect(art, 0, 0, 312, rowHeight - 16, C.white, 18);
            this.petIcon(art, -101, 48, id, 0.85);
            this.text(card, PETS[id].name, 42, 72, 26, 202, this.petTint(id), false, true, 44);
            this.text(card, PETS[id].role, 42, 32, 21, 202, C.muted, false, false, 34);
            this.text(card, descriptions[id], 0, -16, 21, 280, C.ink, false, false, 60);
            const carried = session.carriedPets.includes(id); const banned = session.banishedPets.includes(id);
            const lastAttacker = carried && !session.carriedPets.some(other => other !== id && PETS[other].damage > 0);
            const cost = carried ? ECONOMY.banishCost : ECONOMY.petUnlockCost;
            const title = banned ? '本局已放生' : lastAttacker ? '保留最后一种输出' : carried ? `定向放生 · ${cost} 灵露` : `加入召唤池 · ${cost} 灵露`;
            this.button(card, title, 0, -rowHeight / 2 + 48, 280, 60, () => {
                if (carried) { this.banishCandidate = id; this.renderScreen(); }
                else this.pocketResult(session.buyPocketPet(id), false);
            }, carried || session.dew < cost ? C.pale : C.green, carried || session.dew < cost ? C.ink : C.white, !banned && !lastAttacker, 22);
        });
        this.button(root, '继续远征', 0, bottom + 96, 600, 84, () => {
            if (!session.leaveSanctuary()) return;
            this.banishCandidate = null; this.selected = { kind: 'carried', species: session.carriedPets[0] };
            this.mapCamera = null; this.clearFeedback(); this.renderScreen();
        });
        if (this.banishCandidate) {
            const species = this.banishCandidate;
            const modal = this.uiNode('ConfirmPocketRelease', root); modal.addComponent(BlockInputEvents);
            const shade = modal.addComponent(Graphics); shade.fillColor = color(C.ink, 170);
            shade.rect(-360, bottom, 720, this.layout.height); shade.fill();
            this.rect(shade, 0, 0, 656, 500, C.white, 22);
            this.text(modal, `放生召唤池中的${PETS[species].name}？`, 0, 157, 30, 600, C.ink, false, true, 80);
            this.text(modal, `花费 ${ECONOMY.banishCost} 灵露。已召唤的伙伴保留。\n之后不会随机出现，本局不能重新购买。\n开启新远征后重置为猫、兔。`, 0, 26, 24, 592, C.muted, false, false, 154);
            this.button(modal, '取消', -154, -151, 276, 84, () => { this.banishCandidate = null; this.renderScreen(); }, C.pale, C.ink);
            this.button(modal, `确认放生 · ${ECONOMY.banishCost}`, 154, -151, 276, 84,
                () => this.pocketResult(session.banishPocketPet(species), true), C.orange, C.white, true, 24);
        }
    }

    private drawBattle(root: Node, g: Graphics): void {
        const session = this.session; const current = session.current;
        if (!current) return;
        const { top, bottom, arenaHeight, arenaCenter } = this.layout;
        this.rect(g, 0, top - 66, 656, 104, C.white, 16);
        this.text(root, `${current.name} · 第 ${session.visited.length + 1} 站`, -155, top - 44, 26, 300, C.ink, false, true, 40);
        this.counter = this.text(root, '', -94, top - 86, 22, 430, C.muted, true, false, 36);
        this.dewLabel = this.text(root, '', 234, top - 85, 28, 180, C.green, false, true, 42);
        this.drawBattleArt(root);
        const board = this.uiNode('BattlePlacement', root, 0, arenaCenter, 656, arenaHeight);
        board.on(Node.EventType.TOUCH_START, this.startBoardGesture, this); this.bindGesture(board);
        for (let i = 0; i < ECONOMY.carryLimit; i++) {
            const species = session.carriedPets[i]; const x = -280 + i * 80;
            if (species) this.petCard(root, species, x, bottom + 164);
            else {
                this.rect(g, x, bottom + 164, 72, 106, C.pale, 18);
                this.circle(g, x, bottom + 164, 15, C.bg);
                this.line(g, x - 6, bottom + 164, x + 6, bottom + 164, C.line, 2);
            }
        }
        this.shovelCard(root, 200, bottom + 164);
        this.ropeCard(root, 280, bottom + 164);
        this.deploymentLabel = this.text(root, '', 0, bottom + 238, 20, 640, C.ink, false, false, 30);
        this.bossStatus = this.text(root, '', 120, this.layout.arenaTop - 30, 22, 400, C.red, false, true, 36);
        this.bossStatus.node.active = false;
        const summonWidth = session.phase === 'prepare' ? 232 : 400;
        const random = this.button(root, `随机召唤\n${ECONOMY.summonCost} 灵露`, -322 + summonWidth / 2, bottom + 52, summonWidth, 84,
            () => this.randomSummon(), C.green, C.white, true, 24);
        this.randomMask = this.affordabilityMask(random, 'SummonShade', summonWidth, 84, 16);
        if (session.phase === 'prepare') this.button(root, '开始防守',
            0, bottom + 52, 160, 84, () => this.begin(), C.pale, C.ink, true, 24);
        this.button(root, `${this.speed}倍速`, 147, bottom + 52, 114, 84,
            () => { this.speed = this.speed === 1 ? 2 : 1; this.profile.speed = this.speed; this.renderScreen(); }, C.pale, C.ink, true, 22);
        const count = session.pets.filter(p => p.slot === null).length;
        this.button(root, `后备 ${count}`, 271, bottom + 52, 114, 84,
            () => { this.reservesOpen = true; this.renderScreen(); }, C.pale, C.ink, count > 0, 22);
        const clipped = this.uiNode('BattleClip', root, 0, arenaCenter, 656, arenaHeight);
        clipped.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        this.dynamic = this.graphics(clipped, 'LiveBattle');
        this.dynamic.node.setPosition(0, -arenaCenter);
        this.dragVisual = this.graphics(root, 'DragAvatar');
        this.drawInfoCard(root);
        if (session.phase === 'prepare') this.button(root, `主动蜕变 ${session.mutationCredits}`, -222, this.layout.arenaTop - 32, 196, 52, () => {
            this.metamorphosisOpen = true; this.metamorphosisTarget = null; this.infoOpen = false; this.mergeSourceId = null;
            this.renderScreen();
        }, session.mutationCredits > 0 ? C.spore : C.pale, session.mutationCredits > 0 ? C.white : C.ink, true, 22);
        if (session.phase === 'won' || session.phase === 'lost') this.resultOverlay(root);
        else if (session.phase === 'mutation') this.mutationOverlay(root);
        else if (this.metamorphosisOpen && session.phase === 'prepare') this.metamorphosisOverlay(root);
        else if (this.reservesOpen) this.reserveOverlay(root);
    }

    private mutationOverlay(root: Node): void {
        const pending = this.session.pendingMutation;
        const pet = this.session.pets.find(p => p.id === pending?.petId);
        if (!pending || !pet) return;
        const modal = this.uiNode('MutationChoice', root); modal.addComponent(BlockInputEvents);
        const g = this.graphics(modal); g.fillColor = color(C.ink, 170);
        g.rect(-360, -this.layout.top, 720, this.layout.height); g.fill();
        if (!this.skinImage(modal, 'panel_mutation', 0, 0, 656, 930)) this.rect(g, 0, 0, 656, 930, C.bg, 22);
        this.text(modal, pending.source === 'metamorphosis' ? '主动蜕变' : '发生变异！', 0, 392, 38, 600, C.spore, false, true, 70);
        this.text(modal, `${PETS[pet.species].name} · ${pet.star}星 · 变异 ${pet.mutations.length}/${PET_GROWTH.mutationsByStar[pet.star - 1]}`, 0, 330, 28, 600, C.ink, false, true, 48);
        this.text(modal, `已保留：${mutationNames(pet.species, pet.mutations)}`, 0, 278, 22, 600, C.muted, false, false, 60);
        pending.choices.forEach((id, i) => {
            const card = mutationCards(pet.species).find(item => item.id === id);
            if (!card) return;
            const stats = this.session.petStats({ ...pet, mutations: mutationResult(pet.mutations, id, pending.replacementIndex) });
            const fmt = (n: number): string => Number(n.toFixed(2)).toString();
            const values = pet.species === 'deer' ? `范围 ${fmt(stats.range)} · 助威 +${fmt(stats.boost * 100)}%`
                : pet.species === 'vine' ? `范围 ${fmt(stats.range)} · 间隔 ${fmt(stats.interval)} 秒`
                : `伤害 ${fmt(stats.damage)} · 间隔 ${fmt(stats.interval)} 秒 · 范围 ${fmt(stats.range)}`;
            const y = pending.choices.length === 1 ? 0 : 108 - i * 280;
            const button = this.button(modal, '', 0, y, 600, 248, () => this.chooseMutation(card.id), C.white, C.ink);
            this.text(button, `${pending.replacementIndex !== null && pet.mutations[pending.replacementIndex] === id ? '保留此层 · ' : pending.replacementIndex === null ? '新增 · ' : '替换此层 · '}${card.name}`, 0, 84, 30, 540, id === 'power' ? C.orange : C.spore, false, true, 48);
            this.text(button, card.detail, 0, 13, 23, 540, C.ink, false, false, 94);
            this.text(button, values, 0, -64, 21, 552, C.green, false, true, 46);
            this.text(button, '基础属性 · 未计其他伙伴助威', 0, -103, 19, 540, C.muted, false, false, 30);
        });
        this.text(modal, pending.source === 'metamorphosis' ? '已消耗 1 次机会；有空位则新增，满槽调整一层。\n其他变异保留，候选不会重抽。'
            : '已有变异全部保留，选择后新增一种。\n同名去重，三星最多三种；候选不会重抽。', 0, -389, 22, 600, C.muted, false, false, 84);
    }

    private metamorphosisOverlay(root: Node): void {
        const s = this.session;
        const modal = this.panel(root, 'MetamorphosisSelection', 980);
        this.text(modal, `主动蜕变 · 剩余 ${s.mutationCredits} 次`, 0, 409, 34, 600, C.spore, false, true, 64);
        this.text(modal, s.paused ? '请先从菜单继续远征，再使用蜕变。' : '完成第 3/6 站各得一次，可用于二星或三星。',
            0, 340, 23, 592, C.muted, false, false, 74);
        this.text(modal, '选择伙伴 · 包含后备', 0, 277, 24, 592, C.ink, false, true, 42);
        s.pets.forEach((pet, i) => {
            const selected = this.metamorphosisTarget === pet.id;
            this.button(modal, `${PETS[pet.species].name} ${pet.star}星\n${pet.slot === null ? '后备' : '场上'} #${pet.id}`,
                -222 + i % 4 * 148, 201 - Math.floor(i / 4) * 92, 138, 80,
                () => { this.metamorphosisTarget = pet.id; this.metamorphosisLayer = 0; this.renderScreen(); }, selected ? C.spore : C.pale,
                selected ? C.white : C.ink, pet.star >= 2, 20);
        });
        const pet = s.pets.find(p => p.id === this.metamorphosisTarget);
        const form = pet ? mutationNames(pet.species, pet.mutations) : '';
        if (pet && pet.mutations.length >= PET_GROWTH.mutationsByStar[pet.star - 1]) pet.mutations.forEach((id, index) => {
            const name = mutationCards(pet.species).find(card => card.id === id)?.name ?? id;
            this.button(modal, `第${index + 1}层·${name}`, -184 + index * 184, -205, 172, 54, () => { this.metamorphosisLayer = index; this.renderScreen(); },
                this.metamorphosisLayer === index ? C.spore : C.pale, this.metamorphosisLayer === index ? C.white : C.ink, true, 20);
        });
        this.text(modal, pet ? `${PETS[pet.species].name} #${pet.id} · ${form}` : s.pets.some(p => p.star >= 2)
            ? '请选择一只二星或三星伙伴' : '先合成一只二星伙伴，机会可留到以后。', 0, -142, 23, 592, C.ink, false, true, 74);
        this.text(modal, '确认消耗 1 次，不花灵露；有空位则新增。\n满槽只调整选定的一层，其他变异保留。\n全部变异已拥有时无需蜕变。',
            0, -290, 23, 592, C.muted, false, false, 118);
        this.button(modal, '返回准备', -150, -401, 280, 82, () => {
            this.metamorphosisOpen = false; this.metamorphosisTarget = null; this.renderScreen();
        }, C.pale, C.ink, true, 24);
        this.button(modal, '确认蜕变 · 1 次', 150, -401, 280, 82, () => {
            if (!pet) return;
            const result = s.beginMetamorphosis(pet.id, this.metamorphosisLayer);
            this.metamorphosisOpen = false; this.metamorphosisTarget = null;
            if (!result.ok) this.handlePetAction(result, false);
            else { this.clearFeedback(); this.renderScreen(); }
        }, C.spore, C.white, !!pet && s.metamorphosisError(pet.id, this.metamorphosisLayer) === null, 24);
    }

    private collectionOverlay(root: Node): void {
        const modal = this.panel(root, 'MutationCollection', 1050);
        const collection = this.profile.mutationCollection ?? [];
        this.text(modal, `形态记录 · ${collection.length}/${MUTATION_FORM_COUNT}`, 0, 445, 36, 600, C.spore, false, true, 68);
        this.text(modal, '实际参与战斗并守住该场后收录；新远征保留。', 0, 375, 22, 592, C.muted, false, false, 64);
        PET_ORDER.forEach((species, i) => {
            const y = 278 - i * 92;
            this.text(modal, PETS[species].name, -186, y, 24, 188, this.petTint(species), false, true, 40);
            const names = mutationCards(species).map(card => `${collection.some(form => form.species === species && form.mutation === card.id) ? '已用' : '未用'} ${card.name}`);
            this.text(modal, names.join(' / '), 96, y, 21, 366, C.ink, true, false, 76);
        });
        const last = this.profile.lastExpedition;
        this.text(modal, last ? `上次远征${last.debugModified ? '（调试）' : ''}：${last.outcome === 'won' ? '抵达净土' : '树心耗尽'} · 完成 ${last.nodes} 站\n使用并守住战斗的形态 ${last.forms.length} 种`
            : '完成远征后，这里会留下最近一局的结果。', 0, -321, 23, 584, C.muted, false, false, 90);
        this.button(modal, '返回', 0, -443, 560, 80, () => { this.collectionOpen = false; this.renderScreen(); }, C.green, C.white, true, 25);
    }

    private expeditionOverlay(root: Node): void {
        const modal = this.panel(root, 'ExpeditionComplete', 760);
        this.text(modal, '抵达净土', 0, 281, 40, 592, C.green, false, true, 80);
        this.text(modal, `完成 ${this.session.visited.length} 站 · 树心 ${this.session.heart}/3`, 0, 197, 27, 592, C.ink, false, true, 50);
        this.text(modal, `本局使用并守住战斗的形态 ${this.session.usedMutations.length} 种\n形态记录已保留，下局可以试试另一种搭配。`,
            0, 83, 25, 584, C.muted, false, false, 110);
        this.button(modal, '查看形态记录', 0, -44, 560, 80, () => { this.collectionOpen = true; this.renderScreen(); }, C.pale, C.ink, true, 24);
        this.button(modal, '新远征', -146, -169, 268, 84, () => this.restart(), C.green, C.white, true, 25);
        this.button(modal, '保存回首页', 146, -169, 268, 84, () => this.home(), C.pale, C.ink, true, 24);
    }

    private petCard(root: Node, id: PetId, x: number, y: number): void {
        const node = this.uiNode(`Pet-${id}`, root, x, y, 72, 106);
        const g = node.addComponent(Graphics);
        this.rect(g, 0, 0, 72, 106, C.white, 18);
        this.petIcon(g, 0, -3, id, 0.85);
        // Carried portraits only show the pool; tapping dismisses inspection without opening a card.
        node.on(Node.EventType.TOUCH_END, () => this.selectPet(id), this);
    }

    private affordabilityMask(parent: Node, name: string, width: number, height: number, radius: number): Node {
        const mask = this.uiNode(name, parent, 0, 0, width, height);
        const shade = mask.addComponent(Graphics); shade.fillColor = color(C.ink, 135);
        shade.roundRect(-width / 2, -height / 2, width, height, radius); shade.fill();
        return mask;
    }

    private shovelCard(root: Node, x: number, y: number): void {
        const node = this.uiNode('林地铲', root, x, y, 72, 106);
        const g = node.addComponent(Graphics); this.rect(g, 0, 0, 72, 106, C.white, 18);
        this.shovelIcon(g, 0, 0);
        this.shovelMask = this.affordabilityMask(node, 'ShovelShade', 72, 106, 18);
        node.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.startGesture({ kind: 'cultivate' }, null, event), this);
        this.bindGesture(node);
    }

    private shovelIcon(g: Graphics, x: number, y: number): void {
        this.line(g, x, y + 26, x, y - 12, C.rope, 8);
        g.strokeColor = color(C.tool); g.lineWidth = 6;
        g.roundRect(x - 14, y + 21, 28, 19, 6); g.stroke();
        g.fillColor = color('#8BABB0');
        g.moveTo(x - 20, y - 8); g.lineTo(x + 20, y - 8); g.lineTo(x + 15, y - 28);
        g.lineTo(x, y - 40); g.lineTo(x - 15, y - 28); g.close(); g.fill();
        this.line(g, x, y - 12, x, y - 31, '#D5E4DF', 3);
    }

    private ropeCard(root: Node, x: number, y: number): void {
        const node = this.uiNode('归林绳索', root, x, y, 72, 106);
        const g = node.addComponent(Graphics); this.rect(g, 0, 0, 72, 106, C.white, 18);
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

    private drawInfoCard(root: Node): void {
        const panel = this.uiNode('InspectionCard', root, 0, this.layout.bottom + 384, 656, 236);
        panel.addComponent(BlockInputEvents);
        const g = panel.addComponent(Graphics); this.rect(g, 0, 0, 656, 236, C.white, 18);
        g.strokeColor = color(C.line); g.lineWidth = 2; g.roundRect(-328, -118, 656, 236, 18); g.stroke();
        this.infoRoot = panel;
        this.infoTitle = this.text(panel, '', -75, 82, 26, 450, C.ink, true, true, 42);
        this.infoStats = this.text(panel, '', 0, 36, 23, 616, C.ink, true, false, 34);
        this.infoEffect = this.text(panel, '', 0, -4, 23, 616, C.muted, true, false, 34);
        this.infoMeta = this.text(panel, '', 0, -42, 21, 616, C.muted, true, false, 30);
        this.button(panel, '×', 280, 82, 60, 52, () => { this.infoOpen = false; this.inspectedEnemyId = null; }, C.pale, C.ink, true, 30);
        const action = this.button(panel, '收回', 140, -86, 116, 50, () => {
            this.mergeSourceId = null;
            if (this.inspectedEnemyId !== null || this.selected.kind !== 'pet') return;
            const pet = this.session.pets.find(p => p.id === this.selectedPetId());
            if (!pet) return;
            if (pet.slot === null) this.releasePet(pet.id);
            else this.handlePetAction(this.session.movePet(pet.id, pet.slot), false);
        }, C.pale, C.ink, true, 22);
        this.infoAction = action.getComponentInChildren(Label);
        this.infoMergeButton = this.button(panel, '合成', 268, -86, 116, 50, () => this.beginMerge(), C.pale, C.ink, true, 22);
        this.infoMergeButton.active = false;
        panel.active = false;
    }

    private selectedPetId(): number | null { return this.selected.kind === 'pet' ? this.selected.id : null; }

    private reserveOverlay(root: Node): void {
        const modal = this.uiNode('ReserveSelection', root); modal.addComponent(BlockInputEvents);
        const g = this.graphics(modal); g.fillColor = color(C.ink, 145);
        g.rect(-360, -this.layout.top, 720, this.layout.height); g.fill();
        if (!this.skinImage(modal, 'panel_standard', 0, 0, 656, 650)) this.rect(g, 0, 0, 656, 650, C.white, 20);
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
                    else { this.selected = { kind: 'pet', id: pet.id }; this.infoOpen = true; this.clearFeedback(); this.renderScreen(); }
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
        if (!this.counter || !this.session.current) return;
        const phase = this.session.phase;
        if (this.shovelMask) this.shovelMask.active = this.session.dew < ECONOMY.cultivateCost;
        if (this.randomMask) this.randomMask.active = this.session.dew < ECONOMY.summonCost;
        if (this.feedbackError === 'INSUFFICIENT_DEW' && this.session.dew >= (this.selected.kind === 'cultivate' ? ECONOMY.cultivateCost : ECONOMY.summonCost)) this.clearFeedback();
        const selected = this.selected;
        const pet = selected.kind === 'pet' ? this.session.pets.find(p => p.id === selected.id) : undefined;
        const count = phase === 'prepare' ? `即将来袭 ${this.session.current.count} 只 · ${this.session.current.encounter === "boss" ? "BOSS 压轴" : this.session.current.encounter === "elite" ? "精英压阵" : "混合雾兽"}`
            : `击退 ${this.session.kills}/${this.session.current.count} · 漏过 ${this.session.leaked} · 场上 ${this.session.enemies.length}`;
        if (count !== this.lastCounter) { this.counter.string = count; this.lastCounter = count; }
        const dewText = `灵露  ${this.session.dew}`;
        if (this.dewLabel && this.dewLabel.string !== dewText) this.dewLabel.string = dewText;
        const deployment = `场上 ${this.session.deployedCount} / ${this.session.deploymentLimit} · 待开垦 ${SLOTS.length - this.session.deploymentLimit} · 携带 ${this.session.carriedPets.length}/${ECONOMY.carryLimit}`;
        if (this.deploymentLabel && this.deploymentLabel.string !== deployment) this.deploymentLabel.string = deployment;
        if (this.infoMergeButton) {
            this.infoMergeButton.active = !!pet && this.inspectedEnemyId === null;
            const mergeLabel = this.infoMergeButton.getComponentInChildren(Label);
            const mergeText = this.mergeSourceId !== null ? '取消' : pet?.star === 3 ? '满星' : '合成';
            if (mergeLabel && mergeLabel.string !== mergeText) mergeLabel.string = mergeText;
        }
        const enemy = this.session.enemies.find(e => e.id === this.inspectedEnemyId);
        if (this.inspectedEnemyId !== null && !enemy) this.infoOpen = false;
        const inspectable = !!enemy || !!pet;
        if (this.infoRoot) this.infoRoot.active = this.infoOpen && !this.summonDrag && inspectable
            && !this.reservesOpen && (phase === 'prepare' || phase === 'battle');
        const actionNode = this.infoAction?.node.parent;
        if (actionNode) actionNode.active = !enemy && selected.kind === 'pet';
        if (enemy) {
            const spec = ENEMIES[enemy.kind]; const rage = enemy.kind === 'boss' && enemy.hp <= enemy.maxHp * 0.5;
            const values: [Label | null, string][] = [
                [this.infoTitle, `${spec.name} · ${enemy.kind === 'boss' ? 'BOSS' : enemy.kind === 'elite' ? '精英' : '雾兽'}`],
                [this.infoStats, `生命 ${Math.ceil(enemy.hp)} / ${enemy.maxHp} · 移速 ${Math.round(this.session.current.speed * spec.speed * (rage ? ENEMY_BALANCE.bossRageSpeed : 1))}`],
                [this.infoEffect, rage ? '狂暴中！移速提升 25%' : spec.trait],
                [this.infoMeta, `击败 +${spec.reward} 灵露 · 点击场上伙伴查看资料`], [this.infoAction, '敌人'],
            ];
            for (const [label, value] of values) if (label && label.string !== value) label.string = value;
            if (this.infoTitle) this.infoTitle.color = color(spec.tint);
            if (this.infoStats) this.infoStats.color = color(C.ink);
            return;
        }
        this.inspectedEnemyId = null;
        if (!pet) return;
        const species = pet.species;
        const spec = PETS[species]; const base = pet ? this.session.petStats(pet) : spec;
        const damage = pet ? this.session.effectiveDamage(pet) : spec.damage;
        const range = pet ? this.session.attackRange(pet) : spec.range;
        const interval = pet ? this.session.attackInterval(pet) : spec.interval;
        const fmt = (n: number): string => Number(n.toFixed(2)).toString();
        const boosted = pet && this.session.attackMultiplier(pet) > 1;
        const stats = species === 'vine' ? `范围 ${fmt(range)} · 每 ${fmt(interval)} 秒拦路 ${fmt(pet ? this.session.vineLifetime(pet) : PET_GROWTH.vineLifetime)} 秒`
            : species === 'deer' ? `施法范围 ${fmt(base.range)} · 攻击力 +${fmt(base.boost * 100)}% · 不攻击`
            : species === 'mushroom' ? `范围 ${fmt(range)} · 每 ${fmt(interval)} 秒 ${fmt(damage)} 伤害${boosted ? ' ↑' : ''}`
                : `攻击 ${fmt(damage)}${boosted ? ' ↑' : ''} · 间隔 ${fmt(interval)} 秒 · 范围 ${fmt(range)}`;
        let effect = species === 'vine' ? '伸出藤蔓拦住道路，自己不造成伤害'
            : species === 'sparrow' ? '闪电连锁最多 3 只敌人，逐跳保留 70% 伤害'
            : species === 'deer' ? '范围内友军获得增益，同类光环不叠加'
            : species === 'mushroom' ? '孢子只伤害范围内敌人，离开范围即停止'
                : species === 'cat' ? '挥爪攻击最接近摇篮树的单个敌人' : '发射星弹，追踪范围内最靠前的敌人';
        if (pet?.mutations.length) effect = mutationNames(pet.species, pet.mutations);
        const meta = `${pet.slot === null ? '后备' : '已部署'} #${pet.id} · 搬迁 / 放生 +${Math.floor(pet.purchaseCost * ECONOMY.releaseRate)} 灵露`;
        if (this.infoTitle) this.infoTitle.color = color(this.petTint(species));
        if (this.infoStats) this.infoStats.color = color(boosted ? C.leaf : C.ink);
        const labels: [Label | null, string][] = [
            [this.infoTitle, pet ? `${spec.name} · ${pet.star}星` : `${spec.name} · ${spec.role}`], [this.infoStats, stats],
            [this.infoEffect, effect], [this.infoMeta, meta], [this.infoAction, pet ? pet.slot === null ? `放生+${Math.floor(pet.purchaseCost * ECONOMY.releaseRate)}` : '收回' : '已携带'],
        ];
        for (const [label, value] of labels) if (label && label.string !== value) label.string = value;
    }

    private drawDynamic(g: Graphics): void {
        g.clear(); this.dragVisual?.clear(); const s = this.session;
        if (s.phase === 'prepare' || s.phase === 'battle') {
            const selected = this.selected;
            const pet = selected.kind === 'pet' ? s.pets.find(p => p.id === selected.id) : undefined;
            const species = pet?.species ?? (selected.kind === 'carried' ? selected.species : 'cat');
            const drag = this.summonDrag;
            // A summon selection has no world position: never invent a center-screen range.
            let p = pet && pet.id === this.inspectedPetId && pet.slot !== null
                ? this.boardPoint(SLOTS[pet.slot]) : null;
            if (drag?.active && drag.selection && drag.selection.kind === 'pet' && !this.overRope(drag.point)) {
                const slot = portraitSlotAt(drag.point, this.layout);
                p = slot === null ? drag.point : this.boardPoint(SLOTS[slot]);
            }
            const tint = this.petTint(species); const range = pet ? this.session.attackRange(pet) : PETS[species].range;
            if (p && selected.kind === 'pet') {
                g.fillColor = color(tint, 24); g.circle(p.x, p.y, range * this.layout.scale); g.fill();
                g.strokeColor = color(tint, 150); g.lineWidth = 2; g.circle(p.x, p.y, range * this.layout.scale); g.stroke();
            }
            if ((selected.kind === 'carried' || selected.kind === 'release' || selected.kind === 'cultivate') && this.dragVisual) {
                const x = selected.kind === 'release' ? 280 : selected.kind === 'cultivate' ? 200 : -280 + s.carriedPets.indexOf(selected.species) * 80;
                const outline = this.dragVisual; outline.strokeColor = color(tint); outline.lineWidth = 4;
                outline.roundRect(x - 36, this.layout.bottom + 111, 72, 106, 18); outline.stroke();
            }
        }
        for (const wall of s.vineWalls) {
            const p = this.boardPoint(pointOnPath(wall.distance));
            const before = this.boardPoint(pointOnPath(wall.distance - 1));
            const after = this.boardPoint(pointOnPath(wall.distance + 1));
            const horizontal = Math.abs(after.y - before.y) > Math.abs(after.x - before.x);
            this.line(g, p.x - (horizontal ? 28 : 0), p.y - (horizontal ? 0 : 28),
                p.x + (horizontal ? 28 : 0), p.y + (horizontal ? 0 : 28), C.green, 9);
            for (const offset of [-20, -7, 7, 20]) {
                const x = p.x + (horizontal ? offset : 0); const y = p.y + (horizontal ? 0 : offset);
                this.circle(g, x + 5, y + 5, 6, C.vine);
            }
            const left = Math.max(0, wall.expiresTick - s.tick) / wall.durationTicks;
            this.rect(g, p.x - 24 + 24 * left, p.y - 38, Math.max(1, 48 * left), 5, C.green, 2);
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
            if (pet.species === 'cat' && pet.mutations.length) {
                if (pet.mutations.includes('longarm')) {
                    for (const side of [-1, 1]) this.line(g, p.x + side * 24, p.y - 7, p.x + side * 42, p.y + 7, C.orange, 5);
                }
                if (pet.mutations.includes('power')) {
                    this.circle(g, p.x - 28, p.y - 10, 9, C.orange); this.circle(g, p.x + 28, p.y - 10, 9, C.orange);
                }
                if (pet.mutations.includes('resonance')) { g.strokeColor = color(C.spore); g.lineWidth = 3; g.circle(p.x, p.y + 4, 34); g.stroke(); }
            }
            let badge = this.starLabels.get(pet.id);
            if (!badge) {
                badge = this.text(g.node, '', 0, 0, 24, 40, C.ink, false, true, 36);
                this.starLabels.set(pet.id, badge);
            }
            this.circle(g, p.x, p.y + 60, 15, C.white);
            badge.node.setPosition(p.x, p.y + 60);
            if (badge.string !== `${pet.star}`) badge.string = `${pet.star}`;
            badge.color = color(pet.mutations.length ? C.spore : pet.star > 1 ? C.orange : C.green);
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
            if (mark.kind === 'sparrow') {
                const from = this.boardPoint(mark.from);
                this.line(g, from.x, from.y, (from.x + p.x) / 2 + 8, (from.y + p.y) / 2 - 6, C.electric, 4);
                this.line(g, (from.x + p.x) / 2 + 8, (from.y + p.y) / 2 - 6, p.x, p.y, C.electric, 4);
                this.circle(g, p.x, p.y, 7, C.sparrow); continue;
            }
            if (mark.kind === 'cat') {
                for (let i = -1; i <= 1; i++) this.line(g, p.x - 10 + i * 5, p.y - 11, p.x + 5 + i * 5, p.y + 12, C.orange, 3);
            } else { g.strokeColor = color(mark.kind === 'mushroom' ? C.spore : C.blue, 160); g.lineWidth = 2; g.circle(p.x, p.y, mark.kind === 'mushroom' ? 20 : 12); g.stroke(); }
        }
        const drag = this.summonDrag;
        if (drag?.active && drag.selection) {
            const slot = portraitSlotAt(drag.point, this.layout);
            const release = drag.selection.kind === 'release';
            const cultivate = drag.selection.kind === 'cultivate';
            const affordable = !cultivate || s.dew >= ECONOMY.cultivateCost;
            for (let i = 0; i < SLOTS.length; i++) {
                const occupant = s.pets.find(p => p.slot === i); const empty = !occupant;
                const mergeable = !!occupant && drag.selection.kind === 'pet' && s.mergeError(drag.selection.id, occupant.id) === null;
                const swappable = !!occupant && drag.selection.kind === 'pet' && occupant.species !== drag.species && s.isSlotOpen(i);
                const valid = release ? !empty : mergeable || swappable || empty && affordable && (cultivate ? !s.isSlotOpen(i) : drag.selection.kind === 'pet' && s.isSlotOpen(i));
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
            else if (cultivate) this.shovelIcon(avatar, x, y);
            else this.petIcon(avatar, x, y, drag.species, 1);
            if (drag.selection.kind === 'pet' && this.overRope(drag.point)) {
                avatar.strokeColor = color(C.orange); avatar.lineWidth = 4;
                avatar.roundRect(244, this.layout.bottom + 111, 72, 106, 18); avatar.stroke();
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

    private petIcon(g: Graphics, x: number, y: number, id: PetId, scale: number): void {
        const r = 27 * scale;
        const fill = id === 'cat' ? C.cat : id === 'rabbit' ? C.rabbit : id === 'deer' ? C.deer : id === 'vine' ? C.vine : id === 'sparrow' ? C.sparrow : C.mushroom;
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
        if (id === 'vine') {
            this.rect(g, x, y, r * 2.15, r * 1.8, fill, 9 * scale);
            for (const sign of [-1, 1]) {
                this.line(g, x + sign * r * 0.9, y, x + sign * r * 1.3, y + r * 0.8, C.green, 5 * scale);
                this.circle(g, x + sign * r * 0.6, y + r, r * 0.35, C.leaf);
            }
        } else this.circle(g, x, y, r, fill);
        if (id === 'sparrow') {
            this.circle(g, x - r * 0.8, y - r * 0.1, r * 0.55, '#E5B43C');
            g.fillColor = color(C.orange); g.moveTo(x + r * 0.65, y); g.lineTo(x + r * 1.4, y - r * 0.15);
            g.lineTo(x + r * 0.65, y - r * 0.4); g.close(); g.fill();
            this.line(g, x, y + r * 0.8, x + r * 0.2, y + r * 1.5, C.electric, 4 * scale);
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
        if (!this.skinImage(modal, 'panel_standard', 0, 0, 640, 620)) this.rect(shade, 0, 0, 640, 620, C.white, 20);
        this.text(modal, won ? '这一站，守住了。' : '树心耗尽了。', 0, 218, 36, 590, won ? C.green : C.red, false, true, 84);
        this.text(modal, won ? `击退 ${this.session.kills} 只 · 漏过 ${this.session.leaked} 只\n树心 ${this.session.heart}/${this.session.maxHeart} · 灵露 ${this.session.dew}`
            : '雾兽突破防线，摇篮树失去生机。\n整理阵容，再次出发。', 0, 105, 26, 580, C.muted, false, false, 110);
        const depth = this.session.current?.depth;
        const reward = won && depth !== undefined && PET_GROWTH.metamorphosisRewardDepths.some(d => d === depth);
        this.text(modal, reward ? `获得主动蜕变 1 次 · 剩余 ${this.session.mutationCredits} 次\n下次准备时，可用于二星或三星伙伴。`
            : `本局已收录 ${this.session.usedMutations.length} 种形态\n形态记录随档案保留。`, 0, -21, 24, 580, reward ? C.spore : C.muted, false, false, 98);
        this.button(modal, '查看形态记录', 0, -127, 560, 64, () => { this.collectionOpen = true; this.renderScreen(); }, C.pale, C.ink, true, 23);
        this.button(modal, won ? (this.session.current?.children.length ? '继续选择路线' : '抵达净土') : '重新选择路线',
            0, -235, 560, 84, () => {
                if (won) { this.session.continueRoute(); this.mapCamera = null; this.reservesOpen = false; this.clearFeedback(); this.renderScreen(); }
                else this.restart();
            });
    }
}
