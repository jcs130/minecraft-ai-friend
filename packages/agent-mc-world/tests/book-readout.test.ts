import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { bookPage, readBookItem, readInventoryBook } from '../core/window-protocol.ts';
import { installServerScreens, serverScreen } from '../core/server-screens.ts';
import { readOpenWindow } from '../core/window-readout.ts';

const atSlot = (item: unknown, slot = 36) => Object.assign(Array(46).fill(null), { [slot]: item });

it('reads signed filterable pages from the current inventory by exact window slot and preserves blank pages', () => {
  const item = { name: 'written_book', components: [{ type: 'minecraft:written_book_content', data: {
    title: { raw: '§6新手指南' }, author: '服方',
    pages: [{ raw: { text: '阅读 ', extra: [{ text: '菜单', clickEvent: { action: 'run_command', value: '/test' } }] } },
      { raw: '' }, { content: { text: '第三页' } }],
  } }] };
  const slots = atSlot(item);
  slots[37] = { name: 'book' };
  expect(readInventoryBook(slots, undefined, undefined)).toEqual({ books: [{ windowSlot: 36, title: '新手指南', author: '服方', pageCount: 3 }] });
  expect(readInventoryBook(slots, 36, 1)).toMatchObject({ text: '阅读 菜单', pageCount: 3, nextPage: 2 });
  expect(readInventoryBook(slots, 36, 2)).toMatchObject({ text: '', page: 2, nextPage: 3 });
  expect(readInventoryBook(slots, 36, 3)).toMatchObject({ text: '第三页', nextPage: null });
  expect(() => readInventoryBook(slots, 36, 4)).toThrow('3');
  expect(() => readInventoryBook(slots, 37, 1)).toThrow('不是书本');
});

it('reads legacy NBT and indicates a missing payload instead of guessing from the title', () => {
  const item = { name: 'written_book', nbt: { type: 'compound', value: {
    title: { type: 'string', value: '命格书' },
    pages: { type: 'list', value: { type: 'string', value: ['{"text":"命格说明"}'] } },
  } } };
  expect(readInventoryBook(atSlot(item, 45), 45, 1)).toMatchObject({ title: '命格书', text: '命格说明' });
  const missing = { name: 'written_book', customName: '命格书' };
  expect(readInventoryBook(atSlot(missing), undefined, undefined)).toMatchObject({ books: [{ pageCount: null }] });
  expect(() => readInventoryBook(atSlot(missing), 36, 1)).toThrow('未收到');
});

it('reads the actual modern packet field names including rawTitle and anonymous NBT content', () => {
  const item = { name: 'written_book', componentMap: new Map([['written_book_content', { data: {
    rawTitle: '命格书', author: '千灯纪', pages: [{ content: { type: 'string', value: '可用技能点见第一页。' } }],
  } }]]) };
  expect(readInventoryBook(atSlot(item), 36, 1)).toMatchObject({ title: '命格书', author: '千灯纪', text: '可用技能点见第一页。' });
});

it('uses the offhand for a native opened book and exposes later pages without serializing the book by default', () => {
  const book = { name: 'writable_book', components: [{ type: 'writable_book_content', data: {
    pages: Array.from({ length: 26 }, (_, i) => ({ raw: `page ${i + 1}` })),
  } }] };
  const client = Object.assign(new EventEmitter(), { write() {} });
  const bot = Object.assign(new EventEmitter(), { _client: client, heldItem: { name: 'book' }, inventory: { slots: atSlot(book, 45) } });
  const detach = installServerScreens(bot);
  try {
    client.emit('open_book', { hand: 1 });
    const screen = serverScreen(bot);
    expect(screen?.bookPageCount).toBe(26);
    expect(bookPage(screen!.book!, 26)).toMatchObject({ text: 'page 26', nextPage: null });
    const publicData = readOpenWindow(bot);
    expect(publicData.screen?.book).toBeUndefined();
    expect(JSON.stringify(publicData)).not.toContain('page 26');
    expect(bookPage(readBookItem({ name: 'written_book', components: [{ type: 'written_book_content', data: { pages: ['x'.repeat(5000)] } }] })!, 1)).toMatchObject({ truncated: true });
  } finally { detach(); }
});
