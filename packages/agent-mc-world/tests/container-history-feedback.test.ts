import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { expect, it, vi } from 'vitest';
import { ChestBook } from '../core/chests.ts';
import { knownChestNote, noContainerNearby } from '../core/containers.ts';
import type { SkillContext } from '../core/skill-context.ts';

const registry = minecraftData('1.21.1');
function fixture(block: string | null) {
  const book = new ChestBook(null);
  book.remember('minecraft:overworld', { x: -473, y: 67, z: -489 }, [{ name: 'bread', count: 4 }], 1, 27);
  book.remember('minecraft:the_nether', { x: -473, y: 69, z: -489 }, [{ name: 'diamond', count: 1 }], 1, 27);
  const read = vi.fn((p: Vec3) => {
    expect(p).toEqual(new Vec3(-473, 67, -489));
    return block === null ? null : { name: registry.blocksByName[block].name };
  });
  const bot = { entity: { position: new Vec3(-473, 69, -489) }, game: { dimension: 'minecraft:overworld' }, blockAt: read } as unknown as Bot;
  return { book, bot, read };
}

it('reports the live contradiction without erasing or refreshing historical chest contents', () => {
  const { book, bot, read } = fixture('grass_block');
  const before = JSON.stringify(book.chestsIn('minecraft:overworld'));
  const note = knownChestNote(bot, book)!;
  expect(note).toContain('(-473, 67, -489)');
  expect(note).toContain(new Date(book.chestsIn('minecraft:overworld')[0].observedAt!).toISOString());
  expect(note).toContain('不是容器，不能沿用旧箱位置与库存');
  expect(note).not.toContain('diamond');
  expect(read).toHaveBeenCalledOnce();
  expect(JSON.stringify(book.chestsIn('minecraft:overworld'))).toBe(before);
});

it('distinguishes an unloaded historical location from a currently visible container', () => {
  const unknown = fixture(null);
  expect(noContainerNearby(unknown.bot, { chests: unknown.book } as SkillContext).message).toContain('当前已加载方块中');
  expect(knownChestNote(unknown.bot, unknown.book)).toContain('该格当前未加载，现状未知');
  const present = fixture('chest');
  expect(knownChestNote(present.bot, present.book)).toContain('内容仍须开窗核验');
});
