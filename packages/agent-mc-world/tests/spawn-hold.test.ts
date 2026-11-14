import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installSpawnMovementHold } from '../core/spawn-hold.ts';

afterEach(() => vi.useRealTimers());

describe('spawn movement hold', () => {
  it('stays unstable until the first play position has been quiet', () => {
    vi.useFakeTimers();
    const client = Object.assign(new EventEmitter(), { state: 'play' });
    const hold = installSpawnMovementHold({ _client: client }, { stableMs: 1500 });
    expect(hold.stable()).toBe(false);
    client.emit('position', { x: -1075.5, y: 69, z: -574.5 });
    vi.advanceTimersByTime(1499);
    expect(hold.stable()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hold.stable()).toBe(true);
    expect(hold.status().resyncCount).toBe(0);
    hold.dispose();
  });

  it('resets the timer when the server resyncs position, and release unblocks immediately', () => {
    vi.useFakeTimers();
    const client = Object.assign(new EventEmitter(), { state: 'play' });
    const hold = installSpawnMovementHold({ _client: client }, { stableMs: 1000 });
    client.emit('position', { x: 0.5, y: 64, z: 0.5 });
    vi.advanceTimersByTime(500);
    client.emit('position', { x: 0.5, y: 64, z: 0.5 });
    client.emit('position', { x: 1.5, y: 64, z: 0.5 });
    expect(hold.status().resyncCount).toBe(1);
    vi.advanceTimersByTime(999);
    expect(hold.stable()).toBe(false);
    hold.release('host-move');
    expect(hold.stable()).toBe(true);
    hold.dispose();
  });
});
