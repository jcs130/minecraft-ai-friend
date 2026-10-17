import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MinecraftMotorEnvironment } from '../src/motor/minecraft-simulation.ts';

describe('owned Minecraft motor sandbox boundary', () => {
  it('refuses an existing game directory before creating or launching a server', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'motor-ownership-'));
    const eula = join(directory, 'eula.txt');
    await writeFile(eula, 'eula=true\n');
    const env = new MinecraftMotorEnvironment();
    try {
      await expect(env.start({ java: 'must-not-launch', serverJar: 'unused', acceptedEulaFile: eula, directory })).rejects.toThrow(/non-training directory/);
      expect(await readFile(eula, 'utf8')).toBe('eula=true\n');
      expect(env.port).toBe(0);
    } finally { await env.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('requires an already accepted EULA and never changes its value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'motor-eula-'));
    const eula = join(directory, 'eula.txt');
    await writeFile(eula, 'eula=false\n');
    const env = new MinecraftMotorEnvironment();
    try {
      await expect(env.start({ java: 'must-not-launch', serverJar: 'unused', acceptedEulaFile: eula, directory: join(directory, 'sandbox') })).rejects.toThrow(/accepted.*EULA/);
      expect(await readFile(eula, 'utf8')).toBe('eula=false\n');
      expect(env.port).toBe(0);
    } finally { await env.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
