# 萌宠变异录 MVP

基于 Cocos Creator **3.8.8** 的无素材塔防原型。宠物、敌人、道路和摇篮树均由 Graphics 绘制。

## 运行

### 在 Cocos 中预览

1. 使用 Cocos Creator 3.8.8 打开本项目，等待脚本与资源导入。
2. 打开 `assets/Boot.scene`，Canvas 已挂载 `MvpGame`。
3. 点击编辑器的场景预览。预览工具栏选择 **Webpage Full Screen** 或横屏设备，便于操作。

### 运行独立 Web 版本

```sh
npm ci
npm run build:mvp
npm run serve
```

随后打开 [本地游戏](http://127.0.0.1:8090/)。构建默认使用本机 `/Applications/Cocos/Creator/3.8.8/` 安装的编辑器；其他位置通过 `COCOS_EDITOR` 环境变量指定可执行文件。`serve` 使用 Python 3，仅监听本机地址。

Cocos CLI 成功退出码为 36，构建脚本将其转换为正常成功，并把完整日志写入 `.mvp/build.log`。使用官方 CLI 的方式见 [Cocos 命令行构建文档](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/publish-in-command-line.html)。

## 操作与验收

- 先点击地图上亮起的节点；通关后沿连线选择下一节点，共 3 场防守。
- 准备阶段点击右侧宠物，再点击空树桩放置；同一只宠物可以移动，放在另一只所在位置会交换，再点原位可撤下。
- 橙色爪爪猫近战挥击，蓝色星弹兔远程发射追踪弹；选择已放置宠物可看到射程。
- 点击“开始防守”，之后锁定布阵。支持暂停、1/2 倍速；`1` / `2` 选宠，空格开战或暂停。
- 基地树心 **1 / 1**，任何敌人抵达终点便扣至 0 并立即结束，可重新选路。允许空阵开战以验证失败流程。
- 三场都守住后进入远征完成画面，可以重新开始。

## 检查命令

```sh
npm run typecheck
npm test
```

纯规则测试覆盖路线锁定、放置与交换、近战/远程差异、首次突破失败及完整通关。根 tsconfig 保留引擎生成配置继承；`skipLibCheck` 仅跳过 3.8.8 自带声明的内部缺失引用，项目源码仍参与类型检查。

本次只实现 MVP；合成、变异、捕捉、商店、局内经济和存档留待完整版本。范围与验证记录见 [开发计划](docs/DEVELOPMENT_PLAN.md)。
