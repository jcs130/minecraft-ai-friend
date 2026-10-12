# My Agent World 公网入口与维护

2026-10-12，分支 `experiment/agent-society-1.21.1`。可转发的连接说明见 [纯文字版](MY-AGENT-WORLD-PUBLIC-CONNECT.txt)。新服沿用原世界与登录策略。

| 入口 | 外部地址 | 路由目标 | 本轮验收 |
| --- | --- | --- | --- |
| Java 模组客户端 | `micro.kangqiang.site:28976` TCP | `192.168.3.163:28976` | 外部 Minecraft 状态应答，1.21.1 |
| Mineflayer / SDK | `micro.kangqiang.site:28977` TCP | `192.168.3.163:28977` | 外部 Minecraft 状态应答；LAN 普通账号真实登录、本人 SDK 状态及目录 |
| 基岩国际版 | `micro.kangqiang.site:28988` UDP | `192.168.3.163:28988` | 外部 RakNet 状态应答，26.52 / 协议 2193 |
| Java 距离语音 | `micro.kangqiang.site:28989` UDP | `192.168.3.163:28989` | 本机 SVC 随机挑战、Java 归属、配置和防火墙；外部声音未验 |

路由器现有 `MAW-Java`、`MAW-AgentGate`、`MAW-Bedrock`、`MAW-Voice` 四条 DNAT 已实际读回，WAN IPv4 与域名解析一致。旧 Paper 的 TCP 25702 → 25565、UDP 19140 → 19132 保持原目标。本轮只读取路由和 Windows 防火墙，未写规则。公网地址随拨号变化，给玩家发域名。

网页 / 对外 Numen MCP 仍只在家庭网段通过 `192.168.3.163:28984` 访问；本机原生 Numen HTTP/TCP 28989、Supervisor 28985 / 28996、基岩内部网关 28994 / 28995 保持回环。UDP 28989 与 TCP 28989 是两个不同接口。公网玩家通过本人 Minecraft 连接使用 SDK，无需开放管理 HTTP。

## 本轮故障与修复

语音配置已经将 `voice_host` 改成公网域名，旧守护校验仍要求 LAN 地址，触发正常存档停服与维护暂停。新增显式 `advertisedHost`，将广播地址与固定本机 UDP 绑定、无 DNS 依赖的健康探针分开；固定 JAR、配置漂移和其他语音限制继续校验。

Agent 网关原来在应用层只接受家庭网段。新增严格布尔 `publicGameAccess` 和一致的网关环境变量，只有明确开启后才接受公网 IPv4。网页的来源限制和管理接口未随之放宽。基岩内部网关从主网关复制配置时明确移除公网准入标记，继续绑定回环。

`services/service.json` 中的配置为：

```json
{
  "networkExposure": {
    "mode": "lan",
    "address": "192.168.3.163",
    "publicGameAccess": true
  },
  "voiceChat": {
    "host": "192.168.3.163",
    "port": 28989,
    "advertisedHost": "micro.kangqiang.site:28989"
  }
}
```

主 `gate` 的 `env` 同时保留 `GATE_LISTEN_HOST=0.0.0.0`、`GATE_LAN_SUBNET=192.168.3.0/24`，增加 `GATE_PUBLIC_GAME_ACCESS=1`。语音 properties 保留 `bind_address=192.168.3.163` 和 `port=28989`，只有 `voice_host=micro.kangqiang.site:28989`。未配置公网开关时仍采用原 LAN 默认行为；研究服不能开启公网语音广播或 LAN / 公网游戏模式。

登录仍按 [混合登录说明](MY-AGENT-WORLD-LOGIN.md) 执行：新离线账号先游玩、每次提醒设置密码，注册后必须本人登录；正版 Java / Xbox 原有验证保持。这是现有访客策略，不是邀请白名单。外部 Agent 应设置独立密码，等待认证成功后再调用动作。

## 维护与回滚

修改主配置前需协调停止主服和基岩两个原有 owner。基岩守护会检查主配置文件戳；主配置变化后只向旧 owner 发送 `resume` 会继续被保护性暂停。应先验证两份配置，正常 `shutdown`，通过 `maw_service_task.ps1 -Mode Start`（基岩加 `-Bedrock`）启动新 owner，再通过原 mailbox `resume`。不要强杀 Java、删除存档或解除 Agent 的 `autonomy.paused`。

防火墙只读检查：

```powershell
powershell -NoProfile -File tools/maw_lan_firewall.ps1 -Mode Status -PublicGameAccess
powershell -NoProfile -File tools/maw_lan_firewall.ps1 -Mode Status -PublicGameAccess -Bedrock
powershell -NoProfile -File tools/maw_lan_firewall.ps1 -Mode Status -PublicGameAccess -Voice
```

`-PublicGameAccess` 只支持 `Status`；会拒绝 Apply / Rollback / Plan，避免把现有公网规则当作旧 LAN 规则重写。要恢复纯 LAN，须同时恢复主配置开关、网关环境变量与语音广播地址，再由网络维护方撤销这四个新服映射和对应公网规则；保留旧 Paper 映射及 MCP 的 LAN 防火墙边界。优先回滚指定配置，不用整包旧存档覆盖维护后产生的玩家进度。

## 验收与保全

主 / 基岩通过原 owner 正常关闭并重载，当前 owner 分别为 `36da0fdc768549e2997b74396004ee5e` / `15a27f6abd484cb187fe1525f89af102`。主存档等冷备 32,431 文件、2,420,738,287 字节；基岩冷备 155 文件、158,571,330 字节，均通过 ZIP CRC 和逐文件 SHA256。保存在 `E:\QiandengJiSocietyLab\backups\public-access-20261012`；证据在同根 `research\public-access-20261012`，包含私有配置，不上传。

普通账号 `MawWANProbe` 在 LAN 的公网同一游戏网关真实登录，读取自己的 UUID、采集时间、背包与 111 原生 / 121 总操作，随后正常退出；没有派发游戏变更或模型任务。外部 `mcstatus.io` 三个实时结果均 online，Java / Agent 协议 767，基岩 2193。另一状态服务的基岩检测连官方测试服也失败，保留失败记录，未据此改网络。外部状态应答不等于外部账号完整登录或手机资源包像素验收。

35 个已装模组、私有模型与登录配置保持；`server.properties` 启动时仅改写日期注释，所有属性值一致；EconomyCraft 的在线活动数据正常更新。MawExplorer 原 round 464、自主暂停、历史行动账本前缀及旧 unknown 均保持。`health_mon --society` 的 `autonomy-active=false` 是保留的人为暂停，不能为让健康全绿而恢复模型循环。

Java 语音的实际公网认证、真人麦克风及听感仍需带客户端验证；没有把本机 UDP challenge 当成完整公网声音验收。
