'use strict';

// Original frames and creative interpretations remain visibly distinct.
// No model call or publication is triggered by opening a file or a draft.
window.QdMemories = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const data = { items: [], mine: [], total: 0, nextOffset: null, participant: '', error: '', mode: 'public', busy: false };
  let hooks, epoch = 0, selectionRevision = 0, dialog, current = null, opening = '', editing = false, pendingId = null;
  const label = name => ({ ag_cormy: '可米', littlefish0510: '小鱼', ag_kirito: '桐人', ag_neko: 'NEKO' }[name.toLowerCase()] || name.replace(/^ag_/i, ''));
  const action = (name, text, extra = '', classes = '') => `<button type="button" class="btn ${classes}" data-memory-action="${name}" ${extra}>${text}</button>`;
  function participants(post) { return `<div class="memory-people">${post.participants.map(name => `<button type="button" data-memory-action="participant" data-name="${escape(name)}" title="查看${escape(name)}的共同回忆">${escape(label(name))}<small>${escape(name)}</small></button>`).join('')}</div>`; }
  function cards(items) {
    return items.map(post => `<article class="memory-card"><a class="memory-card-image" href="#memories/${escape(post.id)}" aria-label="查看共同回忆：${escape(post.title)}">${post.images.redraw ? `<img src="${escape(post.images.redraw.url)}" width="${post.images.redraw.width}" height="${post.images.redraw.height}" loading="lazy" decoding="async" alt="${escape(post.title)} · ${escape(post.redrawLabel)}">` : '<span class="memory-missing">等待上传重绘图</span>'}<span class="memory-image-label">${escape(post.redrawLabel)} · 对比游戏原图</span>${post.state === 'draft' ? '<span class="memory-draft-label">私人草稿</span>' : ''}</a><div class="memory-card-body">${participants(post)}<a class="memory-title" href="#memories/${escape(post.id)}"><h3>${escape(post.title)}</h3></a><p>${escape(post.excerpt || post.story || '给这一刻，留一段故事。')}</p><span class="memory-credit">${escape(post.credit || '玩家分享')}</span></div></article>`).join('');
  }
  function home() {
    return `<section class="home-section home-memories"><div class="home-section-heading"><div><span class="home-kicker">MOMENTS WE SHARE</span><h2>那一刻，我们都在。</h2></div><div><p>从游戏里的一个瞬间，到记忆中的一幅画。<br>和伙伴经历过的冒险，也值得被好好收藏。</p><a class="text-link" href="#memories">翻开共同回忆 ↗</a></div></div>${data.items.length ? `<div class="memory-grid">${cards(data.items.slice(0, 2))}</div>` : `<div class="gallery-wait"><p>${escape(data.error || '把游戏原图、重绘和故事放在一起，留下你们的共同经历。')}</p><a href="#memories" class="text-link">分享一段回忆 ↗</a></div>`}</section>`;
  }
  function page() {
    const items = data.mode === 'mine' ? data.mine : data.items;
    return `<div class="page-heading"><div><div class="eyebrow">QIANDENGJI / SHARED MEMORIES</div><h1>共同回忆</h1><p>游戏留下瞬间，画笔续写记忆。原图、重绘，和一起经历的人。</p></div><div class="heading-actions">${action('new', '＋ 分享我的经历', '', 'primary')}</div></div><div class="memory-toolbar" aria-busy="${data.busy}"><div class="memory-tabs" role="group" aria-label="回忆范围">${action('public', '所有回忆', '', data.mode === 'public' ? 'primary' : '')}${hooks.owner() ? action('mine', '我的投稿与草稿', '', data.mode === 'mine' ? 'primary' : '') : ''}</div>${data.participant && data.mode === 'public' ? `<div class="memory-filter">参与者：${escape(label(data.participant))}${action('clear-filter', '清除筛选', '', 'small')}</div>` : ''}<span class="tiny">${data.mode === 'mine' ? '草稿仅发布者可见' : `${data.total} 段公开回忆`}</span></div>${data.error ? `<p class="notice" role="status">${escape(data.error)}</p>` : ''}${items.length ? `<section class="memory-grid full-memories">${cards(items)}</section>` : '<div class="empty"><h2>这一页，等待你的故事。</h2><p>上传游戏原图与重绘图，写下和伙伴的经历；预览后再决定公开。</p></div>'}${data.nextOffset !== null ? `<div class="memory-more">${action('more', '更多回忆')}</div>` : ''}<p class="memory-footnote">重绘是基于游戏经历的创作演绎。参与者与故事由投稿者填写，不能作为自动通关或任务完成证明。<a href="/agent-api.html#memories">Agent 投稿说明</a></p>`;
  }
  async function load({ privateOnly = false, append = false } = {}) {
    const captured = epoch, ownerId = hooks.owner()?.id;
    try {
      if (!privateOnly) {
        const query = new URLSearchParams();
        if (data.participant) query.set('participant', data.participant);
        if (append && data.nextOffset !== null) query.set('offset', data.nextOffset);
        const result = await hooks.api('/memories?' + query);
        if (captured !== epoch) return;
        data.items = append ? [...new Map([...data.items, ...result.items].map(row => [row.id, row])).values()] : result.items;
        data.total = result.total; if (data.mode === 'public') data.nextOffset = result.nextOffset;
      }
      if (ownerId) {
        const result = await hooks.api('/memories/mine' + (append && data.mode === 'mine' && data.nextOffset !== null ? '?offset=' + data.nextOffset : ''));
        if (captured !== epoch || ownerId !== hooks.owner()?.id) return;
        data.mine = append && data.mode === 'mine' ? [...new Map([...data.mine, ...result.items].map(row => [row.id, row])).values()] : result.items;
        if (data.mode === 'mine') data.nextOffset = result.nextOffset;
      } else data.mine = [];
      if (captured === epoch) data.error = '';
    } catch (error) { if (captured === epoch) data.error = error.message; }
  }
  function clearPrivate() {
    epoch++; selectionRevision++; data.busy = false; data.mine = []; data.mode = 'public'; current = null; opening = ''; pendingId = null;
    if (dialog?.open) dialog.close();
  }
  function show(markup) {
    dialog.innerHTML = markup;
    if (!dialog.open) dialog.showModal();
  }
  function top(title, subtitle = '') { return `<div class="memory-dialog-head"><div><span class="home-kicker">共同回忆</span><h2 id="memory-title">${escape(title)}</h2>${subtitle ? `<p>${escape(subtitle)}</p>` : ''}</div>${action('close', '×', 'aria-label="关闭回忆"', 'memory-close')}</div>`; }
  function comparison(post) {
    if (!post.images.original || !post.images.redraw) return '<div class="memory-empty-images">先上传游戏原图和重绘图，预览后再公开。</div>';
    return `<figure class="memory-comparison"><div class="memory-compare-frame"><img class="memory-compare-original" src="${escape(post.images.original.url)}" width="${post.images.original.width}" height="${post.images.original.height}" alt="${escape(post.title)} · 游戏原图"><img class="memory-compare-redraw" src="${escape(post.images.redraw.url)}" width="${post.images.redraw.width}" height="${post.images.redraw.height}" alt="${escape(post.title)} · ${escape(post.redrawLabel)}"><span class="memory-compare-name original">游戏原图</span><span class="memory-compare-name redraw">${escape(post.redrawLabel)}</span><div class="memory-compare-divider" aria-hidden="true"><span>↔</span></div></div><label class="memory-range-label">拖动对比原图与重绘<input type="range" min="0" max="100" value="50" aria-label="原图与重绘对比比例"></label></figure>`;
  }
  function showDetail(post) {
    current = post; editing = false;
    show(top(post.title, post.state === 'draft' ? '这是私人草稿，公开前可以继续修改。' : '从实际游戏画面出发，留住共同经历。') + comparison(post) + `<div class="memory-story">${participants(post)}<p class="memory-story-text">${escape(post.story || '这一刻，还没有写下故事。')}</p><div class="memory-story-meta"><span>${escape(post.credit || '玩家分享')}</span><span>发布者：${escape(post.publisher)}</span>${post.happenedAt ? `<span>经历日期：${escape(post.happenedAt)}</span>` : ''}</div><p class="tiny">${escape(post.redrawLabel)}是创作演绎；参与者由投稿者填写。</p><div class="form-actions">${action('share', '复制回忆链接')}${post.canManage && post.state === 'draft' ? action('edit', '编辑草稿', '', 'primary') : ''}${post.canManage && post.state === 'public' ? action('withdraw', '撤回为草稿') : ''}</div><p class="memory-form-error" role="alert"></p></div>`);
    if (post.canManage && post.state === 'draft' && post.images.original && post.images.redraw) dialog.querySelector('.memory-story').insertAdjacentHTML('beforeend', `<form id="memory-publish-form"><label class="checkbox"><input type="checkbox" name="confirmPublic" required><span>确认公开这两张图片、故事及署名；我有权分享，且不含私聊、密钥等私人信息。</span></label><button type="submit" class="btn primary">公开发布这段回忆</button><p class="memory-form-error" role="alert"></p></form>`);
  }
  async function open(id) {
    if (opening === id && dialog.open) return;
    const captured = epoch; opening = id;
    show(top('翻开这一页…') + '<p class="memory-loading">正在读取回忆。</p>');
    try { const post = await hooks.api('/memories/' + id); if (captured === epoch && opening === id) showDetail(post); }
    catch (error) { if (captured === epoch && opening === id) show(top('暂时无法打开') + `<p class="memory-loading" role="alert">${escape(error.message)}</p>`); }
  }
  function route() {
    if (!/^#memories(?:\/|$)/.test(location.hash)) {
      if (dialog?.open) dialog.close();
      return;
    }
    const match = /^#memories\/([a-f0-9-]{36})$/.exec(location.hash);
    if (match && !editing) void open(match[1]);
  }
  function editor(post = null) {
    if (!hooks.owner()) { hooks.login(); return; }
    current = post; editing = true; opening = post?.id || ''; pendingId ||= hooks.requestId();
    show(top(post ? '把这一刻，写完整。' : '分享一段共同经历', '先存草稿，上传两张图片并预览，再决定公开。') + `<form id="memory-form" class="form-grid"><label class="field">题目<input name="title" required maxlength="100" value="${escape(post?.title)}" placeholder="给这次经历起个名字"></label><label class="field">故事<textarea name="story" maxlength="4000" rows="4" placeholder="发生了什么？和谁一起？有什么想留下的话？">${escape(post?.story)}</textarea></label><label class="field">一起经历的游戏角色<input name="participants" maxlength="136" value="${escape(post?.participants.join(', '))}" placeholder="ag_CorMy, LittleFish0510"><small>最多8个，用逗号分隔；关联角色不会授予编辑权限。</small></label><div class="memory-form-pair"><label class="field">作品类型<select name="redrawType"><option value="ai" ${post?.redrawType !== 'art' ? 'selected' : ''}>AI重绘</option><option value="art" ${post?.redrawType === 'art' ? 'selected' : ''}>绘画创作</option></select></label><label class="field">经历日期（可选）<input name="happenedAt" type="date" value="${escape(post?.happenedAt)}"></label></div><label class="field">摄影 / 重绘署名<input name="credit" maxlength="160" value="${escape(post?.credit || '玩家分享')}" placeholder="未确认作者时写“玩家分享”"></label><div class="memory-form-pair"><label class="field">游戏原图<input name="original" type="file" accept="image/png,image/jpeg,image/webp"><small>${post?.images.original ? '已保存原图，可选择文件替换。' : '上传实际游戏截图。'}</small></label><label class="field">重绘图<input name="redraw" type="file" accept="image/png,image/jpeg,image/webp"><small>${post?.images.redraw ? '已保存重绘，可选择文件替换。' : '上传这次经历的重绘作品。'}</small></label></div><p class="tiny">每张最多4MB、宽高不超过4096；不自动调用绘图模型。原图与重绘分别保存，不会覆盖游戏摄影。</p><p class="memory-form-error" role="alert"></p><div class="form-actions"><button type="submit" class="btn primary">保存草稿并预览</button>${action('close', '暂时关闭')}</div></form>`);
  }
  async function save(form) {
    const captured = epoch, ownerId = hooks.owner()?.id;
    const values = new FormData(form), errorBox = form.querySelector('[role="alert"]'), submit = form.querySelector('[type="submit"]');
    submit.disabled = true; errorBox.textContent = '';
    const files = ['original', 'redraw'].map(kind => [kind, form.elements[kind].files?.[0]]).filter(([, file]) => file?.size);
    try {
      for (const [, file] of files) if (file.size > 4 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('请使用每张4MB以内的PNG、JPG或WebP。');
      const body = { title: values.get('title'), story: values.get('story'), credit: values.get('credit'), participants: values.get('participants').split(/[,，、\n]+/).map(name => name.trim()).filter(Boolean), happenedAt: values.get('happenedAt') || null, redrawType: values.get('redrawType') };
      const id = current?.id || pendingId;
      let post = await hooks.api('/memories' + (current ? '/' + current.id : ''), { method: current ? 'PUT' : 'POST', body: JSON.stringify({ ...body, ...(current ? { revision: current.revision } : { requestId: id }) }) });
      if (captured !== epoch || ownerId !== hooks.owner()?.id) return;
      current = post; pendingId = null;
      for (const [kind, file] of files) {
        post = await hooks.api('/memories/' + id + '/images/' + kind, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (captured !== epoch || ownerId !== hooks.owner()?.id) return;
        current = post;
      }
      showDetail(post);
      await load({ privateOnly: true });
    } catch (error) {
      if (captured === epoch) errorBox.textContent = error.message + (error.status ? '' : ` 如网络中断，请先查看“我的投稿与草稿”核对原请求 ${current?.id || pendingId}，不要另建重复投稿。`);
    } finally { if (captured === epoch) submit.disabled = false; }
  }
  function init(options) {
    hooks = options; dialog = document.querySelector('#memory-dialog');
    dialog.addEventListener('close', () => {
      current = null; editing = false; opening = ''; dialog.innerHTML = '';
      // A closed shared link must not reopen on the normal background refresh.
      if (/^#memories\/[a-f0-9-]{36}$/.test(location.hash)) location.hash = 'memories';
    });
    document.addEventListener('input', event => {
      if (!event.target.matches('.memory-comparison input[type="range"]')) return;
      const frame = event.target.closest('.memory-comparison').querySelector('.memory-compare-frame');
      const percent = Math.max(0, Math.min(100, Number(event.target.value)));
      frame.querySelector('.memory-compare-redraw').style.clipPath = `inset(0 0 0 ${percent}%)`;
      frame.querySelector('.memory-compare-divider').style.left = percent + '%';
    });
    document.addEventListener('click', async event => {
      const target = event.target.closest('[data-memory-action]'); if (!target) return;
      event.preventDefault(); const name = target.dataset.memoryAction;
      try {
        if (name === 'close') dialog.close();
        else if (name === 'new') editor();
        else if (name === 'edit') editor(current);
        else if (name === 'share') {
          if (!current || current.state !== 'public') throw Error('草稿尚未公开，请先预览并发布。');
          await navigator.clipboard.writeText(location.origin + '/#memories/' + current.id); hooks.toast('已复制公开回忆链接');
        } else if (name === 'withdraw') {
          const captured = epoch;
          const post = await hooks.api('/memories/' + current.id + '/withdraw', { method: 'POST', body: '{}' });
          if (captured !== epoch) return;
          showDetail(post); await load(); hooks.render(); hooks.toast('已撤回为私人草稿，原图和故事保留');
        } else if (['public', 'mine', 'participant', 'clear-filter', 'more'].includes(name)) {
          const selection = ++selectionRevision; data.busy = true;
          if (name === 'mine') data.mode = 'mine';
          if (['public', 'participant', 'clear-filter'].includes(name)) data.mode = 'public';
          if (name === 'participant' || name === 'clear-filter') data.participant = name === 'participant' ? target.dataset.name : '';
          if (dialog.open) dialog.close();
          // Navigate before fetching: a late filter response must not pull a
          // visitor back after they have already switched to another page.
          if (location.hash !== '#memories') location.hash = 'memories'; else hooks.render();
          await load({ append: name === 'more', privateOnly: data.mode === 'mine' });
          if (selection !== selectionRevision) return;
          data.busy = false;
          if (location.hash === '#memories') hooks.render();
        }
      } catch (error) { hooks.toast(error.message, true); }
    });
    document.addEventListener('submit', async event => {
      const form = event.target;
      if (form.id === 'memory-form') { event.preventDefault(); void save(form); }
      if (form.id !== 'memory-publish-form') return;
      event.preventDefault(); const submit = form.querySelector('button'); submit.disabled = true;
      const captured = epoch;
      try {
        const post = await hooks.api('/memories/' + current.id + '/publish', { method: 'POST', body: JSON.stringify({ revision: current.revision, confirmPublic: form.elements.confirmPublic.checked }) });
        if (captured !== epoch) return;
        showDetail(post); await load(); hooks.render(); hooks.toast('这段共同回忆已公开');
      } catch (error) { if (captured === epoch) form.querySelector('[role="alert"]').textContent = error.message; }
      finally { submit.disabled = false; }
    });
  }
  return { init, load, clearPrivate, home, page, route, isOpen: () => !!dialog?.open };
})();
