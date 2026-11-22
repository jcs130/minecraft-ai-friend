import { expect, it } from 'vitest';
import { DetachedStorageWindow, detachedStorageMatcher } from '../core/detached-storage-window.ts';

it('opts in to exact commands and titles from a process-safe declaration', () => {
  const entries = structuredClone([{ command: '/example stash browse', titles: ['Personal stash · 1/10', 'Personal stash · 10/10'] }]);
  const matches = detachedStorageMatcher(entries, ' /EXAMPLE  stash\tbrowse ');
  expect(matches?.('Personal stash · 1/10')).toBe(true);
  expect(matches?.('Personal stash · 10/10')).toBe(true);
  expect(matches?.('Personal stash · 11/10')).toBe(false);
  expect(matches?.('Merchant')).toBe(false);
  expect(detachedStorageMatcher(entries, '/example stash take 1')).toBeUndefined();
  expect(detachedStorageMatcher([], '/example stash browse')).toBeUndefined();
});

function prepare() {
  const owner = new DetachedStorageWindow<{ title: string }>();
  const client = { currentWindow: null as { title: string } | null };
  const opted = { title: 'Attested storage' };
  const match = (window: { title: string }) => window.title === opted.title;
  return { owner, client, opted, match };
}

it('tracks a verified native storage response after chat already completed and expires only once', () => {
  const { owner, client, opted, match } = prepare();
  owner.expect(client, match, 1_000);
  client.currentWindow = opted;
  owner.opened(client, opted, 1_110);
  expect(owner.expired(client, 0, () => true, 121_109)).toBe(false);
  expect(owner.expired(client, 0, () => false, 121_110)).toBe(false);
  expect(owner.expired(client, 0, () => true, 121_111)).toBe(true);
  expect(owner.expired(client, 0, () => true, 121_112)).toBe(false);
});

it('keeps the same window in use, with its latest read or click resetting inactivity', () => {
  const { owner, client, opted, match } = prepare();
  owner.expect(client, match, 1_000);
  client.currentWindow = opted;
  owner.opened(client, opted, 1_110);
  owner.touched(client, 100_000);
  expect(owner.expired(client, 0, () => true, 121_111)).toBe(false);
  expect(owner.expired(client, 190_000, () => true, 219_999)).toBe(false);
  expect(owner.expired(client, 190_000, () => true, 310_000)).toBe(true);
});

it('keeps unmatched menus, later replies, and replaced windows open', () => {
  const { owner, client, opted, match } = prepare();
  const merchant = { title: 'Merchant' };
  owner.expect(client, match, 1_000);
  owner.opened(client, client.currentWindow = merchant, 1_110);
  expect(owner.expired(client, 0, () => true, 130_000)).toBe(false);

  owner.expect(client, match, 200_000);
  owner.opened(client, client.currentWindow = opted, 205_001);
  expect(owner.expired(client, 0, () => true, 330_000)).toBe(false);

  owner.expect(client, match, 400_000);
  owner.opened(client, client.currentWindow = opted, 400_100);
  client.currentWindow = { ...opted };
  expect(owner.expired(client, 0, () => true, 530_000)).toBe(false);

  owner.expect(client, match, 600_000);
  const reconnected = { currentWindow: opted };
  owner.opened(reconnected, opted, 600_100);
  expect(owner.expired(reconnected, 0, () => true, 730_000)).toBe(false);
});
