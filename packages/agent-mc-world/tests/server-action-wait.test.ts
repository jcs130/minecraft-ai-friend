import { expect, it } from 'vitest';
import { ServerActionWait } from '../core/server-action-wait.ts';

it('correlates synchronous feedback at dispatch even after a long admission delay', () => {
  const wait = new ServerActionWait();
  // Queue admission is not transport dispatch: unrelated feedback must not arm it.
  wait.noteFeedback('请等待 20 秒', 1_000);
  expect(wait.blockChat('/example enter', 1_000)).toBeNull();
  wait.dispatchChat('/example enter', () => wait.noteFeedback('请等待 20 秒', 7_000), 7_000);
  expect(wait.blockChat('/example enter', 7_000)).toContain('20 秒');
  expect(wait.blockChat('/example enter', 27_000)).toBeNull();
});

it('rolls back a rejected send including synchronous feedback and preserves the preceding wait', () => {
  const wait = new ServerActionWait();
  wait.dispatchChat('/example first', () => wait.noteFeedback('请等待 20 秒', 1_000), 1_000);
  expect(() => wait.dispatchChat('/example second', () => {
    wait.noteFeedback('请等待 30 秒', 2_000);
    throw new Error('socket closed');
  }, 2_000)).toThrow('socket closed');
  expect(wait.blockChat('/example second', 2_000)).toBeNull();
  expect(wait.blockChat('/example first', 2_000)).toContain('19 秒');
  wait.dispatchChat('/example second', () => wait.noteFeedback('请等待 5 秒', 3_000), 3_000);
  expect(wait.blockChat('/example second', 3_000)).toContain('5 秒');
});

it('does not leave a rejected command eligible for a later unrelated reply', () => {
  const wait = new ServerActionWait();
  expect(() => wait.dispatchChat('/example enter', () => { throw new Error('offline'); }, 1_000)).toThrow('offline');
  wait.noteFeedback('请等待 20 秒', 1_001);
  expect(wait.blockChat('/example enter', 1_001)).toBeNull();
});

it('preserves the preceding query comparison after rejected dispatch', () => {
  const wait = new ServerActionWait();
  wait.dispatchChat('/example status', () => wait.noteFeedback('unchanged state', 1_000), 1_000);
  expect(() => wait.dispatchChat('/example status', () => {
    wait.noteFeedback('uncommitted response', 2_000);
    throw new Error('offline');
  }, 2_000)).toThrow('offline');
  let unchanged = false;
  wait.dispatchChat('/example status', () => { unchanged = wait.noteFeedback('unchanged state', 3_000); }, 3_000);
  expect(unchanged).toBe(true);
  expect(() => wait.dispatchChat('/example mutate', () => { throw new Error('offline'); }, 4_000)).toThrow('offline');
  wait.dispatchChat('/example status', () => { unchanged = wait.noteFeedback('unchanged state', 5_000); }, 5_000);
  expect(unchanged).toBe(true);
});

it('does not restore an older state over a newer successful nested dispatch', () => {
  const wait = new ServerActionWait();
  expect(() => wait.dispatchChat('/example outer', () => {
    wait.dispatchChat('/example inner', () => wait.noteFeedback('请等待 5 秒', 1_001), 1_001);
    throw new Error('outer failed');
  }, 1_000)).toThrow('outer failed');
  expect(wait.blockChat('/example inner', 1_002)).toContain('5 秒');
  expect(wait.blockChat('/example outer', 1_002)).toBeNull();
});

it('cleans up both failed nested sends and does not create a wait for ordinary speech', () => {
  const wait = new ServerActionWait();
  expect(() => wait.dispatchChat('/example outer', () => {
    wait.dispatchChat('/example inner', () => { throw new Error('inner failed'); }, 1_001);
  }, 1_000)).toThrow('inner failed');
  wait.noteFeedback('请等待 5 秒', 1_002);
  expect(wait.blockChat('/example outer', 1_002)).toBeNull();
  expect(wait.blockChat('/example inner', 1_002)).toBeNull();
  wait.dispatchChat('hello', () => wait.noteFeedback('请等待 5 秒', 2_000), 2_000);
  expect(wait.blockChat('/example outer', 2_000)).toBeNull();
});
