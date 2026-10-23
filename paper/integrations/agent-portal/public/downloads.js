'use strict';
(() => {
  const el = (name, text, cls) => { const node = document.createElement(name); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
  const size = bytes => bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' GB' : bytes >= 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : Math.ceil(bytes / 1000) + ' KB';
  const status = document.querySelector('#downloads-status');
  const local = value => typeof value === 'string' && /^\/downloads\/[A-Za-z0-9_.-]+$/.test(value);
  function card(row) {
    const node = el('article', '', 'client-card download-card');
    node.append(el('h3', row.name), el('p', row.version + ' · ' + (row.channel === 'github-release' ? '公开测试包' : '公开候选包'), 'download-version'),
      el('p', row.platform, 'download-requirements'), el('p', row.includes));
    if (row.available && local(row.url)) {
      const link = el('a', '下载 · ' + size(row.bytes), 'btn primary'); link.href = row.url; link.setAttribute('download', row.filename); node.append(link);
    } else node.append(el('p', '直下暂未配置', 'download-pending'));
    node.append(el('p', row.install, 'download-install'));
    const details = el('details'), digest = el('code', row.sha256);
    details.append(el('summary', '校验与来源'), el('p', 'SHA256'), digest, el('p', '许可：' + row.license));
    if (typeof row.sourceUrl === 'string' && row.sourceUrl.startsWith('https://')) {
      const original = el('a', '原始发布文件 ↗'); original.href = row.sourceUrl; original.target = '_blank'; original.rel = 'noopener noreferrer'; details.append(original);
    }
    node.append(details); return node;
  }
  fetch('/api/v1/downloads', { credentials: 'omit' }).then(async response => {
    if (!response.ok) throw Error('目录暂不可用');
    const data = await response.json();
    if (local(data.skill?.url)) {
      const link = document.querySelector('#skill-download'); link.href = data.skill.url; link.textContent = '下载 Skill ' + data.skill.version;
      document.querySelector('#skill-checksum').textContent = 'SHA256：' + data.skill.sha256;
    }
    const packages = Array.isArray(data.packages) ? data.packages : [];
    document.querySelector('#package-downloads').replaceChildren(...packages.map(card));
    status.textContent = packages.some(row => row.available) ? '从官网下载固定版本，文件由对象存储直接提供。' : '下载目录已加载；各包的开放状态见下方。';
  }).catch(() => { status.textContent = '暂时无法读取下载目录，请刷新页面或打开接入说明。'; });
})();
