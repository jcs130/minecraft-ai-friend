# 更换本人的皮肤和 YSM

只在需要换装时阅读。继续使用现有框架和同一角色；不重新注册、不更换游戏 UUID，也不需要网站密码、女神管理员凭据或 YSM 上传密钥。

## 已在服务器上的外观

普通皮肤直接在游戏里执行 `/skin help`、`/skin set <预设或正版玩家名>`；已有鸣人预设为 `afu_naruto`。不要加其他玩家作为目标。自己的PNG可用下面的上传助手；MC核心的本地预览换肤不等于向全服提交皮肤。

先读 `/appearance help` 查看服务器实际支持。AgentAppearance0.3.4起支持 `/appearance list` → `/appearance set <模型ID> [贴图ID]` → `/appearance status`，只改本人，不需要OP。旧0.3.3只有查询，不要反复试管理命令。冷却30秒，等待实际“已应用”回执；未知先查，不连续重发。Java三维YSM需匹配的客户端模组，当前原生链为1.21.1／YSM2.4.1。

## 使用邀请码的原身份

Skill 1.3.2 起自带外观助手；Node.js 22+。用原来的 `identity.json`，体验池中尚未认领的角色也可以使用。

```sh
node scripts/appearance.mjs status --identity-file /私有目录/identity.json
node scripts/appearance.mjs skin --identity-file /私有目录/identity.json --file /素材/skin.png --variant slim --public
node scripts/appearance.mjs ysm --identity-file /私有目录/identity.json --file /素材/model.zip --texture default --public
```

Windows 改用自己的绝对路径。`skin`／`ysm` 会上传并提交一次应用；随后运行同一身份的 `status`。只有服务器回执 `applied` 才确认该请求已应用；`queued`、`waiting_player`、`applying`、`unknown` 的退出码为 2，表示仍需等待或查询，不能当成换装成功。结果未知先查原请求，助手不会自动重复应用。

皮肤为 64×64 或 64×32 的标准 PNG，手臂选 `classic` 或 `slim`；默认 classic。YSM 为包含 `ysm.json`、模型、动画和贴图的公开原始 ZIP，`--texture` 可省略以选包内首张贴图。文件不超过 8MB，每类最多 4 份；Java 显示三维 YSM 需要兼容的客户端模组，网页经原转换链处理，基岩完整模型能力以实际投影为准。

`--public` 确认自己有权公开展示该外观；普通皮肤会送交既有签名服务生成原版材质。可加 `--label` 起名字，默认“我的皮肤”／“我的 YSM 模型”。普通皮肤和 YSM 可同时保留。

## 已有角色与旧客户端

主人在官网连接中心为本人已绑定的 Agent 新建“客户端凭据”，勾选“本人外观管理”，把凭据保存为本机私有文件。原有只读凭据不会自动获得换装权限。使用同一助手，改用：

```sh
node scripts/appearance.mjs status --token-file /私有目录/appearance-token.txt
node scripts/appearance.mjs skin --token-file /私有目录/appearance-token.txt --file /素材/skin.png --variant classic --public
```

私有部署可显式加 `--portal https://自己的门户域名`。Token 不放进参数、提示词或游戏聊天；接口只允许这份凭据绑定的本人角色。

## 查询、恢复与清理

助手在身份文件旁保存 `.appearance.json`，按角色和皮肤／YSM 分别保留原请求 ID。换装期间不要删除它；明确终态后可用 `--retry` 重新申请同一份外观。未知结果不重发。异常中止若留下 `.appearance.json.lock`，先运行 `status`，确认原进程已退出和原请求状态，再移除这个本机锁文件；保留身份和请求记录。

`remove --asset-id <编号>` 移除本人未使用的旧文件；不能移除当前绑定或仍待确认的外观，历史回执保留。状态需要机器字段时加 `--json`。

主人后来在网站认领体验角色，原外观、排队中的应用、API 身份和游戏数据继续保留。同步未在线时可保存文件；角色离线时等待本人在线，不反复重登或重传。

## 自己调用 HTTP

同源 HTTPS `Authorization: Bearer ...`，使用原 Agent API 身份，或带 `appearance.write` 的单角色 PAT；不附带 Cookie／Origin。根路径 `/api/v1/agent-access/appearance`，GET 查询；POST `/skin` 或 `/ysm` 传原始二进制，分别使用 `image/png`、`application/zip`，并带 `X-Appearance-Label`（URI 编码）、`X-Skin-Variant`、`X-Appearance-Consent: public-game-appearance`。

POST `/apply` 传先保存的 requestId、本人 assetId、可选 texture。GET 返回的 `/jobs/<requestId>` 查询原回执；DELETE `/assets/<assetId>` 移除未使用文件。身份从凭据确定，不能在参数中指定其他玩家。上传成功只表示保存文件；实际皮肤、模型、贴图、角色绑定与网页转换以最终回执为准。
