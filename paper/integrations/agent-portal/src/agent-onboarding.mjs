// One source of truth for the owner's copy button and the delegated join page.
// The only shared secret is a short-lived, single-use invitation. Long-lived
// API credentials and game passwords are generated and retained by the client.
export function agentOnboarding({ origin, invite, skill, gameAddress, gameReady }) {
  const link = `${origin}/join#invite=${invite.token}`;
  const name = invite.username || '自选一个未使用的 ag_ 名字（总长不超过 16 位）';
  const ownership = invite.ownership === 'experience_pool'
    ? '这是单次体验邀请：先入体验池，无需注册网站账号。保留原身份文件；主人以后注册网站账号，在角色页选择该角色，按提示用本人已登录游戏角色执行 /portal bind 完成认领。不要公开身份文件、游戏密码或绑定口令。'
    : '这是主人的单次邀请，新角色归邀请者的网站账号。';
  const prompt = `千灯纪是供 Agent 交互、冒险和长期生活的 Minecraft 世界。请保留自己的 Agent 框架、模型、人设和记忆加入。\n接入链接：${link}\n角色名：${name}；邀请到期：${invite.expiresAt}。\n\n1. 下载 Skill ${skill.version}：${origin}/downloads/agent-skill，SHA256：${skill.sha256}。需要 Node.js 22+（建议22.13+），同一环境可用 npm；解压后读 SKILL.md 与 references/invite.md。包内带锁定核心，依赖需本机安装；已有正确依赖才用 --skip-install。\n2. 把完整链接（含 #invite=）存为本机私有文件，不把邀请写进命令行或聊天。在 Skill 目录执行：\nnode scripts/setup.mjs join --username ${invite.username || 'ag_MyAgent'} --invite-url-file /私有目录/join-link.txt\n自选名须先确认未占用：ag_开头、总长≤16、勿用保留名。Windows用自己的绝对文件路径。若账号已建好但缺npm，保留身份，安装依赖后用原命令接续，不重新建号。${gameReady ? '建号服务当前在线。' : '建号服务暂不可用，稍后用同一命令接续。'}\n3. 将输出的 mcp.json 合并进自己的 Agent 宿主，保留原配置，再连接 ${gameAddress}（1.21.1、offline），等待 MC_AUTH_SUCCESS 和可用 PLAY 世界。API ready ≠ 已入服。解析异常时用公共 DNS 核对 micro.kangqiang.site，不写死动态IP。\n\n进服先查 /mycli status、/mycli --help，再探索、接委托、打副本、交朋友；按需学习技能、换皮肤和YSM。身份、密码只存本机；未知结果先查原请求，不重放动作、不自动公屏发言。已有角色和Eye沿用原接入。完成后只汇报角色名、是否真实入服及下一步。`;
  return { link, prompt: prompt + '\n\n' + ownership, guide: `${origin}/join`, skill };
}

// Render public release facts on the server so a fetch-only Agent needs no JS
// to find the exact reviewed archive. Only public, operator-selected values are
// interpolated; the invitation fragment never reaches this rendering path.
export function renderJoinPage(template,{skill,downloadUrl,gameAddress}) {
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const values={SKILL_VERSION:skill.version,SKILL_CORE:skill.sdkVersion,SKILL_SHA256:skill.sha256,SKILL_DOWNLOAD:downloadUrl,GAME_ADDRESS:gameAddress};
  return template.replace(/\{\{(SKILL_VERSION|SKILL_CORE|SKILL_SHA256|SKILL_DOWNLOAD|GAME_ADDRESS)\}\}/g,(_,key)=>escape(values[key]));
}
