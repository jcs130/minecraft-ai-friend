# 风格领地法典（zzz-style-territories）

2026-08-25 天神立。目的：千灯纪的村庄**一村一风、以群系分封**，杜绝多风格村庄在同一群系混刷。

## 领地分封表

| 群系 | 封地风格 | 归属包 |
|---|---|---|
| plains 平原 | 欧式村庄（+ Peakscape 园林已迁出） | 原版 |
| meadow 草甸 | 徽派村庄 | mcs |
| sunflower_plains 向日葵平原 | 中式平原村庄 + 魏氏园林/田园小品 | chinesevillage / peakscape |
| snowy_plains 雪原 | 毡房（蒙古包）村庄 | mcs |
| snowy_taiga 雪域针叶林 | 欧式雪村（从雪原迁出） | 原版 |
| cherry_grove 樱花林 | 日式村庄（天然分封，未动） | qrafty |
| jungle 丛林 | 干栏式村庄（天然分封，未动） | mcs |
| badlands 恶地 | 石窟村庄（天然分封，未动） | mcs |
| desert / savanna / taiga | 原版对应村庄（未动） | 原版 |

## 覆写清单（本包文件 → 覆写对象）

1. `data/mcs/tags/.../village_hui.json`（replace）→ 徽州只进草甸（原：plains+meadow）
2. `data/mcs/tags/.../village_yurt.json`（replace）→ 毡房只进雪原（原：plains/snowy/sunflower/meadow 四抢）
3. `data/styleterr/tags/.../village_chinese_plains.json`（新标签）→ 向日葵平原
4. `data/chinesevillage/worldgen/structure/village_plains.json`（复刻）→ biomes 改指新标签（原指 #minecraft:has_structure/village_plains，与欧式共用）
5. `data/minecraft/tags/.../village_snowy.json`（replace）→ 欧式雪村迁去 snowy_taiga，雪原让给毡房
6. `data/peakscape/worldgen/structure/wei_garden.json` + `randomplay.json`（复刻）→ 从 plains 迁至 sunflower_plains（中式园林归中式领地）

## 未动项（有意保留）

- mcs 神庙/祠堂/城堡/天宫/大佛/船队等地标：MCS 本就按群系分风格设计，且为稀落地标（间距 30-100），不算村庄混搭。
- 原版沙漠/草原/针叶林村庄：无冲突。

## 加载优先级

本包必须**最后加载**（优先级最高）才能压过 mcs 对 `minecraft:villages` 放置集的覆写。
目录名 `zzz-` 前缀保证字母序最后；若 `/datapack list` 顺序不对，用
`/datapack disable "file/zzz-style-territories"` + `/datapack enable "file/zzz-style-territories" last` 修正。
