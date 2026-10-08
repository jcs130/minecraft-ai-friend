qd_wayfarer:
  type: assignment
  debug: false
  actions:
    on assignment:
    - trigger name:click state:true radius:3 cooldown:2
    on click:
    - narrate "<aqua>[旅人阿岚] <white>出发前查技能与魔力，带好补给。藏宝图要实地探索后返程交记录。队友倒地时靠近4格连续停留10秒可救起。"

qd_village_story:
  type: command
  debug: false
  name: village-story
  description: 村庄旅人留下的探险与救援指引
  usage: /village-story
  script:
  - narrate "<aqua>[旅人札记] <white>探索不是到此一游：准备补给、观察结构、收集线索、原路返程。新手实习 /mycli world guide start；村民聊天 /mycli world npcs。"
