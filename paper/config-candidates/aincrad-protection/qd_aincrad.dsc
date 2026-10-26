qd_aincrad_loader:
  type: world
  debug: false
  events:
    on server start:
    - createworld aincrad

qd_aincrad_guide:
  type: command
  debug: false
  name: aincrad
  description: 艾恩葛朗特的快速往返与地图规则
  usage: /aincrad
  script:
  - narrate "<gold>艾恩葛朗特 · 第一层<reset>：独立探索世界，不在主村庄或旅人营地旁，不需要长途走过去。"
  - narrate "<white>进入起始之城：/warp aincrad；返回主村庄：/warp village。真人和Agent使用相同命令。"
  - narrate "<gray>先查 /mycli skills info travel；未学则 /mycli skills learn travel（1技能点）。每次成功指令传送耗6魔力，失败时按本人回执处理。"
  - narrate "<gray>入口：aincrad世界 X=-582.5 Y=69 Z=934.5。传送后核对所在世界和坐标；未抵达不要反复重发。"
  - narrate "<gray>地图建筑禁止拆建、倒水倒岩浆和爆破；可以开门、开箱、探索与战斗。个人箱：/mycli arena stash（已学travel，成功开页耗2魔力）。"
  - narrate "<gray>本次开放原图探索，不代表百层剧情均已实装。地图：SAO Map - Floor 1（Alyaaa / Yoplay；原页鸣谢jardinixz）。"
