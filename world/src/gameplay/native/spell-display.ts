import type { NativeSpell } from './contracts.ts'

/** Vanilla item proxies work in the compass and the existing staff HUD without
 * requiring another client resource pack. Native spell textures are not items. */
export function nativeSpellIcon(spell: Pick<NativeSpell, 'id'> & { school?: unknown }): string {
  const school = typeof spell.school === 'string' ? spell.school.split(':').at(-1) : ''
  return ({ fire: 'minecraft:blaze_powder', ice: 'minecraft:blue_ice',
    lightning: 'minecraft:lightning_rod', holy: 'minecraft:golden_apple',
    nature: 'minecraft:oak_sapling', ender: 'minecraft:ender_pearl',
    blood: 'minecraft:fermented_spider_eye', evocation: 'minecraft:amethyst_shard',
    eldritch: 'minecraft:echo_shard' } as Record<string, string>)[school ?? ''] ?? 'minecraft:enchanted_book'
}
