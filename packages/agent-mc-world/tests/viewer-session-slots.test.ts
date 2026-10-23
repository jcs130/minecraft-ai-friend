import { expect, it } from 'vitest';
import { ViewerSessionSlots } from '../core/viewer-session-slots.ts';
import { MINECRAFT_DEFAULTS, MINECRAFT_CONFIG_GROUP } from '../core/config.ts';
import { assertMinecraftReady, MINECRAFT_CLIENT_DEFAULTS } from '../src/client/config.ts';

it('admits more than two audience sessions by default and releases each exactly once', () => {
  const slots = new ViewerSessionSlots();
  const releases = Array.from({length: 12}, () => slots.reserve(false));
  expect(releases.every(Boolean)).toBe(true);
  expect(slots.status()).toEqual({viewers:12,maxSessions:Number.MAX_SAFE_INTEGER,audienceUnlimited:true,captureSessions:0,maxCaptureSessions:1});
  // Existing recorder versions use this comparison before opening a socket.
  expect(slots.status().viewers >= slots.status().maxSessions).toBe(false);
  for (const release of releases) { release!(); release!(); }
  expect(slots.status().viewers).toBe(0);
});

it('keeps capture capacity independent of unlimited or full audience capacity', () => {
  for (const cap of [0, 3]) {
    const slots = new ViewerSessionSlots(cap, 1);
    const viewers = Array.from({length: 3}, () => slots.reserve(false)!);
    const capture = slots.reserve(true);
    expect(capture).not.toBeNull();expect(slots.reserve(true)).toBeNull();
    if (cap) expect(slots.reserve(false)).toBeNull();
    viewers[0]();expect(slots.reserve(true)).toBeNull();
    capture!();expect(slots.reserve(true)).not.toBeNull();
    expect(slots.reserve(false)).not.toBeNull();
  }
});

it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid explicit audience limit %s', limit => {
  expect(() => new ViewerSessionSlots(limit, 1)).toThrow(RangeError);
});

it('exposes the opt-in limit in the shared profile and configuration schema', () => {
  expect(MINECRAFT_DEFAULTS.viewerMaxSessions).toBe(0);
  const properties = MINECRAFT_CONFIG_GROUP.schema.properties as Record<string, any>;
  expect(properties['worlds.minecraft.viewerMaxSessions']).toMatchObject({type:'integer',minimum:0,'x-hot':false});
});

it('validates an explicit SDK profile limit before opening a connection', () => {
  const cfg = {...structuredClone(MINECRAFT_CLIENT_DEFAULTS),host:'example.test',username:'ViewerTest'};
  expect(() => assertMinecraftReady({...cfg,viewerMaxSessions:0})).not.toThrow();
  expect(() => assertMinecraftReady({...cfg,viewerMaxSessions:8})).not.toThrow();
  for (const viewerMaxSessions of [-1, .5, NaN])
    expect(() => assertMinecraftReady({...cfg,viewerMaxSessions})).toThrow('viewerMaxSessions');
});
