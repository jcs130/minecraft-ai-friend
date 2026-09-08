# 女仆声音与模型核对

2026-09-07 本地审计与修复。检查对象为 D 盘独立整合项目，以及只读的原 `minecraft-ai-friend` 素材和 shadow 存档。完整逐包结果见 [maid-voice-model-audit.json](../reports/maid-voice-model-audit.json)，来源与输出哈希见 [voice-packs.lock.json](../manifests/voice-packs.lock.json)。

原先的 17 个自定义声音 ZIP 没有损坏，但 11 个方舟角色包沿用了佩佩的展示名称、说明和跨包图标引用；另有一位已有女仆绑定 ATRI，而该声音包未被导入。本轮已修正这 11 个包的元数据，并从原本地素材补入 ATRI。现在客户端、服务端和下载目录均有同哈希的 **18 个包、2304 个 OGG**。

## 已修复的显示名称

| 包命名空间 | 实际角色中文名 |
| --- | --- |
| `ark_amiya` | 阿米娅 |
| `ark_bena` | 贝娜 |
| `ark_durin` | 杜林 |
| `ark_golding` | 澄闪 |
| `ark_kroos` | 克洛丝 |
| `ark_luo_xiaohei` | 罗小黑 |
| `ark_magallan` | 麦哲伦 |
| `ark_myrtle` | 桃金娘 |
| `ark_paopao` | 泡泡 |
| `ark_texas` | 德克萨斯 |
| `ark_yueyue` | 跃跃 |

名字依据原 `tmp/make_tlm_packs.py` 与 `tmp/import_new_voices.py` 的构建映射，保留旧包 ID，避免改坏已有声音选择。特别是 `ark_golding` 对应澄闪，`ark_yueyue` 对应跃跃。`ark_pepe` 本身仍为佩佩，没有修改。

每个修复包仅更改三项：`assets/<namespace>/maid_sound.json` 的名称、说明及图标引用，以及 `lang/zh_cn.lang`、`lang/en_us.lang` 的对应名称和说明。中文标签现在为“角色名声音包”。原作者署名、版本、日期、所有其他 JSON 和其他资源字节均保留。

11 个包内原本就各有 `textures/sound_icon.png`，但这些图片与佩佩包使用的是同一份图像。本轮只把图标路径改为各包内实际存在的 PNG，保留图片原字节，**没有制作或替换成角色专属立绘**。共同图片 SHA-256 为 `dc82dae2b41d31b0288327e8c84eea8a94a98bca5f0f204f56dd2ff6e720f94a`。

## 18 个声音包的内容归属

12 个 `ark_*` 是方舟角色语音；另外六个是纳西妲、煊煊、苏打 Baka、籽岷、终末地企鹅和 ATRI。`tangyuan_sound` 的包内名称实际为“苏打 Baka 声音包”，应以此为准。

这些声音包可以供东方女仆模组使用，但 **18 个包中没有单独的博丽灵梦、雾雨魔理沙等东方角色专属配音包**。其中 12 个方舟 ZIP 只提供声音，没有附带对应方舟人物模型。籽岷和终末地企鹅 ZIP 各自附带一个 Gecko 模型，默认绑定各自的声音。

TLM 模组自带 `touhou_little_maid` 默认声音和 `littlemaid_peco` 声音；后者确实在本项目 TLM JAR 与自动解包资源中存在。自定义声音由当前 TLM 1.5.3 的 `CustomSoundLoader.loadSoundPack` / `loadSoundEvent` 读取 `maid_sound.json` 和 `assets/<namespace>/sounds/maid/...`，因此无需把没有原版 `sounds.json` 认作坏包。审计记录了攻击、闲置、受伤、驯服、天气等事件目录的文件数。

2026-09-08 补充：[发声链路调研](MAID-VOICE-PIPELINE.md) 区分附近玩家的预录事件音与只给主人发送的普通 AI 语音，并实证定位了本地 PCM WAV 与当前 TLM 解码器不兼容。先前 HTTP 合成验收不代表客户端可播放；该调研未部署格式修复。

## 已有女仆的声音绑定与补漏

对原 C 盘 shadow 与 D 盘副本的实体 region 做离线 NBT 扫描，各找到 3 位保存中的女仆，模型和声音选择相同。没有加载旧区域、传送角色或编辑实体。

| 保存中的模型 | 声音选择 | 当前资源情况 |
| --- | --- | --- |
| 博丽灵梦 `touhou_little_maid:hakurei_reimu` | `touhou_little_maid` | 模组自带 |
| 森近霖之助 `touhou_little_maid:morichika_rinnosuke` | `littlemaid_peco` | 模组自带 |
| 魔法酒狐，保存的 Gecko ID 带后缀 | `atri_sound_pack` | 本轮补入原 ATRI ZIP |

原 ATRI 包位于 `C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\tmp\atri_sound_pack-1.0.0.zip`，不在 `official_packs` 子目录，因而此前只导入 17 包时漏掉。现已将原包字节复制到三个 D 盘目录，并追加到本项目的 `ClientPackDownloadUrls`：

- `client/tlm_custom_pack/atri_sound_pack-1.0.0.zip`
- `server/mc/tlm_custom_pack/atri_sound_pack-1.0.0.zip`
- `server/public/packs/atri_sound_pack-1.0.0.zip`

该包 5,781,983 字节、226 个 OGG，SHA-256 为 `6088998be78e9963c429cef5d038f935c9712f7af519870f24718543d42a5864`。已有女仆仍保持原声音选择、主人和进度，不需要改绑定来使用补回的资源。

灵梦实体还保存了 TTS 参考 `/voices/touhou_little_maid.wav`；原本地 TTS 素材中确有该文件，为 16 kHz 单声道 WAV、约 1.52 秒。固定动作语音的 `SoundPackId` 与聊天 TTS 的参考音是两个独立配置。本次只核对路径和 WAV 结构，没有试听或推断其具体声优，也没有改聊天模型、参考音或任何私有配置。

## 东方人物模型

客户端的 `tlm_custom_pack/touhou_little_maid-1.0.0` 默认模型元数据中，现代东方 namespace 有 154 个模型条目，旧作 namespace 有 34 个，西方系列有 5 个。这是含变体的模型条目数，不等于独立人物数。另外存在 Gecko、作者展示、Minecraft 周年模型，以及 Maid Spell 附加模型。

保存中的灵梦和霖之助模型 ID 均能在当前模型元数据找到。魔法酒狐的内置基础 ID `geckolib:winefox_magical` 存在；保存值带额外后缀，本审计不会只根据后缀认定模型失效。鸣人、桐人等玩家外观属于另外的 YSM / Numen 皮肤链，不能拿这 18 个 TLM 声音包证明它们已经安装或可渲染。

## 可复现准备与验证边界

执行 `python tools/prepare_voice_packs.py --packs-only` 会按本项目下载清单寻找原 C 盘素材、应用固定元数据修复、验证并同步三端 ZIP、更新锁文件。此模式不会修改语音服务地址或 TTS 配置。正常准备模式也采用相同修复，重复运行不会覆回佩佩标签。脚本会在源元数据结构不符合预期、缺少本包图标、ZIP 损坏或资源发生意外变化时拒绝导入。

已经完成的离线检查：18 包 CRC、元数据与资源引用；三端哈希一致；2304 个 OGG 与原来源逐字节相同；11 包只变 33 个预期展示文件；所有其他图像与 JSON 未变；原 C 盘包哈希未变；再次执行准备脚本时 ZIP 和锁文件保持完全一致。`--packs-only` 运行前后 runtime 配置哈希也相同。仅追加 ATRI 时修改了明确的下载列表项。

实际下载目录是 `server/public/packs`，本项目没有 `resources/packs`。本报告没有将文件静态通过等同于实际播放通过：客户端声音选择界面、动作发声、TTS 播放和外观渲染仍应结合最新客户端验收记录判断。
