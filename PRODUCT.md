# 萌宠变异录

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

现有项目：Cocos Creator 3.8.8、TypeScript。MVP 使用 Graphics 与 Label 程序绘制，不依赖外部美术素材。

## Product Purpose

验证萌宠塔防的最小循环：选择路线节点、放置两只不同攻击方式的宠物、防守敌人并结算。

## Capabilities and Constraints

- 用户明确要求一只近战、一只远程宠物，可放置。
- 用户明确要求基地受伤即结束本局；本次 MVP 规则优先于完整设计中的 30 树心容错。
- 先选路线节点再进入战斗，参考爬塔游戏的分岔连线方式。
- 用户确认浅色森林棋盘、橙色近战猫、蓝色远程兔、程序绘制，优先可玩。
- MVP 暂不实现完整版本的合成、变异、捕捉、经济与存档。

## Evidence on Hand

玩法与完整版本计划见 docs/GAME_DESIGN.md、docs/DEVELOPMENT_PLAN.md。本次实现是明确缩减的验证切片。
