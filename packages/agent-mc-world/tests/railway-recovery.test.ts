import { expect, it } from 'vitest';
import type { Bot } from 'mineflayer';
import { observeRailway, railwayReadout, RAILWAY_LIMITS } from '../src/railway.ts';

it('diagnoses the observed repeated request and offers executable alternatives before reading any blocks', () => {
  let reads = 0;
  const bot = { entity: {}, game: { dimension: 'overworld' }, blockAt: () => { reads++; return null; } } as unknown as Bot;
  const args = { bounds: [-545, 64, -440, -530, 87, -410], start: [-541, 67, -442], end: [-539, 86, -412] };
  const copy = structuredClone(args), result = railwayReadout(bot, args);
  expect(result).toMatchObject({ failed: true, meta: { queryRecovery: {
    readExecuted: false, retrySameArguments: false, cells: 11904, endpointsOutsideBounds: [args.start],
  } } });
  expect(reads).toBe(0); expect(args).toEqual(copy);
  const recovery = result.meta!.queryRecovery as { suggestedQueries: Array<{ arguments: Record<string, unknown> }> };
  expect(recovery.suggestedQueries[0].arguments).toEqual({ bounds: [-542, 66, -443, -538, 87, -411], start: args.start, end: args.end, detail: false });
  for (const suggestion of recovery.suggestedQueries) {
    const observation = observeRailway(() => null, suggestion.arguments);
    expect(observation.cells).toBeLessThanOrEqual(RAILWAY_LIMITS.cells);
    if (observation.route) expect(observation.route.status).toBe('unknown');
  }
});

it('offers bounded sections even for reversed or very long axes without changing the original request', () => {
  const bot = { entity: {}, blockAt: () => { throw Error('must not read'); } } as unknown as Bot;
  for (const bounds of [[200, 64, 0, -200, 64, 0], [-1000, 0, 0, 1000, 0, 0]]) {
    const result = railwayReadout(bot, { bounds });
    expect(result).toMatchObject({ failed: true });
    const r = result.meta!.queryRecovery as { suggestedQueries: Array<{ arguments: Record<string, unknown> }> };
    expect(observeRailway(() => null, r.suggestedQueries[0].arguments).cells).toBeLessThanOrEqual(128);
  }
});
