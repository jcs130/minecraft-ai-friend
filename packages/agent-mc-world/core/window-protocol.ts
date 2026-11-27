import { minecraftTextComponent, unwrapNbt, windowTitleText } from './nbt-text.mjs';

type PacketClient = {
  on(event: string, handler: (packet: any) => void): void;
  off(event: string, handler: (packet: any) => void): void;
  prependListener?(event: string, handler: (packet: any) => void): void;
};

/** Rewrite anonymous-NBT window titles to readable text before Mineflayer stores them. */
export function installWindowTitleUnwrap(bot: { _client?: PacketClient | any }): () => void {
  const client = bot._client;
  if (!client) return () => {};
  const onOpen = (packet: Record<string, unknown>): void => {
    if (packet.windowTitle === undefined || typeof packet.windowTitle === 'string') return;
    const raw = packet.windowTitle;
    const text = windowTitleText(raw);
    packet.rawWindowTitle = raw;
    if (text) packet.windowTitle = text;
  };
  if (typeof client.prependListener === 'function') client.prependListener('open_window', onOpen);
  else client.on('open_window', onOpen);
  return () => client.off('open_window', onOpen);
}

function componentData(item: {
  componentMap?: Map<string, { data?: unknown }>;
  components?: Array<{ type?: string; data?: unknown }>;
} | null | undefined, type: string): unknown {
  if (!item) return undefined;
  return item.componentMap?.get(type)?.data
    ?? item.componentMap?.get(`minecraft:${type}`)?.data
    ?? item.components?.find((entry) => entry.type === type || entry.type === `minecraft:${type}`)?.data;
}

function filterableText(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if ('raw' in value) return value.raw;
  if ('content' in value) return filterableText(value.content);
  return value;
}

export interface ReadableBook {
  title: string;
  author: string;
  pages: readonly unknown[] | null;
}

type BookItem = NonNullable<Parameters<typeof componentData>[0]> & {
  name?: string; id?: string; customName?: unknown; nbt?: unknown;
};
const plain = (text: unknown, limit: number) =>
  minecraftTextComponent(text, { limit }).replace(/§[\da-fk-orx]/gi, '');

/** Inspect native written/writable item components or legacy book NBT, without using the item. */
export function readBookItem(value: unknown): ReadableBook | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as BookItem;
  const name = (item.name ?? item.id ?? '').replace(/^minecraft:/, '');
  const component = componentData(item, 'written_book_content') ?? componentData(item, 'writable_book_content');
  if (component === undefined && name !== 'written_book' && name !== 'writable_book') return null;
  const content = unwrapNbt(component ?? item.nbt) as { rawTitle?: unknown; title?: unknown; author?: unknown; pages?: unknown } | unknown[] | undefined;
  const customName = componentData(item, 'custom_name') ?? item.customName;
  const metadata = Array.isArray(content) ? undefined : content;
  const pages = Array.isArray(content) ? content : Array.isArray(metadata?.pages) ? metadata.pages : null;
  return { title: plain(filterableText(metadata?.rawTitle ?? metadata?.title), 160) || plain(unwrapNbt(customName), 160),
    author: plain(metadata?.author, 160), pages };
}

export function bookPage(book: ReadableBook, page: unknown) {
  if (!Number.isSafeInteger(page) || Number(page) < 1) throw Error('书页用从 1 开始的页码。');
  if (!book.pages) throw Error('当前客户端未收到这本书的正文。');
  if (Number(page) > book.pages.length) throw Error(`当前书共有 ${book.pages.length} 页。`);
  const text = plain(filterableText(book.pages[Number(page) - 1]), 4097);
  return { page: Number(page), pageCount: book.pages.length, text: text.slice(0, 4096),
    truncated: text.length > 4096, nextPage: Number(page) < book.pages.length ? Number(page) + 1 : null };
}

/** Compare a server-returned book to submitted plain text, preserving whitespace. */
export function bookMatchesPages(book: ReadableBook, pages: readonly string[]): boolean {
  return book.pages?.length === pages.length && book.pages.every((value, i) => {
    const raw = filterableText(value);
    return typeof raw === 'string' ? raw === pages[i]
      : minecraftTextComponent(raw, { trim: false, limit: 4096 }) === pages[i];
  });
}

export function readInventoryBook(slots: readonly unknown[], windowSlot: unknown, page: unknown) {
  if (windowSlot === undefined) {
    if (page !== undefined) throw Error('翻页前请选取目录返回的 windowSlot。');
    return { books: slots.slice(9, 46).flatMap((item, index) => {
      const book = readBookItem(item);
      return book ? [{ windowSlot: index + 9, title: book.title, author: book.author, pageCount: book.pages?.length ?? null }] : [];
    }) };
  }
  if (!Number.isSafeInteger(windowSlot) || Number(windowSlot) < 9 || Number(windowSlot) > 45)
    throw Error('书本槽位应为背包目录返回的 windowSlot（9–45）。');
  const book = readBookItem(slots[Number(windowSlot)]);
  if (!book) throw Error('该槽位当前不是书本；重新查背包的书本目录。');
  return { windowSlot: Number(windowSlot), title: book.title, author: book.author, ...bookPage(book, page ?? 1) };
}

/** Read the book from the exact hand named by the native packet. */
export function readOpenedBook(bot: { heldItem?: unknown; inventory?: { slots?: unknown[] } },
  packet: Record<string, unknown> = {}): ReadableBook {
  const offhand = packet.hand === 1 || packet.hand === 'off_hand' || packet.hand === 'offhand';
  return readBookItem(offhand ? bot.inventory?.slots?.[45] : bot.heldItem) ?? { title: '', author: '', pages: null };
}
