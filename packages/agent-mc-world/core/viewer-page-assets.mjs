/** Generated viewer documents with optional host speech overlay and legacy fallback. */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
async function document(root, relative) {
    const filename = path.join(root, 'public', relative);
    const info = await stat(filename).catch(error => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
            return null;
        throw error;
    });
    if (!info?.isFile() || info.size > MAX_DOCUMENT_BYTES)
        return null;
    const bytes = await readFile(filename);
    if (bytes.length > MAX_DOCUMENT_BYTES)
        return null;
    return bytes.toString('utf8');
}
export async function viewerPageHtml(root, mode, fallback, speechFrame = '', speechScript = '') {
    const generated = await document(root, mode === 'first' ? 'index.html' : `${mode}/index.html`)
        ?? (mode === 'first' ? null : await document(root, 'index.html'));
    let html = (generated ?? fallback).replaceAll('__VIEW_MODE__', mode);
    const bodyMode = /(<body\b[^>]*\bdata-view-mode\s*=\s*)(["'])[^"']*\2/i;
    if (bodyMode.test(html))
        html = html.replace(bodyMode, `$1"${mode}"`);
    else
        html = html.replace(/<body\b/i, `<body data-view-mode="${mode}"`);
    const additions = [
        speechFrame && !/\bid\s*=\s*["']corti-speech-bubble["']/i.test(html) ? speechFrame : '',
        speechScript && !/\bsrc\s*=\s*["']\/speech-bubble\.js["']/i.test(html) ? speechScript : '',
    ].join('');
    return additions ? html.replace(/<\/body\s*>/i, `${additions}</body>`) : html;
}
export async function viewerPageCss(root, fallback, speechCss = '') {
    const generated = await document(root, 'viewer.css');
    return generated === null ? fallback : generated + speechCss;
}
