const byId = id => document.getElementById(id);
const notice = byId('notice');
const picker = byId('roles');
const form = byId('profile');
let session, companions = [];

async function api(path, options = {}) {
  const response = await fetch('/api/v1' + path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message || '暂时无法读取资料，请稍后重试。');
  return value;
}

async function render(row) {
  byId('name').textContent = row.actualName;
  byId('body').textContent = row.bodyKind === 'maid' ? '车万女仆' : row.bodyKind;
  byId('presence').textContent = row.active ? '同行中' : row.online ? '等待伙伴连接' : '离线';
  byId('level').textContent = row.level == null ? '未读回' : 'Lv. ' + row.level;
  byId('profession').textContent = row.profession || '未选职业';
  byId('voice').textContent = row.soundPackId || '进服后读取';
  form.elements.name.value = row.name;
  form.elements.persona.value = row.persona;
  notice.textContent = row.revision > row.appliedRevision ? '设置已保存，等待游戏端应用。' : '';
  const photos = byId('photos'), diaries = byId('diaries');
  photos.textContent = '正在读取照片…';
  diaries.textContent = '正在读取日记…';
  const base = '/player-companions/' + encodeURIComponent(row.playerId);
  const [photoResult, diaryResult] = await Promise.allSettled([api(base + '/photos'), api(base + '/diaries')]);
  if (picker.value !== row.playerId) return;
  photos.replaceChildren();
  if (photoResult.status !== 'fulfilled') photos.textContent = '照片暂不可读取。';
  else {
    for (const value of photoResult.value.photos) {
      const figure = document.createElement('figure'), title = document.createElement('figcaption');
      if (value.imageUrl) {
        const image = document.createElement('img');
        image.src = value.thumbnailUrl ?? value.imageUrl;
        image.alt = value.title;
        image.loading = 'lazy';
        const link = document.createElement('a');
        link.href = value.imageUrl;
        link.append(image);
        figure.append(link);
      }
      title.textContent = value.title + (value.imageReady ? '' : ' · 原片同步中');
      figure.append(title);
      photos.append(figure);
    }
    if (!photos.childElementCount) photos.textContent = '这位伙伴还没有照片。';
  }
  diaries.replaceChildren();
  if (diaryResult.status !== 'fulfilled') diaries.textContent = '日记暂不可读取。';
  else {
    for (const row of diaryResult.value.entries) {
      const details = document.createElement('details'), title = document.createElement('summary');
      const body = document.createElement('p');
      title.textContent = row.title;
      details.append(title, body);
      details.addEventListener('toggle', async () => {
        if (!details.open || body.dataset.loaded) return;
        body.textContent = '正在翻阅…';
        try {
          body.textContent = (await api('/archives/' + encodeURIComponent(row.id))).body;
          body.dataset.loaded = 'yes';
        } catch (error) { body.textContent = error.message; }
      });
      diaries.append(details);
    }
    if (!diaries.childElementCount) diaries.textContent = diaryResult.value.source?.available
      ? '这位伙伴还没有公开日记。' : '正在等待游戏档案同步。';
  }
}

picker.addEventListener('change', () => render(companions.find(row => row.playerId === picker.value)));
form.addEventListener('submit', async event => {
  event.preventDefault();
  const row = companions.find(row => row.playerId === picker.value);
  const submit = form.querySelector('button');
  submit.disabled = true;
  try {
    const saved = await api('/player-companions/' + encodeURIComponent(row.playerId), {
      method:'PUT', headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},
      body:JSON.stringify({expectedRevision:row.revision,name:form.elements.name.value,persona:form.elements.persona.value}),
    });
    companions = companions.map(value => value.playerId === saved.playerId ? saved : value);
    if (picker.value === saved.playerId) await render(saved);
  } catch (error) { notice.textContent = error.message; }
  finally { submit.disabled = false; }
});

try {
  session = await api('/session');
  if (session.owner) ({companions} = await api('/player-companions'));
  byId('entry').hidden = companions.length > 0;
  byId('manage').hidden = companions.length === 0;
  if (companions.length === 0) notice.textContent = '';
  else {
    companions.forEach(row => picker.add(new Option(row.actualName, row.playerId)));
    await render(companions[0]);
  }
} catch (error) { notice.textContent = error.message; }
