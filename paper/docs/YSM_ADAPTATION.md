## 2026-10-28 大肥鱼已按蓝发鲸鱼娘形象重做

服主指出圆鱼理解错误后，查阅人物展示、全身裙装与表情图，将 `qd_dafeiyu`
更新为1.1.0：蓝发、鲸鳍耳、卷翘呆毛、蓝白女仆裙与水平鲸尾，补抱饭碗动作。
32骨骼/180方块，七项真实联机与11种独立WebGL状态通过；其他219模型保持。
本次未请求重启，未为真人或Agent改选择。人物原型/女仆形象分别署名上善无形、ZipZipPipe，
保留非商用二创边界；没有转换上传的加密模型。源与构建见[蓝发鲸鱼娘](../models/dafeiyu/README.md)。
Java GUI、完整官网和基岩真机画面未验；下方圆鱼已被替换，仅为历史记录。

## 2026-10-28 圆鱼1.0.0历史记录（造型方向错误，已替换）

新增 `qd_dafeiyu` 1.0.0，13 骨骼/139 方块、三款 128×128 配色与独立第一人称鱼鳍。
原生 YSM 2.4.1 Worker 已确认测试账号的真实分配，普通认证连接完整下载 11,791 字节资源，
几何/PNG/动画逐文件核验；独立网页 WebGL 三款配色及 11 种状态通过。
原 219 份模型和五位在线角色的选择保持；只让 `ag_AuthQA` 保留试穿外观，未重启服务。
源模型、确定性构建和使用指引见 [原创大肥鱼](../models/dafeiyu/README.md)。
这是从头制作的 CC0 模型，不是上传的加密“大肥鱼_1.1.ysm”的转换或复制。
原生 Java GUI、完整官网场景与基岩真机显示未验，不将资源下发当作这些画面已完成。

## 2026-10-17 NEKO 头顶修订1.0.1与相机已上线

Web逐面UV的上下转换错误导致下巴贴到头顶，原PNG没有漏色。共享渲染修复已推送mc-visual-console/main的70f3a3f5；服主追加要求的neko_yui/default修订1.0.1也已热更新，原四个上下表面拆为独立贴图面，旧Web不再显示头顶粉块。骨骼/表面/尺寸/PNG/动画保持，两个源文件变化，其余五文件字节一致；原NEKO选择及51份原生分配记录保持。新模型摘要66d756e4…cf81经1.21.1实际连接七文件核验。

服主单独批准后，仅女神桥正常重连，固定相机新包就绪；Paper/模型代理/Worker未重启。69项相关渲染/构建、3项模型变换、12项原资源及正式相机/Web5项、1.21.1模型协议3项检查通过。原生Java与基岩真机像素、远端已打开页面未冒称已验。原因、可分发包、完整哈希及回退见[NEKO_MODEL_REVISION](NEKO_MODEL_REVISION.md)。

## 2026-10-16 原生其他玩家模型自动补发af3已上线

小鱼换YSM2.4.1后已完成真实握手；另一问题是Freesia跳过握手前的其他实体模型，握手完成后漏补发。现已发布af3，在实际原生缓存初始化后补发同后端其他玩家模型，按连接去重并保留PLAY/代次检查。Paper1.21.1保持PID11548运行；原YSM2.4.1/协议2.4.0、模型与账号数据保持。

最终同摘要17时序、10隔离及10正式检查通过；正式延迟握手已实收鸣人的正确原生模型/实体ID。可米维护后离线待回连复验，小鱼实际Java画面需重连查看。下方2.6.5诊断为换版前历史，不能覆盖换版后已握手与漏补发的新结论。发布和回退见[YSM_PEER_SYNC](YSM_PEER_SYNC.md)。

## 2026-10-15 原生客户端2.6.5与现役桥接版本不匹配

小鱼确认Minecraft1.21.1 / YSM2.6.5。当前Paper使用Freesia2.5.1+2.4.1-af2和Fabric1.21.1 / YSM2.4.1 Worker，原生频道是yes_steve_model:2_4_0。Minecraft版本一致不能替代YSM协议一致；当前桥接不能直接服务2.6.5客户端。实际22:45/22:58连接有Worker握手发送，却没有小鱼的客户端handshake_request日志；可米与鸣人的模型绑定均为confirmed。不能把Web资源确认或Worker连接正常当成原生Java客户端已完成同步。

当前可用的匹配客户端下载：[Fabric1.21.1 / YSM2.4.1](https://modrinth.com/mod/yes-steve-model/version/1cHRrrpZ)。2026-10-15核对[Freesia最新发布](https://github.com/YesSteveModel/Freesia/releases/latest)仍指向2.5.1+2.4.1；没有因此直接替换现役服务。若保留客户端2.6.5，需完整适配代理、Worker及消息格式并隔离实测，不能只改频道字符串或更换Worker的YSM JAR。小鱼换版后的原生画面仍需实测，不宣称本次已修复客户端。

## 2026-10-15 可米猫娘面具与平面闪烁修正已热加载

沿用 cormy-winefox-cream / cormy-cream 和原UUID，采用 jcs130/cormy-live2d 固定提交670fa1c的1.2.1-preview-cat-depthfix。只替换主模型与第一人称手臂几何，去除狐狸面具，1259对共面薄片居中加厚0.01模型单位；猫耳、头发、尾巴、UV、动画、2048贴图、0.8比例和CC BY-NC-SA4.0署名保留。现役兼容化ysm.json不覆盖。17份文件实际落盘核对，恰有2份改变，其余15份字节一致；绑定model/texture/mandatory保持安装前当前值（mandatory=false，不强行改回历史true）。

- main.json实际SHA256：adae9772b1851f920935ef081d432524c51c068dc6f1bc9bc946c3a21f7a3b4a。
- arm.json实际SHA256：c0092ab7ee1ad08a0f70e8df6681b90d7c6b8b76b15e729038b9e484fc51acf8。
- 既有稳定扫描器自动原生重载，Worker状态confirmed；真实Mineflayer连接收到62块754001字节资源，SHA256 5c201ee53bab0f11f9ab80aa2370603a034dc5e0e9873051a9ed34c17ea87bd2，逐文件摘要与现役源一致。不是只根据预期after值报成功。
- E/F repairs/ysm-cormy-mask-depth-20261015含17份完整before/after-model、安装/原绑定/实际投递回执。Paper/Proxy/Worker均未重启，也未操作可米客户端；客户端像素由其运行端另行验收，本机不以资源投递代替画面。
- 回退只用before-model的两份几何在核对当前摘要后替换，沿相同扫描器重载，核对真实状态/分发；不覆盖其他纹理、玩家绑定或存档。

# YSM 外观桥接（2026-10-11已上线）

2026-10-15登录阶段修复已上线：服主确认并提前180/60/10秒提醒，原维护锁与真人/副本门禁、E/F模型服务冷备份完成后，Freesia更新af2；Paper保持原PID6372运行。17项时序、43项隔离联机与20项正式联机通过，修复登录大厅提前握手导致原生YSM回复跨入configuration的时序；39账号认证字段、51份绑定、172模型资源保持，女神和鸣人恢复。原生Fabric界面完成同步仍待可米重连复测，详见 [YSM登录阶段](YSM_LOGIN_PHASE.md)。

2026-10-15补充：`ag_NarutoPi` 已同时绑定普通鸣人签名皮肤 `afu_naruto`（slim），原生保存和实际普通游戏连接profile下发核验通过；现有 `qiandengji_naruto/skin` YSM分配保持。两份外观各走原有路径，无需重启。普通皮肤并非完整基岩YSM适配；详见 [Agent角色皮肤](AGENT_SKINS.md)。

## 2026-10-14：鸣人专属模型已热绑定

`ag_NarutoPi` 原 UUID `3a0d9481-2a8f-3bdd-9f56-b5d57c7aafd0` 已原生选择 `qiandengji_naruto` / `skin`，`mandatory=true`。沿用旧千灯纪的“鸣人·木叶忍者”方块造型：黄色碎发、木叶头带、橙黑衣和忍具包；恢复原构建器与 CC0 的 YSM `misc/2_steve` 骨架，主体 67 骨骼/49 方块、第一人称手臂 14 骨骼/10 方块，比例 1。主体几何 SHA256 与旧清单一致（`f2d6c96ff3fa1e2ee8a6f6d78f9a695f74fad6ae5588067bc6745448acdcde8f`）。皮肤取自旧记录的 [Mojang 纹理地址](https://textures.minecraft.net/texture/e5fe33c4101093cbd1eb0b961b25b9c3990726f1b7f23f3578dc3f1b6e31b296)，64×64 PNG 原样复制；其编码字节与旧本地 PNG 不同，不冒称找回了旧 PNG 的相同字节。角色与皮肤权利仍归原权利人，不提交第三方模型或贴图。

现役 Worker 2.4.1 已确认，Freesia 原生 NBT 保存读回通过；51 份既有绑定只有鸣人的三项授权外观字段改变，159 份旧模型文件保持。普通认证 Mineflayer 连接完成 9 项检查，实际收到 4 块、41671 字节网页资源，包含主体、手臂、主动画和原 PNG，SHA256 `f3dd67deb8ac8ce2c877ef3eabd151de4495cacb4b2355f8bfc8303a57e9bd62`。Paper、Proxy、Worker 均未重启，绑定期间原玩家认证会话保持。远端网页、原生 Java 和手机/Xbox 实际画面未验收。

基岩离线转换器可保留全部 67 骨骼/49 方块与原 64×64 贴图；现役扩展仍返回 `YSM_BEDROCK_SOURCE_REVISION_UNAVAILABLE`，尚未完成实际下发，不能把离线转换通过称为基岩已支持。原始动作资源保留；完整原生攻击、吃喝等动画等价也未作本次验收。

私有 E/F `repairs/naruto-ysm-live-20261014` 保存前像、构建来源、转换、真实资源投递及原生保存核验。回退时，玩家在线后在原 Worker 控制台执行 `ysm model set ag_NarutoPi "default" default false`，核对实际状态及保存；这也恢复原 `mandatory=false`，不要直接覆盖在线 NBT。旧模型文件无需删除。

## 2026-10-13：基岩高清资源包候选开发

新增 Geyser 扩展 0.2.0 隔离候选，复用真实玩家实体属性，保留可米 2048 原 PNG/几何与比例，接入原动作和手部物品；明文模型上传/替换自动生成新资源包，原游戏连接下载，每连接固定摘要防止旧槽位串模。正式服未部署；协议 2193 原型与手机/Xbox实机、完整原生动画等价分开验收。配置、测试与回退见 [基岩高清外观](YSM_BEDROCK_RESOURCE_PACK.md)。下方可米模型正式绑定记录与此前基岩限制仍按对应正式版本阅读。

## 2026-10-13：可米奶油酒狐模型已热绑定

`ag_CorMy` 原UUID `822d173a-7181-3b9b-be60-804f29b24ecc` 已由原生控制台选择 `cormy-winefox-cream` / `cormy-cream`，保留 `mandatory=true`。实际Worker状态与原生NBT保存一致；真实Mineflayer连接收到62块、758175字节资源，SHA256 `71b860e7c3fac6a29d9270bed0bfc52291e4a26994e31799cfd61cc6e276927c`，投递几何、主/手部/额外动画和2048原PNG逐文件核对。43份原绑定仅可米授权外观字段改变，142份旧模型文件保持；本次未重启Paper、Proxy、Worker或可米主程序，绑定期间可米/Eye/女神原认证会话保持。远端网页实际画面和原生Java客户端像素尚未验收，资源送达不代表画面已完成。

定稿源ZIP为 `CorMy-WineFox-Cream-1.2.0-preview.zip`，1305004字节，SHA256 `8e70b0c8d4ab151cf0982c17ab3fff3916c579e74f4ef0151ecb90d4bdef5fb3`，原16文件留存不改。安装副本仅有两项兼容处理：将仅含 `uv` 的贴图对象规范化为等义路径字符串（现役网页桥接器仅接受字符串）；原生YSM2.4.1首次热载拒绝WebP作者头像，因此保留原WebP、新增像素相同的128×128 PNG并更新头像引用。两种贴图声明均为[官方spec 2格式](https://yesstevemodel.github.io/wiki/struct/)；不能对带normal/specular的PBR对象无条件抹去字段。角色几何、UV、动画、2048贴图、0.8比例、署名和CC BY-NC-SA 4.0许可保留，模型源自酒狐二创。

基岩仍未支持本模型：离线转换器明确拒绝2048贴图 `YSM_BEDROCK_SKIN_DIMENSIONS_UNSUPPORTED`，现役扩展另返回源版本不可用，未降采样或宣称手机/Xbox显示。旧 `cormy/cormy` 保留；需要回退时在线通过受认证控制台 `appearance admin set ag_CorMy cormy cormy`，不要覆盖正在使用的NBT。私有E/F `repairs/cormy-winefox-cream-live-20261013` 保存安装前原绑定/模型源、首次加载失败、兼容差异、真实投递和最终保存核对；此前 `cormy-winefox-cream-20261013` 是未安装的准备快照，保持冻结。

---

2026-10-12：原手部/额外动作资源与模型比例修正已正式部署，AgentAppearance **0.3.2**，女神相机同步当前共享资源；见[联合发布](COMPLETED_FEATURES_RELEASE_20261012.md)。远端Web仍须更新宿主桥和重建；完整Java/基岩动画等价仍未验。下方候选状态是此前测试时点。

## 2026-10-12：Web 动作、持物与比例修复候选

**正式当前AgentAppearance0.3.1；本轮0.3.2和新版网页/相机尚未部署。**旧网页只使用Worker的自定义动画名，原模型的表达式/曲线会失败，资源转换还漏发手部动画，且没有手持物挂载。新候选完整保留声明的main/arm/extra/fp_arm动画和控制器源文件，经原游戏连接按需发送；不改变玩家绑定、客户端玩法或原资源几何/UV/PNG。

共享Web现在从同一Mineflayer连接观察真实移动、装备、挥手/受击与头部朝向，按原动画分层播放待机、走路、奔跑、跳跃、潜行和手部动作。支持有界Molang算术/变量/原时间线、pre/post与Catmull-Rom曲线；尾帧跨帧清理连招变量。主副手使用原模型定位骨骼和原1.20.6物品模型/贴图，换物、空手、迟到资源与下线释放；名字抬高避开猫耳。合并物品面，减少多人绘制批次。未知表达式、复杂控制器和特殊动态物品明确报告，不称完整原生像素或装备等价。

大小候选只调整两份已知模型定义的等比scale：可米0.7→0.82，NEKO0.9→1.0，含耳朵约2.22/2.20格；与成年村民并排核验，脚贴地。尚未改正式模型文件或玩家碰撞箱，不对任意用户上传模型强行统一大小。

23项Web/动作测试、使用原资源的41项独立1.21.1回归、8项原动画逐字节传输检查通过。真实隔离Proxy/Worker+Mineflayer4.39在浏览器照片渲染页完成可米/NEKO待机、走路、挥剑、双手剑/火把、换石块、停止、本人挥手、名字避让与下线清理；保留实际PNG/WebM。不是原生Java完整场景对照或手机/Xbox动画验收；基岩限制继续按下节执行。

上线需要更新代理0.3.2与相机固定运行目录，并热重载两份模型定义；远端LAN网页必须另行拉取共享源码、包含新增`viewer-ysm-motion.mjs`、按原1.20.6/qiandengji资产重建后重启原宿主，才能取得动作和手部资源。正式维护/模型数据改动仍须服主确认。候选与回退摘要见[清单](../manifests/ysm-web-actions-candidate-20261012.json)，私有回执位于E/F `repairs/ysm-web-actions-20261012`。

---

**历史上线记录：**服主授权先上线YSM后，原维护任务已完成停服、E/F `20261011-030654/.complete` 备份及五文件摘要发布，任务结果0。原身份网关转入私有Proxy 0.3.0 / Freesia 2.5.1+2.4.1 / YSM 2.4.1 Worker，Geyser扩展0.1.0启用；游戏插件后续已更新至AgentFriend 0.4.19、CortiEyeMirror 0.1.12。四个新增监听全部在127.0.0.1，无新公网接口。启动、停止、Watchdog、备份和回退见 [生命周期](YSM_LIFECYCLE.md)。

普通Java、Mineflayer和Eye无需安装YSM即可继续游戏。可分发的原始模型文件夹/ZIP自动稳定扫描、原生重载、转换为网页/相机资源，经原游戏连接按需传送；新增、换贴图、替换、删除无须重启Paper。玩家 `/appearance status` 查本人状态，`/appearance list` 查目录；服主通过本机受认证的控制台分配。仅上线服务不会替全部玩家选模型，普通皮肤保持各自绑定。

## 模型状态诊断（2026-10-11晚间）

**可米随后已热绑定：**服主明确要求分配原模型后，`ag_CorMy`（822d173a-7181-3b9b-be60-804f29b24ecc）已由受认证本机控制台执行 `appearance admin set ag_CorMy cormy cormy`。实际Worker确认modelId=cormy、texture=cormy、mandatory=true；原生保存流程随后将相同值写入原UUID的Freesia NBT。34份旧保存配置核对，除可米这三个字段外均保持。原模型包SHA256为`1b51e7da424fdf1a640f55aa3eb79e199b9b6bb8088c5dc974505159f0223806`，6块66691字节网页/相机资源SHA256为`0172677d20487635ca16a13a08242b8188ad5f619a0c135bc58a7d441403d5b2`，4份投递原文件摘要全部与原包一致。旧绑定及配置有E/F前像，未重启Paper/Proxy/Worker或改NEKO。远端实际页面需独立核验，不把资源完整送达称作画面已完成。

**这套可米模型的基岩限制：**原PNG是512×512，现有Geyser转换仅支持64×32/64×64/128×64/128×128，正式状态明确给出`YSM_BEDROCK_SKIN_DIMENSIONS_UNSUPPORTED`。当前基岩继续使用原皮肤；不能说这套模型已在手机/Xbox显示，也没有缩图或替换原骨骼。原尺寸Web/相机资源保持有效。证据见E/F `repairs/pending-fixes-release-20261011/cormy`。

`YSM_WORKER_STATE_UNAVAILABLE` 只说明桥接尚未取得这个角色的原生模型状态，不能单凭此码认定Worker故障。未绑定自定义模型的默认外观也会出现此状态。需分别核对控制器连接、实际角色分配和资源传输。

分配前的实查：Proxy/Worker保持原进程；可米ag_CorMy、ag_NEKO及Goddess当时已保存的YSM配置均为default/default、mandatory=false。可米此前绑定的是普通皮肤，并不等于绑定YSM。旧测试账号原有default_boy/blue模型仍在，本次以原UUID重连即收到Worker确认的模型、实际Paper实体ID；完整下载4块39828字节资源，压缩包及5个原始文件SHA256均匹配，故不是全局模型服务中断。可米的当前绑定以本节新增记录为准。

AgentAppearance **0.3.1候选尚未部署**：保留原`available`、原因码和协议版本，新增`workerConnected`（仅控制器连接）、`stateStatus`和中文`message`，区分等待本角色状态、控制器离线、确认成功和不支持。既不把等待状态宣称为默认模型已确认，也不据存档伪造实时模型。`/appearance status`先给中文说明，再保留机器回执。Web观察适配保留这些诊断，且未确认模型时不再误报为资产仍在下载。

本次编译候选、8项Web协议/资源检查通过，验证正式只读链路；本轮不重启，正式仍为0.3.0。候选生效需要后续正常维护更新Proxy；远端Web还需自行拉取重建。选择已有模型和上传合法源文件本身可热生效，不能为了清除状态码随意给实际玩家选模型。首次资源探针把请求码写成33位而被正确拒绝，修正为随机32位后通过，原失败保留。私有回执位于E/F `repairs/ysm-worker-state-20261011`。

正式23项原版/Mineflayer验证通过：原三账号同UUID恢复、女神实际经Proxy连接、临时角色由Worker确认模型/贴图，以及4块39828字节资产SHA256完整匹配。55项旧插件、箱子物品、Minepacks原行、技能资格/支出、领地与来源配对检查通过；测试账号仅新增一条无物品身份行，白名单已撤销。真实基岩协议2193几何/UV/RGBA和上传变化14项、生命周期/故障/实际Eye/16连接14项保留隔离证据。不是16个自主LLM长期开荒验收。

**适配边界：**基岩可看见经Proxy分配的Agent/Java模型；基岩本人分配入口、完整Molang/控制器/装备及手机/Xbox真机外观未完成。远端Web仍须拉取并重建支持YSM的前端，服务端资源到达不代表远端页面已更新。女神相机已接到模型连接；本次正式核验的是资源链路，成片验证沿用此前独立隔离记录。

发布前两次预告与原版恢复均留回执：首次Windows维护任务按ANSI误读无BOM的中文UTF-8计划而拒绝，未替换组件；修正为显式UTF-8并在Windows PowerShell 5.1实际复制验收后完整重发预告。正式难度仍普通、三维度keepInventory=true。私有证据E/F `repairs/ysm-release-20261011`。下方是历史阶段记录，未上线状态不代表当前。

---

# 历史：YSM 基岩玩家外观隔离候选

**2026-10-11普通皮肤问题已独立修复：**可米ag_CorMy新皮肤已通过匿名签名生成并热绑定，原版profile实际投递验证通过；旧脚本把SkinsRestorer默认占位符误作真实密钥才导致403。该修复无需新密钥或重启，但不启用YSM。下述Proxy/Worker仍为候选；正式接入须完成原网关路由、单实例启动/停止/Watchdog、备份回退与实际发布。本轮服主要求不重启，未改正式拓扑。

2026-10-10 增量：基岩接收端已实现原模型几何/UV/贴图转换，通过原玩家皮肤包发送；上传、换贴图、替换和删除沿用已有自动触发器，不新增公网接口。实际 Geyser 与 Bedrock 协议2193客户端通过14项联调，原资源/状态约束11项通过，正常冷重启6项通过，带纹理属性角色的应用/恢复3项通过。原骨骼与128×128 RGBA逐项核对；默认皮肤的离线Agent回调路径已修复。额外纹理角色探针有旧物品组件PartialReadError，直连原隔离Paper路径亦复现；外观通过不代表该账号的全部物品协议已验。

**正式服整个 YSM Proxy/Worker 仍未启用。** 本轮使用仅隔离服允许的自签名客户端，不是微软认证或手机/Xbox真机显示验收；正式认证、入口与原Agent客户端不变。当前用于基岩玩家看见经Proxy分配的Agent/Java模型，直接进入Paper的基岩玩家自己的模型分配尚无入口。完整YSM动画、Molang/控制器和装备尚未支持，不称为完整原生画面等价。

实现、构建、限额、配置和回退见 [基岩扩展](../integrations/geyser-ysm/README.md)、[候选清单](../manifests/ysm-bedrock-candidate-20261010.json)。私有回执 `E:/MC/research/bedrock-ysm-20261010` 保留早期换肤回调失败、重复内容模型被原生拒绝，以及冷启动诊断状态晚于实际发包而导致首次脚本误判的记录；最终脚本等待真实状态后通过。下面各阶段记录按历史时点阅读。

---

# YSM 自动网页与相机资源适配（第二阶段隔离候选，0.2.0）

2026-10-10增量：已实现从用户模型源到游戏连接、Web渲染和照片的自动链路。正式服尚未接入私有Proxy/Worker；远端LAN可视化需拉取源码并重建。下方第一阶段记录按历史时点阅读。

## 用户模型与触发器

Proxy的私有 `plugins/agentappearance/models.json` 设置 `publicModelRoot` 为Worker实际 `config/yes_steve_model/custom` 绝对目录。只发布声明 `spec: 2`、`properties.free: true` 的原始文件夹/ZIP；ZIP支持单层外包目录，不落盘解压。不会扫描 `auth`、跟随符号链接或破解加密 `.ysm`。

每5秒扫描，两次稳定摘要后生成新版本，保留模型JSON、UV、原PNG与动画文件的逐文件SHA256。新上传、替换、删除会自动改变目录版本；只对新版本限频执行原生 `ysm model reload`，不重启Paper。写入中的文件继续使用前一已验版本。控制台 `appearance list` 查实际目录，`appearance admin set <玩家> <模型ID> <贴图ID>` 分配；只有控制台能改他人，模型变化由实际Worker NBT确认。

元数据经原游戏连接 `mcagent:appearance`；有网页订阅时才经 `mcagent:ysm_asset` 请求并分块传输摘要绑定的gzip包。无需公网HTTP、上传端口或新摄影账号；普通Agent不订阅不收资源包。浏览器只绑定自己连接实际跟踪的UUID和实体ID，刷新、下线、换维度和实体ID复用清理旧状态。

## 渲染与限制

共享Web与相机复用同一个2.4.1原模型渲染器，支持有界Unicode模型/贴图/骨骼名、原Bedrock几何/UV/PNG及支持的原数值动画轨道。原模型不是硬编码三个内置角色；用户ZIP新增与贴图替换已实际成片确认。未知Molang、动画控制器、装备和完整原生客户端画面仍未全支持，显示明确状态；`completeEntityParityVerified=false`。原生1.21.1/YSM2.6.5路径保持独立。

加密 `.ysm` 官方不支持反转为普通模型；要用于网页/相机须模型作者同时提供可分发原始文件夹/ZIP。私有/付费资源不自动发布。每模型原始8MiB/压缩2MiB、最多16张2048²PNG、浏览器32模型/32MiB缓存、单连接串行传输和超时；超过预算明确不可用，不拖住游戏连接。

## 本轮验收

真实Paper/Velocity/Worker：17项拍照与自动上传联调通过；1536×1536、169列完全网格化、2×2四张地图、真人无上传链接/机器聊天、新ZIP及贴图替换、准确地图扣除均通过。16个Mineflayer4.37.1受控连接均收到真实CLI和SHA验证模型包，未收到原生加密缓存；平均4.5ms、五秒最大19.8ms。不是16个LLM长期探索压测。失败的旧脚本等待不存在MC_STATUS已保留并修正为真实中文状态回复。

原目录/ZIP/稳定写入/删除/私有/路径/加密状态等10项Java目录检查通过；共享定向测试及正常冷重启另留本轮原始证据 `E:/MC/research/photo-ysm-web-20261010`，未覆盖第一阶段验收。手机/Xbox自定义玩家模型仍未完成，原命令/地图兼容与YSM实时身体显示是不同验收项。

部署需要把Proxy/Worker接入现有单实例维护和Watchdog后按原流程发布；不能仅复制JAR就改正式路由。相机0.4.11可独立部署，无代理时普通拍照照常运行。更新远端可视化：拉取 `mc-visual-console`，用其原1.20.6 `qiandengji` 资产路径重建，再重启原宿主，核验提供的bundle摘要；源码推送不等于远端已生效。

来源：[官方模型类型与加密限制](https://yesstevemodel.github.io/wiki/type/)、[原格式](https://yesstevemodel.github.io/wiki/struct/)、[原生热重载命令](https://yesstevemodel.github.io/wiki/command/)。

---

# YSM 适配：第一阶段隔离候选

2026-10-10。正式服仍为 Paper 1.20.6 / AgentFriend 0.4.10；本次没有部署、重启正式服或开放公网接口。实现位于 [freesia-optional](../integrations/freesia-optional/README.md)，共享网页实现位于 `jcs130/mc-visual-console`。

## 已实现

保留 Paper 和原 Agent 客户端，在现有身份网关之后加私有 Velocity/Freesia，另用 Fabric 1.21.1 Worker 处理 YSM 2.4.1。未安装 YSM 不踢人，普通 Mineflayer 不下载模型缓存；Geyser 暂时沿用原 Paper 路径。

- 模型设置关联实际玩家 UUID 和 Paper 实体 ID；实际 Worker NBT 确认生效。
- 控制台可分配 Alex/gsl、Steve/tartaric_acid、default_boy/blue 或 red；普通客户端可查询本人状态与目录，不能改别人模型。
- Worker 中断时继续游戏和登录；重启后限频恢复模型连接，不要求 Agent 重新登录。
- Worker 控制连接异步重连并在正常停服时清理，修复原版退出后的 Netty 线程残留。
- 原 Minecraft 连接发送只读 `mcagent:appearance` 元数据。共享 Web 适配校验版本、原 JAR 摘要、UUID 和实体 ID，并清理失效/换维度/断线状态。
- 每五秒刷新，网页宿主十五秒过期；网页故障回调不会打断游戏协议处理。

## 客户端边界

| 客户端 | 本阶段实际验证 | 仍待完成 |
| --- | --- | --- |
| 普通 Java / Mineflayer 1.20.6 | 登录、原 UUID、移动、玩法查询、实际大背包取放、死亡复活、不收 YSM 模型缓存 | 正式入口切换及长期游戏负载 |
| 已登记 Eye | 显式原生附身后 spectator/camera ID 正确；自己的连接跟踪到主人并收到模型状态 | 原机 watcher 经新正式入口的回连验收 |
| Java 1.21.1 / YSM 2.4.1 | ViaVersion 路径上的协议夹具实际完成握手并收到模型状态包 | 匹配模组客户端的真正模型画面、动作和装备 |
| Web 现代画面 | 接到真实 Worker 状态、正确绑定实体；1.20.6 候选 bundle 构建成功 | 原模型/UV/动画渲染、Java 对照、远端消费者更新 |
| 基岩 / Xbox | 隔离 Geyser UDP 入口响应，路由保留 | 真实认证登录/操作，以及独立的自定义玩家模型转换 |

网页明确显示模型尚未渲染，`renderAvailable=false`、`completeEntityParityVerified=false`。基岩目前显示普通皮肤；不能将资源包下载能力或 Geyser Pong 当成 YSM 模型兼容。

## 隔离验收

独立存档和回环端口，未调用 LLM。完整联机回归 **29 项通过**：身份/来源拒绝、原玩法 CLI、背包实际取放、移动、显式 Eye 附身、真实 Worker 模型、1.21.1 YSM 协议夹具、Worker 停止/恢复、16 个普通 Agent 同时查询和模型同步、死亡复活后的网页状态重建、Geyser Pong。

当时共 20 个受控连接（16 个负载 Agent、主人、同伴、Eye 和 YSM 协议夹具），最近五秒 Paper tick 平均 **4.9 ms**、最大 **15.8 ms**；一分钟最大 **66.2 ms**。这是一轮已加载区域的短测试，不代表 16 个 LLM 长期自主探索或新增 Worker 没有资源成本。

同一最终 build-af6 的正常冷重启共 **6 项通过**，实际保留原 QA 玩家 UUID、default_boy/blue 模型和 Minepacks 内三枚苹果，并成功取回。早期版本也曾重新登录核实三枚苹果在玩家库存、背包内为零；最终轮次复用了这三枚物品，没有补发。

保留失败记录：早期恢复只重试一次，因控制连接早于 Worker Minecraft 端口而失败，已改为五秒重试；第一次死亡轮询错过快速复活，第二次原版 kill 被原保护规则取消，最终用管理端 Essentials kill 触发实际死亡/复活事件。冷重启取出后立即读 `bot.inventory` 读到了旧窗口缓存，失败断言照留，重新登录后实际库存与背包证明取出已完成。

共享 Web 新增 **5 项**测试通过，连同原内容/声音桥接相关回归共 **26 项**通过、零跳过；根目录配置的 TypeScript 检查通过。单独强制检查旧 `mc-modern-viewer.mts` 时，基线与候选均有 **39 项既有类型错误**；新字段没有增加错误，不能把根目录检查称为所有宿主源码类型无误。

私有原始回执：`E:\MC\research\paper-ysm-20261010`，含每次失败、构建来源和最终哈希。最终 build-af6 补充了旧会话迟到回调的身份校验，并重新通过完整 29 项回归；早期 build-af4/af5 及其失败回执保留。第三方 JAR、存档、原图和运行回执均在 Git 外。

版本、源码及产物摘要见 [候选清单](../manifests/ysm-optional-candidate-20261010.json)。这是构建和隔离验收记录，不是上线公告。

## 下一阶段

1. 用匹配的 Java 1.21.1 / YSM 2.4.1 客户端对照真正的几何、UV、动作、装备和观战画面。
2. 为共享网页增加独立 2.4.1 原资产清单和模型映射，再接原模型渲染。已逐字节比较三组内置 CC0 资产，可复用一致的文件；不能把整个 2.4.1 协议直接当作原生服 2.6.5。
3. 单独实现并真机验收 Bedrock 玩家模型及资源包；先核查玩家实体的转换入口，再选择 Geyser 扩展方案。
4. 将私有 Proxy/Worker 接入现有单实例维护和 Watchdog，保持旧网关身份来源限制、Geyser/Floodgate UUID、所有存档与玩法数据，然后按原流程备份、预告、切换与发布复核。

发布与回退以 [维护流程](OPERATIONS.md) 和集成 README 为准；本候选尚未接入正式维护任务。

来源：[Freesia 架构和配置](https://yesstevemodel.github.io/wiki/freesia-plugin/)、[锁定发布](https://github.com/YesSteveModel/Freesia/releases/tag/v2.5.1%2B2.4.1)、[Geyser 实验实体 API](https://geysermc.org/wiki/geyser/custom-entities/)。
