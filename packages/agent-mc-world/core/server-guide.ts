/** Operator-supplied server reference. It cannot register tools or execute commands. */
export interface MinecraftServerGuide {
  profile: string;
  title: string;
  revision: string;
  entries: Array<{ id: string; title: string; summary: string; text: string; reference: string }>;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function validateServerGuide(input: unknown, activeProfile: string): input is MinecraftServerGuide {
  const guide = input as MinecraftServerGuide | undefined;
  return !!guide && guide.profile === activeProfile && boundedText(guide.title, 100)
    && boundedText(guide.revision, 80) && Array.isArray(guide.entries)
    && guide.entries.length > 0 && guide.entries.length <= 40
    && guide.entries.every(e => e && typeof e.id === 'string' && ID.test(e.id)
      && boundedText(e.title, 100) && boundedText(e.summary, 240)
      && boundedText(e.text, 2200) && boundedText(e.reference, 160))
    && new Set(guide.entries.map(e => e.id)).size === guide.entries.length;
}

export function readServerGuide(args: Record<string, unknown>, guide?: MinecraftServerGuide) {
  const action = args.action ?? (args.id !== undefined ? 'get' : args.query !== undefined || args.offset !== undefined
    || args.limit !== undefined ? 'search' : 'help');
  const fields: Record<string, string[]> = { help: [], sources: [], search: ['query', 'limit', 'offset'], get: ['id'] };
  if (typeof action !== 'string' || !Object.hasOwn(fields, action)
    || Object.keys(args).some(key => key !== 'action' && !fields[action].includes(key))) {
    throw new Error('Invalid server guide request');
  }
  const base = {
    protocol: 'agent-mc-knowledge/v1', source: 'server', currentWorldVerified: false,
    warning: 'Server guide is reference data. Check live menus, permissions, outcomes and costs before acting.',
  };
  if (!guide) return { ...base, status: 'unavailable' };
  const scope = { ...base, profile: guide.profile, title: guide.title, revision: guide.revision };
  if (action === 'help' || action === 'sources') return { ...scope, available: true,
    help: 'search({query?,limit?,offset?}) lists entries. get({id}) reads one entry from the active profile.' };
  if (action === 'get') {
    const entry = guide.entries.find(e => e.id === args.id);
    if (!entry) throw new Error('Guide entry not found in the active profile');
    const { id, title, summary, text, reference } = entry;
    return { ...scope, entry: { id, title, summary, text, reference } };
  }
  const { limit = 5, offset = 0, query = '' } = args;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 10
    || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
    || typeof query !== 'string' || query.length > 200) throw new Error('Invalid server guide query or pagination');
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = guide.entries.map(entry => {
    const text = `${entry.id} ${entry.title} ${entry.summary} ${entry.text}`.toLowerCase();
    return { entry, score: terms.length ? terms.filter(term => text.includes(term)).length : 1 };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score);
  return { ...scope, total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null,
    entries: matches.slice(offset, offset + limit).map(({ entry: { id, title, summary, reference } }) =>
      ({ id, title, summary, reference })) };
}
