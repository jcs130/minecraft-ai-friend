# My Agent World：可选 Minescript

2026-10-14。模型、任务调度、记忆和回执继续使用自研 `agent-mc-autonomy` 与 `agent-mc-world`。Minescript 是真实 Java 身体的有限 Python 执行能力，客户端桥为 0.3.0，共 30 项操作。

## 安装

适配 Minecraft 1.21.1、NeoForge 21.1.248、Java 21 和原作者 `minescript-neoforge-1.21.1-4.0.jar`。该游戏版本和加载器的正式包是 4.0，接口以 4.0 为准。客户端按目标服务器要求安装整合包，再把本桥和原版 Minescript 放入客户端 `mods`；Baritone 可选。

在 Minescript 工作目录的 `minescript/config.txt` 配置已有 Python 3.11+，可使用 Agent 核心的环境：

```text
python="C:/path/to/python.exe"
```

Minescript 模组会提供 `minescript.py`。本次安装器只创建可选分发包。原包 SHA256 为 `4e421ed49e38f7453178ce7d8cc8415367cb513e2d837d648ae844c1d8e4b351`；独立 JAR、GPL 许可证与对应源码链接随包提供，详见 `world/third-party/minescript/SOURCE.txt`。

## 调用

按[统一指南](MY-AGENT-WORLD-UNIFIED-ACCESS.md)连接 `provider=java-client`，沿用真实 UUID、实际服务器地址、本机凭据与原账本。查询 `mc_capabilities.scripting.minescript`、`mc_operations`、`mc_help`；`mc_read {"operation":"minescript.state","args":{}}` 返回实际版本、任务和控制归属。

通过 `mc_control {"action":"claim"}` 取得控制后，向 `mc_do` 提交：

```json
{
  "action_id":"inspect-kitchen-001",
  "operation":"minescript.run",
  "args":{
    "code":"from dataclasses import asdict\nresult = {'position': minescript.player_position(), 'items': [asdict(item) for item in minescript.player_inventory()], 'request': input_data}",
    "input":{"task":"查看厨房材料"},
    "timeoutMs":10000
  }
}
```

脚本已有 `minescript` 与 JSON 对象 `input_data`，把 JSON 输出赋给 `result`。默认 `print` 写入私有日志。通过 `mc_result` / `mc_wait` 查询原 ID：`result.value` 是输出，`after` 是实际客户端快照。成功仅表示脚本结束，`goalCompleted=false`、`effectConfirmed=false`；目标完成仍需真实证据。

`minescript.container_get_items()` 可读真实容器；4.0 的 `java_class`、`java_member`、`java_access_field`、`java_call_method` 可调用原生菜单和模组方法。一次脚本可组合查询、操作与核验。直接 Java 点击应自行核对窗口 ID、stateId、完整物品和光标，等待服务器同步后重读；它不会自动获得 `menu.click` 的 CAS 校验。原始画面继续用 `mc_visual`。

## 生命周期

- `code` 最多 16384 字符、UTF-8 最多 32768 字节，`input` 最多 32768 字节；返回 JSON 最多 65536 字节，拒绝 NaN、无限值和超预算输出。
- 默认 30 秒，范围 1000–120000 毫秒。原租约为 90 秒，长任务由原控制器正常续租。
- 同身体单动作；已有独立 Minescript 任务时拒绝接管。停止只针对本桥保留的原 Job 对象，避免任务数字 ID 重用后误杀其他任务。
- 取消、超时、F8、死亡、断线或租约失效会停止本桥任务并释放输入。unknown 保留原记录，仅沿原 ID 对账。
- Python 任务有有限期限退出保护，生命周期属于拥有它的 Minecraft 客户端；没有新增长期模型循环或公网接口。
- 脚本使用当前用户的 Python 权限执行；有限任务约定不包含自行启动的外部进程、后台线程或其他 Minescript 任务。
- 请求、结果、日志和账本留在客户端私有目录。适配器使用原启动入口，并对 4.0 JobManager 作固定版本反射；其他版本明确不可用。
- 本桥生成任务的 `Done` 与受控取消 `-5` 状态通过 SDK 回执呈现，客户端只过滤这些带本实例专属 runner 名的本地提示。独立脚本输出、普通聊天和其他执行错误保留；健康接口检查本地过滤器已实际安装。

原生菜单存取、重启与生命周期验收见[记录](evidence/minescript-20261014.json)。本轮脚本测试不能作为 LLM 成功率或轮次提升的证明。
