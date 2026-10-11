/** Names pair cameras; explicit grants and confirmed online Agents gate login. */
const namePattern = /^[A-Za-z0-9_]{1,16}$/;
export function eyeBaseName(name) {
  if (!namePattern.test(name)) return null;
  const base = name.replace(/_?eye$/i, '');
  return base !== name && base && !/eye$/i.test(base) && !/^goddess$/i.test(base) ? base : null;
}
export function eyeRules(value, online = []) {
  if (value.schemaVersion !== 1 || !Array.isArray(value.pairs) || value.pairs.length > 16)
    throw Error('invalid Eye registry');
  const freeObservers = value.freeObservers ?? ['live'];
  if (!Array.isArray(freeObservers) || freeObservers.length > 4 || freeObservers.some(n => !namePattern.test(n) || /^goddess$/i.test(n)))
    throw Error('invalid freeObservers');
  const free = new Set(freeObservers.map(n => n.toLowerCase()));
  const agents = new Set(), eyes = new Set();
  const pairs = value.pairs.map(({ agent, eye = `${agent}_eye` }) => {
    const a = agent?.toLowerCase(), e = eye?.toLowerCase();
    if (!namePattern.test(agent) || !namePattern.test(eye) || a === e || a === 'goddess'
        || e === 'goddess' || agents.has(a) || eyes.has(e)) throw Error('invalid Eye pair');
    agents.add(a); eyes.add(e); return { agent, eye, key: e, automatic: false };
  });
  if ([...agents].some(a => eyes.has(a))) throw Error('Agent is an Eye');
  if (value.autoNameEyes !== false) for (const eye of [...online].sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
    const agent = eyeBaseName(eye), key = eye.toLowerCase();
    if (!agent || free.has(key) || agents.has(key) || eyes.has(key) || eyes.has(agent.toLowerCase())) continue;
    if (pairs.length >= 16) break;
    pairs.push({ agent, eye, key, automatic: true }); eyes.add(key);
  }
  return { pairs, free, autoNameEyes: value.autoNameEyes !== false };
}
export function eyeLoginAllowed(registry, access, name, address, sessions = []) {
  return eyeLoginDecision(registry, access, name, address, sessions).allowed;
}
export function eyeLoginDecision(registry, access, name, address, sessions = []) {
  const key = name.toLowerCase(), rules = eyeRules(registry, [name]);
  if (access.schemaVersion !== 1 || !Array.isArray(access.accounts)) throw Error('invalid access registry');
  const allow = { allowed: true };
  const deny = reason => ({ allowed: false, reason });
  const grant = entry => Array.isArray(entry?.allowedIps) && entry.allowedIps.includes(address) ? allow
    : deny(`${name} 已设置专用接入限制。请让房管检查该账号的访问配置后重试。`);
  const entry = access.accounts.find(item => item.name?.toLowerCase() === key);
  if (entry) return grant(entry);
  if (rules.free.has(key)) return deny(`${name} 是自由观战账号，需要房管单独登记接入。普通跟随镜头请使用对应角色名_eye。`);
  const binding = rules.pairs.find(pair => pair.key === key);
  if (binding?.automatic) {
    const agentEntry = access.accounts.find(item => item.name?.toLowerCase() === binding.agent.toLowerCase());
    // Explicit restrictions, including an empty address list, always win.
    if (agentEntry) return grant(agentEntry);
    // The legacy switch remains a disable alias; default pairing ignores IP.
    if (registry.autoOnlineAgentEyes === false || registry.autoSameSourceEyes === false)
      return deny('服务器已关闭默认观战接入。请让房管开启自动配对或登记该镜头后重试。');
    return sessions.some(session => session.name?.toLowerCase() === binding.agent.toLowerCase()) ? allow
      : deny(`对应角色 ${binding.agent} 尚未成功在线。请先登录本体，等它进入世界后再连接 ${name}。`);
  }
  if (binding || rules.pairs.some(pair => pair.agent.toLowerCase() === key))
    return deny(`${name} 已设置专用配对，需要房管登记接入。默认镜头请使用在线角色名_eye。`);
  if (/eye/i.test(key)) return deny('未找到可用的观战配对。请先登录本体，再使用角色名_eye；自定义别名请让房管登记。');
  return access.allowUnregisteredGuests === true ? allow : deny('服务器未开放游客接入。请让房管登记你的账号后重试。');
}
