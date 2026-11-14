import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installPacketTrace } from '../core/packet-trace.ts';

describe('packet trace', () => {
  it('logs names and summaries, never command arguments or auth dialogs', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pt-')), 't.jsonl');
    const sent: string[] = [];
    const client: any = Object.assign(new EventEmitter(), { write(name: string) { sent.push(name); } });
    const dispose = installPacketTrace(client, file);
    client.write('chat_command', { command: 'login hunter2' });
    client.write('chat_command', { command: 'stats' });
    client.write('block_dig', { status: 2, location: { x: 1, y: 2, z: 3 }, face: 1, sequence: 7 });
    client.emit('packet', { dialog: { data: { title: 'AuthMe 登录', inputs: [] } } }, { name: 'show_dialog' });
    client.emit('packet', { location: { x: 1, y: 2, z: 3 }, type: 0 }, { name: 'block_change' });
    dispose();
    const text = readFileSync(file, 'utf8');
    expect(sent).toEqual(['chat_command', 'chat_command', 'block_dig']);
    expect(text).not.toContain('hunter2');
    expect(text).toContain('"cmd":"[auth]"');
    expect(text).toContain('"cmd":"stats"');
    expect(text).toContain('"redacted":"auth-dialog"');
    expect(text).toContain('"seq":7');
    expect(text).toContain('"state":0');
  });
  it('is inert without a file', () => {
    const client: any = Object.assign(new EventEmitter(), { write() {} });
    const w = client.write;
    installPacketTrace(client, undefined)();
    expect(client.write).toBe(w);
  });
});
