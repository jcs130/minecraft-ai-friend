import type { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type SqliteModule = typeof import('node:sqlite');

/** Resolve the builtin lazily (same pattern as agent-mc-world/core/reference-index.ts). */
export function openDatabase(file: string): DatabaseSync {
  let mod: SqliteModule;
  try {
    const value = process.getBuiltinModule('node:sqlite') as SqliteModule | undefined;
    if (!value) throw new Error('missing');
    mod = value;
  } catch {
    throw new Error('agent-mc-memory requires Node.js 22.13+ (node:sqlite).');
  }
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new mod.DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  return db;
}
