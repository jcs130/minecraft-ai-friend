// Shared browser/Node adapter. Callers own their existing authentication and
// persist receipts privately. No new identity, generation, or image fallback.
export async function uploadMusic({ api, state, save, metadata, descriptor, audio, publish = false, put = fetch, id = () => crypto.randomUUID(), allowLoopback = false }) {
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ metadata, descriptor, publish })))), byte => byte.toString(16).padStart(2, '0')).join('');
  if (state.fingerprint && state.fingerprint !== fingerprint) throw Error('本地回执对应另一份内容；请先查询旧作品，勿覆盖回执或重复发布。');
  state.fingerprint = fingerprint;
  state.createRequestId ??= id(); state.audioRequestId ??= id(); state.publicationRequestId ??= id();
  await save(state);
  let work;
  if (state.workId) work = await api('/' + state.workId);
  else {
    work = await api('', 'POST', { ...metadata, requestId: state.createRequestId });
    state.workId = work.id; await save(state);
  }
  if (work.state !== 'ready') {
    work = await api('/' + work.id + '/audio', 'POST', { ...descriptor, requestId: state.audioRequestId });
    state.uploadId = work.uploadId; await save(state);
    if (work.upload) {
      const url = new URL(work.upload.uploadUrl);
      if (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw Error('上传地址必须使用 HTTPS。');
      const allowed = new Set(['content-type', 'x-oss-object-acl', 'x-oss-forbid-overwrite', 'x-oss-meta-sha256']);
      if (url.username || url.password || Object.keys(work.upload.headers).some(key => !allowed.has(key.toLowerCase()))) throw Error('上传请求包含非音频存储字段，请停止并检查服务端版本。');
      let response;
      try { response = await put(url.href, { method: 'PUT', headers: work.upload.headers, body: audio, credentials: 'omit', redirect: 'error' }); }
      catch { throw Error('音频直传未确认完成；请保留原回执，重试会继续查询同一作品。'); }
      // An unknown earlier PUT may already have succeeded. Only complete can
      // decide whether the immutable stored bytes really match this work.
      if (!response.ok && response.status !== 409) throw Error(`音频直传未完成（HTTP ${response.status}）；保留原回执后重试。`);
      work = await api('/' + work.id + '/complete', 'POST', { uploadId: state.uploadId });
    }
  }
  if (publish) {
    state.publicationRevision ??= work.revision;
    await save(state);
    work = await api('/' + work.id + '/publication', 'PUT', { requestId: state.publicationRequestId, published: true, expectedRevision: state.publicationRevision });
  }
  state.lastState = work.state; state.published = work.published; state.revision = work.revision; await save(state);
  return work;
}
