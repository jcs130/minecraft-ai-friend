# 儿童陪伴模式（灯语女神 · 适龄语音互动）

2026-09-15 新增。目标：让白名单里的真人小朋友（当前是 6 岁的萌萌 / 登录名 `MengMeng`）能**直接对着麦克风说话**，由灯语女神用**适龄、温暖的语音**回应、陪聊、陪玩文字小游戏，并能**要东西就送到背包**。这是在现有女神语音管道上加的一层人设与准入，不新建角色、不碰结衣/自主生存/工程 Cron/施法罗盘。

设计动机与边界见 [[语言即接口](LANGUAGE-INTERFACE.md)] 与 [语音链迁移](VOICE-INTEGRATION.md)。本文只描述儿童陪伴这一条闭环。

## 它做了什么

复用现成链路，不改施法/馈赠的服务端规则：

```
小朋友说话（客户端 PTT 或语音激活，自己在 SVC 设置里选）
→ god-voice 录音 → 本机 ASR → godvoice/mic/outbox
→ voice-command-inbox（schema2 校验 + 白名单 + 在线 + 去重）
→ spoken-intent 判定为 conversation（不是明确咒语）
→ goddessChat(child 人设) → mc-herald 云端模型
→ reply / give → goddessSayPublic → speakViaGodVoice（TTS 从听者头顶播）
```

对儿童玩家相对成人路径的**三处差异**：

1. **适龄人设**：女神变成"温柔的大姐姐朋友"，短句、多鼓励、可陪玩数数/认字/猜谜/小知识/小故事；明确禁止恐怖、血腥、吓人、骂人、成人等任何不适合小朋友的内容；她知道自己只是游戏里的朋友，不假装真人，聊久了会温柔提醒休息、找爸妈。
2. **免点名准入**：成人语音闲聊必须先喊"女神"或用祈愿句式（`vipChatGate`）才进模型；小朋友不需要——白名单 + PTT/语音激活已经保证她是有意识地说话，任何被识别为 conversation 的话都会得到回应。
3. **可语音要东西**：成人语音路径是 reply-only（`allowGifts=false`），儿童默认 `allowGifts=true`，能直接说"我想要面包/一把剑"。**物品仍受服务端原有 give 白名单和冷却约束**（日常小物与木石铁工具/剑/盾牌等可给，钻石/绿宝石/金锭/合金/附魔书等贵重物不可随手给）。按用户明确要求，武器/装备照常给，让她更容易玩，不做删减。

最后一道防线 `sanitizeChildReply`：即使模型偶尔跑偏，输出命中明确不适宜词也会替换成安全的一句话。游戏正常用词（剑/怪物/打）**不**在拦截范围内，保证给装备、聊战斗不被误伤。人设 prompt 才是主控制，这道网只是兜底。

## 配置（家长可控，改这里不用动代码）

`config/child-companion.json`，经 compose 挂载到世界服务 `/etc/qiandeng/child-companion.json`，由 `CHILD_COMPANION_FILE` 指定：

```json
{
  "schema": 1,
  "enabled": true,
  "players": [
    { "name": "mengmeng", "displayName": "萌萌", "ageBand": "child", "allowGifts": true }
  ]
}
```

- `enabled=false` 或缺文件/解析失败 → 整个儿童模式关闭，按成人路径走，不会误开。
- `name` 与登录名大小写不敏感匹配（对齐离线 UUID 名）。
- `displayName` 是女神对她的称呼。
- `allowGifts` 设为 `false` 可让她只能聊天、不能要东西。
- 要加第二个孩子，往 `players` 里加一条即可。

## 怎么说话（触发方式由客户端自己定）

Simple Voice Chat 自带客户端设置界面，玩家**自己在游戏里选**按住说话（PTT）还是声音阈值自动触发（VOICE/VOX），项目不硬改 `voicechat-client.properties`。对小朋友，**语音激活（VOX）更省事**：张嘴说话就行，不用一直按键；代价是环境声可能误触，可在客户端调阈值。首次进游戏要在语音模组里完成麦克风设备向导。

陪伴聊天**不需要举杖**：法杖手势只在"施法"路径要，conversation 直接进女神。所以她手上照常玩、对着麦克风说话即可。

## 隐私边界（家长须知道）

- 录音 → ASR 转写全程在**本机**，不出门。
- 但生成式回复走**云端模型**（CodingPlan）——即她"被识别为要找女神说话"的那句转写会上云。本机不跑通用 LLM 是既定架构。
- 录音白名单仍只有 `MengMeng` 一人；`MicCapture` 是单解码器，多人同时说话会串音，所以这条**先只对她一个人开**最稳。

## 验收边界（诚实记录）

本轮**只做了离线验证**，未做任何游戏内/真人麦克风实测：

- 新增纯函数单测 `world/tests-ai/child-companion.test.mjs` 7/7 通过：人设选择、成人 prompt 逐字保留、reply/give JSON 契约不变、儿童 give 边界随 `allowGifts` 出现、技能书行、兜底过滤。
- 相关回归 `spoken-commands` / `spoken-intent` / `voice-command-inbox` / `goddess-*` 共 39/39 通过。
- `tsc -p tsconfig.gameplay.json` 严格类型检查 0 错（新叶子模块 `src/gameplay/child-companion.ts` 在其覆盖范围内）。
- 全仓 `tsc -p tsconfig.json` 的 152 个报错为既有基线，落点不在本次改动行；本次未新增类型错误。

**尚未验证**：真人麦克风采集、SVC 实际采音与扬声器听感、云端模型对儿童人设的实际输出质量、`give` 在游戏内真实入包、主动搭话（阶段 3）与事件触发/导航（阶段 4）都还没做。部署需要重建/重启世界服务容器以加载新挂载与 env（`world/src` 与 `bootstrap-world.mts` 是只读挂载，重启即生效；新增的 `config/child-companion.json` 挂载需 `docker compose up -d world` 重建容器）。

## 涉及文件

- 新增 `world/src/gameplay/child-companion.ts`：`resolveChildCompanion` / `buildGoddessChatPrompt` / `sanitizeChildReply` 及类型。
- 改 `world/src/mc-god.ts`：`Config` 加可选 `childCompanion`；`goddessChat` 用儿童人设并对儿童回复兜底过滤；语音 conversation 端口对儿童免点名准入并按配置开启馈赠。
- 改 `world/bootstrap-world.mts`：`loadChildCompanion` 读 `CHILD_COMPANION_FILE`，缺失/损坏按关闭处理，注入 `createGod`。
- 新增 `config/child-companion.json`；改 `compose.yml` 世界服务 env + 只读挂载。
- 新增测试 `world/tests-ai/child-companion.test.mjs`。

## 后续阶段（未实现）

- 阶段 3 主动搭话：进服打招呼 + 安静一会儿后温柔搭话（频率家长可调可关）。
- 阶段 4 游戏事件触发（天黑/饿了/血低）+ "带我去某地"复用已验收传送阵；战斗施法对儿童关闭，只留烟花这类无害的。
