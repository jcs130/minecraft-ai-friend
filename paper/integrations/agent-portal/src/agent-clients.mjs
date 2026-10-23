import { publicDownloads } from './download-catalog.mjs';
// Public discovery only: these links never exchange a website invitation or credential.
export const agentClients = Object.freeze([
  Object.freeze({ id: 'core', name: 'MC 通用核心', description: '在自己的 Agent 框架中使用 MCP 或 SDK，模型、人设和记忆由你管理。',
    source: 'https://github.com/jcs130/minecraft-ai-friend/tree/main/packages/agent-mc-world', sourceLabel: 'GitHub · 最新核心与安装说明',
    install: '本服 Skill 已锁定并验证配套核心；独立 SDK 可按上游说明安装。', framework: null }),
  Object.freeze({ id: 'neko', name: 'N.E.K.O Minecraft 插件', description: '让 N.E.K.O 角色通过自主游玩插件进入世界。',
    source: 'https://github.com/jcs130/n.e.k.o_plugin_minecraft_autonomous', sourceLabel: 'GitHub · 插件与安装说明',
    releases: 'https://github.com/jcs130/n.e.k.o_plugin_minecraft_autonomous/releases/latest', install: '官网提供公开 0.6.70 插件和 Windows 完整离线包；源码开发版本分别标注。',
    framework: { name: 'N.E.K.O 主项目', url: 'https://github.com/Project-N-E-K-O/N.E.K.O' } }),
  Object.freeze({ id: 'cortico', name: 'Cortico 千灯纪 World', description: '在 Cortico 中安装 World 扩展，继续使用角色原本的人设与记忆。',
    source: 'https://github.com/jcs130/cortico-world-qiandengji', sourceLabel: 'GitHub · World 与安装说明',
    install: '官网提供 0.4.1-rc.14 公测 World；Cortico API 6，官方 0.2.5 已验收。',
    framework: { name: 'Cortico 主项目', url: 'https://github.com/Pal-AI-Lab/Cortico' } }),
  Object.freeze({ id: 'dsh', name: 'DSH Minecraft 插件', description: '在 DeepSeek Harness 中使用同一个 Minecraft 核心，继续使用自己的模型与记忆。',
    source: 'https://github.com/jcs130/dsh-minecraft-agent', sourceLabel: 'GitHub · 插件与安装说明',
    install: '官网提供已发布 0.3.0-rc.12，Node.js 24+；官方 DSH 0.2.1-rc.2。',
    framework: { name: 'DSH 主项目', url: 'https://github.com/deepseek-ai/deepseek-harness' } }),
]);

export function getAgentClients(config) {
  const packages = publicDownloads(config);
  // Discovery stays short; detailed installation and integrity data is read
  // only from /api/v1/downloads when the user selects a download.
  return agentClients.map(client => ({ ...client, downloads: packages.filter(row => row.framework === client.id)
    .map(({ id, version, available, url }) => ({ id, version, available, url })) }));
}
