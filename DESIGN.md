---
name: 萌宠变异录 · 无素材 MVP
description: 浅色森林棋盘中的程序绘制塔防界面
colors:
  forest-action: "#337354"
  forest-ink: "#234235"
  forest-muted: "#526A58"
  forest-canvas: "#EDF3E7"
  forest-board: "#DDE9D3"
  forest-pale: "#D9E6D0"
  warm-white: "#FCFDF7"
  forest-line: "#A5B89C"
  path-edge: "#B9C8A8"
  path-sand: "#F5EED9"
  cat-accent: "#B85C20"
  cat-fur: "#F1AF64"
  rabbit-accent: "#286A9C"
  rabbit-fur: "#96CBE3"
  deer-fur: "#C9AD77"
  deer-accent: "#4D8251"
  mushroom-fur: "#CE9DD1"
  mushroom-accent: "#87539D"
  danger: "#A64243"
  mist-body: "#A46D9F"
  mist-face: "#6F4A72"
  pet-card-idle: "#F0F3E9"
  cat-card-selected: "#F8E5CD"
  rabbit-card-selected: "#DFEFF5"
  route-locked: "#C6D4BD"
typography:
  display:
    fontFamily: "sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.45
  headline:
    fontFamily: "sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.45
  title:
    fontFamily: "sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.45
  body:
    fontFamily: "sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.45
  caption:
    fontFamily: "sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  control: "12px"
  hud: "16px"
  board: "20px"
  route-board: "22px"
components:
  button-primary:
    backgroundColor: "{colors.forest-action}"
    textColor: "{colors.warm-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    width: "420px"
    height: "84px"
  button-secondary:
    backgroundColor: "{colors.forest-pale}"
    textColor: "{colors.forest-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    width: "200px"
    height: "84px"
  pet-card:
    backgroundColor: "{colors.pet-card-idle}"
    rounded: "{rounded.control}"
    width: "120px"
    height: "106px"
---
# Design System: 萌宠变异录 · 无素材 MVP

## Overview

**Creative North Star: "浅色森林棋盘"**

浅绿棋盘承载路线、道路、树桩与伙伴。深绿文字保持清楚的层级，橙猫、蓝兔、枝角鹿、紫色茸菇用颜色与轮廓共同区分近战、远程、增益和持续伤害；这是用户确认的视觉方向。

本规范记录 Cocos Creator 3.8.8 的 `Graphics` / `Label` 实现。所有角色与界面均程序绘制，优先支持选择、放置和防守；当前仅支持竖屏，以下尺寸均为 720 × 1280 基准设计坐标中的单位，前置 token 的 `px` 是交换格式表达，并非 CSS 实现。依据为 `MvpGame.ts`、`PortraitLayout.ts` 和 `.mvp/portrait-*.jpg` 的实际构建截图。

**Key Characteristics:**
- 浅绿底、沙色道路、深绿信息与主要操作。
- 圆角容器、圆形树桩及几何角色，不依赖外部美术素材。
- 颜色、描边和中文状态文案共同说明可用与选中状态。

## Colors

前置 token 为实际色值；命名只描述现有用途。`.impeccable/design.json` 的 HTML/CSS 是面板展示用的静态转译，不参与 Cocos 运行；其色阶为预览补充，并非新增游戏配色。

### Primary
- **森林操作绿**（`forest-action`）：主要按钮、可选路线描边、已完成节点、正常树心与敌人剩余血量。

### Secondary
- **猫爪橙 / 暖橙毛色**（`cat-accent` / `cat-fur`）：近战名称、选中描边、射程与挥击；毛色用于猫的轮廓。
- **星弹蓝 / 浅蓝毛色**（`rabbit-accent` / `rabbit-fur`）：远程名称、选中描边、射程与弹道；毛色用于兔的轮廓。
- **受伤红**（`danger`）：基地受伤规则、失败标题与归零树心。
- **雾团紫 / 深紫表情**（`mist-body` / `mist-face`）：敌人与面部细节。

### Neutral
- **林地纸底 / 棋盘浅绿**（`forest-canvas` / `forest-board`）：全屏背景与主要游戏区。
- **深林墨 / 灰绿文字**（`forest-ink` / `forest-muted`）：主信息与辅助说明。
- **暖白 / 淡绿**（`warm-white` / `forest-pale`）：顶部 HUD、弹窗、主要按钮文字与次要按钮背景。
- **沙色路 / 路缘绿 / 连线绿**（`path-sand` / `path-edge` / `forest-line`）：道路内外层、路线连线与页首分隔线。
- **宠物卡与路线状态色**：闲置卡、猫选中卡、兔选中卡与锁定路线分别使用同名 token，保持角色色对应关系。

**The Color-and-Words Rule.** 选中同时显示角色色描边和“已选中”；路线同时用形状、连线和“沿连线解锁 / 已守住”文案说明状态。

## Typography

系统 sans-serif，无外部字体。游戏标题和灵露为 32，路线主标题和结算标题为 36；按钮和卡片名称为 26，正文及路线名为 24，说明为 22。默认行高为 1.45 倍；底部两行状态提示使用字号 24、行高 30。尺寸为设计坐标，不是设备物理像素。

## Layout

只支持竖屏。基准为 720×1280，原点在中心，Y 轴向上。长竖屏使用 FIXED_WIDTH，额外高度分配到中间战场；短竖屏使用 SHOW_ALL 留边。横向或正方形窗口使用独立提示层覆盖，不提供横屏布局。

顶部显示游戏名、树心、战斗进度、灵露和收入。顶部数据卡为 656×152，集中显示选中名称、攻击/施法数值和效果。战斗场宽 656，上边界距离顶部 370，下边界距离底部 340。底部四个 120×106 纯头像排列；下方是 84 高的开始/暂停、倍速与后备按钮，最后是两行状态提示。布局使用顶部与底部相对偏移，中间高度自适应，不将整个横屏界面缩成手机画面。

路线图在介绍下方纵向铺开，三层节点从下向上选择。下方保留四种宠物头像、名称和基地规则。

## Shapes & Depth

保留森林配色与圆角语言：按钮和卡片 12，HUD 16，战斗和弹窗 20，路线区 22。无面板投影。选中卡增加角色色描边；路线可选节点半径 48，树桩半径 35/29，中心为十字。

道路描边宽 52、内部宽 44，转角以圆连接。猫耳为三角形，兔耳为椭圆形；鹿有绿色枝角，菇有紫色菌盖白斑。战场逻辑坐标直接为竖向：左上入口、右下基地、16 个空树桩；统一缩放投影，宠物和树仍保持正立；射程圈使用同一缩放，不能因美术尺寸改变攻击距离。

## Components & Interaction

- 召唤卡：拖动头像到空树桩松手，或点击选择物种再点击空树桩，花 30 灵露召唤。移动超过 12 设计单位进入拖动，头像跟随触点上方；空树桩描边，目标显示射程。占用、余额或容量不符以红色提示；预览不扣款，松手由领域层提交一次。取消、转屏、失焦、界面重建清除拖动；暂停不能拖放。底部只显示头像和选中描边，价格和不足状态移至数据卡。
- 场上宠物：点击选择实例，显示射程，长按 0.3 秒拖到空树桩，或点空位搬迁；再点原位仅查看，通过顶部数据卡收回后备。搬迁停手用灰绿色圆环标记。
- 树桩触点：88 单位直径区域；相邻区域重叠时选最近树桩，不能按节点创建顺序抢占。16 个触点在最短竖屏仍不重叠。
- 后备入口：无后备时禁用；有后备时打开 656×650 弹窗，三列、最多四行，每个伙伴按钮为 188×86。选择后关闭弹窗，再点击树桩部署；背景输入被阻断。
- 结算：居中 640×440 面板，全屏深林墨遮罩 alpha 145/255；绿色胜利、红色失败标题，单一 560×84 主操作。
- 暂停：冻结模拟和灵露，仍可查看信息；不允许召唤或搬迁。按钮 hover 轻微放大，不依赖 hover 完成触摸操作。
- 方向拦截：横屏提示为“请竖屏游玩”，自动暂停原本运行的战斗；回竖屏只恢复自动暂停，不解除手动暂停。Web 提示在物理窗口空间中显示，避免 Cocos 自动旋转画布导致提示也转向。

新增数据卡：实时展示铃芽鹿 185 范围 +40% 不叠加、茸茸菇 145 范围每半秒 8 伤害；选中实例显示增益后的伤害。范围/敌人/攻击反馈通过战场 Mask 裁切，拖动头像在独立顶层，不能覆盖顶部数据。

## Verification & Boundaries

竖屏手机比例用于实际布局与放置验收，横屏仅验收拦截。当前没有完整键盘焦点导航，也没有真实手机硬件安全区验收，不宣称已完成。

后续界面继续使用顶部 HUD、中间战场、底部操作的竖屏结构。不要重新引入横屏侧栏，或为填满宽窗口改变逻辑路径与战斗数值。

范围反馈修正：没有检查实例或拖动目标时不画范围圈，不再做中央预览；点击场上宠物在其脚下显示，拖动在落点显示，放置/取消或点击空白后收起。

## Toast 与不可召唤头像

头像不可负担时，在原头像上绘制 #234235、alpha 150/255 的 120×106 圆角蒙层，余额够用即时移除；保持头像轮廓及选中描边，不添加说明文字、不拦截交互。已有宠物搬迁免费，不能因底部灰显禁用。

通用 GameToast：独立顶层、616×88，居中置于 arenaTop−48，圆角 18，#234235 底色 alpha 245/255、暖白 26 字；warning 橙色描边/!，info 蓝色/i，success 绿色/✓。默认总时长 2.4 秒，0.12 秒淡入、末 0.22 秒淡出；新消息替换、相同消息不延长、不叠层。不挡手势，不暂停游戏，UI 时间不受倍速影响。暂停时仍可自动消失，转屏/后台/结算清理。
