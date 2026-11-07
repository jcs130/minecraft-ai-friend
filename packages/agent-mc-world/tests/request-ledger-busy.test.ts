import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentJournal} from '../src/client/journal.ts';
import {RequestLedger} from '../src/client/request-ledger.ts';
vi.mock('node:fs',async original=>{
  const fs=await original<typeof import('node:fs')>();
  return {...fs,renameSync:vi.fn(fs.renameSync)};
});
const dirs:string[]=[];
afterEach(()=>{vi.mocked(renameSync).mockClear();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function ledger(){const dir=mkdtempSync(join(tmpdir(),'request-busy-'));dirs.push(dir);return new RequestLedger(new AgentJournal(dir));}
const busy=()=>{throw Object.assign(new Error('temporarily shared file'),{code:'EPERM'});};
it('retries only publishing the original prepared receipt after a temporary lock',()=>{
  const r=ledger();r.write({requestId:'one',signature:'same',phase:'pending'});
  vi.mocked(renameSync).mockClear().mockImplementationOnce(busy);
  r.write({requestId:'one',signature:'same',phase:'returned',outcome:{text:'original effect'}});
  expect(renameSync).toHaveBeenCalledTimes(2);
  expect(vi.mocked(renameSync).mock.calls[0]).toEqual(vi.mocked(renameSync).mock.calls[1]);
  expect(r.read('one','same')).toEqual({text:'original effect',blobs:[]});
});
it('bounds a persistent lock and keeps the prior pending record unknown without deleting it',()=>{
  const r=ledger();r.write({requestId:'one',signature:'same',phase:'pending'});
  vi.mocked(renameSync).mockClear();for(let i=0;i<4;i++)vi.mocked(renameSync).mockImplementationOnce(busy);
  expect(()=>r.write({requestId:'one',signature:'same',phase:'returned',outcome:{text:'unpublished'}})).toThrow('temporarily shared file');
  expect(renameSync).toHaveBeenCalledTimes(4);expect(r.inspect('one')).toMatchObject({status:'unknown',reason:'interrupted_or_pending',outcome:null,replayed:false});
});
it('does not retry unrelated filesystem faults',()=>{
  const r=ledger();vi.mocked(renameSync).mockClear().mockImplementationOnce(()=>{throw Object.assign(new Error('storage failed'),{code:'EIO'});});
  expect(()=>r.write({requestId:'one',signature:'same',phase:'pending'})).toThrow('storage failed');
  expect(renameSync).toHaveBeenCalledTimes(1);
});
