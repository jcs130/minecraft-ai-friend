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

function pageTexts(value: unknown): string[] {
  const unwrapped = unwrapNbt(value) as { pages?: unknown; content?: unknown } | unknown[] | undefined;
  const pages = Array.isArray(unwrapped) ? unwrapped
    : unwrapped && typeof unwrapped === 'object' && Array.isArray((unwrapped as { pages?: unknown }).pages)
      ? (unwrapped as { pages: unknown[] }).pages
      : [];
  return pages.map((page) => {
    const body = page && typeof page === 'object' && 'content' in (page as object)
      ? (page as { content: unknown }).content : page;
    return minecraftTextComponent(body);
  }).filter(Boolean);
}

export interface OpenedBook {
  hand: string | null;
  title: string;
  author: string;
  pages: string[];
}

/** Read title, author and pages of the written book in the hand that `open_book` named. */
export function readOpenedBook(bot: {
  heldItem?: unknown;
  inventory?: { slots?: unknown[] };
}, packet: Record<string, unknown> = {}): OpenedBook {
  const hand = typeof packet.hand === 'string' ? packet.hand
    : packet.hand === 1 ? 'off_hand' : 'main_hand';
  const item = hand === 'off_hand'
    ? (bot.inventory?.slots?.[45] as { componentMap?: Map<string, { data?: unknown }>; nbt?: unknown; customName?: unknown } | undefined)
    : bot.heldItem as { componentMap?: Map<string, { data?: unknown }>; nbt?: unknown; customName?: unknown } | undefined;
  const content = componentData(item, 'written_book_content') ?? item?.nbt;
  const unwrapped = unwrapNbt(content) as { title?: unknown; author?: unknown; pages?: unknown } | undefined;
  const titleValue = unwrapped && typeof unwrapped === 'object' ? unwrapped.title : undefined;
  const title = minecraftTextComponent(
    titleValue && typeof titleValue === 'object' && 'raw' in (titleValue as object)
      ? (titleValue as { raw: unknown }).raw : titleValue,
  ) || minecraftTextComponent(item?.customName);
  const author = typeof unwrapped?.author === 'string' ? unwrapped.author : minecraftTextComponent(unwrapped?.author);
  const pages = pageTexts(unwrapped ?? content).map((page) => page.slice(0, 800)).slice(0, 20);
  return { hand, title, author, pages };
}

/** Observe `open_book` and read written_book_content from the used hand. */
export function installOpenBookObserver(bot: {
  _client?: PacketClient | any;
  heldItem?: unknown;
  inventory?: { slots?: unknown[] };
}, onBook: (book: OpenedBook) => void): () => void {
  const client = bot._client;
  if (!client) return () => {};
  const onOpen = (packet: Record<string, unknown>): void => {
    onBook(readOpenedBook(bot, packet));
  };
  client.on('open_book', onOpen);
  return () => client.off('open_book', onOpen);
}
