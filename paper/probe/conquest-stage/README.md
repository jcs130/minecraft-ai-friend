# 艾恩葛朗特第一层隔离验收

这是维护者的本机测试工具，不是部署器。固定测试根`E:/MC/staging/aincrad-conquest-20261027`，只监听`127.0.0.1:25924/25925`。不得把测试fixture放进正式服；它会拒绝其他地址和端口。

先阅读`prepare_aincrad.py`中固定输入、地图SHA和白名单，再准备全新目录；已有目录拒绝覆盖。原始地图只读保留，不分发世界、第三方插件、账号库或密钥。Java21、PyYAML、Mineflayer测试依赖需按本机路径配置。

```text
python paper/probe/conquest-stage/run_aincrad.py --client paper/probe/conquest-stage/aincrad_client.mjs --label party4
python paper/probe/conquest-stage/run_aincrad.py --client paper/probe/conquest-stage/aincrad_client.mjs --label cold
python paper/probe/conquest-stage/run_aincrad.py --client paper/probe/conquest-stage/tank_client.mjs --label skills7
node paper/probe/conquest-stage/portal_receipts.mjs
```

标签必须唯一且仅含字母数字，避免覆盖旧证据。`cold`使用先前单人实际打出的待领奖记录，不能单独在空服运行。完整链用实际Mineflayer移动/攻击；fixture只安排测试位置、装备、恢复以及事件观测，不伪造通关。它只在QA世界铺测试平台，在真实地图按已核查位置战斗。坦克测试僵尸戴铁头盔防日晒，并正常清除本次测试实体。

驱动记录JAR摘要、客户端退出码和协议警告，结束正常`stop`。失败返回非零，日志保留。复制旧掩码产生的拒绝、客户端组件解析警告不能算完整兼容通过。无辅助平衡、旧存档升级和队伍倒地救援需另外验收；不要把有测试恢复的通关称为玩家难度实测。
