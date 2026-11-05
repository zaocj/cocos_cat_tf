import {
    _decorator, Color, Component, EventKeyboard, game, Game, Graphics, input, Input,
    KeyCode, Label, Layers, Node, profiler, ResolutionPolicy, UITransform, view,
} from 'cc';
import { MvpSession, PATH, PETS, PetId, ROUTE, SLOTS, STEP } from '../domain/MvpSession';

const { ccclass } = _decorator;
const C = {
    bg: '#EDF3E7', ink: '#234235', muted: '#526A58', green: '#337354', pale: '#D9E6D0',
    board: '#DDE9D3', roadEdge: '#B9C8A8', road: '#F5EED9', white: '#FCFDF7',
    orange: '#B85C20', cat: '#F1AF64', blue: '#286A9C', rabbit: '#96CBE3',
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
    private status: Label | null = null;
    private counter: Label | null = null;
    private selected: PetId = 'cat';
    private accumulator = 0;
    private paused = false;
    private speed = 1;
    private lastStatus = '';
    private lastCounter = '';

    onEnable(): void {
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        game.on(Game.EVENT_HIDE, this.onHide, this);
    }
    onDisable(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
        game.off(Game.EVENT_HIDE, this.onHide, this);
    }
    start(): void {
        view.setDesignResolutionSize(1280, 720, ResolutionPolicy.SHOW_ALL);
        profiler.hideStats();
        this.renderScreen();
    }
    update(dt: number): void {
        if (this.session.phase === 'battle' && !this.paused) {
            this.accumulator += Math.min(dt, 0.1) * this.speed;
            let steps = 0;
            while (this.accumulator >= STEP && steps++ < 12) {
                this.session.step(); this.accumulator -= STEP;
                if (this.session.phase !== 'battle') { this.accumulator = 0; this.renderScreen(); break; }
            }
        }
        if (this.dynamic) this.drawDynamic(this.dynamic);
        this.updateHud();
    }
    private onHide(): void {
        if (this.session.phase === 'battle') { this.paused = true; this.accumulator = 0; this.renderScreen(); }
    }
    private onKey(event: EventKeyboard): void {
        if (event.keyCode === KeyCode.DIGIT_1) this.selectPet('cat');
        if (event.keyCode === KeyCode.DIGIT_2) this.selectPet('rabbit');
        if (event.keyCode === KeyCode.SPACE) {
            if (this.session.phase === 'prepare') this.begin();
            else if (this.session.phase === 'battle') this.togglePause();
        }
    }
    private selectPet(id: PetId): void {
        if (this.session.phase !== 'prepare') return;
        this.selected = id; this.renderScreen();
    }
    private begin(): void {
        if (this.session.startBattle()) { this.accumulator = 0; this.paused = false; this.renderScreen(); }
    }
    private togglePause(): void {
        this.paused = !this.paused; this.accumulator = 0; this.renderScreen();
    }
    private restart(): void {
        this.session = new MvpSession(); this.selected = 'cat'; this.paused = false;
        this.accumulator = 0; this.speed = 1; this.renderScreen();
    }

    private uiNode(name: string, parent: Node, x = 0, y = 0, width = 1280, height = 720): Node {
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
        this.text(node, title, 0, 0, 18, w - 16, active ? textTint : C.muted, false, true, h);
        if (active) {
            node.on(Node.EventType.TOUCH_END, action, this);
            node.on(Node.EventType.MOUSE_ENTER, () => { node.setScale(1.025, 1.025, 1); }, this);
            node.on(Node.EventType.MOUSE_LEAVE, () => { node.setScale(1, 1, 1); }, this);
        }
        return node;
    }

    private renderScreen(): void {
        if (this.screenRoot) { this.screenRoot.removeFromParent(); this.screenRoot.destroy(); }
        this.dynamic = null; this.status = null; this.counter = null; this.lastStatus = ''; this.lastCounter = '';
        const root = this.uiNode('MVP', this.node); this.screenRoot = root;
        const g = this.graphics(root, 'Background'); this.rect(g, 0, 0, 1280, 720, C.bg, 0);
        this.text(root, '萌宠变异录', -432, 310, 30, 320, C.ink, true, true);
        this.text(root, '无素材可玩原型', -157, 310, 15, 180, C.muted);
        this.line(g, -590, 270, 590, 270, C.line, 1);
        if (this.session.phase === 'map' || this.session.phase === 'complete') this.drawMap(root, g);
        else this.drawBattle(root, g);
    }

    private drawMap(root: Node, g: Graphics): void {
        this.text(root, `树心 ${this.session.heart} / 1`, 490, 310, 19, 190, C.green, false, true);
        const complete = this.session.phase === 'complete';
        this.text(root, complete ? '家园，抵达了。' : '选一条路，\n护送我们的家。', -413, 176, 37, 355, C.ink, true, true, 122);
        this.text(root, complete ? '三场防守全部完成。\n两位小伙伴守住了摇篮树。' : '点击亮起的节点，开始防守。\n每次选择，都决定下一段旅程。',
            -413, 62, 18, 355, C.muted, true, false, 80);
        this.petIcon(g, -550, -65, 'cat', 0.9); this.petIcon(g, -550, -166, 'rabbit', 0.9);
        this.text(root, '爪爪猫 · 近战', -367, -47, 21, 250, C.orange, true, true);
        this.text(root, '短距离挥击，单次伤害高', -367, -80, 16, 250, C.muted, true);
        this.text(root, '星弹兔 · 远程', -367, -148, 21, 250, C.blue, true, true);
        this.text(root, '远距离发射星弹，覆盖更广', -367, -181, 16, 250, C.muted, true);
        this.text(root, '基地一旦受伤，本局立即结束。', -413, -270, 17, 355, C.red, true);
        this.rect(g, 235, -10, 650, 510, C.board, 22);
        const available = this.session.available;
        for (const n of ROUTE) {
            for (const id of n.children) {
                const next = ROUTE.find(r => r.id === id);
                if (!next) continue;
                const walked = this.session.visited.includes(n.id) && this.session.visited.includes(id);
                this.line(g, n.x + 100, n.y, next.x + 100, next.y, walked ? C.green : C.line, walked ? 5 : 2);
            }
        }
        for (const n of ROUTE) {
            const open = available.some(a => a.id === n.id); const done = this.session.visited.includes(n.id);
            const x = n.x + 100; const y = n.y;
            this.circle(g, x, y, 40, done ? C.green : open ? C.white : '#C6D4BD');
            if (open) { g.strokeColor = color(C.green); g.lineWidth = 3; g.circle(x, y, 40); g.stroke(); }
            if (done) {
                this.line(g, x - 13, y, x - 2, y - 10, C.white, 4); this.line(g, x - 2, y - 10, x + 17, y + 13, C.white, 4);
            } else if (n.depth === 2) this.tree(g, x, y - 2, 0.5);
            else {
                this.circle(g, x, y, 13, open ? C.green : C.muted);
                this.line(g, x - 19, y + 16, x + 19, y - 16, open ? C.green : C.muted, 3);
            }
            this.text(root, n.name, x, y - 57, 19, 205, done || open ? C.ink : C.muted, false, true, 36);
            this.text(root, done ? '已守住' : open ? n.detail : '沿连线解锁', x, y - 86, 14, 225, C.muted, false, false, 30);
            if (open) {
                const hit = this.uiNode(`Route-${n.id}`, root, x, y - 20, 185, 125);
                hit.on(Node.EventType.TOUCH_END, () => { if (this.session.chooseNode(n.id)) this.renderScreen(); }, this);
                hit.on(Node.EventType.MOUSE_ENTER, () => { hit.setScale(1.03, 1.03, 1); }, this);
            }
        }
        if (complete) this.button(root, '再出发一次', -413, -325, 300, 44, () => this.restart());
        this.text(root, complete ? '远征完成 · 三段路线全部守住' : `路线进度 ${this.session.visited.length} / 3 · 只能沿连线前进`,
            235, -310, 17, 640, C.muted);
    }

    private drawBattle(root: Node, g: Graphics): void {
        const session = this.session; const current = session.current;
        if (!current) return;
        this.text(root, `${current.name}  ·  第 ${session.visited.length + 1} / 3 站`, 410, 310, 19, 370, C.ink);
        this.rect(g, -130, 5, 950, 510, C.board, 20);
        this.rect(g, 485, -5, 240, 530, C.white, 18);
        // The path itself is the board's structure; foliage stays outside its readable lanes.
        for (let i = 0; i < 18; i++) {
            const x = -570 + (i * 137 % 850); const y = i % 2 === 0 ? 230 : -230;
            this.circle(g, x, y, 4 + i % 3, '#BCCFAC');
        }
        for (let i = 1; i < PATH.length; i++) {
            this.line(g, PATH[i - 1].x, PATH[i - 1].y, PATH[i].x, PATH[i].y, C.roadEdge, 53);
            this.line(g, PATH[i - 1].x, PATH[i - 1].y, PATH[i].x, PATH[i].y, C.road, 45);
        }
        for (const p of PATH) this.circle(g, p.x, p.y, 22, C.road);
        for (let i = 0; i < SLOTS.length; i++) {
            const p = SLOTS[i];
            this.circle(g, p.x, p.y, 30, '#BED0AE'); this.circle(g, p.x, p.y, 24, '#F9F5E7');
            this.line(g, p.x - 7, p.y, p.x + 7, p.y, '#899C79', 2);
            this.line(g, p.x, p.y - 7, p.x, p.y + 7, '#899C79', 2);
            const hit = this.uiNode(`Slot-${i + 1}`, root, p.x, p.y, 60, 60);
            hit.on(Node.EventType.TOUCH_END, () => {
                if (this.session.placePet(this.selected, i)) this.renderScreen();
            }, this);
        }
        this.tree(g, 290, -90, 0.9);
        this.text(root, '摇篮树', 284, -169, 18, 120, C.green, false, true);
        this.text(root, '入口', -553, 148, 15, 90, C.muted);
        this.text(root, `树心  ${session.heart} / 1`, 485, 224, 23, 220, session.heart ? C.green : C.red, false, true);
        this.text(root, '受伤即结束', 485, 186, 15, 220, C.red);
        this.petCard(root, 'cat', 100); this.petCard(root, 'rabbit', -30);
        this.counter = this.text(root, '', 485, -135, 16, 225, C.muted);
        const prepare = session.phase === 'prepare';
        if (prepare) {
            this.button(root, '开始防守', 485, -205, 200, 50, () => this.begin());
        } else if (session.phase === 'battle') {
            this.button(root, this.paused ? '继续' : '暂停', 435, -205, 92, 48, () => this.togglePause());
            this.button(root, `${this.speed} 倍速`, 540, -205, 92, 48,
                () => { this.speed = this.speed === 1 ? 2 : 1; this.renderScreen(); }, C.pale, C.ink);
        }
        this.text(root, '快捷键  1 / 2 选宠 · 空格开战 / 暂停', -130, -315, 16, 900, C.muted);
        this.status = this.text(root, '', -130, -278, 19, 900, C.ink, false, true, 45);
        this.dynamic = this.graphics(root, 'LiveBattle');
        if (session.phase === 'won' || session.phase === 'lost') this.resultOverlay(root);
    }

    private petCard(root: Node, id: PetId, y: number): void {
        const spec = PETS[id]; const pet = this.session.pets.find(p => p.id === id);
        const preparing = this.session.phase === 'prepare'; const chosen = preparing && this.selected === id;
        const node = this.uiNode(`Pet-${id}`, root, 485, y, 214, 118);
        const g = node.addComponent(Graphics);
        this.rect(g, 0, 0, 214, 118, chosen ? (id === 'cat' ? '#F8E5CD' : '#DFEFF5') : '#F0F3E9');
        if (chosen) { g.strokeColor = color(id === 'cat' ? C.orange : C.blue); g.lineWidth = 2; g.roundRect(-107, -59, 214, 118, 12); g.stroke(); }
        this.petIcon(g, -70, 14, id, 0.6);
        this.text(node, spec.name, 24, 31, 19, 135, id === 'cat' ? C.orange : C.blue, false, true, 32);
        this.text(node, `${spec.role} · ${spec.damage} 伤害`, 24, 0, 15, 135, C.muted, false, false, 30);
        this.text(node, `${pet?.slot === null ? '待放置' : `已放置 · 树桩 ${(pet?.slot ?? 0) + 1}`}${chosen ? '  / 已选中' : ''}`,
            0, -37, 14, 205, C.ink, false, false, 30);
        node.on(Node.EventType.TOUCH_END, () => this.selectPet(id), this);
    }

    private updateHud(): void {
        if (!this.status || !this.counter || !this.session.current) return;
        const phase = this.session.phase; const deployed = this.session.pets.filter(p => p.slot !== null).length;
        const text = phase === 'prepare'
            ? `已放置 ${deployed} / 2 · 选择${PETS[this.selected].name}后点击树桩；再次点击原位可撤下`
            : phase === 'lost' ? '树心受损，本次远征结束。'
                : phase === 'won' ? '这一站守住了，准备前往下一段旅程。'
                    : this.paused ? '已暂停 · 可查看战场，开战后不能改变放置'
                        : '防守中 · 橙色挥击是近战，蓝色星弹是远程';
        const count = phase === 'prepare' ? `即将来袭  ${this.session.current.count} 只雾团`
            : `已击退 ${this.session.kills} / ${this.session.current.count} · 场上 ${this.session.enemies.length}`;
        if (text !== this.lastStatus) { this.status.string = text; this.lastStatus = text; }
        if (count !== this.lastCounter) { this.counter.string = count; this.lastCounter = count; }
    }

    private drawDynamic(g: Graphics): void {
        g.clear(); const s = this.session;
        if (s.phase === 'prepare') {
            const pet = s.pets.find(p => p.id === this.selected);
            if (pet && pet.slot !== null) {
                const p = SLOTS[pet.slot]; const tint = pet.id === 'cat' ? C.orange : C.blue;
                this.circle(g, p.x, p.y, PETS[pet.id].range, tint, 22);
                g.strokeColor = color(tint, 120); g.lineWidth = 1.5; g.circle(p.x, p.y, PETS[pet.id].range); g.stroke();
            }
        }
        for (const enemy of s.enemies) {
            const pulse = Math.sin(s.tick * 0.22 + enemy.id) * 2;
            this.circle(g, enemy.x, enemy.y - 10, 16, C.roadEdge, 100);
            this.circle(g, enemy.x, enemy.y + pulse, 17, C.enemy);
            this.circle(g, enemy.x - 9, enemy.y + 8 + pulse, 9, C.enemy);
            this.circle(g, enemy.x + 8, enemy.y + 8 + pulse, 10, C.enemy);
            this.circle(g, enemy.x - 5, enemy.y + 3 + pulse, 2.3, C.enemyDark);
            this.circle(g, enemy.x + 5, enemy.y + 3 + pulse, 2.3, C.enemyDark);
            this.rect(g, enemy.x, enemy.y + 30, 34, 5, '#A7B59B', 2);
            const width = 34 * Math.max(0, enemy.hp / enemy.maxHp);
            if (width > 0) this.rect(g, enemy.x - 17 + width / 2, enemy.y + 30, width, 5, C.green, 2);
        }
        for (const pet of s.pets) {
            if (pet.slot === null) continue;
            const p = SLOTS[pet.slot]; this.petIcon(g, p.x, p.y + 4, pet.id, 0.76);
        }
        for (const p of s.projectiles) {
            this.circle(g, p.x, p.y, 6, C.blue); this.circle(g, p.x - 1, p.y + 1, 2.5, C.white);
        }
        for (const m of s.marks) {
            if (m.kind === 'cat') {
                for (let i = -1; i <= 1; i++) this.line(g, m.to.x - 10 + i * 5, m.to.y - 11, m.to.x + 5 + i * 5, m.to.y + 12, C.orange, 3);
            } else {
                g.strokeColor = color(C.blue, 160); g.lineWidth = 2; g.circle(m.to.x, m.to.y, 12); g.stroke();
            }
        }
    }

    private petIcon(g: Graphics, x: number, y: number, id: PetId, scale: number): void {
        const r = 27 * scale; const fill = id === 'cat' ? C.cat : C.rabbit;
        if (id === 'cat') {
            g.fillColor = color(fill);
            g.moveTo(x - r, y + r * 0.4); g.lineTo(x - r * 0.8, y + r * 1.5); g.lineTo(x - r * 0.1, y + r * 0.7); g.close(); g.fill();
            g.moveTo(x + r, y + r * 0.4); g.lineTo(x + r * 0.8, y + r * 1.5); g.lineTo(x + r * 0.1, y + r * 0.7); g.close(); g.fill();
        } else {
            g.fillColor = color(fill);
            g.ellipse(x - r * 0.45, y + r, r * 0.27, r * 0.95); g.ellipse(x + r * 0.45, y + r, r * 0.27, r * 0.95); g.fill();
        }
        this.circle(g, x, y, r, fill);
        this.circle(g, x - r * 0.34, y + r * 0.1, 2.8 * scale, C.ink);
        this.circle(g, x + r * 0.34, y + r * 0.1, 2.8 * scale, C.ink);
        this.circle(g, x, y - r * 0.2, 2.5 * scale, id === 'cat' ? C.orange : C.blue);
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
        const modal = this.uiNode('Result', root);
        const shade = this.graphics(modal); shade.fillColor = color(C.ink, 145); shade.rect(-640, -360, 1280, 720); shade.fill();
        modal.on(Node.EventType.TOUCH_END, () => {}, this);
        this.rect(shade, 0, 0, 560, 310, C.white, 20);
        this.text(modal, won ? '这一站，守住了。' : '树心受伤了。', 0, 83, 34, 500, won ? C.green : C.red, false, true);
        this.text(modal, won ? `击退 ${this.session.kills} 只雾团，两位伙伴可以继续出发。`
            : '敌人突破了防线，树心 1 → 0。\n本次远征结束，换个位置再试一次。',
            0, 5, 19, 490, C.muted, false, false, 85);
        this.button(modal, won ? (this.session.current?.children.length ? '继续选择路线' : '抵达净土') : '重新选择路线',
            0, -94, 320, 52, () => {
                if (won) { this.session.continueRoute(); this.renderScreen(); }
                else this.restart();
            });
    }
}
