import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CHEST_BLOCKS, FURNACE_BLOCKS } from './chests.ts';
import type { ItemStack } from './terrain.ts';

export interface Cell { x: number; y: number; z: number }
export interface Camp extends Cell { name: string; radius: number; registeredAt: number }
export interface Site extends Cell { kind: string; seenAt: number; source: string; openedAt: number | null; items: ItemStack[] | null }
export interface AssetScope { realm: string; dimension: string; account: string; agent: string }
export const campScopeKey = (s: AssetScope) => JSON.stringify([s.realm,s.dimension,s.account,s.agent]);
const stations = new Set<string>([...CHEST_BLOCKS,...FURNACE_BLOCKS,'physical_container','crafting_table','enchanting_table','anvil','chipped_anvil','damaged_anvil','brewing_stand','smithing_table','stonecutter','grindstone','loom','cartography_table','lectern','beacon','campfire','soul_campfire']);
export const isCampFacility = (name: string) => name.endsWith('_bed') || stations.has(name);
const inCamp = '(s.x-c.x)*(s.x-c.x)+(s.y-c.y)*(s.y-c.y)+(s.z-c.z)*(s.z-c.z)<=c.radius*c.radius';
const near = 'x BETWEEN ? AND ? AND y BETWEEN ? AND ? AND z BETWEEN ? AND ?';
export function bedFoot(p: Cell, part: unknown, facing: unknown): Cell | null {
  if (part === 'foot') return { x:p.x,y:p.y,z:p.z };
  if (part !== 'head') return null;
  switch(facing) {
    case 'north': return {x:p.x,y:p.y,z:p.z+1};
    case 'south': return {x:p.x,y:p.y,z:p.z-1};
    case 'west': return {x:p.x+1,y:p.y,z:p.z};
    case 'east': return {x:p.x-1,y:p.y,z:p.z};
    default: return null;
  }
}
function validCell(p: Cell) {
  return [p.x,p.y,p.z].every(n=>Number.isSafeInteger(n) && Math.abs(n)<=30_000_000);
}
function site(row: Record<string,unknown>): Site {
  return { x:Number(row.x),y:Number(row.y),z:Number(row.z),kind:String(row.kind),seenAt:Number(row.seenAt),
    source:String(row.source),openedAt:row.openedAt===null?null:Number(row.openedAt),
    items:typeof row.contents==='string'?JSON.parse(row.contents):null };
}

/** Per-instance spatial evidence. Registering a camp identifies an area, never ownership or stock. */
export class CampStockBook {
  private db?: DatabaseSync;
  private readonly queries = new Map<string,StatementSync>();
  constructor(private readonly file: string | null) {}
  private query(sql: string): StatementSync {
    if (!this.db) {
      const api = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite') | undefined;
      if (!api) throw new Error('This runtime does not provide node:sqlite; camp stock unavailable.');
      if (this.file) mkdirSync(dirname(this.file),{recursive:true});
      const db = new api.DatabaseSync(this.file || ':memory:');
      try {
        db.exec(`PRAGMA busy_timeout=200;
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS camps(scope TEXT NOT NULL,name TEXT NOT NULL,x INTEGER NOT NULL,y INTEGER NOT NULL,z INTEGER NOT NULL,radius INTEGER NOT NULL,registeredAt INTEGER NOT NULL,PRIMARY KEY(scope,name)) WITHOUT ROWID;
          CREATE TABLE IF NOT EXISTS sites(scope TEXT NOT NULL,x INTEGER NOT NULL,y INTEGER NOT NULL,z INTEGER NOT NULL,kind TEXT NOT NULL,seenAt INTEGER NOT NULL,source TEXT NOT NULL,openedAt INTEGER,contents TEXT,PRIMARY KEY(scope,x,y,z)) WITHOUT ROWID;`);
        this.db = db;
      } catch(error) { db.close(); throw error; }
    }
    let q=this.queries.get(sql);
    if(!q){q=this.db.prepare(sql);this.queries.set(sql,q);}
    return q;
  }
  close(){this.queries.clear();this.db?.close();this.db=undefined;}
  register(scope: string,name: string,p: Cell,radius=24,at=Date.now()) {
    const label=name.trim();
    if (!scope || !label || label.length>64 || /[\x00-\x1f]/.test(label) || !validCell(p) || !Number.isInteger(radius) || radius<1 || radius>128) throw new Error('营地需要名称、整数坐标和 1–128 格范围。');
    this.query('INSERT INTO camps VALUES(?,?,?,?,?,?,?) ON CONFLICT(scope,name) DO UPDATE SET x=excluded.x,y=excluded.y,z=excluded.z,radius=excluded.radius,registeredAt=excluded.registeredAt WHERE excluded.registeredAt>=camps.registeredAt')
      .run(scope,label,p.x,p.y,p.z,radius,at);
  }
  camps(scope: string): Camp[] {
    return this.query('SELECT name,x,y,z,radius,registeredAt FROM camps WHERE scope=? ORDER BY name').all(scope) as unknown as Camp[];
  }
  nearby(scope: string,p: Cell,r: number): Cell[] {
    return this.query('SELECT x,y,z FROM sites WHERE scope=? AND kind<>\'\' AND '+near).all(scope,p.x-r,p.x+r,p.y-r,p.y+r,p.z-r,p.z+r) as unknown as Cell[];
  }
  /** An observed replacement clears the previous contents. No observation never changes a row. */
  observe(scope: string,p: Cell,kind: string,source: string,at=Date.now(),items?: ItemStack[]) {
    if (!validCell(p) || !scope || !Number.isSafeInteger(at)) throw new Error('Invalid camp observation');
    const id=isCampFacility(kind)?kind:'';
    const contents=id && items!==undefined?JSON.stringify(items):null;
    // Keep absence as a dated tombstone so a late read cannot resurrect a removed facility.
    this.query(`INSERT INTO sites VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,x,y,z) DO UPDATE SET
      openedAt=CASE WHEN excluded.contents IS NOT NULL THEN excluded.openedAt WHEN sites.kind=excluded.kind THEN sites.openedAt END,
      contents=CASE WHEN excluded.contents IS NOT NULL THEN excluded.contents WHEN sites.kind=excluded.kind THEN sites.contents END,
      kind=excluded.kind,seenAt=excluded.seenAt,source=excluded.source
      WHERE excluded.seenAt>=sites.seenAt AND (sites.kind<>excluded.kind OR excluded.contents IS NOT NULL OR excluded.seenAt>=sites.seenAt+60000)`)
      .run(scope,p.x,p.y,p.z,id,at,source,contents===null?null:at,contents);
  }
  read(scope: string, name?: string, item?: string, offset=0, limit=24) {
    if (!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>64) throw new Error('Invalid camp result page');
    const key=item?.trim().replace(/^minecraft:/,'')||'';
    const matches=(field:string)=>'('+field+'=$item OR substr('+field+',-length($item)-1)=\'_\'||$item)';
    const rows=this.query(`SELECT c.name AS camp,s.* FROM camps c JOIN sites s ON c.scope=s.scope AND ${inCamp}
      WHERE c.scope=$scope AND ($camp='' OR c.name=$camp) AND s.kind<>'' AND
      ($item='' OR ${matches('s.kind')} OR EXISTS (SELECT 1 FROM json_each(s.contents) j WHERE ${matches("json_extract(j.value,'$.name')")} OR json_extract(j.value,'$.displayName')=$item))
      ORDER BY c.name,s.x,s.y,s.z LIMIT $limit OFFSET $offset`).all({$scope:scope,$camp:name??'',$item:key,$limit:limit+1,$offset:offset});
    return { records:rows.slice(0,limit).map(row=>({camp:String(row.camp),...site(row)})),nextOffset:rows.length>limit?offset+limit:null };
  }
}
