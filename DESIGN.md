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
    fontSize: "37px"
    fontWeight: 700
    lineHeight: 1.45
  headline:
    fontFamily: "sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.45
  title:
    fontFamily: "sans-serif"
    fontSize: "23px"
    fontWeight: 700
    lineHeight: 1.45
  body:
    fontFamily: "sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.45
  caption:
    fontFamily: "sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  control: "12px"
  sidebar: "18px"
  board: "20px"
  route-board: "22px"
components:
  button-primary:
    backgroundColor: "{colors.forest-action}"
    textColor: "{colors.warm-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    width: "200px"
    height: "50px"
  button-secondary:
    backgroundColor: "{colors.forest-pale}"
    textColor: "{colors.forest-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    width: "92px"
    height: "48px"
  pet-card:
    backgroundColor: "{colors.pet-card-idle}"
    rounded: "{rounded.control}"
    width: "214px"
    height: "118px"
---
# Design System: 萌宠变异录 · 无素材 MVP

## Overview

**Creative North Star: "浅色森林棋盘"**

浅绿棋盘承载路线、道路、树桩与伙伴。深绿文字保持清楚的层级，橙猫与蓝兔用颜色和轮廓共同区分近战、远程；这是用户确认的视觉方向。

本规范记录 Cocos Creator 3.8.8 的 `Graphics` / `Label` 实现。所有角色与界面均程序绘制，优先支持选择、放置和防守；以下尺寸均为 1280 × 720 设计坐标中的单位，前置 token 的 `px` 是交换格式表达，并非 CSS 实现。依据为 `assets/scripts/presentation/MvpGame.ts` 与 `.impeccable/review/` 的四张实际 Web 构建截图。

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
- **暖白 / 淡绿**（`warm-white` / `forest-pale`）：侧栏、弹窗、主要按钮文字与次要按钮背景。
- **沙色路 / 路缘绿 / 连线绿**（`path-sand` / `path-edge` / `forest-line`）：道路内外层、路线连线与页首分隔线。
- **宠物卡与路线状态色**：闲置卡、猫选中卡、兔选中卡与锁定路线分别使用同名 token，保持角色色对应关系。

**The Color-and-Words Rule.** 选中同时显示角色色描边和“已选中”；路线同时用形状、连线和“沿连线解锁 / 已守住”文案说明状态。

## Typography

**Display Font:** 系统 `sans-serif`。  
**Body Font:** 系统 `sans-serif`；中文由运行设备字体回退，无外部字体文件。

字形以清楚的中文标签为主。`Label.isBold` 区分重点，统一行高为字号的 1.45 倍；前置层级只收录代表性的复用角色，不意味着源码已有集中字体配置。

- **Display**：路线引导大字（37，粗体）；结算标题为 34 粗体。
- **Headline**：左上游戏名（30，粗体）。
- **Title**：树心（23，粗体）；伙伴介绍为 21，路线名与卡片标题为 19 粗体。
- **Body**：主要提示与结算正文（19）；路线说明为 18，卡片属性为 15。
- **Label**：按钮（18，粗体）；辅助提示为 16–17；状态细节为 14–15。

## Layout

固定设计画布为 **1280 × 720**，原点在中心，Y 轴向上。`ResolutionPolicy.SHOW_ALL` 在桌面、平板及手机横屏等比缩放并留边，不裁掉游戏画面。已查看的截图为桌面 1280 × 800、平板 1024 × 768、手机横屏 844 × 390；小屏文字随整体缩小。**暂无手机竖屏重排、断点或安全区适配规范。**

页首标题中心位于（−432, 310），分隔线横跨 X = −590 至 590。路线页为左侧介绍与右侧路线棋盘：棋盘中心（235, −10），尺寸 650 × 510。战斗页棋盘中心（−130, 5），尺寸 950 × 510；右侧操作栏中心（485, −5），尺寸 240 × 530，两者间距 20。底部状态与快捷键置于 Y = −278 / −315。

宠物卡为 214 × 118，两卡中心相距 130。结算为居中的 560 × 310 面板与全画布遮罩。当前布局使用明确坐标，不存在可复用 CSS 网格或统一间距标尺。

## Elevation & Depth

界面无投影，使用浅绿、暖白和角色浅色卡片区分层次。结算遮罩使用深林墨色、alpha 145 / 255；射程填充 alpha 22 / 255、描边 alpha 120 / 255。敌人脚下有轻薄椭圆式落地色块，不作为面板阴影规范。

## Shapes

按钮与宠物卡使用 12 圆角；侧栏 18，战斗棋盘与结算面板 20，路线棋盘 22。道路外层线宽 53、内层 45，用半径 22 的圆补转角。路线节点半径 40；树桩外圈半径 30、内圈 24，中心用十字提示位置。猫耳三角形与兔耳椭圆形是角色的辨识轮廓。

## Components

### Buttons

实色圆角按钮承载直接操作。主要按钮为森林操作绿配暖白粗体字；倍速按钮为淡绿配深林墨。开始防守为 200 × 50，暂停与倍速各 92 × 48，结算操作为 320 × 52。文字区域比按钮宽度少 16，无独立 padding 布局。

通用按钮指针进入立即缩放为 1.025，离开恢复；没有补间或按压动画。禁用分支使用淡绿和灰绿且不绑定点击，但当前主流程未展示禁用按钮。源码未提供独立键盘焦点视觉。

### Cards / Containers

宠物卡闲置用浅灰绿，选中猫用暖橙底、选中兔用浅蓝底，并增加对应角色色的 2 宽描边；“已选中”仅出现在准备阶段。卡片持续显示近远程属性、伤害与“待放置 / 已放置 · 树桩 N”。战斗和暂停阶段点击卡片不会改变放置。

### Navigation

三层路线从下向上连线。可选节点为暖白圆、3 宽绿色描边；锁定节点为灰绿实心圆；完成节点为绿色圆、暖白勾，走过的连线由宽 2 变宽 5。只有亮起节点绑定选择；节点文字说明与进度保留可读状态。当前没有独立可见的路线 hover / focus 效果。

### Placement & Combat

准备阶段先选伙伴再点树桩；同一位置再次点击可撤下，键盘 1 / 2 也可选伙伴。已部署且选中的宠物显示其实际规则射程，橙代表猫、蓝代表兔。开战后固定放置；空格开始、暂停或继续，按钮切换 1 / 2 倍速，切到后台会暂停。状态文字明确显示准备、防守、暂停与胜败。

近战用三条橙色爪痕，远程用蓝色圆弹与浅色高光；命中用蓝色圆环。敌人使用紫色雾团轮廓、双眼与 34 × 5 血条，随模拟时钟轻微上下浮动。

### Result Overlay

遮罩阻止背景点击。胜利标题为绿色、失败为受伤红；正文说明本场结果，单一主按钮用于继续路线或重新选择路线。

## Do's and Don'ts

### Do:
- **Do** 保持浅色森林棋盘、橙猫、蓝兔与程序绘制方向。
- **Do** 让选择、部署、锁定和完成状态同时有可见图形差异与中文文案。
- **Do** 以 1280 × 720 设计坐标核对整体缩放后的文字、树桩与操作栏。

### Don't:
- **Don't** 把颜色当作近远程或交互状态的唯一线索。
- **Don't** 将文档 token 当作游戏中已存在的 CSS 变量或外部字体依赖。
- **Don't** 将当前等比缩放描述为已完成手机竖屏重排或键盘焦点系统。
