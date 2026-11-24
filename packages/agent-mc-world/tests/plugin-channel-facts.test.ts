import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  advertisedPluginChannels,
  classifyPluginChannels,
  parseRegisterChannelList,
  readVoicechatRequestSecretVersion,
  readVoicechatSecretUdpPort,
} from '../core/plugin-channel-facts.ts';
import { commandEntryHints, commandTreeFacts } from '../core/command-tree-facts.ts';
import { installServerDisplay, readServerDisplay, renderServerDisplayHud } from '../core/server-display.ts';
import { itemComponentEvidence, itemEvidenceFields } from '../core/item-display.ts';
import { readOpenWindow, renderWindowReadout } from '../core/window-readout.ts';

/** Channel names actually registered during the 2026-11-23 橘乡 read-only audit. No invented menus or values. */
const TANGERINE_REGISTERED = [
  'tab:bridge-6',
  'sr:messagechannel',
  'voicechat:secret',
  'cmib:fromserver',
  'vc:request_secret',
  'minekumusic:economy',
  'dangomusic:channel',
  'vc:secret',
  'voicechat:request_secret',
  'cmib:fromproxy',
  'bungeecord:main',
  'xconomy:aca',
  'maxauth:state',
] as const;

function fakeBot() {
  const client = new EventEmitter() as EventEmitter & { prependListener: typeof EventEmitter.prototype.on };
  client.prependListener = client.on.bind(client);
  const bot: any = { _client: client, username: 'ag_cormy', scoreboards: {}, teams: {}, bossBars: {}, inventory: { items: () => [] }, currentWindow: null };
  return { bot, client };
}

describe('plugin channel register facts', () => {
  it('parses advertised minecraft:register lists instead of only recording the register channel name', () => {
    const data = Buffer.from(TANGERINE_REGISTERED.join('\0'));
    expect(advertisedPluginChannels('minecraft:register', data)).toEqual([...TANGERINE_REGISTERED]);
    expect(advertisedPluginChannels('minecraft:register', data)).not.toContain('minecraft:register');
    expect(parseRegisterChannelList(data)).toHaveLength(13);
  });

  it('classifies 橘乡 audit channels: SVC present, Plasmo and mcagent:voice not found', () => {
    const kinds = classifyPluginChannels([...TANGERINE_REGISTERED, 'minecraft:brand', 'vv:server_details']);
    expect(kinds.svc).toEqual([
      'voicechat:secret', 'vc:request_secret', 'vc:secret', 'voicechat:request_secret',
    ]);
    expect(kinds.plasmo).toEqual([]);
    expect(kinds.mcagentVoice).toEqual([]);
    expect(kinds.other).toEqual(expect.arrayContaining([
      'tab:bridge-6', 'xconomy:aca', 'maxauth:state', 'vv:server_details', 'minecraft:brand',
    ]));
  });

  it('installServerDisplay retains register advertisements and later payload names', () => {
    const { bot, client } = fakeBot();
    const handle = installServerDisplay(bot);
    client.emit('custom_payload', { channel: 'minecraft:register', data: Buffer.from(TANGERINE_REGISTERED.slice(0, 9).join('\0')) });
    client.emit('custom_payload', { channel: 'minecraft:register', data: Buffer.from(TANGERINE_REGISTERED.slice(9).join('\0')) });
    client.emit('custom_payload', { channel: 'vv:server_details', data: Buffer.alloc(76) });
    client.emit('custom_payload', { channel: 'minecraft:brand', data: Buffer.from('Purpur (Velocity)') });
    const snapshot = readServerDisplay(bot);
    expect(snapshot.pluginChannels).toEqual(expect.arrayContaining([...TANGERINE_REGISTERED, 'vv:server_details', 'minecraft:brand']));
    expect(snapshot.pluginChannels).not.toContain('minecraft:register');
    expect(snapshot.pluginChannelKinds.svc).toEqual(expect.arrayContaining(['voicechat:secret', 'voicechat:request_secret', 'vc:secret']));
    expect(snapshot.pluginChannelKinds.mcagentVoice).toEqual([]);
    const hud = renderServerDisplayHud(snapshot);
    expect(hud).toContain('voicechat:secret');
    expect(hud).toContain('不是已作为 SVC 客户端发声');
    handle.stop();
  });

  it('keeps command-tree voice literals and 26.2 titles as received text, not as working voice', () => {
    const { bot, client } = fakeBot();
    const handle = installServerDisplay(bot);
    client.emit('declare_commands', {
      rootIndex: 0,
      nodes: [
        { children: [1, 2, 3] },
        { extraNodeData: { name: 'help' } },
        { extraNodeData: { name: 'voicechatproxy' } },
        { extraNodeData: { name: 'xconomy' } },
      ],
    });
    client.emit('set_title_text', { text: { type: 'compound', value: { text: { type: 'string', value: '欢迎 ag_cormy' } } } });
    client.emit('set_title_subtitle', { text: { type: 'compound', value: { text: { type: 'string', value: '登录成功' } } } });
    const snapshot = readServerDisplay(bot);
    expect(snapshot.commandTree).toMatchObject({
      nodeCount: 4, rootLiteralCount: 3, rootLiterals: ['help', 'voicechatproxy', 'xconomy'],
      voiceRelated: ['voicechatproxy'], helpRelated: ['help'],
    });
    expect(snapshot.title).toMatchObject({ title: '欢迎 ag_cormy', subtitle: '登录成功' });
    const hud = renderServerDisplayHud(snapshot);
    expect(hud).toContain('voicechatproxy');
    expect(hud).toContain('入口线索，不是已实现发声');
    expect(hud).toContain('欢迎 ag_cormy / 登录成功');
    handle.stop();
  });

  it('does not treat a missing secret payload as a received UDP port, and parses only a synthetic body', () => {
    expect(readVoicechatSecretUdpPort(undefined)).toBeNull();
    expect(readVoicechatSecretUdpPort(Buffer.alloc(0))).toBeNull();
    const body = Buffer.alloc(36);
    body.writeInt32BE(24454, 16);
    expect(readVoicechatSecretUdpPort(body)).toEqual({ port: 24454, byteLength: 36 });
    expect(JSON.stringify(readVoicechatSecretUdpPort(body))).not.toMatch(/"key"/);
    const version = Buffer.alloc(4);
    version.writeInt32BE(20);
    expect(readVoicechatRequestSecretVersion(version)).toBe(20);
  });
});

describe('command entry hints and item component evidence', () => {
  it('uses commandTreeFacts plus hints without inventing literals', () => {
    const facts = commandTreeFacts({ rootIndex: 0, nodes: [{ children: [1] }, { extraNodeData: 'voicechatproxy' }] });
    expect(commandEntryHints(facts.rootLiterals)).toEqual({ voiceRelated: ['voicechatproxy'], helpRelated: [] });
    expect(commandEntryHints(['help', '?', 'bukkit:help', 'pay']).helpRelated).toEqual(['help', '?', 'bukkit:help']);
  });

  it('retains custom_data keys, custom_model_data and unknown namespaces; 橘乡 audit inventory was empty so no values are invented', () => {
    const emptyAuditInventory: unknown[] = [];
    expect(emptyAuditInventory).toEqual([]);
    const item = {
      name: 'paper',
      componentMap: new Map<string, { data?: unknown }>([
        ['custom_name', { data: { text: '演示纸' } }],
        ['lore', { data: [{ text: '仅用于组件留证' }] }],
        ['custom_data', { data: { type: 'compound', value: { quest_id: { type: 'string', value: 'demo' } } } }],
        ['custom_model_data', { data: { floats: [2] } }],
        ['cookieclickerz:demo', { data: { ok: true } }],
      ]),
    };
    const ev = itemComponentEvidence(item);
    expect(ev.customName).toBe('演示纸');
    expect(ev.lore).toEqual(['仅用于组件留证']);
    expect(ev.customDataKeys).toEqual(['quest_id']);
    expect(ev.customModelData).toEqual({ floats: [2] });
    expect(ev.extraComponentTypes).toEqual(expect.arrayContaining(['custom_data', 'custom_model_data', 'cookieclickerz:demo']));
    expect(itemEvidenceFields(item).customDataKeys).toEqual(['quest_id']);
  });

  it('window readout keeps unknown component evidence without executing plugin messages', () => {
    const bot: any = { currentWindow: { id: 2, title: '演示菜单', inventoryStart: 9, slots: [
      { name: 'paper', count: 1, customName: '演示纸',
        componentMap: new Map([['custom_data', { data: { mark: 1 } }], ['custom_model_data', { data: { flags: [true] } }]]) },
      ...Array(8).fill(null),
    ] } };
    const r = readOpenWindow(bot);
    expect(r.slots[0]).toMatchObject({
      name: '演示纸', customDataKeys: ['mark'], customModelData: { flags: [true] },
    });
    expect(renderWindowReadout(r)).toContain('custom_data键 mark');
  });
});

describe('existing WAV inspect is not an Opus/SVC client', () => {
  it('package has no opus dependency and no exported Opus or SVC UDP sender', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).some((name) => /opus/i.test(name))).toBe(false);
    const src = readFileSync(resolve(import.meta.dirname, '../core/proximity-voice.mjs'), 'utf8');
    expect(src).toContain("CHANNEL='mcagent:voice'");
    expect(src).not.toMatch(/voicechat:request_secret/);
    expect(src).not.toMatch(/createSocket\(|dgram/);
  });
});
