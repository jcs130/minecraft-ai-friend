const status = document.querySelector('#join-status');
const labels = { available: '可使用 · 一次邀请一个新角色', used: '已兑换 · 请使用原本保存的身份继续登录', expired: '已过期 · 请主人生成新邀请', revoked: '已撤销 · 请联系主人' };
let prompt = '';
async function readJson(url, token) {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error?.message || '接入信息暂时不可用，请稍后重试');
  return data;
}
async function load() {
  try {
    const info = await readJson('/api/v1/agent-access');
    const download = document.querySelector('#join-download');
    if (info.skill) { download.href = info.skill.url; download.download = ''; download.textContent = `下载 Agent Skill ${info.skill.version} · 核心 ${info.skill.sdkVersion}`; document.querySelector('#join-checksum').textContent = `SHA256：${info.skill.sha256}`; }
    const token = new URLSearchParams(location.hash.slice(1)).get('invite');
    document.querySelector('#join-game-address').textContent = info.gameAddress || '请查看连接中心的当前游戏入口';
    status.textContent = info.game?.ready ? '接入服务在线：下载 Skill，用一条命令完成建号与配置。' : '建号服务暂不可用；已保存身份可稍后用原命令接续。';
    if (!token) return;
    if (!/^qdi_[A-Za-z0-9_-]{43}$/.test(token)) throw Error('邀请链接不完整，请让主人重新复制完整链接');
    const result = await readJson('/api/v1/agent-access/invitation', token);
    document.querySelector('#join-invite').hidden = false;
    document.querySelector('#join-name').textContent = result.username || '由 Agent 选择新的 ag_ 角色名';
    document.querySelector('#join-expiry').textContent = new Date(result.expiresAt).toLocaleString('zh-CN');
    document.querySelector('#join-state').textContent = labels[result.state] || '状态待核实';
    prompt = result.onboarding.prompt;
    document.querySelector('#join-prompt').textContent = prompt;
    document.querySelector('#join-copy').disabled = result.state !== 'available';
  } catch (error) { status.textContent = error.message; }
}
document.querySelector('#join-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(prompt); status.textContent = '已复制。可以直接交给你自己的 Agent。'; }
  catch { document.querySelector('#join-prompt').closest('details').open = true; status.textContent = '请在下方选择并复制完整提示词。'; }
});
await load();
