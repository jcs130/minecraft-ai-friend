// One source of truth for the owner's copy button and the delegated join page.
// The only shared secret is a short-lived, single-use invitation. Long-lived
// API credentials and game passwords are generated and retained by the client.
import { agentClients } from './agent-clients.mjs';
export function agentOnboarding({ origin, invite, skill, gameAddress, gameReady }) {
  const link = `${origin}/join#invite=${invite.token}`;
  const name = invite.username || '自选一个未使用的 ag_ 名字（总长不超过 16 位）';
  const prompt = `请使用你自己的 Agent 框架、模型、人设和记忆加入千灯纪，不要另启动一套自主 Agent。\n\n接入页：${link}\n角色名：${name}\n邀请到期：${invite.expiresAt}\n\n1. 打开接入页，下载并核对 Agent Skill ${skill.version}：${origin}${skill.url}；SHA256：${skill.sha256}。解压后读取 SKILL.md 和 references/invite.md。包内核心：${skill.sdkVersion}；上游最新说明：${agentClients[0].source}。NEKO 和 Cortico 的接入项目见接入页。也可直接按 ${origin}/agent-api.html 使用自己的 Mineflayer 客户端。\n2. 这个链接是主人交给你的单次邀请。把完整链接保存到本机私有文件，运行 Skill 的 scripts/agent-register.mjs，用 --invite-url-file 读取。注册前保存身份；API 登录后查 status，再 activate。不要申请别人的已有角色或 Eye。\n3. ${gameReady ? '游戏建号桥当前在线。' : '游戏建号桥当前尚未上线；可以先保存 API 身份，等待 status 显示可激活，不能把 API 注册当作游戏已入服。'}只有 status 返回 state=ready 且 gameAccountCreated=true 后，才用 scripts/import-account.mjs 生成本地 MCP 配置；已有客户端可直接读取私有身份文件中的 gamePassword。不要打印密码、密钥或上传身份文件。\n4. 游戏：${gameAddress}，Minecraft 1.21.1，离线身份。等待 MC_AUTH_SUCCESS 与进入 PLAY 世界，再从 /mycli help 和 /mycli status 学习规则、技能与任务。更多故事和玩法在游戏内探索。\n5. 一次只执行一个游戏动作；以最终回执确认成功。超时或结果未知先查询，不重复建号、不重放消耗性动作。保留本机身份以便断线后重登；不要重复创建身体或自动发言。\n\n完成后告诉我角色名、是否真正进入世界，以及你通过 /mycli status 查到的下一步；不要回传任何凭据。`;
  return { link, prompt, guide: `${origin}/join`, skill };
}
