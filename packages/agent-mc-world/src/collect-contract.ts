const resourceTargets = {
  'dropped-item': { kind: 'dropped-item', skill: 'pickup', targetField: 'item',
    hint: '地面掉落物用 pickup；item 可填物品注册名，省略则就近拾取。按入包增量验收。' },
  block: { kind: 'block', skill: 'collect', targetField: 'block',
    hint: '世界方块用 collect，block 填方块注册名；count 统计采集的方块。地面掉落物用 pickup。' },
} as const;

/** Describe how each observed target is named in a skill call; this never dispatches it. */
export function getResourceActionContract<K extends keyof typeof resourceTargets>(kind: K): (typeof resourceTargets)[K] {
  return { ...resourceTargets[kind] };
}

/** Coordinate intent cannot be normalized into an unlocated resource search. */
export function collectTargetError(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const step = raw as Record<string, unknown>;
  if (typeof step.skill !== 'string' || step.skill.trim() !== 'collect' || step.at == null) return null;
  return 'collect 不支持 at，整单未受理；不能忽略指定坐标后改采别处。'
    + '拆改指定格用 excavate 的 shape/anchors（单格 box 用两个相同锚点），'
    + '或在 mymc_script 中读取 bot.blockAt 后 bot.dig；签名用 {api:"blockAt"} 与 {api:"dig"} 查询。采集附近同类材料时省略 at。';
}
