/* Show timed speech captions inside the game view. */
(() => {
  const frame = document.getElementById('corti-speech-bubble');
  if (!frame) return;
  const speaker = '__VIEWER_SPEAKER_NAME__';
  let activeSource = null;
  let connecting = false;
  let stopped = false;

  async function connect() {
    if (connecting || stopped) return;
    connecting = true;
    let source = null;
    try {
      const response = await fetch('/speech-source', { cache: 'no-store', signal: AbortSignal.timeout(6_000) });
      if (response.ok) {
        const info = await response.json();
        if (info.available === true && typeof info.sourceId === 'string' && info.sourceId) source = info.sourceId;
      }
    } catch { /* Keep captions hidden when the owning service is unavailable. */ }
    finally { connecting = false; }
    if (stopped || source === activeSource) return;
    frame.hidden = true;
    frame.removeAttribute('src');
    activeSource = source;
    if (source === null) return;
    frame.src = `/overlay?subtitles=1&cues=0&danmaku=0&ingame=1&speaker=${encodeURIComponent(speaker)}&source=${encodeURIComponent(source)}`;
    frame.hidden = false;
  }

  void connect();
  const check = setInterval(() => { void connect(); }, 20_000);
  window.addEventListener('pagehide', () => { stopped = true; clearInterval(check); }, { once: true });
})();
