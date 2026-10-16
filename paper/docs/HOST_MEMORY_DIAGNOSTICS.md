# 宿主内存排除验证：待确认执行

2026-10-16，Paper千灯纪宿主为12900K / ASUS PRIME Z690-P D4 / BIOS3401。服主确认近期换过或加过内存；现有清单为4×32GiB，配置速率报告3600。当前没有执行本方案，没有排队重启或修改Windows启动项。

## 目的和判据

先验证内存配置与内存控制器稳定性，不把“换过内存”直接当作新条故障。10月12日旧4×16GiB配置也发生过蓝屏，最新转储又有坏链接指针；两者都需要保留。

12900K公开DDR4上限是3200MT/s。首轮采用SPD/BIOS的标准Auto配置，不强求四条大容量内存必须跑到3200，也不继续沿用3600进行对照。准确时序、电压、XMP状态先读BIOS；WMI报数不能代替现场核对。[Intel规格](https://www.intel.com/content/www/us/en/products/sku/134599/intel-core-i912900k-processor-30m-cache-up-to-5-20-ghz/specifications.html)。

一次只改内存配置。ESRV停用、驱动更新、PCIe代际和BIOS更新分别保留为后续分支，不在同一轮混改。

## 执行前由服务维护者完成

1. 取得本次**整机重启及现场BIOS操作**的明确确认。Windows内存检查期间整机不能提供Minecraft、模型、Web及其他服务，不能当作只重启Paper。
2. 发180/60/10秒预告，核对真人及活动副本，待安全退出/结算。核对所有待发布标记，禁止顺带安装候选插件。
3. 沿既有维护权限正常停止原服务并保留`auto-start.paused`。运行脚本`Stop`会建立暂停标记；对已停止的服务器使用原`Afu-MC-DailyBackup`备份，可保留停止状态。必须检查实际任务结果及E/F新快照完整标记，不能把18:59旧快照当作此次新备份。
4. 记录Paper、登录代理、YSM、女神、Eye、FOM及其他宿主服务的当前运行状态；FOM原来停止时不凭空启动。暂停标记在Windows恢复后继续保留，先读回硬件及测试结果，再正常恢复原服务。
5. 保存本轮WMI、蓝屏事件及BIOS前像。已有诊断证据位于E/F `repairs/host-java-crash-20261016`，仍需独立于世界备份保留。

本方案不提供可直接粘贴的自动重启命令，避免未经现场确认中断整机。现役维护脚本不改，不新增计划任务。

## 现场BIOS核对

1. 重启后按Del进入ASUS BIOS；需要时按F7进入高级界面，查看Ai Tweaker。不同BIOS版本标签略有差异，以实际界面为准。
2. 先拍照记录Ai Overclock Tuner、DRAM Frequency、内存时序/电压，以及Tool中的ASUS SPD Information。记录四根是否同一套、各槽容量及SPD；不要只按型号字符串猜额定参数。
3. 首轮关闭XMP配置，将内存频率与手动内存时序恢复标准Auto。确认没有残留强制3600；有不明确的选项先发截图核对，不手动提高DRAM、SA或CPU电压。
4. 保存前检查BIOS列出的变更，只应涉及此次约定的内存设置。保持VMD/存储模式、启动顺序、虚拟化、风扇和其它无关设置；不执行整份BIOS恢复默认或刷固件。
5. 拍下保存后的实际内存速率。出现不能启动或反复训练时先保留错误画面，由现场人员按主板手册处理，不用反复强制重启来“试到成功”。

ASUS官方说明了上述BIOS入口、SPD查看方式，并强调内存频率同时受CPU、主板和内存影响。[ASUS内存设置说明](https://www.asus.com/sg/support/faq/1042256/)。

## 离线检测和回到Windows

使用Windows内置内存诊断（本机已确认存在`mdsched.exe`），按现场界面选择扩展检查并记录检测设置、轮次和结果；在确认维护窗口前不启动或排队该程序。128GiB检测时间由实际进度决定，不承诺几分钟完成。

如改用其他UEFI内存工具，需要另行核对官方工具、启动介质及目标U盘；制作启动盘涉及清除U盘，必须先确认具体目标。没有在这轮下载工具或写启动盘。

Windows恢复后，先读取以下结果，再恢复游戏服务：

```powershell
Get-CimInstance Win32_PhysicalMemory |
  Select-Object Capacity,PartNumber,Speed,ConfiguredClockSpeed
Get-WinEvent -FilterHashtable @{
  LogName='System'
  ProviderName='Microsoft-Windows-MemoryDiagnostics-Results'
} -MaxEvents 5 | Select-Object TimeCreated,Id,Message
```

完整保存结果和时间，不只写“通过”。未出现结果事件时标为未确认；测试被中断时保留中断记录，不能补写零错误。

## 如何缩小到具体原因

- 标准配置仍检出错误：按主板手册推荐槽位逐条验证，再交换槽位。错误跟着某根条走、跟着某个槽位走、还是只在四条同时插入时出现，要分别记录。
- 标准配置零错误：只说明本次覆盖范围没有发现错误；恢复原服务继续正常使用对照，不故意恢复高频来制造生产蓝屏。
- 标准配置下仍出现同样网络蓝屏：继续独立的ESRV/WFP/网卡分支，并考虑保留更完整内核转储。仍需逐项确认，不能同时卸载所有驱动。
- PCIe纠错继续存在：另开该卡链路的维护对照，不用隐藏WHEA事件代替修复。

本方案是可执行的排除验证，不是“根因已修复”的证明；最近故障及完整证据见[诊断记录](HOST_JAVA_CRASH_20261016.md)。
