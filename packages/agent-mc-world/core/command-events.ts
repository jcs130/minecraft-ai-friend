const commandListeners = new WeakMap<object, Set<(text: string) => void>>();

export function publishViewerCastCommand(bot: object, text: string): void {
  for (const listener of commandListeners.get(bot) ?? []) listener(text);
}

export function observeViewerCastCommands(bot: object, listener: (text: string) => void): () => void {
  let listeners = commandListeners.get(bot);
  if (!listeners) { listeners = new Set(); commandListeners.set(bot, listeners); }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

