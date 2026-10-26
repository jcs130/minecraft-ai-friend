# 可恢复的运营台账

使用现有 `C:/Users/lzl19/.qwenpaw/venv-2.2.2-20261016/Scripts/python.exe` 运行 `E:/MC/ops/goddess-evolution.py`。默认数据目录为女神工作区 `state/world-evolution`。帮助 `--help`；输入文件 UTF-8 JSON。不要把另一套工作区镜像当现役。

命令：`status` 查 revision/项目/租约；`schema` 返回全部必填字段、预算、阶段与最小示例（不必为格式反复读Python源码）；`snapshot --out <新文件>` 保存实时只读摘要；`lease <run-id>` / `lease <run-id> --release` 协调施工；`record --file <JSON>` 原子记账。不自动运行游戏命令或把项目排队发布。

QwenPaw此机的 execute_shell_command 默认是 **cmd.exe**。不要用 `python - <<'PY'` 或把PowerShell语法直接交给cmd；用 write_file 写UTF-8的 .json/.py，再调用带引号的Python绝对路径。检查实际退出码与输出中的业务status，不把工具外壳success当作命令成功。

新项目示例（先读实际 revision；示例 0 不能盲用）：

```json
{"request_id":"npc-route-plan-20261026","project_id":"village-npc-routes","expected_revision":0,"category":"npc","title":"修复反复卡住的居民通路","phase":"planned","next_action":"查当前原UUID与脚下地形，分清固定NPC和普通村民","evidence":[]}
```

类别：story/npc/village/exploration/dungeon/operations。阶段依次 planned → surveyed → staged → applied → verified → reviewed。被阻塞写 blocked+reason；已发命令但结果不明写 unknown+reason，保存原 request/action ID 和 next_action（下一安全只读查询）。不得因进程结束就记成功。blocked 恢复后仍须核验，不借状态跳过步骤。

同阶段可用新的 request_id 更新证据与下一步，不为更新计划虚升阶段。blocked 只能先恢复被打断的阶段；staged 发出写操作但结果未知可直接记 unknown，不必先声称 applied。unknown 先查原动作：确认落地再 applied；只有从 staged 转入且确认未落地时可退回 staged。不能从 unknown 直接 verified。

planned 之后 evidence 必须引用本机真实绝对文件路径与 sha256（最多 20 份，每份 ≤16MiB）。文件内容保持不变；更改需新证据。verified/reviewed 还要 checks，每项有 name、observed_at、expected、actual、passed=true 和 evidence_index；没有完成的验收不伪造全通过。reviewed 增加 outcome，写实际样本、使用率、完成/失败、性能影响和局限。证据校验只证明文件一致，游戏结论仍须原始回执支撑。

同 request_id 相同内容重复返回原收据，不增加记录；同 ID 不同内容拒绝。revision 冲突先重读合并。台账不自动清理历史；原生日记/记忆继续记录简短摘要与项目ID。租约没有自动超时抢占：另一次运行若遗留锁，检查持有任务与实际世界结果后由原 owner 释放。不要删除未知操作的锁来假装完成。
