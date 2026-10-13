import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A private runtime directory has one connection owner, including across MCP clients. */
export class AgentConnectionLease {
  private held = false;
  private readonly path: string;
  constructor(dataDir: string, private readonly run: string) { this.path = join(dataDir, 'connection.lock'); }

  acquire(): void {
    if (this.held) return;
    if (existsSync(this.path)) {
      const owner = JSON.parse(readFileSync(this.path, 'utf8')) as { pid: number };
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('Invalid connection owner; inspect connection.lock.');
      try { process.kill(owner.pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') unlinkSync(this.path);
        else throw error;
      }
    }
    let descriptor: number;
    try { descriptor = openSync(this.path, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('This dataDir already has a live game connection owner. Use a separate account and dataDir.');
      throw error;
    }
    try { writeFileSync(descriptor, JSON.stringify({ pid: process.pid, run: this.run })); this.held = true; }
    finally { closeSync(descriptor); }
  }

  release(): void {
    if (!this.held) return;
    const owner = JSON.parse(readFileSync(this.path, 'utf8')) as { run: string };
    if (owner.run !== this.run) throw new Error('Connection ownership changed unexpectedly.');
    unlinkSync(this.path);
    this.held = false;
  }
}
