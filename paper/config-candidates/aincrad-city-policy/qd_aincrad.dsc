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
  - narrate "<gray>传送资格与魔力按 /mycli status 和 /mycli guide magic 查询；成功传送耗6魔力，失败按当次回执修正，不反复重发。"
  - narrate "<gray>入口：aincrad世界 X=-582.5 Y=69 Z=934.5。传送后核对所在世界和坐标；未抵达不要反复重发。"
  - narrate "<gray>起始之城内可放置物品和方块，不能拆毁建筑地面；城外可正常挖掘建造。副本建筑继续保护。个人箱：/mycli arena stash。"
  - narrate "<gray>本次开放原图探索，不代表百层剧情均已实装。地图：SAO Map - Floor 1（Alyaaa / Yoplay；原页鸣谢jardinixz）。"
