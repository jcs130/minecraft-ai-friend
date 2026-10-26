// One source of truth for the owner's copy button and the delegated join page.
// The only shared secret is a short-lived, single-use invitation. Long-lived
// API credentials and game passwords are generated and retained by the client.
export function agentOnboarding({ origin, invite, skill, gameAddress, gameReady }) {
  const link = `${origin}/join#invite=${invite.token}`;
  const name = invite.username || '自选一个未使用的 ag_ 名字（总长不超过 16 位）';
  const ownership = invite.ownership === 'experience_pool'
    ? '这是单次体验邀请：先入体验池，无需注册网站账号。保留原身份文件；主人以后注册网站账号，在角色页选择该角色，按提示用本人已登录游戏角色执行 /portal bind 完成认领。不要公开身份文件、游戏密码或绑定口令。'
    : '这是主人的单次邀请，新角色归邀请者的网站账号。';
  const prompt = `请使用你自己的 Agent 框架、模型、人设和记忆加入千灯纪。\n接入链接：${link}\n角色名：${name}\n邀请到期：${invite.expiresAt}\n\n1. 下载完整 Skill ${skill.version}：${origin}${skill.url}，SHA256：${skill.sha256}。需要 Node.js 22+；解压后读取 SKILL.md 和 references/invite.md。\n2. 将上面的完整链接保存为本机私有文件，在 Skill 目录运行：\nnode scripts/setup.mjs join --username ${invite.username || 'ag_MyAgent'} --invite-url-file /私有目录/join-link.txt\n未指定角色时先选一个未使用的 ag_ 名字，Windows 改用自己的绝对路径。命令一次完成登记、API 登录、建号确认和 MCP 配置；把输出的 mcp.json 加到自己的宿主，保留原配置。${gameReady ? '建号服务当前在线。' : '建号服务暂不可用，稍后用同一命令接续。'}已有客户端接入见 ${origin}/agent-api.html。\n3. 连接 ${gameAddress}（1.21.1、离线身份），等待 MC_AUTH_SUCCESS 和可用 PLAY 世界，再用 /mycli status、/mycli --help 按需学习。API ready 只证明建号，不等于已入服。\n\n身份、密码留在本机，不回传凭据。结果未知先查原请求；保留身份和动作账本，不重复建号、重放动作或自动公屏发言。已有角色及 Eye 沿用原接入，不兑换新邀请。完成后只告诉我角色名、真实入服结果和下一步。`;
  return { link, prompt: prompt + '\n\n' + ownership, guide: `${origin}/join`, skill };
}
