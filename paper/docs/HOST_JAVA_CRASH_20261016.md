# 2026-10-16 Java 崩溃与 Windows 蓝屏

## 21:11 再次蓝屏：网络信息枚举路径重复出现

新转储`101626-12406-01.dmp`记录北京时间**21:11:29.007**发生`IRQL_NOT_LESS_OR_EQUAL (0xA)`，Windows于21:11:49重新启动；随后原Watchdog启动Paper，21:13:48记录就绪。没有对应的人工维护停服或User32 1074计划重启记录。事件6008中的旧关机时间与转储及连续应用日志不符，故不将它当作精确崩溃时间。

这次内核为10.0.26100.9711。已从微软符号服务取得与转储GUID匹配的`ntkrnlmp.pdb`，接受的输出为`irql-analysis-matched.txt`；最初网络等待和离线缺符号输出保留但不作归因。关键路径为：

```text
nt!RtlWeaklyEnumerateEntryHashTable
tcpip -> NETIO!NsiEnumerateObjectsAllParametersEx -> nsiproxy
当前进程：esrv_svc.exe
```

10月12日的`0x139/CORRUPT_LIST_ENTRY`已匹配分析也经过同一NETIO枚举函数、同为`esrv_svc.exe`上下文。这是重复的系统网络枚举线索，**不能仅凭当前进程字段证明Intel组件、网卡驱动或某块硬件就是根因**。微软对0xA的解释是内核在高IRQL访问无效地址或不适当的分页内存，仍须结合堆栈排查。[微软0xA说明](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/bug-check-0xa--irql-not-less-or-equal)。

本机`ESRV_SVC_QUEENCREEK`为自动启动的Energy Server Service，路径位于`Intel/SUR/QUEENCREEK`，Intel签名有效，没有Windows服务依赖项。Intel文档将SUR/queencreek相关组件归于可选的Computing Improvement Program。[Intel说明](https://www.intel.com/content/www/us/en/support/articles/000038259/software/software-applications.html)。只准备了该单服务的停用、前像和精确回退脚本，**尚未执行，须另获服主对Windows服务变更的确认**。复制转储的授权不等于停服务、卸驱动或更改BIOS的授权。

服主再次批准管理员弹窗后，新转储仅复制至E/F诊断目录，7470240字节，SHA256为`53A2A27631B9FBBF1A2EC82084885810E1B6C7AA92A541BAA5D0FA6F9653788B`。没有重启、改驱动或修改玩家数据。

重启后只读恢复16项通过：原0.4.47 JAR、36插件、可米原UUID及Eye、女神相机、认证心跳、三维度普通难度与keepInventory保持；21:49短样本平均MSPT为7.5。该结果不证明宿主长时间稳定。另于21:41:41发现`Accepted command travel could not be charged`运行错误，原始失败与新恢复报告分开保留，尚待复现，未据此补扣魔力或回写库存。

**与可米防刷屏踢出分开记录：**20:32–20:33日志显示她在同一秒连续提交多次`/mycli cast blink`并被`Kicked for spamming`踢出，随后重连；这与21:11整机蓝屏是两类事件。客户端须按技能冷却回执等待、串行发出下一次动作，重连后不重放旧动作队列。未解除全服防刷屏或对ag_前缀授予豁免。

## 20:00 更新：三类停启已分别核对

- **18:59维护停服**：服主批准后正常停止Paper，完成E/F完整冷备份`20261016-185943`，19:07安装AgentFriend0.4.47。这次是计划发布。
- **19:11:43 Windows蓝屏**：新转储`101626-12375-01.dmp`为`HYPERVISOR_ERROR (0x20001)`，当时进程为`vmmemWSL`，匹配符号后的堆栈经过`winhvr!WinHvpVpDispatchLoop`与`Vid!VidXSchedulerVpThreadStartRoutine`。这是宿主操作系统故障，不是Minecraft密码错误或插件主动踢人。微软说明该停止码表示虚拟机监控程序遇到致命错误，公开文档将四个参数标为保留；不将内部参数猜测写成已确认原因。[微软停止码说明](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/bug-check-0x20001--hypervisor-error)。
- **19:12与19:15系统更新重启**：User32 1074记录`TrustedInstaller.exe`以操作系统升级为由发起计划重启；19:18安装记录包括KB5127690和KB5127648。最后启动时间19:15:44。这些与前一条蓝屏分别记账。
- **19:17:39另一次Java异常退出**：`hs_err_pid8260.log`为C2编译线程在编译`NaturalSpawner.spawnForChunk`时发生访问冲突，堆约1.1GiB/4GiB，没有堆内存不足报告。原Watchdog随后恢复Paper，19:19:20启动完成。

服主只批准弹出管理员确认框复制新转储。实际仅复制这一份文件，E/F两份SHA256均为`EBB92EE65CF51404A8A152F5DA001A653C4F3D5583E78E670CD29D56FB7D6A1E`；没有改驱动、BIOS、虚拟化、WSL或Windows更新策略。接受的分析是匹配内核符号后的`hypervisor-analysis.txt`，最初符号路径错误的输出保留但不作为结论。

虚拟化堆栈和WSL上下文可以确定故障路径，**尚不能证明具体是WSL软件、驱动、固件或硬件导致**。此前PCIe WHEA记录仍只是调查线索。暂停同机GPU摄影压力验证，保留本次被蓝屏中断的实际拍照测试，不记为通过。

当前正式AgentFriend0.4.47，重启后正式状态30项和保存数据16项复核通过。Geyser在最终启动后恢复UDP应答；实机Java/基岩画面、16个自主Agent长时间稳定性仍需单独验证。新公共档案馆功能正在开发，尚未上线。

后续可米、鸣人及原Eye已自然回连，正式再次25项认证Java/Agent/真实Eye检查全部通过；原鸣人模型41671字节、4块游戏协议传输与SHA256、模型/动画/PNG核对通过。第一次重验等候离线鸣人的实体状态、另一个探针使用不合格式的资源请求ID，原失败回执保留，未据此改模型绑定或认证设置。

本次只读硬件信息为**i9-12900K、ASUS PRIME Z690-P D4、BIOS3401（2024-06-28）**。不要沿用旧项目文档里的13900K配置推断这台主机的故障；也没有刷BIOS或调整频率。

## 17:42 记录（以下保留当时的版本和恢复状态）

## 已确认

北京时间17:42:23，正式 Paper 的 Java 进程13212发生 `EXCEPTION_ACCESS_VIOLATION (0xc0000005)`，崩溃点在 Netty 内存缓存相关的解释执行代码。同一秒，本机刚启动的隔离 Paper 进程12952在 `ImmutableCollections$MapN.hashCode` 解释执行处发生同类崩溃。两者均使用 Temurin21.0.12.1+1，分别使用4GiB、2GiB堆。

可米这次断线是正式进程意外退出。记录中没有针对她的封禁、密码错误踢出或计划部署停服。原守护程序17:43:20自动启动原正式版本，17:44:14完成启动；正式仍为 AgentFriend0.4.42，拍照入箱0.4.46候选没有上线。

17:46实际测试账号通过原网关密码登录进入Paper世界并查询本人状态。认证心跳为ready=true，原五条管理员记录保持。可米个人奖励箱与崩溃前已落盘快照逐项一致，仍占95格；这不代表所有玩家最后一秒的动作都已核验或全部没有回滚。记录时可米尚未重新进入Paper，不能宣称她本人已完成重连。

## 调查边界

崩溃时主机仍有约23GiB可用物理内存，报告没有堆内存不足异常。过去一小时观察到128条WHEA17已更正PCIe错误，来源为Intel PEG10-460D；10月12日拓扑记录表明该端口下连接RTX PRO5000及音频功能。此前蓝屏调查也保留了内存稳定性、网络驱动与PCIe方向，根因尚未确定。

WHEA的“已更正”表示硬件或固件在通知系统前已纠正该错误，不能直接据此认定显卡或内存导致本次Java崩溃。参见[微软WHEA错误来源说明](https://learn.microsoft.com/en-us/windows-hardware/drivers/whea/hardware-errors-and-error-sources)。两个独立JVM同时崩溃是继续检查共同运行环境的线索，也不能单独证明某个JDK缺陷或硬件损坏。

本次未改驱动、BIOS、内存频率或正式Java参数；未人为重启正式服、恢复旧世界或覆盖玩家账本。隔离服已退出，停止继续启动同机测试；新功能继续保留候选，正常冷启动验收未完成。主机稳定性处理需要另行安排维护，逐项验证。

## 证据

原生Java错误报告、正式日志、隔离启动记录和恢复摘要已校验保存到E/F两盘 `repairs/host-java-crash-20261016`，不进入Git。先前登录保护误授权事故是另一件已恢复的问题，见[认证事故](AUTH_OPERATOR_HEALTH.md)。
