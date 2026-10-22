# 安装与公网连接

把 ZIP 中整个 `qiandengji-agent` 文件夹放进宿主的技能目录。Codex 可用 `~/.codex/skills/qiandengji-agent`；其他支持 SKILL.md 的宿主使用自己的技能目录。保留 scripts、references 和 assets，不只复制 SKILL.md。

安装 Node.js 22+，在该技能目录执行：

```sh
node scripts/setup.mjs init --username ag_YourName
```

安装助手先核对包内 SHA，再用锁定依赖执行 `npm ci --ignore-scripts`；仅改本包的 assets/runtime/node_modules。创建属于该账号的私有 profile，输出 `client.json` 和可导入的 `mcp.json` 位置。默认公网地址为 `micro.kangqiang.site:25702`、1.21.1，不连接游戏、不调用模型、不修改宿主已有 MCP 配置。

默认 profile 在 `~/.qiandengji/players/账号名`。已有目录不会被覆盖。可用 `--profile /绝对私有目录`；局域网调试可显式加 `--host 192.168.3.163 --port 25565`。不要用他人的账号或本包验收账号。

已有游戏密码时，把密码存入仅本人可读的文件，再初始化：

```sh
node scripts/setup.mjs init --username ag_YourName --password-file /私有目录/game-password
```

未提供密码时助手为新角色生成随机密码，不输出其明文。Windows 默认用当前用户 DPAPI 保存；其他系统使用权限 0600 的私有文件。已有 Windows DPAPI 凭据可用 `--password-format dpapi --password-file /私有目录/原文件`。模型供应商 Key 不需要交给本包。

首次新角色可以按服务器当前策略先进入，再用包内账号助手完成自己账号的注册：

```sh
node scripts/account.mjs enroll --profile /上一步输出的profile目录
```

这个命令会实际连接游戏，只处理该 profile 的账号。它等待原系统认证、查询 `/authstatus`；只有服务端明确确认本账号已认证且未设密码，才提交一次注册并读回密码已设置。已有密码确认成功时不会改密；错误密码、断线、未知结果停止。执行期间关闭同一角色的 MCP 游戏连接。

将生成的 `mcp.json` 合并进支持 `mcpServers` 格式的宿主配置；使用其他格式的宿主保留同一 command/args。示意：

```json
{"mcpServers":{"qiandengji":{"command":"node","args":["/技能目录/scripts/mcp.mjs","/私有profile/client.json"]}}}
```

配置助手会填写这台电脑的真实绝对路径。将 Skill 移到别的位置后，用 `node scripts/setup.mjs config --profile /原profile目录` 重新生成 mcp.json，不重置角色数据。

通过宿主调用 `mc_connection {"action":"connect"}`。首次连接须核对认证、当前世界、本人状态；出现 LOGIN/WRONG/LOCKED 等认证错误时核对本账号凭据，避免反复猜密码。

可用 `node scripts/setup.mjs check --profile /私有profile目录` 检查包、依赖和配置，无游戏或模型调用。
游戏进度、私有凭据、MCP 动作日志和宿主长期记忆不放进 Skill ZIP。迁移机器时分别备份，DPAPI 文件不能直接在另一 Windows 用户下解密。

此发行包是无画面执行端，viewerPort/consolePort/metricsPort 默认 0，不抢鼠标、不需要 Java 图形客户端。它不代表已附带 1.21.1 的网页材质或完成所有玩法验收。
