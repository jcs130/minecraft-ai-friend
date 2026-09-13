# 独立服务器集成冒烟

脚本已准备，仅在确认 `qiandengji` 的 MC 与 world 服务就绪后运行。它不连接原 shadow 生产网络，不添加玩法/API。

## 准备

在 `D:\Projects\QiandengJi` 操作。先完成原存档私有快照导入；确保本项目 **world 服务停止**，再执行：

```powershell
python world/tests-ai/prepare_smoke_state.py --world-stopped
```

此命令只在本项目 `server/world-data/magic-state.json` 和 `server/mcdata/magic-state.json` 加入两个固定测试身份 `QDSmokeProbe` / `QDSmokeBody`，保留所有其他玩家条目；同名非测试条目存在时拒绝覆盖。QA 只预学现役羽落术 `feather_fall`，已有真实玩家的进度不重置。旧版本测试夹具中的 `appraise` 只在带本项目测试来源标记的 QA 条目中替换；当前法术表没有该退役技能。`world` 已运行时不能直接改文件，因为进程持有状态缓存。

启动 world 后再运行下方命令。测试需要 world 的 `rcon-secret.txt` 为独立服的凭据；不要将其值传入命令行或报告。欢迎、发书消息不计入成功回执。

## 执行

```powershell
docker compose -p qiandengji run --rm --no-deps -T --entrypoint /app/node_modules/.bin/tsx -v "D:/Projects/QiandengJi/tools:/checks:ro" -e SMOKE_EXECUTE=qiandengji -e SMOKE_PROJECT=qiandengji world /checks/smoke_ai.mjs
```

临时进程使用 `mc-world:2.1.38` 现有 `/app/node_modules`，读取本项目 `/app/src/rcon.ts`，只接受 `mc:25599`（游戏）和 `mc:25575`（RCON）。必须同时通过显式执行标志和本项目快照中的 `.qiandengji-smoke` 标记。不会从宿主生产 profile 读取凭据。默认总超时 90 秒，`SMOKE_TIMEOUT_MS` 可设 30000–180000；单步和清理也有超时。

检查顺序：命令树含 numen_act/skillchest/fly；Mineflayer 1.21.1 以原版协议登录，QA 客户端切换创造模式后打开真实技能轮盘 GUI；创建 Numen QA 假玩家并只读调用 get_self_status；将现役羽落术写入世界现有咏唱队列，读取本 QA 在提交时间之后的成功回执，再核对服务端实体确有 `minecraft:slow_falling`，以及技能台账成功消耗 8 点魔力。脚本先验证当前法术定义只有预期短时效果，不把投递成功或其他人的回执当成施法成功。

标准输出为 JSON 报告，成功 exit 0、失败 exit 1。最后关闭 Probe、dismiss 本次尝试创建的 Body，并验证 Probe 已离线。QA 的历史条目留在**私有测试副本**，不合并回源存档；避免在 world 活缓存上删改它们。

应将完整标准输出以 UTF-8 保存至 `reports/ai-smoke.json`，健康探针读取这个规范路径。2026-09-07 最终 botgate 版本上，全部 9 项实际检查及退出清理已通过。

## 女神游戏聊天

独立 QwenPaw 和 world 均健康后，使用 `node tools/smoke_goddess.mjs --execute qiandengji`。它从宿主启动同一个独立网络中的临时容器，让 `QDGoddessProbe` 登录并发送“问：这是连通测试，只回复连接成功”。仅当真实聊天发送者为 `Goddess`、正文包含本 QA 名和“连接成功”时接受回复；欢迎、技能礼包和请求排队提示均不计入。随后核对本次 QA 的 QwenPaw 会话构建、零工具及会话保存日志，报告写入 `reports/goddess-smoke.json`，不输出聊天历史。

女神测试与 AI/NPC 冒烟使用同一把文件锁，必须串行执行。它不创建 Numen 身体，退出时恢复该 QA 原游戏模式并确认离线。

若外部强杀进程导致 finally 无法执行，应只对这两个保留 QA 名清理：

```powershell
docker compose -p qiandengji exec -T mc rcon-cli "numen_act dismiss QDSmokeBody"
docker compose -p qiandengji exec -T mc rcon-cli "kick QDSmokeProbe"
```

确认没有测试进程后，再处理本项目 `server/world-data/.qiandengji-smoke.lock` 残留；不要运行批量清玩家命令。

## 离线检查

```powershell
node --check tools/smoke_ai.mjs
node --test world/tests-ai/smoke-ai-guards.test.mjs
python -B -m unittest discover -s world/tests-ai -p 'test_smoke_prepare.py' -v
```

这些只使用临时目录和纯函数，不连接服务器。离线通过不代表集成冒烟已经通过。
