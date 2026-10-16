# 2026-10-16 Java 崩溃与 Windows 蓝屏

## 22:15 根因排查进展：优先验证内存配置，保留网络与PCIe分支

**结论边界：已经定位最新蓝屏的检测路径，尚未证明最早破坏内存的组件。** 以下是同一主机的只读采集与现有转储对照，没有以改插件代替宿主诊断，也没有启动压力测试、停Windows服务或更改BIOS。

服主本轮已确认**最近换过或加过内存**。这与64GiB→128GiB的实测清单变化一致，但尚未取得换条后的BIOS/XMP前像。服主随后批准“现在能配合，安排维护”。第一次Windows确认返回取消，脚本未启动；服主明确批准重弹后，第二次确认通过，22:39:18已发180秒预告，预计22:42:18正常停服，再以原任务完成E/F冷备份。此时尚未完成备份或重启，不据授权宣称测试通过；后续实际阶段以私有`memory-maintenance-state.json`和原维护日志为准。方案见[内存排除验证](HOST_MEMORY_DIAGNOSTICS.md)。

| 优先级 | 本轮新增证据 | 能得出的结论 | 下一项可验证操作 |
| --- | --- | --- | --- |
| 1：内存配置稳定性 | 当前12900K、4×32GiB Kingston，SMBIOS报告配置速率3600；10月12日是4×16GiB G Skill，同样3600。最新坏链接值与候选链表头寄存器值相差1bit；另有内存压缩断言、虚拟化蓝屏和两个独立JVM同秒在不同方法访问冲突 | 需要先排除内存、内存控制器及其配置的不稳定；还不能证明哪根内存坏了或确认XMP开关 | 现场核对BIOS内存频率/时序/XMP，记录前像；经维护确认后仅恢复内存标准/Auto配置，进行离线内存检查并按条/槽隔离 |
| 2：TCP连接枚举/采集触发 | 已取得与转储GUID匹配的nt、tcpip、NETIO、nsiproxy公共符号；10月12日与本次均为`TcpEnumerateConnections → TcpEnumerateAllConnections → NETIO → nsiproxy`，当时进程均为Intel `esrv_svc.exe` | 重复检测路径成立；采集服务可能触发已有问题，仍不能把当前进程认作内存破坏者 | 已准备单独停用ESRV服务与精确回退，另行确认后做一个变量的对照；保留后续自然运行证据 |
| 3：独立PCIe链路异常 | 14:13至22:13附近的八小时采集得到815条WHEA17，均为已纠正错误，状态示例`CorrectableErrorStatus=0x1`、`UncorrectableErrorStatus=0`；当前PnP父链确认PEG10-460D下是RTX PRO5000 72GB，第二块3080Ti在另一根端口 | 显卡所在链路存在持续纠错，值得单独处理；没有证明它造成网络蓝屏或显卡已经损坏 | 维护时检查该卡插接、转接线及供电；有转接线时先按厂商要求排除。后续PCIe代际或驱动对照也一次只改一项 |

Intel公布12900K支持DDR4最高3200MT/s、最大128GB；系统报告3600高于该CPU公开DDR4规格，这不是“容量超出128GB”。**当前内存料号字符串`KF3200C16D4/32GX`没有取得精确官方数据表，不能只凭料号中的3200确定这批条子的额定参数。** 实际时序、电压和XMP状态须读BIOS或SPD；WMI的3600与1200mV只是固件报告，不能当作示波测量值。[Intel规格](https://www.intel.com/content/www/us/en/products/sku/134599/intel-core-i912900k-processor-30m-cache-up-to-5-20-ghz/specifications.html)。

### 最新坏指针能说明什么

匹配符号后的指令为`nt!RtlWeaklyEnumerateEntryHashTable+0x8d`读取`[rdx+0x10]`。陷阱帧中`rax=ffffd0042306d500`、`rdx=ffffd0062306d500`，两者XOR为`0x200000000`，只有bit33不同。前面的真实指令从桶头读取链接，随后访问链接指向的项。

这个差异支持继续检查数据/指针损坏，**不等于已证实一次物理内存位翻转**。小型转储没有保留该桶头和链接的原始池页面，`dq`与`!pool`无法读回，不能确认原始自链接、释放状态、写入者或故障DIMM。调试器也提示陷阱帧不保存所有寄存器，不使用零值的非易失寄存器猜测正常对象。10月12日0x139说明检测到链表不一致；微软明确指出损坏可能早于检测时间。[微软0x139说明](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/bug-check-0x139--kernel-security-check-failure)。

### 网络、驱动与存储交叉检查

- 当前物理网卡为Realtek Gaming 2.5GbE，驱动1125.21.903.2024；启用绑定列表均为微软组件，另有WSL/Hyper-V虚拟交换机。这不能排除WFP筛选驱动。
- 184个运行中内核驱动的文件身份已采集。另发现`wnfe.sys`（westone filter engine，1.0.0.7，签名有效）、Intel签名的`semav6msr64.sys`和网易签名校验驱动。它们在模块清单中，**没有出现在本次故障调用栈上**；不能仅凭加载状态或名字停用。`wnfe.sys`与具体应用的归属仍未核实。
- WFP详细状态只读查询被Windows以需要管理员权限拒绝，未取得筛选器/提供者完整清单；没有绕过权限或将这一缺口记作“没有过滤器”。
- 七天内选定disk/storport/NTFS错误与超时事件未检出；四块盘当前Healthy/OK，最新转储NTFS黑匣子没有慢I/O超时。这降低了现有存储证据的优先级，不能彻底排除间歇故障。
- 当前是小型转储（CrashDumpEnabled=3），自动管理页面文件、C盘约285GiB可用。更完整的内核转储会有助于保留损坏链表，但配置变更尚未执行，也没有故意制造蓝屏。30天内未检出Windows内存诊断结果，不能说内存测试已通过。
- BIOS仍3401。ASUS现有4003及后续ME更新说明已核对，但不会把面向13/14代的Vmin说明套到本机12代，也未下载刷写固件。先做可回退的内存配置验证；不同时更新BIOS、网卡、显卡和Windows。[ASUS固件说明](https://www.asus.com/supportonly/prime%20z690-p%20d4/helpdesk_bios/)。

下一次维护验证须先记录BIOS前像、正常停止并备份原服务。只改内存相关设置，不使用“恢复所有BIOS默认”来重置VMD/存储/启动项。离线内存测试要记录频率、条子组合、槽位、覆盖轮次和错误地址；有错误才据此按条/槽隔离。短时间无蓝屏或一次测试通过，均不单独宣告根因已修复。

原始证据和可回退方案均保留于E/F `repairs/host-java-crash-20261016` 的`root-cause-*`文件。服务器仍运行0.4.47，公共档案馆0.4.48源码候选已另行提交，未因本次诊断重启上线。

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
