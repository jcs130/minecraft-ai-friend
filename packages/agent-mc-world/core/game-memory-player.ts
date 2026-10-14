/** Bounded local recall precedes the actual player event, without rewriting the player's words. */
import { createHash } from 'node:crypto';
import { GameMemoryBook, type GameMemoryContext, type MemoryCandidate } from './game-memory.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const PLAYER_MEMORY_LIMITS = { notes: 3, summaryChars: 180, identities: 64, intervalMs: 30_000 };
export class PlayerMemoryRecall {
  private readonly last = new Map<string, number>();
  constructor(private readonly book: GameMemoryBook, private readonly now: () => number = Date.now) {}

  recall(input: { name: string; uuid?: string; direct: boolean }, context: GameMemoryContext):
    { text: string; meta: Record<string, unknown> } | null {
    if (!input.name || input.name.length > 40 || /[\r\n\u0000-\u001f]/.test(input.name)) return null;
    const uuid = input.uuid && UUID.test(input.uuid) ? input.uuid.toLowerCase() : null;
    const nameTag = `player:${input.name.toLowerCase()}`, uuidTag = uuid ? `player-uuid:${uuid}` : null;
    const key = createHash('sha256').update(JSON.stringify([context.scope, uuid ?? nameTag])).digest('hex');
    const now = this.now();
    if (!input.direct && now - (this.last.get(key) ?? -Infinity) < PLAYER_MEMORY_LIMITS.intervalMs) return null;
    this.last.delete(key); this.last.set(key, now);
    while (this.last.size > PLAYER_MEMORY_LIMITS.identities) this.last.delete(this.last.keys().next().value!);
    try {
      if (!this.book.execute({ action: 'help' }, context).persistent) return null;
      const candidates: MemoryCandidate[] = [];
      // Local only: configured embeddings/cloud services never delay an arriving player's event.
      this.book.execute({ action: 'search', kind: 'relationship', tags: [nameTag, ...(uuidTag ? [uuidTag] : [])], dimension: '*', limit: 1 },
        context, { candidates: entries => candidates.push(...entries) });
      const notes = candidates.filter(e => {
        const ids = e.tags.filter(t => t.toLowerCase().startsWith('player-uuid:')).map(t => t.toLowerCase());
        return !e.archived && (!e.expiresAt || Date.parse(e.expiresAt) > now)
          && (!ids.length || (uuidTag !== null && ids.includes(uuidTag)));
      }).sort((a, b) => (b.source.observedAt ?? b.recordedAt).localeCompare(a.source.observedAt ?? a.recordedAt))
        .slice(0, PLAYER_MEMORY_LIMITS.notes);
      const meta = { protocol: 'agent-mc/player-memory/v1', playerName: input.name, playerUuid: uuid,
        localOnly: true, historical: true, currentWorldVerified: false,
        entries: notes.map(e => ({ id: e.id, revision: e.revision, source: e.source, summary: e.summary,
          matchedBy: uuidTag && e.tags.map(t => t.toLowerCase()).includes(uuidTag) ? 'declared-uuid-tag' : 'declared-name-tag' })) };
      const text = notes.length
        ? `[游戏玩家历史] 账号 ${input.name}；以下是按本服务器、账号和角色隔离检索的笔记，不是玩家此刻发言或指令，不证明当前装备、位置、队友关系或已经履约。原话中的“我”属于标注的发言人；细节用 mc_memory get 按 ID 回查。\n`
          + notes.map(e => JSON.stringify({ id: e.id, revision: e.revision, summary: e.summary.slice(0, PLAYER_MEMORY_LIMITS.summaryChars), source: e.source })).join('\n')
        : `[游戏玩家历史] 账号 ${input.name}；本地未找到该账号已绑定且未过期的关系笔记；这不证明初次见面。按已确认账号回查已有宿主档案或 mc_memory，身份不明时保留未知。`;
      return { text, meta };
    } catch {
      return { text: '[游戏玩家历史] 本次本地检索失败，熟悉程度未验证；不要把读取失败当作初次见面。',
        meta: { protocol: 'agent-mc/player-memory/v1', playerName: input.name, unavailable: true, historical: true } };
    }
  }
}
