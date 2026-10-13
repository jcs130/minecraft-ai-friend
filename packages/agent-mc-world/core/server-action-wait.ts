/** 将服务端等待回执与客户端状态关联到目标，暂缓无新观察的重复交互。 */
export class ServerActionWait {
  private recent: { key: string; at: number } | null = null;
  private waiting: { key: string; until: number; reason: string } | null = null;
  private readonly recentUses = new Map<string, { at: number; observation: string }>();
  private readonly repeatUseIntervalMs = 15_000;
  private readonly recentQueries = new Map<string, number>();
  private readonly queryFeedback = new Map<string, {
    count: number; lines: string[]; previousLines: string[]; stableCycles: number;
  }>();
  private readonly queryIntervalMs = 60_000;
  private lastChat: { key: string; at: number } | null = null;
  private readonly repeatCommandIntervalMs = 2_000;

  private key(at: readonly number[]): string {
    return `use:${at.join(',')}`;
  }

  private chatKey(command: string): string {
    return `chat:${command.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  }

  isReadOnlyQuery(command: string): boolean {
    return /^\/\S+(?:\s+\S+)*\s+(?:status|help|board|list|info|rewards)(?:\s|$)/i.test(command.trim());
  }

  /** Only a writable transport's actual block-use packet starts the wait. */
  observeUses(
    protocol: { write(name: string, params?: Record<string, unknown>): unknown; serializer?: { writable: boolean } },
    observation: (at: readonly number[]) => string | undefined,
  ): () => void {
    const originalWrite = protocol.write;
    const guard = this;
    const observedWrite: typeof protocol.write = function (this: typeof protocol, name, params) {
      const location = params?.location as { x?: unknown; y?: unknown; z?: unknown } | undefined;
      const blockUse = name === 'block_place' && protocol.serializer?.writable !== false
        && Number.isInteger(params?.direction) && Number(params?.direction) >= 0 && Number(params?.direction) <= 5
        && location && [location.x, location.y, location.z].every(Number.isSafeInteger);
      const at = blockUse ? [Number(location.x), Number(location.y), Number(location.z)] : null;
      const before = at ? observation(at) : undefined;
      const result = originalWrite.call(this, name, params);
      if (at && before !== undefined) guard.noteUse(at, Date.now(), before);
      return result;
    };
    protocol.write = observedWrite;
    return () => { if (protocol.write === observedWrite) protocol.write = originalWrite; };
  }

  noteUse(at: readonly number[], now = Date.now(), observation?: string): void {
    const key = this.key(at);
    this.recent = { key, at: now };
    for (const [oldKey, entry] of this.recentUses) {
      if (now < entry.at || now - entry.at >= this.repeatUseIntervalMs) this.recentUses.delete(oldKey);
    }
    if (observation !== undefined) this.recentUses.set(key, { at: now, observation });
  }

  noteChat(command: string, now = Date.now()): void {
    if (!command.trim().startsWith('/')) return;
    const key = this.chatKey(command);
    this.recent = { key, at: now };
    this.lastChat = { key, at: now };
    if (this.isReadOnlyQuery(command)) {
      for (const [oldKey, at] of this.recentQueries) {
        if (now - at > 60 * 60_000) {
          this.recentQueries.delete(oldKey);
          this.queryFeedback.delete(oldKey);
        }
      }
      const previous = this.queryFeedback.get(key);
      this.recentQueries.set(key, now);
      this.queryFeedback.set(key, {
        count: 0, lines: [], previousLines: previous?.lines ?? [],
        stableCycles: previous?.stableCycles ?? 0,
      });
    } else {
      // A mutating command may change the very state the query describes.
      this.recentQueries.clear();
      this.queryFeedback.clear();
    }
  }

  /** Returns true only for an unchanged line of the same read-only query. */
  noteFeedback(text: string, now = Date.now()): boolean {
    const use = this.recent;
    if (!use || now - use.at > 3_000 || now < use.at) return false;
    const feedback = this.queryFeedback.get(use.key);
    let unchanged = false;
    if (feedback) {
      unchanged = feedback.previousLines[feedback.count] === text.slice(0, 240);
      feedback.count++;
      if (feedback.lines.length < 3) feedback.lines.push(text.slice(0, 240));
      if (feedback.previousLines.length > 0 && feedback.count === feedback.previousLines.length) {
        feedback.stableCycles = feedback.lines.every((line, i) => line === feedback.previousLines[i])
          ? feedback.stableCycles + 1 : 0;
      }
    }
    const match = /(?:还需|仍需|剩余|还剩|请等待|再等)\s*(\d{1,3})\s*(秒|分钟)/.exec(text);
    if (!match) return unchanged;
    const amount = Number(match[1]);
    if (amount <= 0) return unchanged;
    const duration = amount * (match[2] === '分钟' ? 60_000 : 1_000);
    this.waiting = { key: use.key, until: now + duration, reason: text };
    this.recent = null;
    return unchanged;
  }

  blockReason(at: readonly number[], now = Date.now(), observation?: string): string | null {
    const key = this.key(at);
    const wait = this.blockKey(key, now);
    if (wait) return wait;
    const last = this.recentUses.get(key);
    if (!last || observation === undefined) return null;
    if (now < last.at || now - last.at >= this.repeatUseIntervalMs || observation !== last.observation) {
      this.recentUses.delete(key);
      return null;
    }
    return `同一格刚右键过，现场可见状态没有变化；还需等 ${Math.ceil((this.repeatUseIntervalMs - (now - last.at)) / 1_000)} 秒再试，先核对实际回执或换做法`;
  }

  blockChat(command: string, now = Date.now()): string | null {
    if (!command.trim().startsWith('/')) return null;
    const key = this.chatKey(command);
    const wait = this.blockKey(key, now);
    if (wait) return wait;
    if (!this.isReadOnlyQuery(command)) {
      const last = this.lastChat;
      if (last?.key === key && now >= last.at && now - last.at < this.repeatCommandIntervalMs) {
        return `相同游戏命令刚发送过；还需等 ${Math.ceil((this.repeatCommandIntervalMs - (now - last.at)) / 1_000)} 秒再试，先等待实际回执`;
      }
      return null;
    }
    const feedback = this.queryFeedback.get(key);
    const interval = feedback?.stableCycles
      ? feedback.stableCycles >= 2 ? 15 * 60_000 : 5 * 60_000
      : this.queryIntervalMs;
    const last = this.recentQueries.get(key);
    if (last === undefined || now - last >= interval || now < last) return null;
    const receipt = feedback?.count
      ? `上次收到 ${feedback.count} 条服务端回执：${feedback.lines.join('；')}。`
      : '上次查询尚无服务端回执。';
    const stable = feedback?.stableCycles ? '服务端状态连续未变化；先做其他事，状态改变后再核对。' : '';
    return `同一只读查询刚发送过；还需等 ${Math.ceil((interval - (now - last)) / 1_000)} 秒再查。${receipt}${stable}先根据回执行动`;
  }

  private blockKey(key: string, now: number): string | null {
    const wait = this.waiting;
    if (!wait) return null;
    if (now >= wait.until) {
      this.waiting = null;
      return null;
    }
    if (wait.key !== key) return null;
    return `服务端刚提示「${wait.reason}」；同一目标还需等 ${Math.ceil((wait.until - now) / 1_000)} 秒，先做其他事或等到时间再试`;
  }
}
