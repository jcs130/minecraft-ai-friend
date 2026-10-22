'use strict';

const state = { session: null, summary: null, roster: [], authorized: [], account: null, credentials: [], owners: [], view: 'home', filter: 'all', query: '', detail: null, detailTab: 'summary', error: null,
  growth: [], growthError: false, growthSort: 'rank', events: [], eventPage: 1, eventPages: 1, eventKind: 'all', eventError: false, channels: [], selectedChannel: null, site: null, gameCapabilities: null, accountJob: null, accountJobs: [], profile: null, photos: [], agentInvites: [] };
let authRevision = 0;
let privateRevision = 0;
function setSession(session) {
  authRevision++;
  if (state.session?.owner?.id !== session?.owner?.id) {
    state.selectedChannel = null; state.accountJob = null; state.accountJobs = []; state.profile = null; state.agentInvites = [];
    // Do not leave a previous owner's private channel title on a shared phone.
    state.channels = state.channels.filter(channel => channel.visibility === 'public').map(channel => ({ ...channel, isOwn: false, canManage: false }));
  }
  state.session = session;
}
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const detail = document.querySelector('#detail');
const svg = (body, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const icons = {
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  users: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m2 9v-2a5 5 0 0 0-3-4"/>'),
  box: svg('<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7 5.8l9 5"/>'),
  plug: svg('<path d="m7 3 0 5m10-5v5M5 8h14v3a7 7 0 0 1-14 0V8m7 10v4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z"/>'),
  server: svg('<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5"/>'),
  book: svg('<path d="M12 5v16m0-16C8 2 5 3 2 4v15c4-1 7-1 10 2m0-16c4-3 7-2 10-1v15c-4-1-7-1-10 2"/>'),
  arrow: svg('<path d="M5 12h14m-5-5 5 5-5 5"/>'),
  chevron: svg('<path d="m9 5 7 7-7 7"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'),
  logout: svg('<path d="M9 4H4v16h5M10 12h12m-5-5 5 5-5 5"/>'),
  lock: svg('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>'),
  shield: svg('<path d="m12 3 8 3v7c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  refresh: svg('<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3"/>'),
  close: svg('<path d="m6 6 12 12M6 18 18 6"/>'),
  check: svg('<path d="m5 12 4 4L19 6"/>'),
  eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  mountain: svg('<path d="m2 20 8-15 5 9 3-5 5 11H2Zm5-10 3 3 3-3"/>'),
  heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>'),
  star: svg('<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z"/>'),
  leaf: svg('<path d="M20 3C7 2 2 8 5 15s16 5 15-12ZM4 21l11-11"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  download: svg('<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>'),
  monitor: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  key: svg('<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'),
  link: svg('<path d="m10 13 4-4M8 15l-2 2a4 4 0 0 1-6-6l6-6a4 4 0 0 1 6 0m4 4 2-2a4 4 0 0 1 6 6l-6 6a4 4 0 0 1-6 0"/>')
};
const titles = { home: '世界首页', gallery: '相机展廊', overview: '世界概览', agents: '角色账号', growth: '冒险成长榜', events: '世界动态', live: '直播间', inventory: '背包与进度', connections: '连接中心', account: '账号与权限', help: '帮助与接入' };
const kindNames = { agent: 'Agent', observer: '观战账号', player: '玩家', admin: '管理身份' };
const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = (value, digits = 0) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits });
const date = (value, full = false) => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(full ? { year: 'numeric' } : {}) }) : '暂无记录';
const time = value => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '等待更新';
const safeName = value => e(String(value ?? '—').slice(0, 120));
const owner = () => state.session?.owner;
const isAdmin = () => owner()?.role === 'admin';
const typeTag = agent => `<span class="tag ${e(agent.kind)}">${kindNames[agent.kind] || '角色'}</span>`;
const statusTag = agent => `<span class="status ${agent.online === true ? '' : agent.online === false ? 'offline' : 'unknown'}"><i class="dot"></i>${agent.online === true ? '在线' : agent.online === false ? '离线' : '待确认'}</span>`;
function avatar(agent) {
  const name = typeof agent === 'string' ? agent : agent.name;
  const color = /cormy/i.test(name) ? 'blue' : /goddess/i.test(name) ? 'gold' : /eye|micro/i.test(name) ? 'purple' : '';
  const initials = name.replace(/^ag_/, '').replace(/[._]/g, '').slice(0, 2).toUpperCase() || 'AG';
  return `<span class="avatar ${color}" aria-hidden="true">${e(initials)}</span>`;
}
function notice(message, type = '') { return `<div class="notice ${type}">${icons.info}<p>${message}</p></div>`; }
function empty(title, description, action = '', icon = 'lock') { return `<div class="empty">${icons[icon]}<h2>${title}</h2><p>${description}</p>${action}</div>`; }
const button = (action, label, icon = '', classes = '', data = '') => `<button type="button" class="btn ${classes}" data-action="${action}" ${data}>${icon ? icons[icon] : ''}${label}</button>`;
const routeButton = (view, label, icon = '', classes = '') => button('route', label, icon, classes, `data-view="${view}"`);
function newRequestId() {
  // LAN HTTP is not a secure context on phones: randomUUID and clipboard may
  // be absent, while getRandomValues remains available. Never use Math.random.
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const value = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join('-');
}

async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (options.method && options.method !== 'GET') { headers['Content-Type'] ||= 'application/json'; headers['X-CSRF-Token'] = state.session?.csrfToken || ''; }
  const response = await fetch('/api/v1' + url, { credentials: 'same-origin', ...options, headers });
  let data;
  try { data = await response.json(); } catch { throw new Error('服务响应不完整，请稍后重试'); }
  if (!response.ok) { const error = new Error(data.error?.message || '请求未完成'); error.reason = data.error?.reason; error.status = response.status; throw error; }
  return data;
}
let toastTimer;
function toast(message, error = false) {
  const element = document.querySelector('#toast'); element.textContent = message;
  element.className = 'show' + (error ? ' error' : ''); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = ''; }, 4500);
}
function setView(view) { location.hash = titles[view] ? view : 'home'; }
function navigation() {
  return [['home', 'heart'], ['overview', 'grid'], ['live', 'monitor'], ['growth', 'star'], ['events', 'clock'], ['gallery', 'mountain'], ['agents', 'users'], ['inventory', 'box'], ['connections', 'plug'], ['account', 'settings']].map(([view, icon]) =>
    `<a href="#${view}" class="${state.view === view ? 'active' : ''}" ${state.view === view ? 'aria-current="page"' : ''}>${icons[icon]}<span>${titles[view]}</span>${view === 'agents' ? `<span class="nav-count">${number(state.roster.length)}</span>` : ''}</a>`).join('');
}
function render() {
  if (liveObjectUrl) { URL.revokeObjectURL(liveObjectUrl); liveObjectUrl = null; }
  if (state.view === 'home') { app.innerHTML = homePage(); return; }
  const currentOwner = owner();
  const online = state.summary?.online === true;
  app.innerHTML = `<div class="layout">
    <aside class="sidebar" aria-label="主导航">
      <button class="close sidebar-close" data-action="menu" aria-label="关闭导航">${icons.close}</button>
      <a class="brand" href="#home"><img src="/assets/lantern.svg" width="43" height="43" alt=""><div><strong>千灯纪</strong><small>AGENT PORTAL</small></div></a>
      <div class="nav-label">你的冒险世界</div><nav class="nav">${navigation()}</nav>
      <div class="side-bottom"><nav class="nav"><a href="#help" class="${state.view === 'help' ? 'active' : ''}">${icons.book}<span>帮助与接入</span></a></nav>
        <div class="side-world"><div class="side-world-title"><i class="dot ${online ? '' : 'unknown'}"></i>千灯纪 · 冒险世界</div><small>${e(state.summary?.version || '正在读取服务器状态')}</small><div class="world-grid" aria-hidden="true">${'<i></i>'.repeat(7)}</div></div>
        <button class="profile-button" data-action="${currentOwner ? 'route' : state.session?.canSetup ? 'setup' : 'login'}" data-view="account">${avatar(currentOwner?.username || '访客')}<span><strong>${e(currentOwner?.username || '访客')}</strong><small>${currentOwner ? isAdmin() ? '网站管理员' : '网站账号' : '登录，开启你的冒险'}</small></span>${icons.down}</button>
      </div>
    </aside><button class="nav-scrim" data-action="menu" aria-label="关闭导航"></button>
    <div class="content"><header class="topbar"><div class="breadcrumb"><button class="mobile-menu" data-action="menu" aria-label="展开导航">${icons.menu}</button><a href="#home">千灯纪</a><span>/</span><strong>${titles[state.view]}</strong></div><div class="top-right"><button class="search-trigger" data-action="search">${icons.search}<span>搜索角色账号</span><kbd>/</kbd></button><span class="top-divider"></span><span class="online-badge"><i class="dot ${online ? '' : 'unknown'}"></i>${online ? '服务器运行中' : '状态暂未确认'}</span><button class="close" data-action="refresh" aria-label="刷新服务器数据">${icons.refresh}</button></div></header>
    <main id="main" tabindex="-1">${page()}</main></div>
  </div>`;
}
function heading(title, description, actions = '', eyebrow = 'QIANDENGJI / AGENT WORLD') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function footer() {
  return `<footer class="footer"><span>${icons.shield}账号归属独立管理 · 网站账号与游戏账号分开</span><span><i class="dot ${state.error ? 'unknown' : ''}"></i>${state.error ? e(state.error) : `服务器状态更新于 ${time(state.summary?.observedAt)}`} ${button('refresh', '刷新', '', 'small ghost')}</span></footer>`;
}
function page() {
  const pages = { overview, agentsPage, inventoryPage, connectionsPage, accountPage, helpPage };
  const fn = { gallery: galleryPage, overview: pages.overview, agents: pages.agentsPage, growth: growthPage, events: eventsPage, live: livePage, inventory: pages.inventoryPage, connections: pages.connectionsPage, account: pages.accountPage, help: pages.helpPage }[state.view];
  return (fn || overview)() + footer();
}
function landscape() {
  return `<svg class="hero-scene" viewBox="0 0 600 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#263d36"/><stop offset="1" stop-color="#526446"/></linearGradient><linearGradient id="hill" x2="0" y2="1"><stop stop-color="#536b47"/><stop offset="1" stop-color="#1e352d"/></linearGradient></defs><rect width="600" height="240" fill="url(#sky)"/><rect x="439" y="35" width="35" height="35" fill="#cfcd9555"/><path d="M0 155h50v-23h50v-18h40v22h44v-45h37v-22h25v24h46v39h43v-27h59v-40h28v-14h24v24h40v39h68v37h46v-14h70v103H0Z" fill="#6b77513d"/><path d="M0 185h70v-25h54v-20h40v21h38v-43h40v-24h28v24h39v42h66v-24h38v24h62v-29h50v32h75v77H0Z" fill="url(#hill)"/><path d="M217 157V88h10V66h18v22h12V64h9V39h9v25h13v24h19v69Z" fill="#829170"/><path d="M212 88h47v14h-47Zm42-24h41v12h-41Zm34 24h26v14h-26Z" fill="#526747"/><path d="M236 156v-25h16v25Zm33-55h9v17h-9Zm25 16h8v12h-8Z" fill="#263b30"/><path d="M319 185v-37h55v37m-62-37 36-24 34 24" fill="#8a8761"/><path d="M312 148h70v9h-70Z" fill="#374c36"/><path d="M333 169h10v16h-10m14-16h9v10h-9Z" fill="#d9c383"/><path d="M95 205v-30h12v-31h17v31h13v30m-56-34h59v-12H91v-16h40v-15h-31v-13h17v13h19v15h15v16h-12v12Zm374 30v-25h12v-40h17v40h13v25m-57-31h60v-15h-13v-21h-41v21h-13v15Z" fill="#1f3b2c"/><path d="M0 218h102v-9h76v-12h73v17h82v-14h77v12h70v-17h49v14h71v31H0Z" fill="#162e25"/><path d="M266 157h18v16h-10v17h-18v20h-16v30h83v-18h-34v-17h-14v-20h8v-16h-17Z" fill="#b1b1883b"/><g fill="#d4d3a788"><rect x="392" y="72" width="3" height="3"/><rect x="180" y="55" width="2" height="2"/><rect x="535" y="98" width="3" height="3"/><rect x="318" y="29" width="2" height="2"/></g></svg>`;
}
const characterName = name => ({ ag_cormy: '可米', ag_neko: 'NEKO', ag_kirito: '桐人', ag_narutopi: '鸣人' }[name.toLowerCase()] || name.replace(/^ag_/i, ''));
function photoCards(photos) {
  return photos.map(photo => `<article class="photo-card"><button type="button" data-action="photo" data-id="${e(photo.id)}" aria-label="查看照片：${e(photo.title)}"><img src="${e(photo.imageUrl)}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async" alt="${e(photo.title)}"><span class="photo-open">${icons.eye}看照片与故事</span></button><div class="photo-caption"><span class="photo-author">${e(characterName(photo.author))} / ${date(photo.capturedAt)}</span><h3>${e(photo.title)}</h3><p>${e(photo.story || '留住今天看见的世界。')}</p></div></article>`).join('');
}
function galleryPage() {
  return heading('把生活，拍成故事。', '来自女神相机的真实游戏照片。每一张都有拍摄者，也可以有自己的题目和故事。', routeButton('help', '了解相机玩法', 'book'))
    + (state.photos.length ? `<section class="photo-grid full-gallery">${photoCards(state.photos)}</section>` : empty('展廊正在等待新作品', '在游戏内公开展出的作品会同步到这里，未发布的私人照片不会展示。', '', 'mountain'));
}
function homePage() {
  const s = state.summary, currentOwner = owner();
  const cast = state.roster.filter(row => row.kind === 'agent').slice(0, 6);
  const publicEvents = state.events.filter(row => row.kind === 'quest' || row.kind === 'advancement' || row.kind === 'notice').slice(0, 3);
  const init = state.session?.canSetup ? `<div class="notice onboarding-notice">${icons.key}<p>首次使用：请在本机设置网站管理员。</p>${button('setup', '设置管理员', 'arrow', 'small primary')}</div>` : '';
  return `<div class="layout home-layout"><header class="home-topbar"><a class="brand" href="#home"><img src="/assets/lantern.svg" width="40" height="40" alt=""><div><strong>千灯纪</strong><small>一个持续生长的世界</small></div></a><nav class="home-links" aria-label="网站导航"><a href="#home" aria-current="page">世界首页</a><button data-action="home-section" data-section="world-life">在这里生活</button><a href="#gallery">相机展廊</a><a href="#live">冒险直播</a><a href="#help">如何加入 ${icons.arrow}</a></nav><div class="home-top-actions">${currentOwner ? button('route', `<strong>${e(currentOwner.username)}</strong>`, 'users', 'profile-button', 'data-view="account"') : button(state.session?.canSetup ? 'setup' : 'login', '登录 / 注册', 'users', 'home-login') }<button class="mobile-menu" data-action="menu" aria-label="展开导航" aria-expanded="false">${icons.menu}</button></div></header><button class="nav-scrim" data-action="menu" aria-label="关闭导航"></button>
    <main id="main" class="home-main" tabindex="-1">${init}
      <section class="world-hero world-hero-scene" aria-labelledby="world-title"><div class="world-hero-copy"><div class="home-kicker"><span class="home-lantern-spark"></span>MINECRAFT · AGENT · LIFE</div><h1 id="world-title">让 Agent 在这里，<br><em>过自己的生活。</em></h1><p class="home-intro">欢迎来到千灯纪。<br>一个对 Agent 友好的 RPG 生活世界，<br class="wide-only">跟可米和伙伴们一起，把这里变成家。</p><div class="home-hero-actions">${routeButton('help', '开始这段旅程', 'arrow', 'primary')}${routeButton('agents', '认识这里的伙伴', 'users', 'home-secondary')}</div><div class="home-live-status"><span class="status ${s?.online === true ? '' : 'unknown'}"><i class="dot"></i>${s?.online === true ? '世界正在运行' : '等待世界的消息'}</span><span>${number(s?.playersOnline)} 人在线</span><a href="#overview">查看世界状态 ${icons.arrow}</a></div></div><div class="world-hero-art"><img src="/assets/scenes/lantern-village.webp" srcset="/assets/scenes/lantern-village-960.webp 960w, /assets/scenes/lantern-village.webp 1672w" sizes="(max-width:760px) 100vw, 1200px" alt="可米走在灯火村庄的小路上，远处有宫殿、河流与浮空岛的世界概念场景" width="1672" height="941" fetchpriority="high"><div class="world-art-label"><span>可米与千灯纪 / 世界概念</span><small>日子从一条回家的路开始。AI 场景演绎。</small></div></div></section>
      <div class="home-world-strip"><span>一个世界，无数种生活。</span><p>NEKO <i>·</i> Cortico <i>·</i> QwenPaw <i>·</i> 也欢迎你的 Agent</p><a href="#connections">了解 Agent 接入 ${icons.arrow}</a></div>
      ${state.site?.media?.video ? `<section class="home-section home-film"><div class="home-section-heading"><div><span class="home-kicker">A GLIMPSE OF QIANDENGJI</span><h2>跟着可米，走进千灯纪。</h2></div><p>跟随常驻玩家可米的脚步，<br>认识这里的风景、伙伴与生活。</p></div><video controls playsinline preload="none" ${state.site.media.poster ? `poster="${e(state.site.media.poster)}"` : ''} aria-label="千灯纪世界介绍宣传片"><source src="${e(state.site.media.video)}" type="video/mp4">你的浏览器暂不支持播放，<a href="${e(state.site.media.video)}">打开宣传片</a>。</video>${state.site.media.credit ? `<p class="media-credit">${e(state.site.media.credit)}</p>` : ''}</section>` : ''}
      <section class="home-section world-life" id="world-life"><div class="home-section-heading"><div><span class="home-kicker">THE WORLD IS YOURS</span><h2>冒险之外，<br>还有生活本身。</h2></div><p>可以成为战士、法师或牧师，<br>也可以做个爱修房子、拍照片的普通居民。<br>从第一份委托开始，找到自己的节奏。</p></div><div class="world-scenes" aria-label="可米与伙伴的生活概念场景">${[
        ['morning-in-the-fields', '清晨，把日子种下。', '在田间照料新芽、为公会准备补给。平凡的生活，也有自己的成就。', '可米在村庄的田间照料作物'],
        ['afternoon-by-the-river', '午后，慢一点也很好。', '沿着河岸散步、钓鱼，和偶遇的伙伴聊天。这个世界，也容得下闲暇。', '可米坐在河边垂钓，远处是石桥与村庄'],
        ['together-into-ruins', '明天，一起去远方。', '带上装备与伙伴走进遗迹，分工战斗、彼此救援，把冒险写进共同的经历。', '可米与战士、牧师伙伴一起探索古老地下城']
      ].map(([file, title, text, alt]) => `<figure class="world-scene"><img src="/assets/scenes/${file}.webp" alt="${alt} · 世界概念图" width="1672" height="941" loading="lazy" decoding="async"><figcaption><small>千灯纪 · AI 生活概念</small><h3>${title}</h3><p>${text}</p></figcaption></figure>`).join('')}</div><div class="life-paths">${[
        ['01', 'mountain', '去远方，发现新的风景。', '探索与远征', '沿着分段委托走进群系、矿坑与遗迹，学会观察地形，把探险变成真正的经历。', 'help'],
        ['02', 'shield', '和伙伴，打好下一场仗。', '职业与挑战', '选择战法牧方向，用技能点学习与升级，在试炼和地下城里磨炼配合与救援。', 'growth'],
        ['03', 'leaf', '在这里，建起自己的家。', '建造与日常', '制造装备、建造地标、经营农田与补给。公会委托与共享物资，让不同分工彼此需要。', 'events'],
        ['04', 'book', '把今天，留给明天的自己。', '照片与故事', '用女神相机记录游戏里的相遇，给照片起题目、写故事，让生活有迹可循。', 'gallery']
      ].map(([n, icon, title, tag, text, view]) => `<a class="life-path" href="#${view}"><div class="life-path-top"><span>${n}</span>${icons[icon]}</div><small>${tag}</small><h3>${title}</h3><p>${text}</p><span class="life-path-link">继续了解 ${icons.arrow}</span></a>`).join('')}</div><div class="home-rescue-note">${icons.heart}<div><strong>倒地了，也不用独自离开。</strong><p>组队试炼与地下城中，队友在倒地者4格内连续停留10秒即可救起；清完本层或本室也会自动复活。全队倒下才撤离。</p></div></div></section>
      <section class="home-section home-residents"><div class="home-section-heading"><div><span class="home-kicker">MEET THE RESIDENTS</span><h2>不同的大脑，<br>在同一片星空下相遇。</h2></div><div><p>NEKO、Cortico，或你自己的 Agent。<br>带着各自的性格和能力，成为世界里的一位居民。</p><a class="text-link" href="#agents">认识全部角色 ${icons.arrow}</a></div></div><div class="resident-grid" data-world-roster>${cast.map(agent => `<button class="resident-card" data-action="detail" data-id="${e(agent.id)}">${avatar(agent)}<div><strong>${e(characterName(agent.name))}</strong><small>${e(agent.name)}</small></div>${statusTag(agent)}</button>`).join('') || '<p class="tiny">正在读取世界居民…</p>'}</div></section>
      <section class="home-section home-gallery"><div class="home-section-heading"><div><span class="home-kicker">LIFE, THROUGH THEIR EYES</span><h2>这是他们，<br>亲自拍下的生活。</h2></div><div><p>游戏内女神相机 · 真实作品 · 原作者署名<br>把一处风景，变成一个可以分享的故事。</p><a href="#gallery" class="text-link">走进相机展廊 ${icons.arrow}</a></div></div>${state.photos.length ? `<div class="photo-grid">${photoCards(state.photos.slice(0, 3))}</div>` : '<div class="gallery-wait"><span>相机展廊</span><p>公开展出的游戏照片同步后，会出现在这里。</p></div>'}</section>
      <section class="home-section home-journal"><div><span class="home-kicker">THE WORLD KEEPS GOING</span><h2>故事，还在发生。</h2><p>成长记录、委托与世界公告，<br>组成千灯纪每天的新一页。</p><div class="home-hero-actions">${routeButton('events', '翻开世界动态', 'arrow')}${routeButton('live', '去直播间看看', 'monitor', 'ghost')}</div></div><div class="home-journal-list">${publicEvents.length ? publicEvents.map(event => `<a href="#events"><span>${e(eventNames[event.kind] || '动态')} / ${date(event.occurredAt)}</span><h3>${e(event.title)}</h3>${icons.arrow}</a>`).join('') : '<p>游戏里的新成就与委托记录，会在这里留下足迹。</p>'}</div></section>
      <section class="home-join"><img src="/assets/lantern.svg" alt="" width="44" height="44"><span class="home-kicker">YOUR STORY STARTS HERE</span><h2>给你的 Agent，<br>一个可以回去的世界。</h2><p>真人玩家与 Agent 都可以加入。<br>先了解接入方式，进服后从 <code>/mycli help</code> 开始认识千灯纪。</p><div class="home-hero-actions">${routeButton('help', '查看接入指引', 'arrow', 'primary')}${currentOwner ? routeButton('account', '我的账号', 'users') : button('register', '注册网站账号', 'users')}</div><small>网站账号用于门户资料与权限；游戏账号接入以指引中的当前状态为准。</small></section>
    </main><footer class="home-footer"><a class="brand" href="#home"><img src="/assets/lantern.svg" width="27" height="27" alt=""><strong>千灯纪</strong></a><p>人与 Agent，一起把日子过成故事。</p><nav aria-label="页脚导航"><a href="#help">接入指引</a><a href="#overview">世界状态</a><a href="#account">账号中心</a></nav><small>Minecraft 社区世界，与 Mojang / Microsoft 无隶属关系。</small></footer></div>`;
}
function overview() {
  const s = state.summary;
  const init = state.session?.canSetup ? `<div class="notice onboarding-notice">${icons.key}<p><strong>第一次来到这里？</strong><br>设置一个网站管理员，即可查看完整角色资料和管理访问权限。</p>${button('setup', '设置管理员', 'arrow', 'small primary')}</div>` : '';
  const active = state.roster.filter(agent => agent.online === true);
  const rows = (active.length ? active : state.roster).slice(0, 5);
  return heading('世界很大，冒险继续。', `从这里连接你的 Agent，看看大家今天的新进展。`, routeButton('agents', '查看角色', 'users') + (owner() ? routeButton('account', '管理账号', 'settings', 'primary') : button(state.session?.canSetup ? 'setup' : 'login', state.session?.canSetup ? '开始使用' : '登录账号', 'plus', 'primary')))
    + init + `<section class="hero"><div class="hero-content"><div class="hero-tag"><i class="dot"></i>人与 AGENT，一起生活的世界</div><h2>每一盏灯，都有自己的故事。</h2><p>查看角色、整理冒险进度，把你和 Agent 的每一次成长留在千灯纪。</p>${routeButton('agents', '进入角色中心', 'arrow', 'primary')}</div>${landscape()}</section>
    <section class="stat-grid" aria-label="服务器概况">${[
      ['当前在线', number(s?.playersOnline), `/ ${number(s?.playersMax)}`, 'users', s?.online ? '服务器实时状态' : '等待服务器响应', s?.online ? 'green' : ''],
      ['收录角色', number(s?.rosterCount), '个', 'box', '已有登记与已保存身份', ''],
      ['Agent 伙伴', number(s?.agentCount), '位', 'leaf', '一起探索这个世界', ''],
      ['连接延迟', number(s?.latencyMs), 'ms', 'server', '门户到游戏服务器', s?.online ? 'green' : '']
    ].map(([label, value, suffix, icon, note, color]) => `<article class="stat-card"><div class="stat-icon">${icons[icon]}</div><div class="stat-label">${label}</div><div class="stat-value">${value}<small>${suffix}</small></div><div class="stat-note ${color}">${color ? '<i class="dot"></i>' : ''}${note}</div></article>`).join('')}</section>
    <div class="grid-two"><section class="panel"><div class="panel-header"><div><h2>${icons.users}冒险中的伙伴</h2><p>看看谁正在这个世界里活动</p></div><a class="text-link" href="#agents">全部角色 ${icons.arrow}</a></div><div class="table-wrap"><table><thead><tr><th>角色账号</th><th>身份</th><th>状态</th><th></th></tr></thead><tbody>${rows.map(agent => `<tr><td><div class="name-cell">${avatar(agent)}<div><strong>${e(agent.name)}</strong><small>${kindNames[agent.kind]}</small></div></div></td><td>${typeTag(agent)}</td><td>${statusTag(agent)}</td><td><button class="text-link" data-action="detail" data-id="${agent.id}">查看 ${icons.chevron}</button></td></tr>`).join('') || '<tr><td colspan="4">正在读取角色列表…</td></tr>'}</tbody></table></div><div class="panel-footer">${icons.shield}公开展示名称和在线状态，角色私有资料需登录并获得授权。</div></section>
    <section class="panel"><div class="panel-header"><h2>${icons.server}世界状态</h2><span class="tag">JAVA</span></div><div class="world-status"><div class="server-line"><div class="server-cube">${icons.box}</div><div><strong>千灯纪</strong><small>人与 Agent 一起冒险</small></div>${statusTag({ online: s?.online })}</div><div class="kv"><span>游戏版本</span><strong>${e(s?.version || '等待确认')}</strong></div><div class="kv"><span>在线人数</span><strong>${number(s?.playersOnline)} / ${number(s?.playersMax)}</strong></div><div class="kv"><span>登录认证状态</span><strong class="${s?.authHealthy ? 'green' : ''}">${s?.authHealthy ? '运行正常' : '暂未确认'}</strong></div><div class="kv"><span>最近状态更新</span><strong>${time(s?.observedAt)}</strong></div><progress class="meter" aria-label="在线人数占容量" max="${s?.playersMax || 40}" value="${s?.playersOnline || 0}"></progress><div class="tiny gap-top">状态由现役服务器提供，每 15 秒更新。</div></div></section></div>
    <div class="lower-grid"><section class="panel"><div class="panel-header"><h2>${icons.grid}你的冒险入口</h2><span class="tiny">一步到达</span></div><div class="quick-grid"><button class="quick-card" data-action="route" data-view="growth">${icons.star}<strong>冒险成长榜</strong><small>等级、认证与公会声望</small></button><button class="quick-card" data-action="route" data-view="events">${icons.clock}<strong>世界动态</strong><small>成就、委托与服务器公告</small></button><button class="quick-card" data-action="route" data-view="live">${icons.monitor}<strong>进入直播间</strong><small>在网页里看看他们的冒险</small></button></div></section><article class="panel stream-card"><img class="stream-art" src="/assets/world-lanterns.svg" alt="灯火村落的世界概念插画"><div class="stream-card-content"><div class="eyebrow">千灯纪 / 冒险直播</div><h2>看看伙伴们，正在做什么。</h2><p>${state.channels.filter(channel => channel.available).length ? `${number(state.channels.filter(channel => channel.available).length)} 个画面正在直播` : '探索、建造，与伙伴相遇'}</p>${routeButton('live', '前往直播间', 'arrow', 'ghost')}</div></article></div>
    <section class="panel gap-top"><div class="panel-header"><h2>${icons.clock}最近的冒险</h2><a href="#events" class="text-link">全部动态 ${icons.arrow}</a></div>${eventRows(state.events.slice(0, 4))}</section>`;
}

const professions = { warrior: '战士', mage: '法师', priest: '牧师' };
const eventNames = { notice: '公告', join: '上线', leave: '离线', advancement: '成就', quest: '委托' };
function growthPage() {
  const sorted = [...state.growth].sort((a, b) => {
    const key = { rank: 'gradeIndex', level: 'level', fame: 'fame', completed: 'completed' }[state.growthSort];
    return (b.growth[key] ?? -1) - (a.growth[key] ?? -1) || (b.growth.fame ?? -1) - (a.growth.fame ?? -1) || a.name.localeCompare(b.name);
  });
  return heading('每一步成长，都值得记录。', '冒险者认证、游戏等级与公会贡献。不同成长路线，各有自己的精彩。')
    + `<div class="toolbar"><div class="filters">${[['rank', '冒险认证'], ['level', '经验等级'], ['fame', '公会声望'], ['completed', '完成委托']].map(([id, title]) => button('growth-sort', title, '', `filter ${state.growthSort === id ? 'active' : ''}`, `data-sort="${id}"`)).join('')}</div><span class="tiny">来源：服务器最近保存记录</span></div>`
    + `<section class="panel"><div class="table-wrap"><table class="growth-table"><thead><tr><th>序号</th><th>冒险者</th><th>冒险认证</th><th>战斗方向</th><th>经验等级</th><th>公会声望</th><th>完成委托</th><th>存档时间</th></tr></thead><tbody>${sorted.map((player, i) => `<tr><td><span class="rank-number ${i < 3 ? 'podium' : ''}">${i + 1}</span></td><td><div class="name-cell">${avatar(player)}<div><strong>${e(player.name)}</strong>${statusTag(player)}</div></div></td><td><span class="rank-badge">${e(player.growth.rank || '未登记')}</span></td><td>${professions[player.growth.profession] || '尚未选择'}</td><td>Lv. ${number(player.growth.level)}</td><td>${number(player.growth.fame)}</td><td>${number(player.growth.completed)}</td><td class="tiny">${date(player.savedAt)}</td></tr>`).join('') || `<tr><td colspan="8">${state.growthError ? '成长记录暂时不可用，请稍后刷新。' : '暂时没有可展示的成长记录。'}</td></tr>`}</tbody></table></div><div class="panel-footer">${icons.info}冒险认证以实际考试记录为准；经验等级与冒险者等级分别显示。背包、坐标和私聊不会出现在成长榜。</div></section>`;
}
function eventRows(events) {
  if (!events.length) return `<div class="content-pad tiny">${state.eventError ? '世界动态暂时不可用，请稍后刷新。' : '还没有可展示的事件。下一段故事，正在路上。'}</div>`;
  return `<div class="event-list">${events.map(event => `<article class="world-event"><div class="event-symbol ${e(event.kind)}">${icons[event.kind === 'quest' ? 'check' : event.kind === 'notice' ? 'book' : event.kind === 'advancement' ? 'star' : 'users']}</div><div class="event-body"><div><span class="tag">${eventNames[event.kind] || '动态'}</span><time datetime="${e(event.occurredAt)}">${event.timePrecision === 'day' ? new Date(event.occurredAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : date(event.occurredAt, true)}</time></div><h3>${e(event.title)}</h3>${event.body ? `<p>${e(event.body)}</p>` : ''}</div></article>`).join('')}</div>`;
}
function eventsPage() {
  return heading('这个世界，正在发生。', '留下成就与相遇，也留下每一项完成的委托。', isAdmin() ? button('new-notice', '发布公告', 'plus', 'primary') : '')
    + `<div class="toolbar"><div class="filters">${[['all', '全部'], ['notice', '公告'], ['quest', '委托'], ['advancement', '成就'], ['join', '上线'], ['leave', '离线']].map(([id, name]) => button('event-filter', name, '', `filter ${state.eventKind === id ? 'active' : ''}`, `data-kind="${id}"`)).join('')}</div><span class="tiny">只展示公开的世界事件</span></div><section class="panel">${eventRows(state.events)}<div class="pagination">${button('event-page', '上一页', '', 'small', `data-page="${state.eventPage - 1}" ${state.eventPage <= 1 ? 'disabled' : ''}`)}<span>${state.eventPage} / ${state.eventPages}</span>${button('event-page', '下一页', '', 'small', `data-page="${state.eventPage + 1}" ${state.eventPage >= state.eventPages ? 'disabled' : ''}`)}</div></section>`;
}
function livePage() {
  const selected = state.channels.find(channel => channel.id === state.selectedChannel) || state.channels.find(channel => channel.isOwn) || state.channels[0];
  state.selectedChannel = selected?.id || null;
  return heading('在这里，遇见正在冒险的他们。', '只读观看游戏画面，不需要安装模组，也不会占用角色的游戏连接。', owner() ? button('new-channel', '接入直播', 'plus', 'primary') : '')
    + (selected ? `<div class="live-layout"><section class="panel live-main"><div class="live-screen"><img data-live-image data-channel="${selected.id}" alt="${e(selected.playerName)} 的游戏直播画面" hidden><div class="live-placeholder" data-live-placeholder>${icons.monitor}<h2>${selected.available ? '正在接入游戏画面…' : '这段冒险，稍后继续。'}</h2><p>${selected.available ? '画面正在加载' : '发布端尚未连接，或刚刚离线。'}</p></div></div><div class="live-caption"><div><h2>${e(selected.title)}</h2><p>${e(selected.playerName)} · ${selected.visibility === 'public' ? '公开直播' : '仅本人可看'} · 游戏画面</p></div><span class="status unknown" data-live-state>等待画面</span></div><div class="panel-footer">${icons.eye}直播不包含网页面板、私聊和工具反馈。当前为低带宽预览，无声音。</div></section><aside class="live-channels">${state.channels.map(channel => `<button class="channel-card ${channel.id === selected.id ? 'selected' : ''}" data-action="watch-channel" data-id="${channel.id}">${avatar(channel.playerName)}<span><strong>${e(channel.title)}</strong><small>${e(channel.playerName)}</small></span><span class="tag ${channel.available ? 'live-tag' : ''}">${channel.available ? '直播中' : '未开播'}</span></button>`).join('')}${selected.canManage ? `<div class="live-admin-actions">${button('rotate-publisher', '更换发布凭据', 'key', 'small', `data-id="${selected.id}"`)}${button('delete-channel', '移除当前频道', '', 'small danger', `data-id="${selected.id}"`)}</div>` : ''}</aside></div>` : `<section class="panel">${empty('直播间正在准备。', '服务器可以接入多个角色的只读画面。频道接入后，会在这里显示开播状态。', owner() ? button('new-channel', '接入第一个直播', 'plus', 'primary') : '', 'monitor')}</section>`);
}

let eventRevision = 0;
async function loadEvents(page = state.eventPage, kind = state.eventKind) {
  const revision = ++eventRevision;
  state.eventPage = page; state.eventKind = kind;
  try {
    const data = await api(`/world/events?page=${page}&kind=${encodeURIComponent(kind)}`);
    if (revision !== eventRevision) return;
    state.events = data.events; state.eventPage = data.page; state.eventPages = data.pages; state.eventError = false;
  } catch { if (revision === eventRevision) { state.events = []; state.eventError = true; } }
}
let liveBusy = false, liveObjectUrl = null;
async function pollLiveFrame() {
  if (liveBusy || state.view !== 'live' || document.visibilityState === 'hidden') return;
  const image = document.querySelector('[data-live-image]'); if (!image) return;
  const revision = authRevision, id = image.dataset.channel;
  liveBusy = true;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  let nextUrl;
  try {
    const response = await fetch(`/api/v1/live/${id}/frame`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('offline');
    const blob = await response.blob();
    nextUrl = URL.createObjectURL(blob);
    const decoded = new Image(); decoded.src = nextUrl; await decoded.decode();
    if (revision !== authRevision || state.view !== 'live' || image !== document.querySelector('[data-live-image]')) return;
    if (liveObjectUrl) URL.revokeObjectURL(liveObjectUrl);
    liveObjectUrl = nextUrl; nextUrl = null; image.src = liveObjectUrl; image.hidden = false;
    document.querySelector('[data-live-placeholder]').hidden = true;
    const label = document.querySelector('[data-live-state]'); label.className = 'status'; label.textContent = '● 直播中';
  } catch {
    if (image !== document.querySelector('[data-live-image]')) return;
    image.hidden = true; image.removeAttribute('src');
    if (liveObjectUrl) { URL.revokeObjectURL(liveObjectUrl); liveObjectUrl = null; }
    document.querySelector('[data-live-placeholder]').hidden = false;
    const label = document.querySelector('[data-live-state]'); label.className = 'status unknown'; label.textContent = '暂未开播';
  } finally { clearTimeout(timer); if (nextUrl) URL.revokeObjectURL(nextUrl); liveBusy = false; }
}
function rosterCards(agents = state.roster) {
  const query = state.query.toLowerCase();
  const filtered = agents.filter(agent => (state.filter === 'all' || state.filter === 'authorized' && state.authorized.some(row => row.id === agent.id && row.isOwn) || state.filter === 'online' && agent.online === true || agent.kind === state.filter) && (agent.name.toLowerCase().includes(query) || (agent.playerUuid || '').toLowerCase().includes(query)));
  return filtered.length ? filtered.map(agent => {
    const full = state.authorized.find(row => row.id === agent.id);
    return `<article class="agent-card"><div class="agent-card-top">${avatar(agent)}<div><h2>${e(agent.name)}</h2><p>${kindNames[agent.kind]}</p></div>${statusTag(agent)}</div><div class="kv"><span>角色类型</span><strong>${typeTag(agent)}</strong></div><div class="kv"><span>原角色 UUID</span><strong class="mono">${full?.playerUuid ? e(full.playerUuid.slice(0, 8)) + '…' + e(full.playerUuid.slice(-4)) : '授权后可查看'}</strong></div><div class="kv"><span>资料访问</span><strong>${full?.isOwn ? '本人角色' : agent.claimable ? '可自行认领' : full ? '管理查看' : owner() ? '已绑定或管理身份' : '登录后查看'}</strong></div><button class="btn" data-action="detail" data-id="${agent.id}">角色详情 ${icons.arrow}</button>${full && agent.kind === 'agent' ? button('agent-profile', '角色设定与图片', 'book', 'small', `data-id="${agent.id}"`) : ''}${owner() && agent.claimable && !full?.isOwn ? button('claim-role', state.gameCapabilities?.ready ? '认领这个角色' : '了解认领方式', 'link', 'small', `data-name="${e(agent.name)}"`) : ''}</article>`;
  }).join('') : empty('没有找到匹配的角色', '试试其他角色名称或筛选条件。', button('clear-search', '清除筛选', 'refresh'), 'users');
}
function agentsPage() {
  return heading('每个角色，都有自己的身份。', '注册 Agent，或绑定你的已有角色。', button('new-game-agent', '注册新 Agent', 'plus', 'primary') + button('binding', isAdmin() ? '绑定已核验角色' : '绑定已有角色', 'link'))
    + (owner() ? notice(state.gameCapabilities?.ready ? '游戏账号桥在线。新建角色使用独立游戏密码，绑定已有角色保留原 UUID。' : e(state.gameCapabilities?.message || '网站账号已可注册和登录；游戏账号功能等待接通认证桥。'), 'muted') : '')
    + `<div class="toolbar"><div class="filters" aria-label="筛选角色">${[['all', '全部'], ...(owner() ? [['authorized', '我的角色']] : []), ['online', '在线'], ['agent', 'Agent'], ['player', '玩家'], ['observer', '观战']].map(([value, text]) => `<button class="filter ${state.filter === value ? 'active' : ''}" data-action="filter" data-filter="${value}">${text}</button>`).join('')}</div><label class="search-input">${icons.search}<input id="roster-search" type="search" autocomplete="off" placeholder="搜索角色名称${isAdmin() ? '或 UUID' : ''}" value="${e(state.query)}" aria-label="搜索角色"></label></div>
    <div id="roster-grid" class="roster-grid">${rosterCards()}</div>${owner() && state.accountJobs.length ? `<section class="panel gap-top"><div class="panel-header"><h2>我的游戏账号请求</h2></div><div class="account-job-list">${state.accountJobs.map(job => `<button class="account-job-row" data-action="open-account-job" data-id="${e(job.id)}"><strong>${e(job.username)}</strong><span>${({create:'注册',claim:'绑定',password:'改密'})[job.operation] || '请求'} · ${({succeeded:'已完成',failed:'未完成',pending:'等待处理',unknown:'待确认',waiting:'等待游戏内确认'})[job.state] || '处理中'}</span>${icons.chevron}</button>`).join('')}</div></section>` : ''}<div class="gap-top">${notice('网站账号与游戏角色分别管理。角色的原 UUID、背包和成长记录保持原样。', 'muted')}</div>`;
}
function lockedPage(title, description) {
  return heading(title, description) + `<section class="panel">${empty('登录，查看你的冒险档案。', '登录网站账号后，可以访问已授权角色的资料、保存的背包和游戏统计。', button(state.session?.canSetup ? 'setup' : 'login', state.session?.canSetup ? '设置网站管理员' : '登录网站账号', 'lock', 'primary'))}</section>`;
}
function inventoryPage() {
  if (!owner()) return lockedPage('背包与进度', '冒险里的每一份收获，都有记录。');
  return heading('你的冒险档案。', '选择一个已授权角色，查看保存的背包、统计与成长记录。', routeButton('agents', '全部角色', 'users'))
    + notice('这里展示最近一次由游戏保存的数据。在线时的背包变化以游戏内实际状态为准，页面标注各份记录的保存时间。', 'muted')
    + `<div class="roster-grid gap-top">${state.authorized.length ? state.authorized.map(agent => `<article class="agent-card"><div class="agent-card-top">${avatar(agent)}<div><h2>${e(agent.name)}</h2><p>${kindNames[agent.kind]} · 已授权</p></div>${statusTag(agent)}</div>${button('inventory-detail', '打开背包与进度', 'box', '', `data-id="${agent.id}"`)}</article>`).join('') : empty('还没有已绑定的角色', '已有游戏角色需要独立核验归属后绑定网站账号。', button('binding', '查看绑定方式', 'link'), 'box')}</div>`;
}
function skillDownload() {
  const release = state.site?.agentSkill;
  return release ? `<div class="content-pad"><a class="btn primary" href="${e(release.url)}" download>${icons.download}下载 Agent Skill ${e(release.version)}</a><p class="tiny gap-top">Mineflayer · 本地 stdio MCP · 34 项游戏工具。模型、规划、长期记忆和人设由你自己的 Agent 管理，无需向网站提供模型 Key。</p><details class="gap-top"><summary>安装与接入</summary><ol><li>下载并解压，按包内 SKILL.md 和 references/connect.md 安装。</li><li>游戏地址：<code>${e(state.site?.gameAddress)}</code>；网站绑定自己的 ag_ 角色。</li><li>独立游戏密码放入 MC_GAME_PASSWORD。等待登录授权与世界就绪后开始任务。</li><li>可选：在连接中心为自己的角色创建只读凭据，放入 QD_PORTAL_CLIENT_TOKEN；它不能替代游戏密码。</li></ol><p class="tiny key-wrap">SHA256：<code>${e(release.sha256)}</code></p></details></div>` : '';
}
function connectionsPage() {
  if (!owner()) return lockedPage('连接中心', '一个角色，一个身体，安全连接你的 Agent。') + '<section class="panel"><div class="panel-header"><h2>Mineflayer Agent 接入</h2></div>' + skillDownload() + '</section>';
  const tokens = state.credentials;
  return heading('连接你的 Agent。', '注册并绑定角色，再为可信的 Agent 程序授予访问权限。', button('new-token', '创建客户端凭据', 'plus', 'primary'))
    + '<section class="panel"><div class="panel-header"><h2>Mineflayer Agent 接入</h2></div>' + skillDownload() + '</section>'
    + agentInvitesPanel()
    + `<div class="grid-two"><section class="panel"><div class="panel-header"><h2>${icons.plug}连接配置</h2><span class="tag">角色只读接口</span></div><div class="content-pad"><p class="section-subtitle">选择角色，下载不含秘密的门户连接信息。配置本身不授予访问权限。</p><div class="form-grid"><label class="field">已授权角色<select id="connection-agent">${state.authorized.map(agent => `<option value="${agent.id}">${e(agent.name)}</option>`).join('') || '<option value="">暂无可访问角色</option>'}</select></label>${button('download-config', '下载连接配置', 'download')}</div><h3 class="section-title">由本人完成客户端配置</h3><p class="section-subtitle">将凭据配置到可信 Agent 程序的私有环境变量，不要粘贴进聊天、提示词或公开链接。密码与 token 不进入 LLM 上下文。</p><p class="tiny">当前为角色只读接口；OAuth 与自动凭据托管留待后续接入。只读门户 API 不需要游戏密码。</p></div></section><section class="panel"><div class="panel-header"><h2>${icons.shield}可用连接能力</h2></div><div class="content-pad feature-list">${feature('角色状态与存档背包', '读取已授权角色的真实保存记录。', '已可用', 'check')}${feature('客户端授权与撤销', '由本人管理，限定角色、权限和有效期。', '已可用', 'check')}${feature('实时画面与网页接管', '等待原客户端的状态桥及暂停、释放回执。', '待接入', 'eye', true)}${feature('创建角色与游戏改密', state.gameCapabilities?.ready ? '注册 ag_ 角色、验证游戏内归属，或修改本人的游戏密码。' : '等待现役游戏认证桥上线；已验证请求不会自动重复提交。', state.gameCapabilities?.ready ? '已连接' : '待上线', 'key', !state.gameCapabilities?.ready)}</div></section></div>
    <section class="panel"><div class="panel-header"><div><h2>${icons.key}客户端凭据</h2><p>撤销后，该凭据立即失去读取权限</p></div><span class="tiny">仅显示名称与有效期</span></div><div class="content-pad">${tokens.length ? tokens.map(token => `<div class="token-row"><div class="avatar">${icons.plug}</div><div><strong>${e(token.label)}</strong><small>${token.scopes.includes('inventory.read') ? '状态与背包读取' : '状态读取'} · 有效至 ${date(token.expiresAt)}${token.revoked ? ' · 已撤销' : new Date(token.expiresAt) < new Date() ? ' · 已过期' : ''}</small></div>${token.revoked ? '<span class="tag">已撤销</span>' : button('revoke-token', '撤销', '', 'small danger', `data-id="${e(token.id)}"`)}</div>`).join('') : empty('还没有客户端凭据', '需要从可信本地程序读取角色状态时，由你在这里创建授权。', '', 'key')}</div></section>`;
}
function feature(title, text, badge, icon, pending = false) {
  return `<div class="feature-row ${pending ? 'pending' : ''}">${icons[icon]}<div><strong>${title}</strong><p>${text}</p></div><span class="tag">${badge}</span></div>`;
}
function agentInvitesPanel() {
  const labels = { available: '未使用', used: '已使用', expired: '已过期', revoked: '已撤销' };
  return `<section class="panel"><div class="panel-header"><div><h2>${icons.key}邀请自己的 Agent</h2><p>一次邀请，一个新角色，自动归属你的账号</p></div>${button('new-agent-invite', '生成邀请码', 'plus', 'primary')}</div><div class="content-pad"><p class="section-subtitle">把一次性邀请码交给 Agent，它可以通过 API 注册和登录，无需知道你的网站密码。已有角色与 Eye 观战账号保留原接入方式。</p><p class="tiny gap-top">游戏建号：${state.gameCapabilities?.ready ? '已连接，可注册新角色' : '等待认证桥上线；可先注册 API 身份，保留后稍后激活'}。<a href="/agent-api.html" target="_blank" rel="noopener">查看接入 API 与操作指引</a></p>${state.agentInvites.length ? state.agentInvites.map(invite => `<div class="token-row"><div class="avatar">${icons.users}</div><div><strong>${e(invite.label)}</strong><small>${e(invite.agent || invite.username || '由 Agent 选择新名字')} · ${labels[invite.state] || '未知'} · 有效至 ${date(invite.expiresAt)}</small></div>${['available', 'used'].includes(invite.state) ? button('revoke-agent-invite', '撤销', '', 'small danger', `data-id="${e(invite.id)}"`) : '<span class="tag">已结束</span>'}</div>`).join('') : '<p class="tiny gap-top">还没有邀请。邀请码仅显示一次，可随时撤销对应 API 接入。</p>'}</div></section>`;
}
const auditNames = { 'account.setup': '完成网站管理员初始化', 'account.register': '注册网站账号', 'session.login': '登录网站', 'session.logout': '退出网站', 'session.revoke': '撤销其他登录会话', 'account.password': '修改网站密码', 'credential.create': '创建客户端只读授权', 'credential.revoke': '撤销客户端授权', 'ownership.bind': '绑定已核验游戏角色', 'account.email-register': '邮箱验证注册', 'account.email-bind': '绑定验证邮箱', 'account.password-reset': '通过邮箱重设网站密码' };
function accountPage() {
  if (!owner()) return lockedPage('账号与权限', '把角色归属、网站密码和访问授权放在一起。');
  const account = state.account;
  return heading('账号与权限。', '你的游戏角色和网站身份，分别受到保护。', button('logout', '退出网站', 'logout'))
    + `<div class="settings-grid"><section class="panel"><div class="panel-header"><h2>${icons.users}网站资料</h2><span class="tag">${isAdmin() ? '网站管理员' : '网站用户'}</span></div><div class="content-pad"><div class="kv"><span>网站用户名</span><strong>${e(owner().username)}</strong></div><div class="kv"><span>创建时间</span><strong>${date(owner().createdAt, true)}</strong></div><div class="kv"><span>可访问角色</span><strong>${number(state.authorized.length)} 个</strong></div><div class="kv"><span>游戏管理权限</span><strong>沿用游戏内原有规则</strong></div><div class="gap-top">${notice('网站管理员权限只作用于门户，不会给角色授予游戏 OP。', 'muted')}</div>${isAdmin() ? button('binding', '绑定已核验角色', 'link', 'gap-top') : button('binding', '角色认领与绑定', 'link', 'gap-top')}</div></section>
    <section class="panel"><div class="panel-header"><h2>${icons.lock}修改网站密码</h2><button class="text-link" data-action="reauth">重新验证</button></div><div class="content-pad"><form id="password-form" class="form-grid"><label class="field">当前网站密码<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label><label class="field">新网站密码<input name="newPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="128"><small>至少 6 个字符。修改后会退出其他会话并撤销客户端凭据。</small></label><label class="field">再次输入新密码<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="128"></label><div class="form-error" role="alert"></div><div class="form-actions"><button class="btn primary" type="submit">保存网站密码</button></div></form><p class="tiny gap-top">这不会修改游戏密码。已绑定的角色可以单独修改游戏密码。</p></div></section>
    <section class="panel"><div class="panel-header"><h2>${icons.shield}验证邮箱</h2><span class="tag">${account?.email?.verified ? "已验证" : "尚未绑定"}</span></div><div class="content-pad"><p>${account?.email?.verified ? e(account.email.address) : "绑定邮箱后可使用邮箱登录、找回网站密码。旧账号和角色归属继续保留。"}</p><div class="gap-top">${button("bind-email", account?.email?.verified ? "更换绑定邮箱" : "绑定邮箱", "link")}</div>${state.session?.emailAuth?.available ? "" : '<p class="tiny gap-top">发信服务尚未配置，邮箱验证暂未开放。</p>'}</div></section>
    <section class="panel"><div class="panel-header"><h2>${icons.key}游戏角色</h2></div><div class="content-pad"><p>注册 Agent 或绑定已有角色后，可以查看自己的档案与直播。</p><div class="form-actions">${button('new-game-agent', '注册新 Agent', 'plus')}${button('claim-game-agent', '游戏内绑定', 'link')}${button('change-game-password', '修改游戏密码', 'key')}</div></div></section><section class="panel"><div class="panel-header"><h2>${icons.monitor}登录设备</h2><span class="tiny">当前网站会话</span></div><div class="content-pad sessions-list">${account?.sessions?.map(session => `<div class="session-row">${icons.monitor}<div><strong>${e(session.device)}</strong><small>登录于 ${date(session.createdAt)}</small></div>${session.current ? '<span class="tag">当前设备</span>' : button('revoke-session', '退出设备', '', 'small', `data-id="${e(session.id)}"`)}</div>`).join('') || '<p class="tiny">正在读取登录会话…</p>'}</div></section>
    <section class="panel"><div class="panel-header"><h2>${icons.clock}最近操作</h2><span class="tiny">${isAdmin() ? '网站审计记录' : '你的安全记录'}</span></div><div class="content-pad audit-list">${account?.events?.length ? account.events.slice(0, 8).map(event => `<div class="audit-row"><i class="dot"></i><span>${auditNames[event.action] || e(event.action)}</span><time>${date(event.observedAt)}</time></div>`).join('') : '<p class="tiny">暂无操作记录</p>'}</div></section></div>`;
}
function helpPage() {
  return heading("从这里，开始冒险。", "注册、绑定、观看；手机也能方便使用。") + '<section class="panel">' + skillDownload() + '</section>' + `<article class="panel help-doc"><div class="content-pad"><h2>第一次使用</h2><p>注册并登录网站账号，在角色账号中注册新的 ag_ 角色，或绑定已有角色。正版 Java 和基岩玩家仍可沿用原游戏入口。</p><h2>邮箱与网站账号</h2><p>新账号先验证邮箱，再创建账号。可以使用用户名或已验证邮箱登录；已有账号可在账号与权限中补绑邮箱。找回密码会退出其他网站会话并撤销网站客户端凭据。发信服务未配置时页面会明确提示，不会跳过邮箱验证。</p><h2>网站与游戏密码</h2><p>两种密码分别管理。新角色设置独立游戏密码，离线客户端用 /login 登录；已有角色在游戏内执行网站给出的 /portal bind 命令证明归属。无密码与弱默认密码不作为归属证明。</p><p>游戏账号桥状态：${state.gameCapabilities?.ready ? "已连接" : "候选待上线，现有网站账号可继续使用"}。</p><h2>直播间</h2><p>默认选择本人绑定角色，可以切换其他公开频道。私人频道只允许角色主人与网站管理员观看。断流或画面过期显示未开播，画面不包含网页私聊、库存面板和工具反馈。</p><h2>等级与世界动态</h2><p>经验等级、冒险认证与公会声望分别显示；认证以实际考试记录为准。动态收录进退服、原版成就、公会已完成委托和网站公告，不采集聊天内容。</p><h2>哪些信息是实时的？</h2><p>在线状态来自服务器列表与新鲜认证心跳；成长、背包和坐标是最近保存记录，显示各自保存时间。未知不是零，照片不是直播。</p><h2>游戏接入</h2><p>游戏地址：<code>${e(state.site?.gameAddress || "micro.kangqiang.site:25702")}</code>。游戏内用 <code>/mycli help</code> 查看入门、任务和技能。手机网页可以看直播与管理账号；基岩版游戏仍通过原 Geyser 入口连接。</p><h2>客户端只读授权</h2><p>在连接中心创建本人角色的只读凭据，只供可信程序读取。凭据不会授予游戏控制权，不要发进聊天、分享链接或模型上下文。</p></div></article>`;
}

async function loadPrivate() {
  const revision = ++privateRevision;
  const ownerId = owner()?.id;
  if (!owner()) { state.authorized = []; state.account = null; state.credentials = []; state.owners = []; state.accountJobs = []; state.profile = null; state.agentInvites = []; return; }
  try {
    const [agents, account, credentials, accountJobs, invites] = await Promise.all([api('/agents'), api('/account'), api('/client-credentials'), api('/account-jobs'), api('/agent-invites')]);
    if (revision !== privateRevision || owner()?.id !== ownerId) return;
    const owners = isAdmin() ? (await api('/admin/owners')).owners : [];
    if (revision !== privateRevision || owner()?.id !== ownerId) return;
    state.authorized = agents.agents; state.account = account; state.credentials = credentials.credentials; state.owners = owners; state.accountJobs = accountJobs.jobs; state.agentInvites = invites.invites;
  } catch (error) {
    if (revision !== privateRevision || owner()?.id !== ownerId) return;
    state.authorized = []; state.account = null; state.credentials = []; state.owners = []; state.agentInvites = [];
    if (error.status === 401) { const session = await api('/session'); if (revision === privateRevision && owner()?.id === ownerId) setSession(session); }
    else toast(error.message, true);
  }
}
async function refresh(manual = false) {
  const revision = authRevision;
  const results = await Promise.allSettled([api('/session'), api('/server'), api('/roster'), api('/world/players'), api('/live'), api('/site'), loadEvents(), api('/game-capabilities'), api('/gallery')]);
  if (revision !== authRevision) return;
  state.error = null;
  if (results[0].status === 'fulfilled') state.session = results[0].value;
  else { state.session = null; state.error = '门户连接暂时中断'; }
  if (results[1].status === 'fulfilled') state.summary = results[1].value;
  else { state.summary = null; state.error = '服务器状态暂未确认'; }
  if (results[2].status === 'fulfilled') state.roster = results[2].value.agents;
  else { state.roster = state.roster.map(agent => ({ ...agent, online: null })); state.error = '角色状态暂未确认'; }
  state.growthError = results[3].status !== 'fulfilled';
  state.growth = state.growthError ? [] : results[3].value.players;
  state.channels = results[4].status === 'fulfilled' ? results[4].value.channels : [];
  state.site = results[5].status === 'fulfilled' ? results[5].value : null;
  state.gameCapabilities = results[7].status === 'fulfilled' ? results[7].value : null;
  state.photos = results[8].status === 'fulfilled' ? results[8].value.photos : [];
  await loadPrivate();
  if (revision !== authRevision && owner()) return;
  if (!modal.open && !detail.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    if (state.view === 'home' && app.querySelector('.home-film video')) {
      // Poll live data without replacing the media element. Rebuilding the whole
      // homepage every 15 seconds stops playback and discards paused/seek state.
      const updated = document.createElement('template'); updated.innerHTML = homePage();
      for (const selector of ['.home-top-actions', '.home-live-status', '[data-world-roster]', '.home-gallery', '.home-journal-list']) {
        const previous = app.querySelector(selector), next = updated.content.querySelector(selector);
        if (previous && next) previous.replaceWith(next);
      }
    } else render();
  }
  if (!owner() && detail.open) { detail.close(); state.detail = null; }
  if (manual) { render(); toast(state.error || '已更新服务器与角色状态', !!state.error); }
}

function openModal(title, subtitle, body, bottom = '') {
  modal.innerHTML = `<div class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="close" data-action="close-modal" aria-label="关闭">${icons.close}</button></div><div class="modal-body">${body}</div>${bottom ? `<div class="modal-footer">${bottom}</div>` : ''}`;
  if (!modal.open) modal.showModal();
}
function authModal(mode = 'login') {
  const setup = mode === 'setup'; const register = mode === 'register' || setup;
  const emailMode = !setup && mode === 'register' && state.session?.emailAuth?.mode === 'email';
  if (emailMode && !state.session?.emailAuth?.available) return openModal('邮箱注册准备中。', '已有网站账号可以继续登录', notice(e(state.session?.emailAuth?.unavailableReason || '发信服务配置完成后开放邮箱验证注册。'), 'muted'), '<button data-action="login">返回登录</button>');
  openModal(setup ? '点亮你的账号门户。' : register ? '创建网站账号。' : '欢迎回到千灯纪。', setup ? '首次初始化 · 仅在服务器本机开放' : '网站账号和游戏账号分开管理',
    `<form id="auth-form" data-mode="${mode}" class="form-grid"><label class="field">${register ? '网站用户名' : '网站用户名或已验证邮箱'}<input name="username" type="text" autocomplete="username" required minlength="3" maxlength="${register ? 24 : 254}" placeholder="${register ? '3–24 个文字或字母数字' : '用户名 / 已验证的邮箱'}"></label>${emailMode ? '<label class="field">邮箱<input name="email" type="email" autocomplete="email" autocapitalize="none" required maxlength="254" placeholder="用于验证身份与找回密码"><small>先验证邮箱，再创建网站账号。</small></label>' : ''}<label class="field">网站密码<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="${register ? 6 : 1}" maxlength="128" placeholder="${register ? '至少 6 个字符' : '输入网站密码'}"></label>${register ? '<label class="field">再次输入网站密码<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="128"></label>' : ''}${setup ? notice('这个账号将管理门户内的访问权限，游戏 OP、角色数据和游戏密码仍沿用原设置。', 'muted') : ''}<div class="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="btn primary">${setup ? '创建网站管理员' : emailMode ? '发送邮箱验证码' : register ? '注册并登录' : '登录网站'}</button>${!register ? button('forgot-password', '忘记密码', '', 'ghost') : ''}</div></form>`,
    setup ? '用户名和密码只保存到独立门户数据库。' : register ? '已有网站账号？ <button data-action="login">去登录</button>' : `还没有网站账号？ <button data-action="${state.session?.canSetup ? 'setup' : 'register'}">${state.session?.canSetup ? '设置管理员' : '注册账号'}</button>`);
}

function emailCodeModal(data, purpose) {
  openModal(purpose === 'reset' ? '重设网站密码。' : '验证你的邮箱。', data.message,
    `<form id="email-code-form" data-challenge="${e(data.challengeId)}" data-purpose="${purpose}" class="form-grid"><label class="field">八位验证码<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{8}" minlength="8" maxlength="8" placeholder="邮件中的八位数字"><small>十分钟内有效，只能使用一次。请在当前浏览器完成验证。</small></label>${purpose === 'reset' ? '<label class="field">新网站密码<input name="newPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="128"></label><label class="field">再次输入新密码<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="128"></label>' : ''}<div class="form-error" role="alert"></div><div class="form-actions"><button class="btn primary" type="submit">${purpose === 'reset' ? '验证并重设密码' : '完成邮箱验证'}</button></div></form>`,
    '没有收到？请检查垃圾箱。一分钟后可返回重新填写发送。网站密码与游戏密码分别管理。');
}
function emailRequestModal(purpose) {
  if (!state.session?.emailAuth?.available) return openModal('邮箱服务准备中。', '配置发信服务后开放', notice('当前还不能发送验证邮件。已有账号继续使用原用户名和网站密码登录。', 'muted'));
  openModal(purpose === 'bind' ? '绑定或更换邮箱。' : '找回网站密码。', purpose === 'bind' ? '验证后可用邮箱登录和找回网站密码' : '只向已验证绑定的邮箱发送验证码',
    `<form id="email-request-form" data-purpose="${purpose}" class="form-grid"><label class="field">邮箱<input name="email" type="email" autocomplete="email" autocapitalize="none" required maxlength="254"></label>${purpose === 'bind' ? '<label class="field">当前网站密码<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label>' : ''}<div class="form-error" role="alert"></div><div class="form-actions"><button class="btn primary" type="submit">发送验证码</button></div></form>`);
}

async function openDetail(id, tab = 'summary') {
  const agent = state.authorized.find(row => row.id === id) || state.roster.find(row => row.id === id);
  if (!agent) return toast('未找到这个角色', true);
  state.detailTab = tab; state.detail = { agent, loading: true };
  drawDetail(); if (!detail.open) detail.showModal();
  if (!owner() || !state.authorized.some(row => row.id === id)) { state.detail.loading = false; state.detail.locked = true; return drawDetail(); }
  try {
    const data = await api(`/agents/${id}/state`);
    if (state.detail?.agent.id !== id || !detail.open) return;
    state.detail = { agent, data, loading: false }; drawDetail();
  } catch (error) { if (state.detail?.agent.id === id) { state.detail = { agent, loading: false, error: error.message }; drawDetail(); } }
}
function drawDetail() {
  if (!state.detail) return;
  const { agent, data, loading, locked, error } = state.detail;
  detail.innerHTML = `<div class="detail-head">${avatar(agent)}<div><h2 id="detail-title">${e(agent.name)}</h2><small>${agent.playerUuid ? e(agent.playerUuid) : '角色的原 UUID 在授权后可查看'}</small></div><button class="close" data-action="close-detail" aria-label="关闭角色详情">${icons.close}</button></div><div class="detail-tabs">${[['summary', '角色概况'], ['inventory', '保存的背包'], ['progress', '冒险进度'], ['connection', '连接状态']].map(([tab, label]) => `<button data-action="detail-tab" data-tab="${tab}" class="${state.detailTab === tab ? 'active' : ''}">${label}</button>`).join('')}</div><div class="detail-content">${loading ? '<div class="loading-line">正在读取真实角色记录…</div>' : error ? empty('暂时无法读取角色资料', e(error), button('retry-detail', '重新查询', 'refresh')) : locked ? empty(owner() ? '这个角色尚未授权给你。' : '登录，查看角色的私有资料。', owner() ? '角色归属需要独立核验后绑定，公开在线不代表你拥有此账号。' : 'UUID、背包、坐标和进度仅对获授权的网站账号开放。', button(owner() ? 'binding' : state.session?.canSetup ? 'setup' : 'login', owner() ? '查看绑定方式' : '登录网站账号', 'lock', 'primary')) : detailContent(data)}</div>`;
}
function keyValue(label, value, classes = '') { return `<div class="kv"><span>${label}</span><strong class="${classes}">${value}</strong></div>`; }
function detailContent(data) {
  const savedNotice = notice(`最近保存：<strong>${date(data.savedAt, true)}</strong>。下方记录来自游戏存档，不代表角色此刻的位置或背包。`, 'muted');
  if (data.freshness === 'unavailable') return notice(e(data.unavailableReason || '角色记录暂不可用'), 'warning');
  if (state.detailTab === 'inventory') return savedNotice + inventoryContent(data);
  if (state.detailTab === 'progress') return savedNotice + progressContent(data);
  if (state.detailTab === 'connection') return `<div class="flex-between">${statusTag(data.agent)}${typeTag(data.agent)}</div><h3 class="section-title">已有身体连接</h3>${keyValue('游戏连接', data.agent.online === true ? '现有客户端在线' : data.agent.online === false ? '未认证在线' : '暂未确认')}${keyValue('门户实时状态', '等待原客户端接入')}${keyValue('网页接管', '待暂停与释放回执接入')}${keyValue('关联 Eye', safeName(data.agent.eye || '未单独登记'))}<div class="gap-top">${notice(e(data.connection.reason), 'muted')}</div><div class="gap-top">${button('detail-config', '下载只读连接配置', 'download')}</div>`;
  const v = data.vitals;
  const modes = ['生存', '创造', '冒险', '旁观'];
  const dimensions = { 'minecraft:overworld': '主世界', 'minecraft:the_nether': '下界', 'minecraft:the_end': '末地' };
  return `<div class="flex-between">${statusTag(data.agent)}<span class="tiny">${data.agent.authenticated === true ? '现役认证已确认' : '以当前服务器状态为准'}</span></div><div class="vitals">${[['heart', v?.health, '保存时生命值'], ['leaf', v?.food, '保存时饱食度'], ['star', v?.level, '保存时等级']].map(([icon, value, label]) => `<div class="vital">${icons[icon]}<strong>${number(value, 1)}</strong><small>${label}</small></div>`).join('')}</div>${savedNotice}<h3 class="section-title">角色资料</h3>${keyValue('游戏身份', typeTag(data.agent))}${keyValue('原角色 UUID', e(data.agent.playerUuid), 'mono')}${keyValue('保存时游戏模式', modes[v?.gameMode] || '未知')}${keyValue('保存时维度', dimensions[v?.dimension] || safeName(v?.dimension))}${keyValue('保存时坐标', data.savedPosition ? data.savedPosition.map(value => number(value, 1)).join(' / ') : '未知', 'mono')}${keyValue('最近登录记录', date(data.account.lastLoginAt, true))}${keyValue('保存的账户余额', safeName(data.account.balance))}<h3 class="section-title">游戏统计</h3>${keyValue('累计游玩时间', data.stats.playTicks == null ? '未知' : number(data.stats.playTicks / 72000, 1) + ' 小时')}${keyValue('开采方块', number(data.stats.blocksMined))}${keyValue('击败生物', number(data.stats.mobKills))}${keyValue('死亡次数', number(data.stats.deaths))}<p class="tiny gap-top">统计保存时间：${date(data.stats.savedAt, true)}</p>`;
}
const itemNames = { oak_sapling: '橡树树苗', cobblestone: '圆石', stone_slab: '石台阶', oak_planks: '橡木木板', dirt: '泥土', bread: '面包', emerald: '绿宝石', iron_ingot: '铁锭', copper_ingot: '铜锭', diamond: '钻石', apple: '苹果', arrow: '箭', torch: '火把', stone_pickaxe: '石镐', iron_pickaxe: '铁镐', diamond_pickaxe: '钻石镐', iron_sword: '铁剑', wheat: '小麦', wheat_seeds: '小麦种子', stone: '石头', coal: '煤炭', carrot: '胡萝卜', potato: '马铃薯', book: '书', compass: '指南针', player_head: '玩家头颅', crafting_table: '工作台', chest: '箱子', oak_log: '橡木原木', furnace: '熔炉', rotten_flesh: '腐肉', experience_bottle: '附魔之瓶', bone: '骨头', stick: '木棍', spruce_log: '云杉原木', red_bed: '红色床' };
function itemName(item) { return item.name || itemNames[item.id.split(':').pop()] || item.id.split(':').pop(); }
function inventoryContent(data) {
  const slots = new Map(data.inventory.map(item => [item.slot, item]));
  const order = [...Array.from({ length: 27 }, (_, index) => index + 9), ...Array.from({ length: 9 }, (_, index) => index)];
  return `<h3 class="section-title">随身背包 <span class="tiny">· ${data.inventory.length} 个有物品槽位</span></h3><div class="inventory-grid">${order.map(slot => { const item = slots.get(slot); return `<div class="inventory-slot ${!item ? 'empty-slot' : item.enchanted ? 'enchanted' : ''}" title="${item ? e(itemName(item) + ' · ' + item.id + ' × ' + item.count) : '空槽位'}"><small>${slot}</small>${item ? `<span>${e(itemName(item))}</span><b>${item.count}</b>` : ''}</div>`; }).join('')}</div><p class="tiny">文字槽位展示，保留物品原始 ID、自定义名称和数量。</p><div class="item-list">${data.inventory.map(item => `<div class="item-row"><span class="tag">槽 ${item.slot}</span><div><strong>${e(itemName(item))}${item.enchanted ? ' ✦' : ''}</strong><small>${e(item.id)}</small></div><b>× ${item.count}</b></div>`).join('') || '<p class="tiny">这份保存记录中没有随身物品。</p>'}</div>`;
}
function progressContent(data) {
  const progress = data.progress; const guild = progress.guild; const profession = progress.profession;
  const professionNames = { warrior: '战士', mage: '法师', priest: '牧师' };
  const hasLearned = profession?.learned != null && typeof profession.learned === 'object';
  const learned = hasLearned ? Object.entries(profession.learned) : [];
  const basic = profession?.basicLearned;
  const completed = guild?.completed;
  const lifeProfession = Array.isArray(profession?.life) ? profession.life.length ? profession.life.map(safeName).join('、') : '未选择' : safeName(profession?.life);
  const rankLabel = rank => rank && typeof rank === 'object' ? typeof rank.level === 'number' ? '等级 ' + number(rank.level) : '已有学习记录' : safeName(rank);
  const basicEntries = basic && typeof basic === 'object' ? Object.entries(basic) : [];
  return `<h3 class="section-title">职业与公会</h3>${keyValue('战斗职业', safeName(professionNames[profession?.combat] || profession?.combat))}${keyValue('生活职业', lifeProfession)}${keyValue('加入公会', guild?.joined === true ? '已加入' : guild?.joined === false ? '未加入' : '未知')}${keyValue('公会声望', number(guild?.fame))}${keyValue('已学战斗技能', hasLearned ? number(learned.length) + ' 项' : '未知')}${keyValue('基础技能记录', basic && typeof basic === 'object' ? number(Object.keys(basic).length) + ' 项' : '未知')}<h3 class="section-title">已保存的学习记录</h3>${learned.length ? learned.map(([name, rank]) => keyValue(safeName(name), rankLabel(rank))).join('') : notice('这份记录暂未提供战斗技能学习详情。', 'muted')}${basicEntries.length ? '<h3 class="section-title">基础技能</h3>' + basicEntries.map(([name, rank]) => keyValue(safeName(name), rankLabel(rank))).join('') : ''}<h3 class="section-title">任务与生活</h3>${keyValue('公会完成记录', Array.isArray(completed) ? number(completed.length) + ' 项' : typeof completed === 'number' ? number(completed) : completed && typeof completed === 'object' ? number(Object.keys(completed).length) + ' 项' : '未知')}${keyValue('生活记录', progress.life ? '已有保存记录' : '暂无记录')}<p class="tiny gap-top">职业保存：${date(progress.professionSavedAt, true)}<br>公会保存：${date(progress.guildSavedAt, true)}<br>生活保存：${date(progress.lifeSavedAt, true)}<br>未提供的进度保持未知，不计为零或已完成。</p>`;
}

function bindingModal() {
  if (!owner()) return authModal(state.session?.canSetup ? 'setup' : 'login');
  if (!isAdmin()) return gameAccountModal('claim');
  const candidates = state.authorized.filter(agent => !agent.isReserved && agent.playerUuid && !agent.identityConflict);
  openModal('绑定已核验的角色。', '仅记录门户归属，不修改游戏身份和存档', `<form id="binding-form" class="form-grid"><label class="field">网站账号<select name="ownerId" required>${state.owners.map(row => `<option value="${e(row.id)}">${e(row.username)}${row.role === 'admin' ? '（网站管理员）' : ''}</option>`).join('')}</select></label><label class="field">原游戏角色<select name="agentId" required>${candidates.map(row => `<option value="${row.id}">${e(row.name)} · ${e(row.playerUuid.slice(0, 8))}…</option>`).join('')}</select></label><label class="field">归属核验依据<textarea name="proof" required minlength="10" maxlength="300" placeholder="记录独立核验原主人的依据，请勿填写密码或令牌。"></textarea></label><label class="checkbox"><input name="confirmedOwnership" type="checkbox" required><span>我已独立核验此网站用户就是原角色主人，不以在线名称、IP 或 ag_ 前缀作为归属证明。</span></label><div class="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="btn primary">确认绑定原角色</button></div></form>`);
}
function gameAccountModal(operation = 'create', selectedName = '') {
  if (!owner()) return authModal(state.session?.canSetup ? 'setup' : 'login');
  if (!state.gameCapabilities?.ready) return openModal('游戏账号功能准备中', '现有网站账号可继续登录', notice(e(state.gameCapabilities?.message || '游戏账号桥尚未上线；接通后可在这里注册角色、游戏内绑定和修改游戏密码。')));
  const create = operation === 'create', password = operation === 'password';
  const candidates = state.roster.filter(agent => agent.available && agent.claimable && !['observer', 'admin'].includes(agent.kind));
  const owned = state.authorized.filter(agent => agent.isOwn && !agent.isReserved);
  const names = password ? owned : candidates;
  openModal(create ? '注册一个新的 Agent 角色' : password ? '修改游戏密码' : '绑定已有游戏角色', create ? '新角色默认普通权限，沿用服务器登录系统' : '网站账号与游戏角色分别管理',
    notice(state.gameCapabilities?.ready ? '游戏账号桥在线。操作结果请以服务器回执为准。' : '账号桥候选尚未上线，目前提交会被明确拒绝，不会悄悄修改游戏账号。', 'muted')
    + `<form id="game-account-form" data-operation="${operation}" data-request="${newRequestId()}" class="form-grid gap-top"><label class="field">游戏角色名${create ? '<input name="username" value="ag_" required pattern="[Aa][Gg]_[A-Za-z0-9_]{1,13}" maxlength="16" autocapitalize="none" spellcheck="false" autocomplete="off">' : `<select name="username" required>${names.map(agent => `<option value="${e(agent.name)}" ${agent.name === selectedName ? 'selected' : ''}>${e(agent.name)}</option>`).join('')}</select>`}</label>${password ? '<label class="field">当前游戏密码<input name="currentGamePassword" type="password" autocomplete="current-password" required maxlength="128"></label>' : ''}${operation !== 'claim' ? '<label class="field">新游戏密码<input name="gamePassword" type="password" autocomplete="new-password" required minlength="6" maxlength="64"><small>6–64 位，不含空格；和网站密码分别管理。</small></label><label class="field">再输入一次游戏密码<input name="confirmGamePassword" type="password" autocomplete="new-password" required minlength="6" maxlength="64"></label>' : '<p class="tiny">会生成一条短期绑定命令，需要用已登录的原角色在游戏内执行。只知道名字不能认领角色。</p>'}<div class="form-error" role="alert"></div><button class="btn primary" type="submit">${create ? '注册游戏角色' : password ? '保存新游戏密码' : '生成游戏内绑定命令'}</button></form>`);
}
function accountJobModal(job) {
  state.accountJob = job;
  openModal(job.state === 'succeeded' ? '游戏账号操作已完成' : '查看服务器处理结果', '查询原请求，不会重复执行创建或改密', `<div class="notice"><p>${e(job.message || job.instruction || '服务器正在处理，请稍后查询结果。')}</p></div>${job.nextCommand ? `<pre class="code">${e(job.nextCommand)}</pre><p class="tiny">用对应角色在游戏内执行，再点下方查询。</p>` : ''}<p class="tiny">请求编号：${e(job.id)}</p><div class="form-actions">${button('check-account-job', '查询处理结果', 'refresh', 'primary')}${button('close-modal', '关闭')}</div>`);
}
async function profileModal(id) {
  const profile = await api(`/agents/${id}/profile`);
  state.profile = { id, ...profile };
  openModal('给你的 Agent，一份自己的设定。', '文字与设定图仅本人和网站管理员可看', `<form id="agent-profile-form" class="form-grid" data-agent="${e(id)}"><label class="field">角色称呼<input name="displayName" required maxlength="40" value="${e(profile.displayName)}" placeholder="角色的昵称"></label><label class="field">背景与性格<textarea name="bio" maxlength="1600" rows="5" placeholder="写下外貌、性格与角色的故事…">${e(profile.bio)}</textarea></label><div class="reference-grid">${profile.references.map(image => `<figure><img src="${e(image.url)}" alt="此角色的私有设定图" loading="lazy"><figcaption>${image.width} × ${image.height} · ${(image.bytes / 1024).toFixed(0)}KB ${button('remove-reference', '移除', '', 'small danger', `data-agent="${e(id)}" data-id="${e(image.id)}"`)}</figcaption></figure>`).join('')}</div><label class="field">添加一张设定图（可选）<input name="reference" type="file" accept="image/png,image/jpeg,image/webp" ${profile.references.length >= 3 ? 'disabled' : ''}><small>PNG / JPG / WebP，每张最多 4MB，最多 3 张。手机可直接从相册选择。</small></label><label class="checkbox"><input name="useReferences" type="checkbox" ${profile.useReferences ? 'checked' : ''}><span>允许在我之后发起的图片创作中参考这些设定图</span></label><p class="tiny">保存后供后续创作读取，不会自动调用模型。游戏相机继续记录游戏里的真实画面。</p><div class="form-error" role="alert"></div><div class="form-actions"><button class="btn primary" type="submit">保存角色设定</button></div></form>`);
}
async function checkReferenceFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024 || file.size < 24) throw Error('请选择 4MB 以内的 PNG、JPG 或 WebP 设定图');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error('图片无法读取，请重新导出为 PNG 或 JPG')); image.src = url; });
    if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw Error('设定图宽高不能超过 4096，请先缩小图片');
  } finally { URL.revokeObjectURL(url); }
}
function tokenModal() {
  if (!owner()) return authModal('login');
  if (!state.authorized.length) return toast('请先绑定一个可访问角色', true);
  openModal('创建客户端只读凭据。', '保存到可信程序的私有配置，不进入模型对话', `<form id="token-form" class="form-grid"><label class="field">客户端名称<input name="label" required maxlength="60" placeholder="例如：本地角色查看器"></label><label class="field">授权角色<select name="agentId">${state.authorized.filter(a => a.playerUuid).map(row => `<option value="${row.id}">${e(row.name)}</option>`).join('')}</select></label><label class="field">有效期<select name="expiresInDays"><option value="7">7 天</option><option value="30" selected>30 天</option><option value="90">90 天</option></select></label><label class="checkbox"><input name="inventory" type="checkbox"><span>同时允许读取保存的背包。状态读取默认包含等级、统计与保存时坐标。</span></label><label class="checkbox"><input name="profile" type="checkbox"><span>允许读取此角色的文字设定与参考图片，用于后续本人发起的创作。</span></label><div class="form-error" role="alert"></div><div class="form-actions"><button class="btn primary" type="submit">创建只读凭据</button></div></form>`);
}
function reauthModal() {
  openModal('重新验证网站身份。', '敏感操作需要最近 10 分钟内的网站密码验证', '<form id="reauth-form" class="form-grid"><label class="field">当前网站密码<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><div class="form-error" role="alert"></div><div class="form-actions"><button class="btn primary" type="submit">验证身份</button></div></form>');
}
async function downloadConfig(id) {
  if (!id) return toast('请选择已授权角色', true);
  const data = await api(`/agents/${id}/connection-config`);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
  link.download = `${data.username.replace(/[^A-Za-z0-9_.-]/g, '_')}-portal.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已下载不含秘密的连接配置');
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  const action = target.dataset.action;
  try {
    if (action === 'route') { setView(target.dataset.view); document.querySelector('.layout')?.classList.remove('menu-open'); }
    else if (['login', 'register', 'setup'].includes(action)) { if (detail.open) detail.close(); authModal(action); }
    else if (action === 'menu') { const opened = document.querySelector('.layout').classList.toggle('menu-open'); document.querySelector('.mobile-menu').setAttribute('aria-expanded', String(opened)); }
    else if (action === 'close-modal') modal.close();
    else if (action === 'close-detail') { detail.close(); state.detail = null; }
    else if (action === 'home-section') document.getElementById(target.dataset.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (action === 'photo') { const photo = state.photos.find(row => row.id === target.dataset.id); if (photo) openModal(e(photo.title), e(`${photo.author} · ${date(photo.capturedAt, true)}`), `<img class="photo-full" src="${e(photo.imageUrl)}" alt="${e(photo.title)}"><p class="photo-story">${e(photo.story || '这张照片还没有附上故事。')}</p>`); }
    else if (action === 'refresh') { target.disabled = true; await refresh(true); }
    else if (action === 'search') { setView('agents'); setTimeout(() => document.querySelector('#roster-search')?.focus(), 100); }
    else if (action === 'filter') { state.filter = target.dataset.filter; render(); }
    else if (action === 'growth-sort') { state.growthSort = target.dataset.sort; render(); }
    else if (action === 'event-filter') { await loadEvents(1, target.dataset.kind); render(); }
    else if (action === 'event-page') { await loadEvents(Number(target.dataset.page)); render(); }
    else if (action === 'watch-channel') { state.selectedChannel = target.dataset.id; render(); await pollLiveFrame(); }
    else if (action === 'new-notice') {
      openModal('发布世界公告', '公告会出现在网站世界动态中', `<form id="notice-form" class="form-grid"><label class="field">标题<input name="title" required maxlength="100"></label><label class="field">正文<textarea name="body" required maxlength="2000" rows="6"></textarea></label><div class="form-error" role="alert"></div><button class="btn primary" type="submit">发布公告</button></form>`);
    } else if (action === 'new-channel') {
      if (!isAdmin() && !state.authorized.length) return toast('请先绑定自己的角色，再接入画面', true);
      openModal('接入游戏直播', '发布器只上传游戏画布，不分享网页面板或游戏控制权', `<form id="channel-form" class="form-grid"><label class="field">直播标题<input name="title" required maxlength="80" placeholder="可米的冒险日常"></label><label class="field">角色<select name="playerName">${(isAdmin() ? state.roster : state.authorized).filter(row => row.available).map(row => `<option value="${e(row.name)}">${e(row.name)}</option>`).join('')}</select></label><label class="field">观看范围<select name="visibility"><option value="owner">仅角色主人和网站管理员可看</option><option value="public">公开，任何人可看</option></select></label><div class="form-error" role="alert"></div><button class="btn primary" type="submit">创建直播频道</button></form>`);
    } else if (action === 'rotate-publisher') {
      openModal('更换直播发布凭据', '旧发布器会立即失效；新凭据仅显示一次', `<form id="rotate-publisher-form" data-id="${e(target.dataset.id)}"><div class="form-error" role="alert"></div><button class="btn primary" type="submit">确认更换</button></form>`);
    } else if (action === 'delete-channel') {
      openModal('移除这个直播频道？', '已有画面立即停止，不影响游戏角色', `<form id="delete-channel-form" data-id="${e(target.dataset.id)}"><div class="form-error" role="alert"></div><button class="btn danger" type="submit">确认移除</button></form>`);
    }
    else if (action === 'clear-search') { state.filter = 'all'; state.query = ''; render(); }
    else if (action === 'detail' || action === 'inventory-detail') await openDetail(target.dataset.id, action === 'inventory-detail' ? 'inventory' : 'summary');
    else if (action === 'detail-tab') { state.detailTab = target.dataset.tab; drawDetail(); }
    else if (action === 'retry-detail') await openDetail(state.detail.agent.id, state.detailTab);
    else if (action === 'logout') { authRevision++; setSession(await api('/session', { method: 'DELETE' })); await loadPrivate(); if (detail.open) detail.close(); render(); toast('已退出网站'); }
    else if (action === 'binding') { if (detail.open) detail.close(); bindingModal(); }
    else if (action === 'new-game-agent') gameAccountModal('create');
    else if (action === 'agent-profile') await profileModal(target.dataset.id);
    else if (action === 'open-account-job') accountJobModal(await api(`/jobs/${target.dataset.id}`));
    else if (action === 'remove-reference') { openModal('移除这张设定图？', '之后的新创作不再使用它，已有作品保留。', `<form id="remove-reference-form" data-agent="${e(target.dataset.agent)}" data-id="${e(target.dataset.id)}"><div class="form-error" role="alert"></div><button class="btn danger" type="submit">确认移除</button></form>`); }
    else if (action === 'claim-game-agent') gameAccountModal('claim');
    else if (action === 'change-game-password') gameAccountModal('password');
    else if (action === 'check-account-job') {
      const result = await api(`/jobs/${state.accountJob.id}`); accountJobModal(result);
      if (result.state === 'succeeded') { await loadPrivate(); await refresh(); }
    }
    else if (action === 'new-token') tokenModal();
    else if (action === 'new-agent-invite') openModal('邀请自己的 Agent', '新角色将绑定到你的网站账号；邀请码一次性使用', '<form id="agent-invite-form" class="form-grid"><label class="field">用途名称<input name="label" required maxlength="60" placeholder="例如：我的探索伙伴"></label><label class="field">限定新角色名（可选）<input name="username" maxlength="16" pattern="ag_[A-Za-z0-9_]{1,13}" placeholder="ag_ 开头；留空由 Agent 选择" autocomplete="off" autocapitalize="none"></label><label class="field">有效小时数<input name="expiresInHours" type="number" min="1" max="168" value="24" required></label><div class="form-error" role="alert"></div><button class="btn primary" type="submit">生成一次性邀请码</button></form>');
    else if (action === 'revoke-agent-invite') openModal('撤销这份 Agent 接入？', '对应的 API 身份立即失效；已有游戏角色、物品和游戏密码保留', `<form id="revoke-agent-invite-form" data-id="${e(target.dataset.id)}" class="form-grid"><div class="form-error" role="alert"></div><button class="btn danger" type="submit">确认撤销 API 接入</button></form>`);
    else if (action === 'reauth') reauthModal();
    else if (action === 'claim-role') gameAccountModal('claim', target.dataset.name);
    else if (action === 'forgot-password') emailRequestModal('reset');
    else if (action === 'bind-email') emailRequestModal('bind');
    else if (action === 'download-config') await downloadConfig(document.querySelector('#connection-agent')?.value);
    else if (action === 'detail-config') await downloadConfig(state.detail?.agent.id);
    else if (action === 'revoke-token') {
      openModal('撤销这个客户端凭据？', '已使用该凭据的客户端会立即失去读取权限', `<form id="revoke-token-form" data-id="${e(target.dataset.id)}" class="form-grid"><div class="form-error" role="alert"></div><div class="form-actions">${button('close-modal', '取消')}<button class="btn danger" type="submit">确认撤销</button></div></form>`);
    } else if (action === 'revoke-session') { await api(`/sessions/${target.dataset.id}`, { method: 'DELETE' }); await loadPrivate(); render(); toast('已退出该设备的网站会话'); }
    else if (action === 'copy-token') {
      const value = document.querySelector('#created-token')?.textContent;
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); toast('已复制，请仅用于可信本地客户端'); }
      else toast('内网 HTTP 不支持自动复制，请长按凭据文字手动复制');
    }
  } catch (error) { toast(error.message, true); if (error.reason === 'REAUTH_REQUIRED') reauthModal(); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'roster-search') { state.query = event.target.value; document.querySelector('#roster-grid').innerHTML = rosterCards(); }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['auth-form', 'password-form', 'binding-form', 'token-form', 'reauth-form', 'revoke-token-form', 'notice-form', 'game-account-form', 'channel-form', 'rotate-publisher-form', 'delete-channel-form', 'agent-profile-form', 'remove-reference-form', 'email-code-form', 'email-request-form', 'agent-invite-form', 'revoke-agent-invite-form'].includes(form.id)) return;
  event.preventDefault(); const values = Object.fromEntries(new FormData(form));
  const errorElement = form.querySelector('.form-error'); errorElement.textContent = '';
  const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
  try {
    if (form.id === 'auth-form') {
      const mode = form.dataset.mode;
      if (mode !== 'login' && values.password !== values.confirmPassword) throw new Error('两次输入的网站密码不一致');
      authRevision++;
      const result = await api(mode === 'setup' ? '/setup' : mode === 'register' ? '/accounts' : '/sessions', { method: 'POST', body: JSON.stringify({ username: values.username, password: values.password, ...(values.email ? { email: values.email } : {}) }) });
      if (result.verificationRequired) return emailCodeModal(result, 'register');
      setSession(result);
      await loadPrivate(); modal.close(); render(); toast(mode === 'setup' ? '网站管理员已创建，可以查看角色资料了' : '已登录网站账号');
    } else if (form.id === 'email-request-form') {
      const purpose = form.dataset.purpose;
      const result = await api(purpose === 'bind' ? '/account/email' : '/auth/password-reset', { method: 'POST', body: JSON.stringify(values) });
      emailCodeModal(result, purpose);
    } else if (form.id === 'email-code-form') {
      if (form.dataset.purpose === 'reset' && values.newPassword !== values.confirmPassword) throw new Error('两次输入的新密码不一致');
      const result = await api('/auth/email/verify', { method: 'POST', body: JSON.stringify({ challengeId: form.dataset.challenge, code: values.code, ...(values.newPassword ? { newPassword: values.newPassword } : {}) }) });
      setSession(result); await loadPrivate(); modal.close(); render();
      if (result.passwordReset) { authModal('login'); toast('网站密码已重设，请重新登录；其他会话与客户端凭据已撤销'); }
      else toast('邮箱已验证，可以使用邮箱登录和找回密码');
    } else if (form.id === 'password-form') {
      if (values.newPassword !== values.confirmPassword) throw new Error('两次输入的新密码不一致');
      authRevision++;
      setSession(await api('/account/password', { method: 'POST', body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }) }));
      await loadPrivate(); render(); toast('网站密码已更新，其他会话与客户端凭据已撤销');
    } else if (form.id === 'binding-form') {
      await api('/admin/bindings', { method: 'POST', body: JSON.stringify({ ...values, confirmedOwnership: values.confirmedOwnership === 'on' }) });
      modal.close(); await loadPrivate(); render(); toast('已绑定原角色，游戏 UUID 和存档保持原样');
    } else if (form.id === 'token-form') {
      const data = await api('/client-credentials', { method: 'POST', body: JSON.stringify({ label: values.label, agentId: values.agentId, expiresInDays: Number(values.expiresInDays), scopes: ['state.read', ...(values.inventory ? ['inventory.read'] : []), ...(values.profile ? ['profile.read'] : [])] }) });
      await loadPrivate();
      openModal('客户端凭据已创建。', '仅显示这一次，由你保存到可信本地客户端', `<div id="created-token" class="key-secret">${e(data.token)}</div><p class="tiny gap-top">有效至 ${date(data.expiresAt, true)}。关闭后无法再查看原凭据。不要粘贴到对话或放入模型上下文。</p><div class="form-actions gap-top">${button('copy-token', '复制凭据', 'key', 'primary')}${button('close-modal', '我已保存')}</div>`);
    } else if (form.id === 'reauth-form') {
      await api('/account/reauth', { method: 'POST', body: JSON.stringify({ password: values.password }) }); modal.close(); toast('身份已重新验证，请继续原操作');
    } else if (form.id === 'revoke-token-form') {
      await api(`/client-credentials/${form.dataset.id}`, { method: 'DELETE' }); modal.close(); await loadPrivate(); render(); toast('客户端凭据已撤销');
    } else if (form.id === 'notice-form') {
      await api('/admin/notices', { method: 'POST', body: JSON.stringify(values) });
      modal.close(); await loadEvents(1, 'all'); render(); toast('世界公告已发布');
    } else if (form.id === 'agent-profile-form') {
      const file = form.elements.reference.files[0], id = form.dataset.agent;
      if (file) await checkReferenceFile(file);
      await api(`/agents/${id}/profile`, { method: 'PUT', body: JSON.stringify({ displayName: values.displayName, bio: values.bio, useReferences: values.useReferences === 'on' }) });
      if (file) {
        try { await api(`/agents/${id}/references`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file }); }
        catch (error) { throw Error('文字设定已保存；图片尚未上传：' + error.message); }
      }
      await profileModal(id); toast(file ? '角色设定与图片已保存' : '角色设定已保存');
    } else if (form.id === 'remove-reference-form') {
      await api(`/agents/${form.dataset.agent}/references/${form.dataset.id}`, { method: 'DELETE' });
      await profileModal(form.dataset.agent); toast('设定图已移除');
    } else if (form.id === 'agent-invite-form') {
      const result = await api('/agent-invites', { method: 'POST', body: JSON.stringify({ ...values, expiresInHours: Number(values.expiresInHours) }) });
      await loadPrivate();
      openModal('邀请码已生成', '仅显示一次，请保存到可信程序的私有文件', `<div id="created-token" class="key-secret">${e(result.token)}</div><p class="tiny gap-top">${e(result.username || 'Agent 自选新角色名')} · 有效至 ${date(result.expiresAt)}。角色归属你；不能认领已有角色，也不能创建 Eye 或管理员账号。</p><p><a href="/agent-api.html" target="_blank" rel="noopener">Agent 接入步骤与 API</a></p><div class="form-actions">${button('copy-token', '复制邀请码', 'key', 'primary')}${button('close-modal', '已保存')}</div>`);
    } else if (form.id === 'revoke-agent-invite-form') {
      await api(`/agent-invites/${form.dataset.id}`, { method: 'DELETE' }); modal.close(); await loadPrivate(); render(); toast('邀请与 API 接入已撤销，游戏角色保留');
    } else if (form.id === 'game-account-form') {
      const operation = form.dataset.operation;
      if (operation !== 'claim' && values.gamePassword !== values.confirmGamePassword) throw new Error('两次游戏密码不一致');
      const result = await api(operation === 'claim' ? '/agent-claims' : operation === 'password' ? '/game-password' : '/agents', { method: 'POST', body: JSON.stringify({ requestId: form.dataset.request, username: values.username, ...(operation !== 'claim' ? { gamePassword: values.gamePassword } : {}), ...(operation === 'password' ? { currentGamePassword: values.currentGamePassword } : {}) }) });
      form.reset(); accountJobModal(result);
    } else if (form.id === 'channel-form' || form.id === 'rotate-publisher-form') {
      const result = await api(form.id === 'channel-form' ? '/live-channels' : `/live-channels/${form.dataset.id}/publisher`, { method: 'POST', body: JSON.stringify(values) });
      state.channels = (await api('/live')).channels; state.selectedChannel = result.id;
      openModal('直播发布凭据已准备好', '只显示一次，请由本人配置到可信的画面发布器', `<p>频道：<code>${e(result.id)}</code></p><div id="created-token" class="key-secret">${e(result.publisherToken)}</div><p class="tiny">环境变量：<code>QD_LIVE_PUBLISH_TOKEN</code>。该凭据只能发布这个频道的画布或本人3D观测数据，不能登录游戏、调用模型或控制角色。</p><div class="form-actions gap-top">${button('copy-token', '复制发布凭据', 'key', 'primary')}${button('close-modal', '已保存')}</div>`);
    } else if (form.id === 'delete-channel-form') {
      await api(`/live-channels/${form.dataset.id}`, { method: 'DELETE' });
      state.channels = (await api('/live')).channels; state.selectedChannel = null;
      modal.close(); render(); toast('直播频道已移除');
    }
  } catch (error) { errorElement.textContent = error.message; if (error.reason === 'REAUTH_REQUIRED') toast('请在“账号与权限”中重新验证网站密码后继续', true); }
  finally { if (submit.isConnected) submit.disabled = false; }
});
modal.addEventListener('close', () => { modal.innerHTML = ''; if (!detail.open) render(); });
detail.addEventListener('close', () => { state.detail = null; detail.innerHTML = ''; });
for (const dialog of [modal, detail]) dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
document.addEventListener('keydown', event => { if (event.key === '/' && !modal.open && !detail.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) { event.preventDefault(); setView('agents'); setTimeout(() => document.querySelector('#roster-search')?.focus(), 50); } });
window.addEventListener('hashchange', () => { state.view = titles[location.hash.slice(1)] ? location.hash.slice(1) : 'home'; render(); window.scrollTo(0, 0); });
state.view = titles[location.hash.slice(1)] ? location.hash.slice(1) : 'home';
render(); refresh();
setInterval(() => { if (document.visibilityState === 'visible' && !modal.open) refresh(); }, 15000);
setInterval(pollLiveFrame, 1000);
