/** BossBar is a packet format; its title determines what the server is displaying. */
export function classifyBossBarTitle(title: string): 'skillExperience' | 'boss' | 'status' {
  const text = title.trim();
  if (/^\+\d+(?:\.\d+)?\s+.+?\s+经验\s*[（(]\d+(?:\.\d+)?%[）)]$/.test(text)) {
    return 'skillExperience';
  }
  if (/^(?:凋灵|末影龙|Wither|Ender Dragon)$/i.test(text)) return 'boss';
  return 'status';
}
