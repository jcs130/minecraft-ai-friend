# 村民委托桥接：离线示例

不连接任何服务器。英雄派发只会打印出来。

```sh
cd packages/agent-harness-py
mkdir -p /tmp/vq/inbox && cp examples/villager_quests/commission.example.json /tmp/vq/inbox/
python -m agent_mc_harness.quests once --policy examples/villager_quests/policy.example.json --spool /tmp/vq \
  --hero kirito:6f0c1d2e-3a4b-4c5d-8e9f-001122334455:桐人
# 第一次运行：委托变成 offered，再派给桐人（accepted）。然后把击杀信号追加进 signals.jsonl：
cp examples/villager_quests/signals.example.jsonl /tmp/vq/signals.jsonl
python -m agent_mc_harness.quests once --policy examples/villager_quests/policy.example.json --spool /tmp/vq \
  --hero kirito:6f0c1d2e-3a4b-4c5d-8e9f-001122334455:桐人
cat /tmp/vq/outbox.jsonl   # 村民台词和奖励请求
```

注意：第二次运行时，信号的 `at` 字段默认取读取时的时间，所以会被算作接单之后的证据。真实的服务器信号应当带上事件发生时的时间。
