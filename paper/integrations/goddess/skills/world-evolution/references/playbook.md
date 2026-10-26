# 从现有能力做出可玩的内容

先确认正式实例：`E:/MC/server` 是 Paper 1.21.1，不是 FOM/NeoForge。snapshot 列出的 JAR/数据包仅证明已安装；原管理 audit/世界实查确认已启用和实际入口。别把退役实验服的 Create、MineColonies、车万女仆等能力宣称成现役已具备。新增模组不能塞进 Paper；需独立兼容方案。

## 居民活动驱动的剧情

看原生日记、公开行为及有据可查的任务结果，找真实需求：远征归来、多人组队、卡在入口、重复刷塔、补给短缺。不要把私聊全文或未核实经历写成“村史事实”。将兴趣转为可选的调查、采集、制器、摄影、解谜、护送/战斗（只用现有判定类型）路线，避免刚撤下的强制农耕重复上线。

最小活动包应有：稳定ID/版本、触发依据、世界与实测入口XYZ、NPC/告示入口、CLI入口、目标与完成条件、失败/重连路径、适量奖励、旧单兼容及效果复查。优先复用现有任务和奖励：
- `rpg-story.yml`：章节/人物/话题；`mycli admin worldlife reload`。原章节快照、人物ID及活动所需NPC保留。按需读 `resource/RPG_STORY.md`。
- `route-contracts.yml`、`task-market.yml`：任务模板，按各专题实际 schema/管理 audit/reload；先读 `resource/TASK_ROUTES.md`、`LOCAL_TASK_CHAINS.md`、`TASK_MARKET.md`。新一季用新ID，不重置旧奖账。
- `dynamic-board.yml`：日常供货/已有目标。先核实天气/库存/可获得性与已接状态，只替换没有在途进度的卡。仅调库存不是完整剧情迭代。
- BetonQuest / Denizen / Citizens / FancyNpcs / NPCSpeak：有实际插件，先读原配置与 `resource/WORLD_LIFE_PLUGINS.md`，不猜新版本 API；新增交互先隔离验证原版菜单/Agent入口。没有真实验收器的新目标先开发。

## NPC 与村庄

`resource/VILLAGE_RESIDENTS.md`、`VILLAGE_GROUND_SAFETY.md`、`VILLAGE_PUBLIC_MINE.md` 是既有方法。采两次原 UUID/位置/NoAI/职业/家/工作站/交易及脚下支撑，区别睡觉、工作、固定服务岗、卸载和真卡点。先修复跌落入口、半砖高差、门宽、照明、钟/工作站路线等根因，保留建筑材料与真实交易。救援沿原 UUID、核对落点，不杀掉重刷。不因短时静止就把 NPC 全体传送到广场，不把它们永久设 NoAI。

逐块前像+本次允许改动集合，修改后再读回，下一轮复查是否重入旧坑。玩家自己施工不恢复成昨天快照；公共设施要可走、补给可取，不能为“安全”把整个生活区封死。保护查询使用被询问玩家的权限；OP成功不代表普通玩家成功。

## 探索与地下城

已装结构包包括 Dungeons and Taverns、Terralith、Explorify、Ships、Structory，以及锁定的城堡/村庄/神庙扩展。先用已有地标/生成区块勘察，`/locate` 近似中心不等于入口，别为发现内容大规模生成世界。按需读 `resource/DUNGEON_NETWORK.md`、`CRYPT_ACCESS.md`、`STRUCTURE_PROTECTION.md`。

`dungeons.yml` 可新增已勘察的地点/真实房间（最多16处、每处1–6室，半径3–8），`mycli admin dungeons audit|reload`；有活动/检查点会拒绝，等结束，不删检查点。MythicMobs 已支持 QD_Ranger/QD_Guard/QD_Hexer 等，先查现役定义和实际兼容，不单独召怪绕过副本追踪/清理。难度设计用原生地形掩体、高差、视线与路线，给普通/冒险/末日不同挑战；不要只堆血和钻石奖励。

新增地点需隔离实走入口→各室→出口，确认原怪武器/AI/目标、怪间误伤、实际清场与奖励、掉线/死亡/正常重启、满箱与重复领取。沿原奖励箱/队列/日限，不造另一套奖励账。实际验收前只标候选，不向玩家报“已开放”。

## 发布与复查

常规公共小修可在线按原授权完成：本次前像 E/F、当前场地无冲突、精确改动、原UUID、真实读回。配置热更新先解析、隔离、保留旧有效定义；不使用全服 `/reload`。JAR/加载器/权限、全服停启仍按 `resource/OPERATIONS.md` 当次维护流程，先备好具体候选和回退，再申请最终维护。

复盘看实际产物：新增可用入口/任务/房间数、完成率（含分母）、超时/未知、NPC重复卡点、玩家实际参与、奖励产出、MSPT/错误。任务调度 success 仅表示 Agent 调用结束；不能替代游戏完成。没有玩家样本就留待观察；不得编造“居民很喜欢”。
