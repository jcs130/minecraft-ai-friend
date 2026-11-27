/** Read the recipe data actually delivered to this client connection. */
import type { Bot } from 'mineflayer';
import { onConnectionEnd } from './connection-end.ts';
import { zhName } from './names.ts';

type Packet = Record<string, unknown>;
type Display =
  | { item: string; count?: number; components?: true }
  | { tag: string } | { anyFuel: true } | { anyOf: Display[] }
  | { input: Display; remainder: Display | null } | { unrecovered: true };
type Recipe = {
  id: string;
  type: string;
  result: Extract<Display, { item: string }>;
  station: Display | null;
  ingredients: Array<Display | null>;
  grid?: Array<Array<Display | null>>;
  ticks?: number;
};
type Book = {
  entries: Map<string, Recipe>;
  sampledAt: string | null;
  packet: 'declare_recipes' | 'recipe_book_add' | null;
};
const MAX_ENTRIES = 4096;
const books = new WeakMap<Bot, Book>();
const object = (value: unknown): Packet => value && typeof value === 'object' && !Array.isArray(value) ? value as Packet : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const resource = (value: unknown): value is string => typeof value === 'string' && value.length <= 120
  && /^[a-z0-9_.-]+:[a-z0-9_.\/-]+$/.test(value);

function item(bot: Bot, id: unknown): Display {
  const name = integer(id, 0, 1_000_000) ? bot.registry?.items?.[id]?.name : undefined;
  return name ? { item: name } : { unrecovered: true };
}

function stack(bot: Bot, raw: unknown): Display | null {
  const slot = object(raw);
  const count = slot.itemCount;
  if (count === 0) return null;
  const value = item(bot, slot.itemId);
  if (!('item' in value)) return value;
  return { ...value, count: integer(count, 1, 127) ? count : 1,
    ...(list(slot.components).length || Number(slot.addedComponentCount) > 0 ? { components: true } : {}) };
}

function display(bot: Bot, raw: unknown, depth = 0): Display | null {
  if (depth > 3) return { unrecovered: true };
  const { type, data } = object(raw);
  switch (type) {
    case 'empty': return null;
    case 'item': return item(bot, data);
    case 'item_stack': return stack(bot, data);
    case 'tag': return resource(data) ? { tag: data } : { unrecovered: true };
    case 'any_fuel': return { anyFuel: true };
    case 'composite': {
      const choices = list(data);
      return choices.length <= 24 ? { anyOf: choices.map(value => display(bot, value, depth + 1))
        .filter((row): row is Display => row !== null) } : { unrecovered: true };
    }
    case 'with_remainder': {
      const row = object(data);
      const input = display(bot, row.input, depth + 1);
      return { input: input ?? { unrecovered: true }, remainder: display(bot, row.remainder, depth + 1) };
    }
    default: return { unrecovered: true };
  }
}

function legacyIngredient(bot: Bot, raw: unknown): Display | null {
  const choices = list(raw);
  if (!choices.length) return null;
  if (choices.length > 24) return { unrecovered: true };
  const values = choices.map(value => stack(bot, value)).filter((row): row is Display => row !== null);
  return values.length === 1 ? values[0]! : { anyOf: values };
}

function row(bot: Bot, packet: unknown, legacy: boolean): Recipe | null {
  const value = object(packet);
  const fields = legacy ? value : object(value.recipe);
  const key = legacy ? fields.name : fields.displayId;
  if (legacy ? !resource(key) : !integer(key, 0, 1_000_000)) return null;
  const recipe = legacy ? fields : object(fields.display);
  const type = String(recipe.type ?? '').replace(/^minecraft:/, '');
  const data = object(recipe.data);
  const output = legacy ? stack(bot, data.result) : display(bot, data.result);
  if (!output || !('item' in output)) return null;
  const decode = legacy ? legacyIngredient : display;
  const station = legacy ? null : display(bot, data.craftingStation);
  const out: Recipe = { id: legacy ? String(key) : `display/${key}`, type, result: output, station, ingredients: [] };
  if (type === 'crafting_shaped') {
    const width = legacy ? data.gridWidth ?? object(data.grid).width : data.width;
    const height = legacy ? data.gridHeight ?? object(data.grid).height : data.height;
    if (!integer(width, 1, 3) || !integer(height, 1, 3)) return null;
    const cells = list(data.ingredients);
    // Legacy separators describe network layout; flatten in wire order while
    // retaining each ingredient's list of alternative item stacks.
    const raw = legacy ? cells.flatMap(cell => list(cell)) : cells;
    if (raw.length !== width * height) return null;
    out.ingredients = raw.map(value => decode(bot, value));
    out.grid = Array.from({ length: height }, (_, y) => out.ingredients.slice(y * width, (y + 1) * width));
  } else if (type === 'crafting_shapeless') {
    const raw = list(data.ingredients);
    if (raw.length < 1 || raw.length > 9) return null;
    out.ingredients = raw.map(value => decode(bot, value));
  } else if (['furnace', 'smelting', 'blasting', 'smoking', 'campfire_cooking', 'stonecutter', 'stonecutting'].includes(type)) {
    out.ingredients = [decode(bot, data.ingredient)];
    const ticks = data.duration ?? data.cookTime;
    if (integer(ticks, 0, 1_000_000)) out.ticks = ticks;
  } else if (['smithing', 'smithing_transform'].includes(type)) {
    out.ingredients = [data.template, data.base, data.addition].map(value => decode(bot, value));
  } else return null;
  return out;
}

export function installServerRecipeBook(bot: Bot): () => void {
  const book: Book = { entries: new Map(), sampledAt: null, packet: null };
  books.set(bot, book);
  const mark = (packet: Book['packet']) => { book.packet = packet; book.sampledAt = new Date().toISOString(); };
  const ingest = (value: unknown, legacy: boolean) => {
    const body = object(value);
    const raw = legacy ? body.recipes : body.entries;
    if (!Array.isArray(raw)) return;
    // Modern declare_recipes is a property-set / stonecutter index. Only the
    // pre-1.21.2 packet actually declares the complete recipe bodies.
    if (legacy && !/^1\.21(?:\.1)?$/.test(bot.version)) return;
    if (legacy || body.replace === true) book.entries.clear();
    for (const entry of raw.slice(0, MAX_ENTRIES)) {
      const recipe = row(bot, entry, legacy);
      if (recipe && (book.entries.size < MAX_ENTRIES || book.entries.has(recipe.id))) book.entries.set(recipe.id, recipe);
    }
    mark(legacy ? 'declare_recipes' : 'recipe_book_add');
  };
  const replaced = (data: unknown) => ingest(data, true);
  const added = (data: unknown) => ingest(data, false);
  const removed = (value: unknown) => {
    for (const id of list(object(value).recipeIds).slice(0, MAX_ENTRIES))
      if (integer(id, 0, 1_000_000)) book.entries.delete(`display/${id}`);
    if (book.packet === 'recipe_book_add') mark('recipe_book_add');
  };
  const reset = () => { book.entries.clear(); book.sampledAt = null; book.packet = null; };
  const listeners = { declare_recipes: replaced, recipe_book_add: added, recipe_book_remove: removed, start_configuration: reset };
  for (const [event, handler] of Object.entries(listeners)) bot._client.on(event, handler);
  const detach = onConnectionEnd(bot, dispose);
  function dispose() {
    for (const [event, handler] of Object.entries(listeners)) bot._client.off(event, handler);
    detach();
    if (books.get(bot) === book) books.delete(bot);
  }
  return dispose;
}

const keyOf = (text: string) => text.normalize('NFKC').toLowerCase().replace(/^minecraft:/, '').replace(/[\s_-]/g, '');
function match(value: string, query: string): number {
  if (value === query) return 100;
  if (value.startsWith(query)) return 80;
  if (value.includes(query)) return 60;
  if (query.length >= 2 && /^\p{Script=Han}+$/u.test(query)) {
    let cursor = 0;
    for (const character of query) {
      const found = value.indexOf(character, cursor);
      if (found === -1) return 0;
      cursor = found + 1;
    }
    return 25;
  }
  if (!/^[a-z0-9]{5,}$/.test(query)) return 0;
  for (let index = 0; index < query.length; index++) {
    const first = query.slice(0, index), last = query.slice(index + 1);
    if (value === first + last || value.length === query.length && value.startsWith(first) && value.endsWith(last)) return 40;
  }
  for (let index = 0; index < value.length; index++) if (value.slice(0,index) + value.slice(index+1) === query) return 40;
  return 0;
}

export function readServerRecipeBook(bot: Bot | null | undefined, args: Record<string, unknown>, profile?: string): Record<string, unknown> {
  const book = bot ? books.get(bot) : undefined;
  const action = args.action ?? (args.id === undefined ? 'search' : 'get');
  const offset = args.offset ?? 0, limit = args.limit ?? 5;
  if (!integer(offset, 0, MAX_ENTRIES) || !integer(limit, 1, 10)
      || args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 120)
      || args.kind !== undefined && args.kind !== 'recipe' || !['search', 'get', 'help'].includes(String(action)))
    throw new Error('Use source:recipe_book with query or id, and optional limit/offset');
  const coverage = book?.packet === 'recipe_book_add' ? 'unlocked-recipe-displays'
    : book?.packet === 'declare_recipes' ? 'declared-recipe-definitions' : 'unobserved';
  const base = { protocol: 'agent-mc-server-recipes/v1', source: 'server-recipe-book', profile: profile ?? null,
    version: bot?.version ?? null, packet: book?.packet ?? null, sampledAt: book?.sampledAt ?? null, coverage,
    note: '现代版只囊括服务器已发送的解锁配方。查不到不代表服务器没有；配方不代表当前材料、权限或做成。display ID 仅用于当前连接。' };
  if (action === 'help') return { ...base, example: { source: 'recipe_book', query: '铁胸', limit: 3 } };
  const query = keyOf(String(args.query ?? '').trim());
  const id = args.id;
  if (action === 'get' && (typeof id !== 'string' || !resource(id) && !/^display\/\d{1,7}$/.test(id))) throw new Error('Invalid recipe book id');
  const rows = action === 'get' ? [book?.entries.get(String(id))].filter((recipe): recipe is Recipe => !!recipe)
    : [...(book?.entries.values() ?? [])].map(recipe => {
      const name = recipe.result.item;
      return { recipe, score: !query ? 1 : Math.max(match(keyOf(name), query), match(keyOf(zhName(name)), query)) };
    }).filter(value => value.score > 0).sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id)).map(value => value.recipe);
  return { ...base, total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null,
    entries: rows.slice(offset, offset + limit).map(recipe => ({ ...recipe, title: zhName(recipe.result.item) })) };
}
