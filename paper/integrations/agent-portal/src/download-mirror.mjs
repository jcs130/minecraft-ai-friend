// Only an operator-selected HTTPS base, never a request parameter or user file.
export function downloadBaseUrl(value = '') {
  if (value === '') return '';
  if (typeof value !== 'string' || /[%\\]/.test(value) || /\/\.{1,2}(?:\/|$)/.test(value)) throw new Error('Download base must be an HTTPS URL without encoded paths');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !/^[a-zA-Z0-9/_-]*$/.test(url.pathname)) throw new Error('Download base must be HTTPS without credentials, queries or encoded paths');
  return url.href.replace(/\/+$/, '') + '/';
}

export function skillMirrorUrl(config, release) {
  const base = downloadBaseUrl(config.downloads?.baseUrl);
  if (!base) return null;
  return base + release.sha256 + '/' + release.filename;
}
