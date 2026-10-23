import { describe, it, expect } from 'vitest';
import { selectJavaViewer } from '../src/client/java-viewer-selection.ts';

const caps = { protocol: 'agent-mc-java/v1', minecraftVersion: '1.20.6', realRendering: true, visualData: 'agent-mc-visual/v1' };
describe('native viewer capability negotiation', () => {
  it('prefers actual data with auto/default and respects explicit screenshot selection', () => {
    expect(selectJavaViewer({}, caps).mode).toBe('data');
    expect(selectJavaViewer({viewerMode:'auto'}, caps).mode).toBe('data');
    expect(selectJavaViewer({viewerMode:'auto'}, {...caps,minecraftVersion:'1.21.1'}).mode).toBe('data');
    expect(selectJavaViewer({viewerMode:'framebuffer',viewerPageFile:'explicit.html'}, caps).mode).toBe('framebuffer');
  });
  it('detects older/unsupported clients and labels only explicitly configured compatibility views', () => {
    for (const c of [{...caps,visualData:undefined},{...caps,minecraftVersion:'1.21.2'},{...caps,visualData:'future/v2'}]) {
      const selected=selectJavaViewer({viewerPageFile:'explicit.html'},c);
      expect(selected.mode).toBe('framebuffer');expect(selected.reason).toContain('截图兼容');
      expect(()=>selectJavaViewer({},c)).toThrow();
      expect(()=>selectJavaViewer({viewerMode:'data',viewerPageFile:'explicit.html'},c)).toThrow();
    }
  });
  it('does not infer rendering support from installed files or an unrelated protocol', () => {
    expect(()=>selectJavaViewer({viewerPageFile:'exists.html'},{...caps,visualData:undefined,realRendering:false})).toThrow();
    expect(()=>selectJavaViewer({}, {...caps,protocol:'other'})).toThrow();
  });
});
