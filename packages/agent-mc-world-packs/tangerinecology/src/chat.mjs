/**
 * Text readers for 橘乡 plugins. Pure functions over plain text / chat component JSON.
 * They report what the server displayed; none of them sends a command.
 */

// CraftEngine / CustomNameplates draw icons with private-use glyphs from the server resource pack.
const PRIVATE_USE = /[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]|[\u{100000}-\u{10FFFD}]/gu;

/** Remove resource-pack glyphs (icons, nameplate backgrounds). Returns the visible text and the glyph count. */
export function stripCustomGlyphs(text) {
  const raw = String(text ?? '');
  let glyphs = 0;
  const out = raw.replace(PRIVATE_USE, () => { glyphs++; return ''; }).replace(/[ \t]{2,}/g, ' ').trim();
  return { text: out, glyphs };
}

/**
 * TrChat public line: `[prefix]... name >>> message`. A `>>>` line is a player only when the
 * name is a known online player; plugin notices (e.g. `LiteSignIn >>> ...`) use the same arrow.
 */
export function parseTrChatLine(text, isKnownPlayer = () => false) {
  const { text: clean } = stripCustomGlyphs(text);
  const m = /^(?:[[【(（][^\]】)）]{1,32}[\]】)）]\s*)*([A-Za-z0-9_]{2,16})\s*>>>\s*(.+)$/u.exec(clean);
  if (!m || !isKnownPlayer(m[1])) return null;
  return { sender: m[1], text: m[2].trim() };
}

/** Walk a chat component (JSON or prismarine-chat json) for run_command click actions. */
export function clickCommands(component, limit = 16) {
  const out = [];
  const seen = new Set();
  const visit = (node, depth, label) => {
    if (!node || typeof node !== 'object' || depth > 64 || out.length >= limit) return;
    if (Array.isArray(node)) { for (const part of node) visit(part, depth + 1, label); return; }
    const text = typeof node.text === 'string' ? node.text : '';
    const click = node.clickEvent ?? node.click_event;
    const command = click && (click.action === 'run_command') ? (click.value ?? click.command) : null;
    if (typeof command === 'string' && command.trim() && !seen.has(command)) {
      seen.add(command);
      out.push({ label: stripCustomGlyphs(text || label || '').text.slice(0, 60), command: command.trim().slice(0, 200) });
    }
    for (const key of ['extra', 'with', 'children']) if (node[key]) visit(node[key], depth + 1, text || label);
  };
  visit(component, 0, '');
  return out;
}

const TPA_INCOMING = [
  { re: /^([A-Za-z0-9_]{2,16})\s*请求传送到你的位置/u, kind: 'tpa' },
  { re: /^([A-Za-z0-9_]{2,16})\s*请求你传送到(?:他|她|它|TA|ta)?的?位置/u, kind: 'tpahere' },
];

/**
 * HuskHomes teleport request addressed to this body. `accept`/`deny` are the clickable commands
 * the server attached when present; otherwise the documented `/tpaccept <name>` form.
 */
export function parseTeleportRequest(text, component) {
  const { text: clean } = stripCustomGlyphs(text);
  for (const { re, kind } of TPA_INCOMING) {
    const m = re.exec(clean);
    if (!m) continue;
    const buttons = component ? clickCommands(component) : [];
    const accept = buttons.find((b) => /^\/?(?:huskhomes:)?(?:tpaccept|tpyes)\b/i.test(b.command));
    const deny = buttons.find((b) => /^\/?(?:huskhomes:)?(?:tpdeny|tpdecline|tpno)\b/i.test(b.command));
    return {
      kind, from: m[1],
      accept: accept?.command ?? `/tpaccept ${m[1]}`,
      deny: deny?.command ?? `/tpdeny ${m[1]}`,
      fromClick: !!accept,
    };
  }
  return null;
}

/** Teleport warm-up: moving during it cancels the teleport. */
export function parseTeleportWarmup(text) {
  const { text: clean } = stripCustomGlyphs(text);
  const m = /你将在\s*(\d{1,3})\s*秒后被传送/u.exec(clean);
  if (m) return { state: 'warmup', seconds: Number(m[1]) };
  if (/^传送完成/u.test(clean)) return { state: 'done' };
  if (/传送(?:已)?取消|传送被取消/u.test(clean)) return { state: 'cancelled' };
  return null;
}
