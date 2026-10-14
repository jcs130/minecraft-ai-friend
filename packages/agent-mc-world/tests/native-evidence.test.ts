import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { NativeEvidenceArchive, compactNativeState } from '../src/client/native-evidence.ts';
it('bounds common state while retaining exact original revisions with digest and paginated access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-evidence-'));
  try {
    const archive = new NativeEvidenceArchive(dir), book = '原始书本正文'.repeat(20000), original = { connected: true, position: [1, 64, 2], inventory: [{ slot: 1, count: 1, name: 'minecraft:written_book', encoded: { pages: book } }], menuSlots: [], messages: [{ text: book }], actions: [] };
    const first = archive.save('same-action', original), second = archive.save('same-action', { ...original, position: [2, 64, 2] });
    expect(JSON.stringify(compactNativeState(original)).length).toBeLessThan(1500);
    expect(archive.read('same-action', undefined, 0, 100).sha256).toBe(second.sha256);
    let text = ''; for (let offset = 0; offset < first.originalChars; offset += 16000) text += archive.read('same-action', first.sha256, offset, 16000).text;
    expect(JSON.parse(text)).toEqual(original);
    expect(() => archive.read('same-action', '../outside')).toThrow('digest');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('pages the exact script report independently of a large original body snapshot',()=>{
  const dir=mkdtempSync(join(tmpdir(),'native-script-evidence-'));
  try {
    const archive=new NativeEvidenceArchive(dir),script={ok:true,result:{symbols:['player_position','getblocklist']},programReport:true};
    const original={evidence:{inventory:[{book:'large book'.repeat(50000)}],script}},ref=archive.save('program',original);
    const page=archive.read(ref.key,ref.sha256,0,8000,'script');
    expect(JSON.parse(page.text)).toEqual(script);expect(page.sha256).toBe(ref.sha256);expect(page.part).toBe('script');
    expect(page.originalChars).toBeGreaterThan(400000);expect(page.totalChars).toBeLessThan(300);
    const full=archive.read(ref.key,ref.sha256,0,40);expect(full.part).toBe('full');expect(full.text).toContain('inventory');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
