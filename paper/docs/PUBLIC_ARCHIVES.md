# 公共档案馆、日记与持久资料

2026-10-16：AgentFriend **0.4.48候选，尚未部署**；正式仍0.4.47。源码、数据库与原版协议均已实现，发布仍按当次维护确认、预告、完整E/F冷备份执行。不要把隔离档案库或测试书复制到正式服。

## 玩家怎样使用

日记默认公开，是可持有、放箱子、交给别人或放在讲台上的普通签名书。数据库保存原文，实体书是可以流通的实物。没有日记专用登录账号、上传网站或新公网端口。

入口是技能罗盘→旅途指南→公共档案馆；也可在新村问旅堂右键已登记的阅览讲台。档案目录可阅读作者、标题、日期和正文，公共书箱用于借阅、捐赠实体书和空白书与笔。

```text
/mycli archive --help
/mycli archive status --json
/mycli archive list book --json
/mycli archive create 营地的第一夜|今天遇到新伙伴，我们一起看了河边的晚霞。 --request-id diary-20261016-01 --json
/mycli archive read <作品UUID> --page 1 --json
/mycli archive restore <作品UUID> --request-id restore-20261016-01 --json
```

`create`耗一本本人背包里的**空白书与笔**，在原槽位写成签名书，不要求额外空背包格。先保存数据库，回到游戏线程重新核对材料，才替换这一格。书名1–32字、正文最多10000个UTF-16字符；CLI还受各客户端命令长度限制。长文可用原版书与笔编辑、签名，服务端会归档实际签成的书及原分页。

旧`/mycli life write <书名>|<正文>`保留40–256字规则，改为复用同一个持久写书流程。新日记可短写；达到原40字标准的新原作才可记录原写作委托的证明。恢复副本、阅读与公告不会冒充新的写作实操。

需要在正文里写`--help`或`--json`时，用`--`标出正文开始，例如：

```text
/mycli archive create --json --request-id notes-01 -- 技能笔记|查命令可用 /mycli --help；--json 仅选择结果格式。
```

## 查询、公告和恢复

- `status/list/info`只读，不写书、不报名、不消耗物品。列表每页最多7项，正文用`read --page N`逐页获取，也会打开原版书阅读界面。
- `notice <标题>|<正文>`发布署名公告并写成普通书，消耗一本空白书与笔。正文只在公共目录和作品内阅读，不向公屏广播。奖励托管、物资或组队委托继续用现有`commission`，公告不冒充已托管的悬赏。
- `restore <作品UUID> [--version N]`耗一本空白书与笔恢复普通副本，保留原作者、版本和原文。原作不因副本丢失而删除；副本不会重新发摄影、考试、技能或公会奖励。
- `--request-id`应在一次操作重试时保持相同。同一写书请求返回原作品，同一恢复请求只登记一次打印尝试；不会重复扣材料或打印。没有提供标识时每条主动命令视为一个新请求。
- `durable=true`仅说明原文或打印尝试已落盘。`printed=true`才说明本次服务器确实替换了材料槽位；`stored_print_not_confirmed/print_not_confirmed`要先核对背包和作品，不能自动重放。进程在数据库提交与物品保存之间中断时，也不能把打印记录当作实物交付证明。

Agent默认收到一份私有`MC_ARCHIVE`结果；普通玩家默认中文，`--json`可明确选结构化结果；实际附身Eye只收简短中文。帮助仍遵循[CLI约定](CLI_CONTRACT.md)，不在登录提示里加入完整目录。

## 数据库保存什么

文件：`plugins/AgentFriend/archives/archive.db`，使用固定官方SQLite3.46.0.0驱动，已随候选JAR打包原命名空间、原生库与许可证；启动不依赖在线下载。驱动摘要在`build.ps1`固定校验。

| 内容 | 保存依据 | 恢复与边界 |
| --- | --- | --- |
| 日记、原版签名书、公告 | 真实作者UUID/签名事件、标题、完整正文、原分页、时间及版本 | 游戏内恢复实体书；不替其他人署名 |
| 照片 | 已保存的摄影纪念册记录、署名/故事/地点、原ImageFrame索引和地图ID | 保存可读取的原始PNG和地图切片；不只存URL；不重新生成考试照片 |
| 游戏履历 | 已落盘的公会任务结束记录、结果、阶段、真实证据及耗时 | 初次导入现存历史，之后归档新保存记录；不是完整录像、全部动作或聊天日志 |

照片及附件在一个SQLite事务内提交。原图缺失时明确记录`source_missing`；只有地图切片时为`tiles_saved`，有原始PNG时才为`original_bytes_saved`。不从外部URL抓取图片；只读取ImageFrame目录内经真实路径校验的原文件。附件按SHA256校验，不覆盖旧版本。

原生ImageFrame目录也会归档，因此旧手动导入图和超过实练纪念册64份上限的后续照片仍可保存。没有现场元数据的原图明确标记`sceneMetadataUnavailable=true`，不推断群系、走查或考试证明。它们保留原作者并默认仅作者可读；新日记仍默认公开。

新日记和公告公开；旧照片继续尊重原`published`状态，私有原片只供本人查阅，主动撤展及时拒绝其他人读原片。来源账本与照片字节的扫描均在单个、有界的后台队列中完成，避免在服务器主线程读图或扫描大配置。只归档真实已保存的记录，不采集密码、认证命令、私聊或模型内部提示。

数据库保留原作、版本、请求去重和打印尝试，不随实体书、实体照片或游戏短历史的清理自动删除。正常停服会等待队列并检查点WAL；异常退出由SQLite恢复已提交事务。故障后未提交的内容不冒称已保存。

## 场地与运营

候选利用已安装Chinese Village完整蓝图建成的新村**问旅堂**，范围X=-1124..-1112、Y=62..76、Z=-638..-620，主人仍为Goddess；东侧门保留。

- 阅览讲台：`(-1117,64,-634)`、`(-1117,64,-629)`、`(-1117,64,-624)`。
- 公共借阅/捐赠木桶：`(-1119,64,-632)`、`(-1119,64,-626)`。两只木桶和三处阅览讲台各自登记公共使用例外，建筑拆建仍受保护；讲台也会被领地系统按容器检查，不能只放开木桶。
- 两个书架、入口公告牌；保留原酿造台、门、道路、全部建筑及其他储物权限。

讲台坐标在`plugins/AgentFriend/public-archives.yml`配置。源码默认空列表，启动不会凭空建房或移动NPC。实体装修的逐块前像与原领地配置在E/F私有候选目录；只有正式发布和施工验收后才公布场地已经启用。

数据库包含在原完整服务器备份范围内。在线备份须使用SQLite backup API，不能只复制正在写入的主`.db`文件而漏掉WAL。回退JAR到0.4.47时保留`archives`目录和原作文件，之后重新启用同版本可继续读取；不要回滚玩家库存来匹配旧的数据库快照，以免复制物品。

## 验证

```powershell
./paper/plugins/AgentFriend/build.ps1
./paper/plugins/AgentFriend/test-archive-store.ps1
./paper/plugins/AgentFriend/test-cli-contract.ps1 -PluginClasses ./paper/plugins/AgentFriend/build-0.4.48-mc-1.21.1
# 仅隔离服25914/25915；探针要求指定测试MOTD：
$env:MC_ARCHIVE_TEST_SERVER='E:/MC/staging/world-expansion-20261016/full'
$env:MC_ARCHIVE_TEST_OUTPUT='E:/MC/ops/repairs/public-archives-20261016'
node paper/probe/public-archives-stage.mjs
node paper/probe/public-archives-compat-stage.mjs
node paper/probe/public-archives-cold-stage.mjs --snapshot
# 正常停止并原样重启隔离服之后：
node paper/probe/public-archives-cold-stage.mjs
```

数据库25项与CLI80项通过。最终同JAR的普通Java/Mineflayer23、物品移动/断线/原版签名7、实际Eye/基岩2193协议7、冷重启与公共阅览11项通过；场地装修26项有逐块前像。早期把命格书也计入“写成的日记”、原生NBT的长字符串摘要被误当完整结果，以及阅览讲台缺少容器权限的失败均保留；最终按作品UUID、实际槽位、原生标量和普通访客验证。Java/Mineflayer、实际附身Eye及基岩2193协议使用同一原版书/菜单；手机/Xbox真实画面没有冒称已验。

179项验证及同摘要联机、兼容和冷重启结果见[候选清单](../manifests/public-archives-candidate-20261016.json)。私有目录：E/F `repairs/public-archives-20261016`；运行数据库、原照片、测试书和第三方JAR均不进入Git。宿主蓝屏另行调查，候选验收不代表宿主稳定；正式未安装档案库或装修讲堂。
