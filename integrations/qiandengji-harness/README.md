# 千灯纪可选服务器接入包

使用 SDK 公开扩展口，不依赖 Paper 源码，也不修改通用核心或已运行 Agent。
部署与账号/凭据说明见 [维护手册](../../docs/QIANDENGJI-HARNESSROUTER.md)。

- `entry.mjs`：独立 MCP 入口，明确选择本包。
- `engine.mjs`：沿用原动作队列、控制租约和战术工具。
- `configuration.mjs`：登录代理重新配置期间暂停物理输入，保留正常协议握手。
- `protocol.mjs`：只读取此连接的私有状态/事件，严格检查负载与身份。
- `contract.mjs`：额外的只读工具和渐进发现指南。
- `*.example`：独立普通角色模板，不含凭据。
- `body-package*.json`：冻结身体的依赖和解析锁。部署时改为 `package*.json`，
  配合部署锁中的 SDK 归档执行 `npm ci --ignore-scripts --no-audit --no-fund`。

将上述五个 `.mjs` 放在新 `body/qiandengji/` 下，依赖在 `body/node_modules/`；
操作员选择器位于仓库 `tools/qiandengji_harness.py`，安装时复制到冻结包根目录。
第三方资源及 SDK 二进制归档不放进本目录的 Git 提交。

无游戏/模型调用的验证：

```powershell
node --test integrations/qiandengji-harness/configuration.test.mjs integrations/qiandengji-harness/protocol.test.mjs
python -m unittest discover -s tools -p test_qiandengji_harness.py -v
```

Python 测试需使用已安装 `agent-mc-autonomy 0.1.27` 的环境。
私有联机脚本属于一次性验收，不能当作日常启动命令重放。
