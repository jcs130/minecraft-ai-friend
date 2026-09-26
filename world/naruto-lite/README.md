# 鸣人·轻量版（A/B 对照身体）

2026-09-26 造物主谕：**同一个世界里做对照实验——桐人走重栈（survivor/JEV/电机信箱/numen 执行器），鸣人走轻量直驱；两边脑子都用阿福（qwen3.8）**。

- 链路：`mineflayer → gate-public(宿主 25702, 名字 ag_ 前缀) → NeoForge 主服`；
  LLM：`naruto_lite.cjs → 127.0.0.1:8010 decision-proxy → 阿福 :4000`（与 qwenpaw 同一把 key，不落明文）。
- 语音：`127.0.0.1:8191 IndexTTS shim`（默认音色 `cosy_male`，env `NARUTO_VOICE` 可换）。
- 设计纪律：**单循环、每动作硬超时、错误全吞进日志继续跑**——不存在"等一个永远不来的回执"，卡住在结构上不可能；慢了/傻了看 `state/thinking.jsonl` 一眼可知。
- 观测产物：`state/thinking.jsonl`（每轮 think/say/action/result/快照）、`state/status.json`、`state/voice/latest.mp3`。
- 常驻：计划任务 `qiandengji-naruto-lite`（onlogon → `start.cmd`）。手工重启要先杀掉 node 孤儿（`schtasks /end` 不杀子进程，老坑）。
- 已知待修：`bot.findRecipe` 在 mineflayer 4.37 改名（craft 动作会报错但不卡）；装饰台地寻路难（已加连续无路→直跑脱困兜底）。
