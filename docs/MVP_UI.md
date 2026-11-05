# MVP 界面约定

模式：Operate。用户已确认浅色森林棋盘风格，优先可玩；本轮直接以 Cocos 代码实现。

## Direction contract

THESIS：让路线选择、近远程差异、树桩放置与基地危险可直接读懂。

OWN-WORLD：浅绿战场、深绿文字与主要按钮、橙色近战猫、蓝色远程兔；系统中文字体，图形全部程序绘制。颜色与文字共同标明状态。

STORY：玩家先选亮起的连线节点，进入战斗选择宠物、点击树桩，主动开战；胜利后沿已选分支继续，失败可重新开始。

FIRST VIEWPORT：左侧游戏标题、路线说明与两只伙伴；右侧自下而上的三层分岔路线。战斗切换为左侧大地图、右侧宠物与操作栏，顶部保留树心和进度，底部给出当前操作提示。

FORM：用户指定的森林棋盘与路线结构，不进行随机方向选择；seed: none (user-pinned)。签名交互是放置时展示橙/蓝射程，战斗中对应挥击/弹道。

FINISH：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
