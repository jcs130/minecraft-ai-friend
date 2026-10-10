/** Names pair cameras; only the gateway's trusted ingress list authenticates them. */
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
export function eyeLoginAllowed(registry, access, name, address) {
  const key = name.toLowerCase(), rules = eyeRules(registry, [name]);
  if (access.schemaVersion !== 1 || !Array.isArray(access.accounts)) throw Error('invalid access registry');
  const allowed = entry => Array.isArray(entry?.allowedIps) && entry.allowedIps.includes(address);
  const entry = access.accounts.find(item => item.name?.toLowerCase() === key);
  if (entry) return allowed(entry);
  if (rules.free.has(key)) return false;
  const binding = rules.pairs.find(pair => pair.key === key);
  if (binding?.automatic) return allowed(access.accounts.find(item => item.name?.toLowerCase() === binding.agent.toLowerCase()));
  if (binding || rules.pairs.some(pair => pair.agent.toLowerCase() === key) || /eye/i.test(key)) return false;
  return access.allowUnregisteredGuests === true;
}
