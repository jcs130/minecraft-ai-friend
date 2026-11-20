# 副本方块日志联机回归

使用全新的 Paper 1.21.1 隔离目录，实例只监听 `127.0.0.1:26736`。在目录的 `.journal-qa` 写入 `SYNTHETIC_DUNGEON_JOURNAL_ONLY`。测试插件会按这三项检查实例身份。

用 Java 21、Paper 的运行时 JAR 和 libraries 编译本目录的 `DungeonJournalFixture.java` 及 AgentFriend 的 `DungeonEditJournal.java`。将两个类及内部类打入同一个测试插件。插件描述如下。

```yaml
name: DungeonJournalQA
version: 1
api-version: '1.21'
main: org.afuhome.agentfriend.DungeonJournalFixture
commands:
  jdqa: {}
```

1. 启服，从控制台执行 `jdqa seed`，等到 `JOURNAL_QA_OK seed`。测试场地有一块石头、一处可搭建空位和一个有名字、有自定义数据的木桶。完成三处修改后，直接结束**这个隔离 JVM**。
2. 用同一目录重启，由普通 Java 或 Mineflayer 角色 `JournalBodyQA` 进服。在控制台执行 `jdqa hold`。它会把角色送到原来的石头坐标，发起还原，并验证新的写入已冻结。
3. 等两秒，执行 `jdqa release`。它验证角色仍能安全站立，临时工作台已经清除，原木桶的名称、自定义数据和第 11 号槽位的七个自定义名称绿宝石都已还原。角色随后离开该区。
4. 等两秒，执行 `jdqa check`。确认石块归位、日志已结清后，执行 `jdqa damage`。这一步在另一个合成场地制造日志校验错误。再次直接结束这个隔离 JVM。
5. 重启同一目录，依次执行 `jdqa check`、`jdqa fault`。第一条验证已确认还原的区块经过硬停仍然正确。第二条验证损坏的场地拒绝编辑和恢复，原始记录保留供修复。

每条测试命令在对应 `JOURNAL_QA_OK` 出现后才算通过。`JOURNAL_QA_FAILED` 表示断言失败。最终关闭隔离服。本夹具使用原生方块与容器数据，不生成正式角色、奖励或账号。
