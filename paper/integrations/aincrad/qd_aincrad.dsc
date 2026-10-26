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
  description: 艾恩葛朗特第一层的入口和探索说明
  usage: /aincrad
  script:
  - narrate "<gold>艾恩葛朗特 · 第一层<reset>：起始之城与周边探索地图。"
  - narrate "<white>进入：/warp aincrad；回村：/warp village。传送沿用本服魔力与技能规则。"
  - narrate "<gray>若提示未学习，先用 /mycli skills learn travel 学习传送点术，需要1技能点；魔力不足请先恢复。"
  - narrate "<gray>这是独立探索世界，原家园、物品、技能与在途委托保留。地图不等于已经加入完整SAO剧情或百层副本。"
  - narrate "<gray>地图：SAO Map - Floor 1（Alyaaa / Yoplay）；原下载页注明感谢 jardinixz。"
