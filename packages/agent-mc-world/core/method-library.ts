/** Host-independent, immutable Agent-authored method versions. Saving never executes or installs code. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_ADAPTER, type MethodRun } from './method-runner.ts';
import { parseProcedure, procedureId, procedureRevision, procedureHash, PROCEDURE_SCHEMA,
  type ProcedureReference, type ProcedureVersion } from './support/procedure.ts';

interface Entry { revision: string; versions: number; description: string; conditions: string[]; updatedAt: string }
type Index = Record<string, Entry>;
export const METHOD_LIBRARY_SCHEMA = { type: 'object', additionalProperties: false,
  properties: {
    op: { type: 'string', enum: ['list', 'read', 'save'] }, id: { type: 'string' }, revision: { type: 'string' },
    code: { type: 'string', maxLength: 12000 }, description: { type: 'string', maxLength: 800 },
    conditions: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 400 } },
    parent: { type: ['string', 'null'] }, validationRunId: { type: 'integer', minimum: 1 },
    query: { type: 'string', maxLength: 200 }, after: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 },
  }, required: ['op'] };

export class MethodLibrary {
  private index: Index = {};
  private readonly versions = new Map<string, ProcedureVersion>();
  constructor(private readonly directory: string | null) {}

  private reload(): void {
    if (!this.directory) return;
    const file = join(this.directory, 'index.json');
    if (!existsSync(file)) { this.index = {}; return; }
    if (statSync(file).size > 2_000_000) throw new Error('method index too large');
    const text = readFileSync(file, 'utf8');
    const index = JSON.parse(text) as Index;
    if (!index || typeof index !== 'object' || Array.isArray(index) || Object.keys(index).length > 128) throw new Error('invalid method index');
    for (const [id, entry] of Object.entries(index)) {
      procedureId(id); procedureRevision(entry?.revision);
      if (!Number.isInteger(entry.versions) || entry.versions < 1 || entry.versions > 64
        || typeof entry.description !== 'string' || entry.description.length > 800
        || !Array.isArray(entry.conditions) || entry.conditions.length > 8
        || entry.conditions.some(c => typeof c !== 'string' || c.length > 400)
        || typeof entry.updatedAt !== 'string') throw new Error('invalid method index entry');
    }
    this.index = index;
  }

  list(args: Record<string, unknown> = {}): unknown {
    this.reload();
    const limit = args.limit ?? 8, query = args.query ?? '', after = args.after ?? '';
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 20 || typeof query !== 'string'
      || query.length > 200 || typeof after !== 'string') throw new Error('list: limit=1..20; query<=200 characters; after=id');
    const all = Object.entries(this.index).sort(([a],[b]) => a.localeCompare(b))
      .filter(([id, entry]) => (!after || id.localeCompare(after) > 0)
        && `${id} ${entry.description} ${entry.conditions.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    const shown = all.slice(0, Number(limit));
    return { persistent: !!this.directory, methods: shown.map(([id, entry]) => ({ id, revision: entry.revision,
      description: entry.description.slice(0,240), conditions: entry.conditions.slice(0,2).map(c=>c.slice(0,160)),
      updatedAt: entry.updatedAt, reference: this.reference(id, entry.revision) })),
    next: all.length > shown.length ? shown.at(-1)![0] : null,
    note: '源码版本与语法校验不是玩法效果证据；read 按需读取，procedure 显式选择版本运行。' };
  }

  reference(id: string, revision: string): ProcedureReference {
    return { handle: `mem:mc-method/${procedureId(id)}/${procedureRevision(revision)}`, revision };
  }

  read(id: string, revision?: string): ProcedureVersion {
    procedureId(id); this.reload();
    const rev = procedureRevision(revision ?? (Object.hasOwn(this.index, id) ? this.index[id].revision : undefined));
    const key = `${id}/${rev}`;
    const file = this.directory ? join(this.directory, id, `${rev}.json`) : null;
    if (file && statSync(file).size > 128_000) throw new Error('method version too large');
    const version = file ? JSON.parse(readFileSync(file, 'utf8')) : this.versions.get(key);
    const result = parseProcedure(version);
    if (result.id !== id || result.revision !== rev) throw new Error('method identity mismatch');
    return result;
  }

  blob(handle: string): { bytes: Uint8Array; mime: string } | null {
    const match = /^mem:mc-method\/([a-z][a-z0-9-]{0,63})\/([a-f0-9]{64})$/.exec(handle);
    if (!match) return null;
    if (this.directory ? !existsSync(join(this.directory, match[1], `${match[2]}.json`)) : !this.versions.has(`${match[1]}/${match[2]}`)) return null;
    const version = this.read(match[1], match[2]);
    return { bytes: Buffer.from(JSON.stringify(version)), mime: 'application/json' };
  }

  save(args: Record<string, unknown>, validation: MethodRun | undefined, role: string): unknown {
    const id = procedureId(args.id);
    const code = args.code;
    if (typeof code !== 'string') throw new Error('code is required');
    const sourceHash = createHash('sha256').update(code).digest('hex');
    if (!validation || validation.status !== 'validated' || validation.sourceHash !== sourceHash) {
      throw new Error('先对同一源码执行 mc_script {name,code,validate:true} 并取得 validated 终态，再传 validationRunId；完成运行不能代替语法校验。');
    }
    let lock: number | undefined;
    if (this.directory) { mkdirSync(this.directory, { recursive: true }); lock = openSync(join(this.directory, 'write.lock'), 'wx'); }
    try {
      this.reload();
      const previous = Object.hasOwn(this.index, id) ? this.index[id] : undefined;
      if (args.parent !== (previous?.revision ?? null)) throw new Error('parent 与当前版本不一致；先 read，保留他人修订后再合并。新方法须 parent:null。');
      if (!previous && Object.keys(this.index).length >= 128) throw new Error('method library limit reached (128 methods)');
      if ((previous?.versions ?? 0) >= 64) throw new Error('method version limit reached (64 per method)');
      const body = { schema: PROCEDURE_SCHEMA, id, adapter: METHOD_ADAPTER,
        description: args.description, conditions: args.conditions, code, dependencies: {},
        parent: args.parent, author: { kind: 'agent', role: role.slice(0, 80) },
        createdAt: new Date().toISOString(), sourceHash };
      const version = parseProcedure({ ...body, revision: procedureHash(body) });
      const entry: Entry = { revision: version.revision, versions: (previous?.versions ?? 0) + 1,
        description: version.description, conditions: version.conditions, updatedAt: version.createdAt };
      const next = { ...this.index, [id]: entry };
      if (this.directory) {
        mkdirSync(join(this.directory, id), { recursive: true });
        writeFileSync(join(this.directory, id, `${version.revision}.json`), JSON.stringify(version), { flag: 'wx', mode: 0o600 });
        const temporary = join(this.directory, `index-${randomUUID()}.tmp`);
        try { writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 }); renameSync(temporary, join(this.directory, 'index.json')); }
        finally { if (existsSync(temporary)) unlinkSync(temporary); }
      } else this.versions.set(`${id}/${version.revision}`, version);
      this.index = next;
      return { reference: this.reference(id, version.revision), sourceHash, parent: version.parent,
        persistent: !!this.directory, author: version.author, validationRunId: validation.id,
        verifiedImprovement: false, note: '已保存、未运行。procedure 可运行该版本或旧版；按真实任务终态和世界净变化评价效果。' };
    } finally { if (lock !== undefined) { closeSync(lock); unlinkSync(join(this.directory!, 'write.lock')); } }
  }
}
