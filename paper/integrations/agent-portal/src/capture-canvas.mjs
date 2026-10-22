// Executed in a separate read-only browser, before viewer code creates WebGL.
// Keeping this buffer is restricted to the capture browser. The normal viewer
// keeps its existing rendering/performance settings.
export function installCaptureHook(sourceOrigin) {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
    return original.call(this, kind, /^(webgl2?|experimental-webgl)$/.test(kind) ? { ...attributes, preserveDrawingBuffer: true } : attributes);
  };
  globalThis.__qdLiveTransport = { open: false, at: 0 };
  const NativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      const target = new URL(url, location.href);
      const source = new URL(sourceOrigin);
      if (target.host !== source.host || !target.pathname.startsWith('/socket.io/')) return;
      this.addEventListener('open', () => { globalThis.__qdLiveTransport = { open: true, at: 0 }; });
      this.addEventListener('message', () => { globalThis.__qdLiveTransport = { open: true, at: Date.now() }; });
      this.addEventListener('close', () => { globalThis.__qdLiveTransport = { open: false, at: 0 }; });
    }
  };
}

export function captureCanvas() {
  const renderer = globalThis.__lanternRenderer;
  const canvas = document.querySelector('#viewer-canvas');
  const transport = globalThis.__qdLiveTransport;
  if (!renderer || !['1.20.6', '1.21.1'].includes(renderer.minecraftVersion) || !canvas || canvas.width < 160 || canvas.height < 90) return { available: false, reason: 'VIEWER_NOT_READY' };
  if (!transport?.open || Date.now() - transport.at > 5000) return { available: false, reason: 'VIEWER_DISCONNECTED' };
  if (!(renderer.chunkLoading?.meshed > 0) || renderer.viewMode === 'obs') return { available: false, reason: 'WORLD_NOT_READY' };
  // Read the canvas itself. An element screenshot can include DOM painted on
  // top of it (private chat, inventory, dialogs), even with a canvas-only clip.
  const jpeg = canvas.toDataURL('image/jpeg', 0.8);
  if (!jpeg.startsWith('data:image/jpeg;base64,')) return { available: false, reason: 'CANVAS_UNAVAILABLE' };
  return { available: true, jpeg, width: canvas.width, height: canvas.height };
}
