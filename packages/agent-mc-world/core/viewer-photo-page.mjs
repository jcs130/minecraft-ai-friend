import { viewerPageHtml } from './viewer-page-assets.mjs';

/** A read-only still camera. No inventory, chat history, controls or extra account. */
export async function viewerPhotoPage(root, mode = 'first') {
  if (!['first', 'third', '3dview'].includes(mode)) throw Error('PHOTO_VIEW_MODE_INVALID');
  const page = await viewerPageHtml(root, mode, '');
  if (!page.includes('/index.js')) throw Error('PHOTO_VIEWER_ASSETS_MISSING');
  return page.replace('</head>', `<style>
    body > :not(#viewer-canvas):not(script):not(style) { display:none !important }
    #viewer-canvas { position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important }
  </style></head>`).replace('</body>', `<script>
    globalThis.__photoSkinTasks = new Set();
    globalThis.__photoSkinFailed = false;
    // The consumer must also wait for its authenticated native camera lease.
    globalThis.__photoReady = () => {
      const d = globalThis.__lanternRenderer?.chunkLoading;
      const radius = Math.max(2, Math.min(8, Number(new URLSearchParams(location.search).get('distance')) || 6));
      const footprint = (radius * 2 + 1) ** 2;
      const ysm = globalThis.cortiViewerContent?.stats?.().ysm;
      const canvas = document.getElementById('viewer-canvas');
      return Boolean(globalThis.__lanternRenderer?.photoMode === true
        && canvas?.width && canvas?.height && d?.received >= footprint
        && d.meshed >= footprint && d.masked === 0 && d.pendingSections === 0
        && __photoSkinTasks.size === 0 && !__photoSkinFailed
        // Received states also include the hidden first-person self and culled actors.
        // Actual render jobs must be drained; total states need not equal visible actors.
        && (!ysm || ysm.pending === 0 && ysm.failed === 0 && ysm.unavailable === 0)
        && document.fonts.status === 'loaded');
    };
  </script></body>`);
}
