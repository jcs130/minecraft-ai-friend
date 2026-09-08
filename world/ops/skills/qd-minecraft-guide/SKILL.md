---
name: qd-minecraft-guide
description: 千灯纪 Minecraft 1.21.1 玩法参考。遇到合成缺料、装备成长、种地、建房、村民交易、公会、法术或女仆工作问题时，按当前需要只读对应主题，再用真实游戏资料核对。
---

# 按需查玩法

先复用本轮已有观察；遇到具体知识缺口时，用原生 `read_file` 读取自己工作区 `skills/qd-minecraft-guide/references/` 下的一篇。只取必要范围，不一次读全目录，不把参考正文加载进 AGENTS 或长期提示。

| 当前问题 | 读取文件 |
| --- | --- |
| 不确定需要哪种资料、如何区分知识与执行 | [index.md](references/index.md) |
| 配方、缺料、合成与烧炼验收 | [crafting.md](references/crafting.md) |
| 生存优先级、采矿、工具和装备成长 | [progression.md](references/progression.md) |
| 耕地、种植、收获与补种 | [farming.md](references/farming.md) |
| 勘察、住所、容器与建筑风格 | [building.md](references/building.md) |
| 村民报价、接单、交货与结算 | [trading-guild.md](references/trading-guild.md) |
| 特色技能、铁魔法、人物与程序成长 | [magic.md](references/magic.md) |
| 女仆自身状态、原生任务和工作安排 | [maid-work.md](references/maid-work.md) |

所有角色都可阅读。工具与身体权限以当前角色实际开放的接口为准：没有桐人的身体工具就只提供知识或任务建议；女仆只操作自身已绑定的原生能力。阅读不会获得其他角色的身体、租约或管理权限。资料可能落后于服务器，实际配方、方块、库存、报价及回执优先。
