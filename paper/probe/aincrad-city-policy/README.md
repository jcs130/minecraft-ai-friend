# 城市保护规则验证

本目录只准备配置与验证规则，不连接正式服，不包含私人建设者清单或地图文件。

```sh
python -m unittest discover -s paper/probe/aincrad-city-policy -p test_city_policy.py
```

`city_policy.py` 的 `block_policy` 仅替换 aincrad 的保留范围，`city_regions` 合并城市与四角区域，`guide_script` 只改已核对的指引文本。调用方须先校验、双盘备份和保留现役其他区域；更新后使用已有 BlockAccess、WorldGuard、Denizen 重载，不替换整个游戏配置树。

`CityPolicyFixture.java` 只允许 `127.0.0.1:29385` 的隔离服；不能安装到正式服。使用与正式相同的 AgentFriend/WorldGuard，配合普通非 OP Mineflayer 客户端验证实际拆放、CLI 预检、边界、副本和两种重载。夹具的临时测试地面和物品仅存在于 QA 副本。

当前部署与结果见 `paper/docs/AINCRAD_CITY_POLICY_20261029.md`。
