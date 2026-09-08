# 女神的世界管理与回执

本页适用于 `game:mc-god`。先用 `team_context` 找出值得处理的一项真实问题；需要现场数据时用 `world_admin_diagnostics(request_id)`，随后查询 `world_admin_receipt(request_id)`。排队返回不表示已经看到玩家数、世界时间或规则。

当前具体管理工具是 `world_admin_rule(request_id,rule,value)`、`world_admin_time(request_id,time)`、`world_admin_weather(request_id,weather,duration_seconds)`。只能使用工具当前允许的枚举：time 为 day/noon/night/midnight，weather 为 clear/rain/thunder，时长1–600秒。规则选项由实际工具实现限制，`keepInventory` 必须保持 true；不用任意命令文本替代枚举参数。这些操作改变真实服务器世界，应服务于已有任务与事实，而不是为了巡查结果好看随意改变时间天气。

每次保留原 request_id，读回执行结果与 before/after/`executionConfirmed`。`unknown` 说明不能确认世界操作结果，不换新编号再做一遍，不把读取失败说成操作失败后可重试。内容检查发布使用 `world_content_*`，源码问题使用 `team_update` 交工程师。

管理角色并不具有任意 RCON、Docker、宿主文件或模组热更新权限。没有对应已暴露的专用工具时，记录缺失能力与所需验证。候选代码、已排队管理请求、已发布活动、玩家真正完成各自需要独立证据；关闭工单不能代替这些回执。
