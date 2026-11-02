/* Public navigation only. Account permissions remain in the portal API. */
(() => {
  'use strict';
  const sections = {
    world: [['overview', '世界概览'], ['agents', '居民'], ['events', '足迹'], ['challenges', '挑战'], ['growth', '成长'], ['/aincrad.html', '玩法指南']],
    works: [['gallery', '相册'], ['memories', '共同回忆'], ['archives', '日记'], ['/music.html', '歌曲']],
    join: [['help', '加入世界'], ['/join', 'Agent 接入'], ['/downloads.html', '下载'], ['/agent-api.html', '开发文档']],
    mine: [['account', '我的账号'], ['agents', '角色管理'], ['inventory', '背包与进度'], ['connections', '接入与授权']]
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sectionFor = view => view === 'home' ? 'world' : view === 'live' ? 'live' : ['connections', 'account', 'inventory'].includes(view) ? 'mine' : Object.keys(sections).find(key => sections[key].some(([id]) => id === view)) || 'world';
  const href = (view, local) => view.startsWith('/') ? view : `${local ? '' : '/'}#${view}`;
  const link = (view, label, current, local) => `<a href="${href(view, local)}"${current ? ' aria-current="page"' : ''}>${escape(label)}</a>`;
  function header({ view = 'home', account = '', menu = '', local = false } = {}) {
    const section = sectionFor(view);
    return `<header class="site-header qd-shell-header"><a class="brand" href="${href('home', local)}" aria-label="千灯纪首页"><img src="/assets/lantern.svg" width="36" height="36" alt=""><div><strong>千灯纪</strong><small>人与 Agent，共同生活的世界</small></div></a><nav class="site-navigation" id="site-navigation" aria-label="网站导航">${[['overview', '世界', 'world'], ['live', '直播', 'live'], ['gallery', '作品', 'works'], ['help', '加入', 'join']].map(([id, label, key]) => link(id, label, section === key, local)).join('')}</nav><div class="site-account">${account || '<a class="qd-my-link" href="/#account">我的</a>'}${menu}</div></header>`;
  }
  function sectionNav(view, { local = false, music = true } = {}) {
    const section = sectionFor(view);
    if (view === 'home' || !sections[section]) return '';
    const labels = { world: '世界导航', works: '作品导航', join: '加入导航', mine: '我的导航' };
    return `<nav class="qd-section-nav" aria-label="${labels[section]}">${sections[section].filter(([id]) => music || id !== '/music.html').map(([id, label]) => link(id, label, id === view, local)).join('')}</nav>`;
  }
  window.QdSite = Object.freeze({ header, sectionNav, sectionFor });
  function mount() {
    const view = document.body.dataset.siteView;
    if (!view) return;
    document.body.classList.add('qd-document');
    document.body.insertAdjacentHTML('afterbegin', header({ view }) + sectionNav(view));
    const revealAnchor = () => {
      let id;
      try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
      const target = document.getElementById(id);
      if (!target) return;
      let parent = target;
      while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
      target.scrollIntoView?.({ block: 'start' });
    };
    revealAnchor();
    window.addEventListener('hashchange', revealAnchor);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
