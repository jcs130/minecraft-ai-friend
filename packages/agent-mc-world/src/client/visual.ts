import type { ToolDef, ToolCallContext, ToolOutcome, WorldHost, WorldRequestFacts } from './contracts.ts';

/** A missing capability is unknown, not permission to send an image. */
export function acceptsImages(host: WorldHost | null): boolean {
  try { return host?.modelFacts?.accepts('image/png') === true; }
  catch { return false; }
}

export function visualArgumentError(args: Record<string, unknown>, prefix = 'mc'): ToolOutcome | undefined {
  if (args.mode !== undefined && (typeof args.mode !== 'string' || !['first', 'third', 'dungeon'].includes(args.mode)))
    return { text: `[${prefix}_visual 失败] mode 只能是 first、third 或 dungeon`, failed: true };
  for (const key of ['include_hud', 'raw', 'background']) {
    if (args[key] !== undefined && typeof args[key] !== 'boolean')
      return { text: `[${prefix}_visual 失败] ${key} 只能是 boolean`, failed: true };
  }
  return undefined;
}

const SCENE_PARTS = new Set(['sample', 'place', 'flight', 'body', 'life', 'structure', 'terrain', 'players', 'queue']);
const HUD_PARTS = new Set(['gear', 'equip', 'foodReserve']);
const MAX_READOUT_CHARS = 4800;

/** Reuse timestamped engine observations; do not invent a picture or stop body work. */
export function structuredVisual(facts: WorldRequestFacts | null, reason: string, includeHud: boolean, prefix = 'mc'): ToolOutcome {
  const heading = `[${prefix}_visual 结构化回退] ${reason}。本次没有图像分析结论。`;
  if (!facts) return { text: `${heading}\n游戏现场读数尚不可用；连接与现场状态未验证。`, failed: true };
  const readout = facts.parts?.length
    ? facts.parts.filter(part => SCENE_PARTS.has(part.key) || (includeHud && HUD_PARTS.has(part.key)))
      .map(part => part.text).filter(Boolean).join('\n')
    : facts.text;
  if (!readout) return { text: `${heading}\n缓存中没有可用的现场分段；请查询实际游戏状态。`, failed: true };
  const bounded = readout.length <= MAX_READOUT_CHARS ? readout
    : readout.slice(0, MAX_READOUT_CHARS) + '\n[读数节选；其余未展开]';
  return { text: `${heading}\n[引擎缓存读数；以原采样时间为准]\n${bounded}\n`
    + '以上来自游戏数据，不是看图识别，不能据此评价外观或未观察的区域。'
    + `精确局部方块和碰撞可用 ${prefix}_scout 的 observe 查询，装备与打开的容器用 ${prefix}_bag 核对。` };
}

/** Shared visual delivery; server integrations can translate names without owning another vision model. */
export async function observeVisual(tool: ToolDef, args: Record<string, unknown>, ctx: ToolCallContext,
  host: WorldHost | null, facts: () => WorldRequestFacts | null, structured: boolean, prefix = 'mc',
  mapText: (text: string) => string = text => text): Promise<string | ToolOutcome> {
  const invalid = visualArgumentError(args, prefix);
  if (invalid) return invalid;
  if (ctx.signal?.aborted) return { text: `[${prefix}_visual 未受理] 本次观察已取消`, failed: true };
  const fallback = (reason: string) => structuredVisual(facts(), reason, args.include_hud === true, prefix);
  if (structured || !acceptsImages(host)) return fallback(structured ? '已选择结构化观察' : '当前模型未声明支持图片');
  const result = await tool.handler({ ...args, raw: true }, ctx);
  const text = typeof result === 'string' ? result : result.text;
  const failed = (typeof result !== 'string' && result.failed) || /\[mc_visual (?:失败|暂不可用)\]/.test(text);
  if (failed && !ctx.signal?.aborted) return fallback(`截图未完成：${mapText(text).slice(0, 300)}`);
  return typeof result === 'string' ? mapText(result) : { ...result, text: mapText(text) };
}
