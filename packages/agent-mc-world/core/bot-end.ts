/**
 * Idempotent Mineflayer disconnect. A status/ping failure can leave a bot
 * without `quit` attached; callers must not throw in that case.
 */
export type EndableBot = {
  quit?: (reason?: string) => void;
  end?: (reason?: string) => void;
  _client?: {
    end?: (reason?: string) => void;
    destroy?: (err?: Error) => void;
    socket?: { destroy?: () => void };
  };
} | null | undefined;

export function endMinecraftBot(bot: EndableBot, reason?: string): void {
  if (!bot) return;
  try {
    if (typeof bot.quit === 'function') {
      bot.quit(reason);
      return;
    }
    if (typeof bot.end === 'function') {
      bot.end(reason);
      return;
    }
    if (typeof bot._client?.end === 'function') {
      bot._client.end(reason);
      return;
    }
    bot._client?.destroy?.();
    bot._client?.socket?.destroy?.();
  } catch {
    try {
      bot._client?.end?.(reason);
    } catch {
      try { bot._client?.socket?.destroy?.(); } catch { /* already gone */ }
    }
  }
}
