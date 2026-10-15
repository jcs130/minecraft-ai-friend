/** Only the first translation argument identifies the victim; rendered text may name the killer. */
export function isOwnDeathTranslation(message: unknown, name: string, uuid?: string): boolean {
  if (!message || typeof message !== 'object' || !name) return false;
  const value = message as Record<string, any>;
  const raw = value.json ?? value;
  if (typeof raw.translate !== 'string' || !raw.translate.startsWith('death.') || !Array.isArray(raw.with)) return false;
  const component = raw.with[0];
  if (typeof component === 'string') return component.toLowerCase() === name.toLowerCase();
  if (!component || typeof component !== 'object' || Array.isArray(component)) return false;
  const victim = component.json ?? component;
  const hover = victim.hoverEvent;
  if (hover?.action === 'show_entity') {
    const entity = hover.contents ?? hover.value;
    if (entity && typeof entity === 'object' && typeof entity.id === 'string') {
      if (!uuid || entity.type !== 'minecraft:player') return false;
      return entity.id.replaceAll('-', '').toLowerCase() === uuid.replaceAll('-', '').toLowerCase();
    }
  }
  return typeof victim.text === 'string' && victim.text.toLowerCase() === name.toLowerCase();
}
