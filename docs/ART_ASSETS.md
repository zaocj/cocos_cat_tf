# 萌宠变异录 · 美术素材放置与使用说明

更新：2026-11-11。引擎：Cocos Creator 3.8.8。

## 1. 这批图片放在哪里

来源目录：`/Users/zj/Downloads/game/`。下载目录原图保留；项目原图副本使用英文文件名，内容与下载目录原图一致；本轮战斗场景另有基于原图制作的分层派生资源，见第 6 节。

本批四张 UI 底图已经放入：

```text
/Users/zj/cocos/NewProject/assets/resources/art/ui/
├── button_primary.png
├── button_secondary.png
├── panel_standard.png
└── panel_mutation.png
```

将文件放入项目后，先切回 Cocos Creator，等待资源扫描/脚本编译完成，再重新打开或刷新预览。编辑器未扫描新目录时，旧预览页可能还没有 resources 路径表；不需要删除缓存或重建 `.meta`。

当前界面由代码动态搭建，所以这四张常用 UI 图通过 `resources.load` 预加载，放在 `assets/resources/` 内。此前建议的 `assets/art/` 仍适合通过 Inspector 静态引用的宠物、敌人、环境等图片；不是所有美术都要放进 resources。

## 2. 每张图用在哪些场景

| 原始图片 | 项目文件 | 原图尺寸 | 当前使用场景 |
| --- | --- | --- | --- |
| 森林绿叶藤蔓游戏按钮.png | [button_primary.png](../assets/resources/art/ui/button_primary.png) | 2172×724 | 绿色主操作：新远征、继续远征、随机召唤、结算后继续等 |
| 奶油绿边立体圆角按钮.png | [button_secondary.png](../assets/resources/art/ui/button_secondary.png) | 1774×887 | 次操作：倍速、后备、返回、查看记录、开始防守，以及符合尺寸的选择按钮/变异候选底板 |
| 奶油绿边叶饰卡片面板.png | [panel_standard.png](../assets/resources/art/ui/panel_standard.png) | 1086×1448 | 远征菜单、修改器、新局确认、首次引导、保存失败提示、主动蜕变、形态记录、远征终局、节点结算和后备面板 |
| 淡紫花藤羊皮纸卡框.png | [panel_mutation.png](../assets/resources/art/ui/panel_mutation.png) | 1024×1536 | 触发自然变异/主动蜕变后的必选界面外框，突出变异主题；不是每个普通按钮的底图 |

小型关闭/菜单图标按钮、工具与宠物槽、战场顶部信息条、宠物实例资料卡、宠物/敌人/远征选路图/射程及战斗特效目前仍由代码绘制；战场环境已按第 6 节接入。本轮没有为尚未提供的素材制作假替代图片，也没有恢复已取消的工具浮层、携带头像说明或战斗暂停按钮。

## 3. 图片如何适配不同尺寸

- 所有标题、按钮文字、灵露、概率和宠物数据仍由 Label/EditBox 显示，不写进图片。
- 使用 Sprite 的 Sliced 九宫格绘制，边角与叶饰保持比例，中间区域按按钮/弹窗尺寸延展。
- PNG 原文件不裁切、不重绘。原图透明区域有极低 alpha 的零星杂点，导入器默认阈值会把它们算进边界。因此根据 alpha≥16 的主体边界外留 2 像素，在运行时克隆 SpriteFrame 上指定有效矩形、重设原始尺寸/偏移和九宫格边界，避免把原图的大面积透明留白算进按钮可见尺寸；不改已有 `.meta` 身份或导入参数。
- 美术子节点等比缩放，按钮的实际点击区域仍采用原来的布局尺寸，文字不随图片像素尺寸变大。
- 绿色主按钮使用浅色文字，奶油底按钮使用深色文字；紫色/橙色选择以染色区分，禁用按钮使用灰色染色。原有灵露不足蒙层保留。
- 运行时代码、四个资源路径和九宫格参数集中在 [MvpGame.ts](../assets/scripts/presentation/MvpGame.ts) 的 `UI_SKINS`、`UI_CROPS`、`loadUiArt`、`skinImage`、`button` 和 `panel`。

运行时有效矩形为 `x / y / 宽 / 高`（源 PNG 像素）：

| 文件 | 有效矩形 |
| --- | --- |
| button_primary | 49 / 92 / 2070 / 524 |
| button_secondary | 39 / 209 / 1686 / 467 |
| panel_standard | 21 / 12 / 1047 / 1418 |
| panel_mutation | 22 / 32 / 979 / 1478 |

当前九宫格边界采用源图像素，顺序为左/右/上/下：

| 文件 | 九宫格边界 |
| --- | --- |
| button_primary | 350 / 350 / 120 / 140 |
| button_secondary | 220 / 220 / 100 / 100 |
| panel_standard | 240 / 220 / 240 / 240 |
| panel_mutation | 240 / 240 / 300 / 320 |

启动时一次加载四张 UI 底图与五张战场资源，再开放首页操作。失败会列出具体资源路径并提供重试；不会在玩家拖动中途加载完成后重建界面。资源按组件生命周期持有和释放，重建 UI 不重复加载。

## 4. 后续新增素材的目录

| 建议目录（相对项目根目录） | 放置内容 |
| --- | --- |
| `assets/resources/art/ui/` | 当前由代码按路径加载的这套通用 UI 底图 |
| `assets/art/icons/` | 灵露、树心、铲子、绳索、设置、变异机会等独立图标，后续接入时配置引用 |
| `assets/art/pets/` | 猫、兔、鹿、菇、墙兽、电雀的角色与动画源图 |
| `assets/art/enemies/` | 普通、疾行、岩甲、回春、精英和 BOSS |
| `assets/art/environment/` | 树桩、荒藤、摇篮树、道路与背景 |

后四个目录是后续素材的约定位置，不表示对应图片或接入代码已经存在。使用英文小写加下划线命名；无文字的按钮/面板与动态文字分开，角色保持统一视角、比例与透明边距。

替换同一张图时保留同名文件和它的 `.meta`，由编辑器重新导入。新文件的 `.meta` 由 Cocos 生成，不复制其他资源的 UUID。若新图的外形、透明边距或边框宽度变化，需要同步检查九宫格参数和实际手机布局。

当前未建立自动图集，四张独立 PNG 共约 5.6 MiB；没有宣称完成包体/DrawCall 优化。后续正式发布前再检查压缩、图集、分包及抖音真机表现。

## 5. 验证记录

实际类型检查、导入、构建与预览结果记录在 [MVP_ACCEPTANCE.md](MVP_ACCEPTANCE.md) 的“首批 UI 美术接入”条目；未提供的角色和场景图片不属于本轮完成范围。


## 6. 战斗场景分层接入（2026-11-11）

新增来源：`/Users/zj/Downloads/game/梦幻森林树桩防线地图.png`，941×1672，项目副本保留原始字节。

这张图已画入道路、16 个树桩、藤蔓和终点树；道路布局、树桩位置及封锁分布与当前领域坐标不一致。不能直接铺上整图，否则敌人会偏离路面，开垦后还会残留图片里的藤蔓。本轮保留现有 PATH/SLOTS、射程、速度、触点与存档版本，改为分层表现。

资源目录：`/Users/zj/cocos/NewProject/assets/resources/art/environment/`。

| 项目文件 | 来源 / 尺寸 | 使用方式 |
| --- | --- | --- |
| [forest_source.png](../assets/resources/art/environment/forest_source.png) | 用户原图，941×1672 | 原图完整副本；取其中 48×48 的土路纹理，按真实 PATH 蒙版铺路 |
| [forest_floor.png](../assets/resources/art/environment/forest_floor.png) | imagegen 清理原图得到，941×1672 | 移除画死的道路、树桩、藤蔓、洞口和摇篮树，仅保留森林草地与边缘植物；战场范围内等比 cover，超出部分裁切 |
| [stump_open.png](../assets/resources/art/environment/stump_open.png) | imagegen 参考原图分离的透明图，1254×1254 | 全部 16 个逻辑位置使用，实际开放位显示木桩；宠物站在桩面上方 |
| [stump_locked.png](../assets/resources/art/environment/stump_locked.png) | imagegen 参考原图分离的透明图，1254×1254 | 仅实际被封锁的树桩显示；合法开垦后替换成开放木桩，不把原图的封锁分布当规则 |
| [cradle_tree.png](../assets/resources/art/environment/cradle_tree.png) | imagegen 参考原图分离的透明图，1254×1254 | 摆放在真实 PATH 终点附近，随统一逻辑投影缩放；不改变漏怪位置和树心规则 |

派生图片由内置 imagegen 生成，原图没有覆盖；它们是风格一致的分层重制，并非逐像素无损抠图。输入图、完整提示词、输出用途见 [BATTLE_ART_PROMPTS.md](BATTLE_ART_PROMPTS.md)。

代码配置为 MvpGame 的 `BATTLE_ART` / `drawBattleArt` / `battleImage`；继续复用一次预加载、失败重试、资源引用与销毁保护。有效矩形为源像素 `x / y / 宽 / 高`：

| 运行时键 | 有效矩形 |
| --- | --- |
| forest_floor | 0 / 0 / 941 / 1672 |
| road_sand（forest_source） | 400 / 420 / 48 / 48 |
| stump_open | 242 / 373 / 770 / 508 |
| stump_locked | 146 / 190 / 944 / 801 |
| cradle_tree | 93 / 82 / 1070 / 1069 |

道路纹理通过 Cocos 3.8.8 的 Graphics stencil mask 按真实 PATH 显示；宽度、树桩、终点树与角色使用同一 scale，只有无交互草地底图按战场范围 cover。树桩的桩身中心略向下，确保桩面位于宠物脚下；树桩触摸中心仍为逻辑 SLOTS，不从 PNG 猜位置。

不整张拉伸原图来修改战斗几何，不从图片数量或颜色读取规则。未接入随机多主题地图、角色美术、场景动画及真机压缩优化。
