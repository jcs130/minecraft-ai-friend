import { expect, it } from 'vitest';
import { setViewerBodyState, viewerBodyState } from '../core/viewer-body-state.ts';
it('preserves authoritative incapacity until recovery and isolates a replacement connection', () => {
  const bot = {}, replacement = {};
  expect(viewerBodyState(bot)).toBeUndefined();
  setViewerBodyState(bot, true, 'downed');
  expect(viewerBodyState(bot)).toEqual({ pose: 'downed', canAct: false, source: 'server' });
  expect(viewerBodyState(replacement)).toBeUndefined();
  setViewerBodyState(bot, false);
  expect(viewerBodyState(bot)).toEqual({ pose: 'standing', canAct: true, source: 'server' });
  setViewerBodyState(bot, true);
  expect(viewerBodyState(bot)?.pose).toBe('standing');
});
