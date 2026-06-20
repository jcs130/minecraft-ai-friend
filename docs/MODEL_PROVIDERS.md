# 云端模型接入

本项目把模型接入分成两层：

- Autoplayer：用于自动陪玩循环做高层任务决策，调用 OpenAI-compatible `/chat/completions`。
- Mindcraft Agent Profile：用于 AI 玩家本体聊天、写行动代码、执行任务。

控制台的“模型供应商”会同时给这两层提供配置片段，但 API key 仍然只从环境变量或 Mindcraft 自己的 `keys.json` 读取，页面不会保存或展示密钥。

## 已内置的供应商

| 供应商 | Base URL 默认值 | 模型默认值 | 推荐环境变量 |
| --- | --- | --- | --- |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen3-vl:8b` | 不需要 |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` | `DEEPSEEK_API_KEY` |
| 阿里云百炼 / 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `DASHSCOPE_API_KEY` 或 `QWEN_API_KEY` |
| 豆包 / 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | `your-endpoint-id` | `ARK_API_KEY` |
| OpenAI-compatible 自定义 | `https://api.example.com/v1` | `your-model` | `MINDCRAFT_LLM_API_KEY` 或 `OPENAI_API_KEY` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` | `OPENROUTER_API_KEY` |

## Windows 环境变量示例

PowerShell 临时设置：

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
$env:DASHSCOPE_API_KEY = "sk-..."
$env:ARK_API_KEY = "..."
```

永久设置用户环境变量：

```powershell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", "sk-...", [EnvironmentVariableTarget]::User)
[Environment]::SetEnvironmentVariable("DASHSCOPE_API_KEY", "sk-...", [EnvironmentVariableTarget]::User)
[Environment]::SetEnvironmentVariable("ARK_API_KEY", "...", [EnvironmentVariableTarget]::User)
```

设置后需要重启运行本控制台和 Mindcraft 的终端，环境变量才会被进程读取。

## Mindcraft 兼容说明

- DeepSeek：Mindcraft 原生读取 `DEEPSEEK_API_KEY`。
- Qwen：Mindcraft 原生读取 `QWEN_API_KEY`。如果本控制台进程里只有 `DASHSCOPE_API_KEY`，从控制台启动 Mindcraft 时会把它映射成子进程的 `QWEN_API_KEY`。
- 豆包 / OpenAI-compatible：Mindcraft 通过 `openai` 适配器加自定义 `url` 访问，子进程里需要 `OPENAI_API_KEY`。从控制台启动 Mindcraft 时，如果检测到当前供应商密钥但没有 `OPENAI_API_KEY`，会只在子进程环境里临时映射。
- Ollama：Autoplayer 使用 `/v1`，Mindcraft 使用 Ollama 原生 `/api/chat`，因此同步到 Profile 时会自动去掉末尾 `/v1`。

## 使用流程

1. 在系统环境变量或启动终端里配置对应 API key。
2. 打开控制台，选择“模型供应商”。
3. 点击“应用供应商预设”，确认 Base URL 和模型名。
4. 点击“保存”让 Autoplayer 生效。
5. 在“AI 角色配置”里读取当前角色，点击“套用当前模型”。
6. 保存角色 JSON，重启 Mindcraft。

阿里云百炼不同地域和业务空间可能要求专属 Base URL，例如包含 WorkspaceId 的地域 URL；这种情况下直接编辑“模型接口地址”即可。
