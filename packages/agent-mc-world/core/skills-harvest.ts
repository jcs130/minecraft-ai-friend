/** Exact, revalidated work cells. NPC task mechanics are implemented through player actions. */
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { SkillBlocked, checkAbort, type SkillContext } from './skill-context.ts';
import type { SkillCall } from './skills.ts';
import { blockAtCell, cellText, resolveAt } from './cell-facts.ts';
import { cropAgeAt } from './terrain.ts';
import { invCount } from './inventory.ts';
import { skillCollect } from './skills-gather.ts';
import { skillUse } from './skills-interact.ts';
import { walkOnlyPath } from './travel.ts';

export const REPLANT_SEEDS: Readonly<Record<string, string>> = Object.freeze({
  wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato', beetroots: 'beetroot_seeds',
});

/** One executor step owns harvest + replant; interruption never pretends to roll back a harvested crop. */
export async function skillHarvest(bot: Bot, call: Extract<SkillCall, { skill: 'harvest' }>, ctx: SkillContext): Promise<string> {
  checkAbort(ctx);
  const cell = resolveAt(bot, call.at);
  const position = new Vec3(cell.x, cell.y, cell.z);
  const target = blockAtCell(bot, cell);
  if (!target || target.name !== call.block) throw new SkillBlocked(
    `${cellText(cell)} ${target ? `实际是 ${target.name}，需要 ${call.block}` : '尚未加载'}；没有改采别处`,
    [], 'local', 'target-not-ready');
  const seed = call.replant ? REPLANT_SEEDS[call.block] : undefined;
  if (call.replant && !seed) throw new SkillBlocked(`补种只支持 ${Object.keys(REPLANT_SEEDS).join('/')}，未收割`);
  const soil = { x: cell.x, y: cell.y - 1, z: cell.z };
  if (seed) {
    const age = cropAgeAt(bot, position);
    if (!age || age.value < age.max) throw new SkillBlocked(`${cellText(cell)} 的 ${call.block} 未成熟，保留植株`,
      [], 'local', 'target-not-ready');
    if (blockAtCell(bot, soil)?.name !== 'farmland') throw new SkillBlocked(`${cellText(soil)} 不是耕地，未收割`);
    if (invCount(bot, name => name === seed) < 1) throw new SkillBlocked(`缺少预留补种材料 ${seed}×1，未收割`,
      [], 'local', 'resource-unavailable');
  }
  const release = walkOnlyPath(bot);
  let collected = '';
  let harvestError: SkillBlocked | undefined;
  try {
    try {
      collected = await skillCollect(bot, call.block, 1, ctx, false, !!seed, call.tool, cell);
    } catch (error) {
      // A broken crop with an unconfirmed drop still needs replanting, if the capability is live.
      if (!(error instanceof SkillBlocked) || !seed || blockAtCell(bot, cell)?.name !== 'air') throw error;
      harvestError = error;
    }
    checkAbort(ctx);
    if (!seed) return collected;
    if (blockAtCell(bot, cell)?.name !== 'air' || blockAtCell(bot, soil)?.name !== 'farmland') {
      throw new SkillBlocked(`收割后 ${cellText(cell)} 或其耕地已改变，未覆盖方块；须核验并补种。${collected}`, [], 'server');
    }
    if (invCount(bot, name => name === seed) < 1) throw new SkillBlocked(
      `已收割 ${cellText(cell)}，但补种材料 ${seed} 不在包里；须核验并补种。${collected}`, [], 'server');
    const planted = await skillUse(bot, { skill: 'use', item: seed, at: [soil.x, soil.y, soil.z], face: 'up' }, ctx);
    checkAbort(ctx);
    const fresh = blockAtCell(bot, cell);
    const age = cropAgeAt(bot, position);
    if (fresh?.name !== call.block || !age || age.value !== 0) throw new SkillBlocked(
      `收割后补种未确认，${cellText(cell)} 实际为 ${fresh?.name ?? 'unknown'}；${planted}`, [], 'server');
    const receipt = `${collected}；已补种 ${call.block} age=0 于 ${cellText(cell)}。${planted}`;
    if (harvestError) throw new SkillBlocked(`${harvestError.message}；${receipt}`, harvestError.scene, 'server', harvestError.code);
    return receipt;
  } finally { release(); }
}
