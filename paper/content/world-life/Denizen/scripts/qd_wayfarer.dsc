qd_wayfarer:
  type: assignment
  debug: false
  actions:
    on assignment:
    - trigger name:click state:true radius:3 cooldown:2
    on click:
    - narrate "<aqua>[旅人阿岚] <white>三份遗迹调查在居民事务板：亡骸地窖、蔓生地窖、战团地堡。先接单再出发，所有房间都要亲自参与，清完返回第一间并结算。普通难度也能完成。"
    - narrate "<gray>冒险以上会遇到游猎者、守卫和药师。组队同伴倒地，在4格内停留10秒救起；清室也救起。先去集市备口粮、火把和盾牌。"
    - execute as_player "mycli world board menu"

qd_village_story:
  type: command
  debug: false
  name: village-story
  description: 阿岚的三处遗迹札记与实际居民事务
  usage: /village-story
  script:
  - narrate "<aqua>[旅人札记·亡骸] <white>地窖里留下了古老守墓者。别只走到门口；清完每间，带同伴平安返回。tm_crypt_report。"
  - narrate "<green>[旅人札记·蔓生] <white>藤蔓吞没了回廊，药师仍在等待来客。归来后给自己的家挂张照片，记得这段旅途。tm_creeping_report。"
  - narrate "<gold>[旅人札记·地堡] <white>战团留下狭窄壁垒。先准备盾牌，与队友互相照看；归来用一次真正的技艺，给小满看看。tm_bunker_report。"
  - execute as_player "mycli world board"
