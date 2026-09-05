# 方舟女仆音色包（TLM 声音包 × 6）

2026-09-06 造物主圈选 6 干员：佩佩 / 贝娜 / 桃金娘 / 澄闪 / 阿米娅 / 德克萨斯。
明日方舟官方中文 CV 台词 → TLM（Touhou Little Maid）声音包，给萌萌的女仆换嗓。

## 成品

- 6 个 zip：`ark_{pepe,bena,myrtle,golding,amiya,texas}-1.0.0.zip`（各 129-141 条 ogg，vorbis/22050Hz/mono，对齐官方包规格）
- 运行时分发位：`ops/docker/shadow/data/packs/`（面板 `/packs/<name>.zip` 路由读这里）
- 原件副本：`tmp/tlm_packs/`（不入库，可由脚本再生成）
- 下发 URL：`http://192.168.3.133:9090/packs/ark_<id>-1.0.0.zip`（写进 `ops/docker/shadow/mc/config/touhou_little_maid-server.toml` 的 `ClientPackDownloadUrls`，该目录 git 不跟踪，改后需 `docker restart shadow-mc`）
- 客户端安装：游戏内 女仆菜单 → 资源包下载 → 选中下载 → 对女仆切换音色（零手动装文件）

## 台词 → TLM 事件映射（37 条源全铺满）

| TLM 事件 | 方舟台词源 |
|---|---|
| ai/tamed 驯服认主 | 干员报到、任命助理、任命队长、信赖触摸、戳一下 |
| ai/find_target 发现敌人 | 选中干员1-2、行动出发、行动开始、部署1-2 |
| ai/hurt 受伤 | 作战中1-4、行动失败、非3星结束行动 |
| ai/item_get 捡东西 | 3星结束行动、完成高难行动、精英化晋升、编入队伍、观看作战记录 |
| ai/game_win / game_lost | 三星结算系 / 行动失败系 |
| environment/morning night snow | 问候、新年祝福、闲置、进驻设施、生日 |
| mode/idle 闲聊 | 交谈1-3、信赖提升后交谈1-3、晋升后交谈1-2 |
| mode/attack range_attack danmaku | 行动开始、作战中1-4、部署、选中干员 |
| mode/feed feed_animal farm furnace torch shears milk brewing extinguishing | 交谈系/问候/新年（工作音复用日常台词，听感自然） |
| ai/death | 行动失败、非3星结束行动 |
| other/credit | 干员报到 |

各干员 label 集略有差异（贝娜无「戳一下」等），缺失事件留空——TLM 跳过不播，与官方包跳号行为一致。

## 再生成流程

1. `python tmp/fetch_full_voice.py` — 抓 6 人全量台词 JSON（biligame wiki api.php parse，label+音频 url）
2. `python tmp/make_tlm_packs.py` — 下载源音频 → ffmpeg 转 vorbis/22050/mono → 按 ASSIGN 映射铺事件 → 写元文件 → 图标（干员页立缩图裁脸 64x64）→ zip
3. `python tmp/fix_icons.py` — 图标单独重做+重 zip
4. 拷 `tmp/tlm_packs/*.zip` → `ops/docker/shadow/data/packs/`，改 toml，`docker restart shadow-mc`

## 坑

- biligame `Special:FilePath/头像_*.png` 404，头像改从干员页 HTML 抠 `alt="<干员名><数字>.png"` 的立绘 thumb，再 ffmpeg crop 上部正方+scale 64
- wiki 音频源直接可 ffmpeg；官方包 ogg 规格 vorbis/22050/mono（照抄）
- TLM 声音包无 sounds.json——事件名约定式，`assets/<pid>/sounds/maid/<cat>/<event><n>.ogg` 命中即挂
- IndexTTS 克隆参考：每人「任命助理」转 wav 存 `tmp/tts_refs/<干员名>.wav`（待 TTS 引擎升级时用）
