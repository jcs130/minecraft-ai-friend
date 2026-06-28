'use strict'

const voiceState = {
  enabled: false,
  lastSpokenAt: '',
  latest: null,
  voices: []
}

const els = {
  enableBtn: document.getElementById('enableBtn'),
  playLatestBtn: document.getElementById('playLatestBtn'),
  testVoiceBtn: document.getElementById('testVoiceBtn'),
  voiceSelect: document.getElementById('voiceSelect'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  latestText: document.getElementById('latestText'),
  latestMeta: document.getElementById('latestMeta'),
  queue: document.getElementById('queue'),
  volumeRange: document.getElementById('volumeRange'),
  rateRange: document.getElementById('rateRange')
}

document.addEventListener('DOMContentLoaded', () => {
  restoreVoiceSettings()
  els.enableBtn.addEventListener('click', enableVoice)
  els.playLatestBtn.addEventListener('click', () => {
    if (voiceState.latest) speak(voiceState.latest.text, true)
  })
  els.testVoiceBtn.addEventListener('click', () => speak('你好，我是AI村长。这个声音听起来怎么样？', true))
  els.voiceSelect.addEventListener('change', saveVoiceSettings)
  els.volumeRange.addEventListener('input', saveVoiceSettings)
  els.rateRange.addEventListener('input', saveVoiceSettings)
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices
    loadVoices()
    setTimeout(loadVoices, 400)
    setTimeout(loadVoices, 1200)
  }
  refreshVoice()
  setInterval(refreshVoice, 2000)
})

async function refreshVoice() {
  try {
    const response = await fetch('/api/voice/latest', { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    renderVoice(data)
    const latest = data.latest
    if (voiceState.enabled && latest && latest.at && latest.at !== voiceState.lastSpokenAt) {
      voiceState.lastSpokenAt = latest.at
      speak(latest.text)
    }
    setStatus(voiceState.enabled ? '已启用，等待新回复' : '未启用', voiceState.enabled)
  } catch (error) {
    setStatus(`连接失败：${error.message}`, false)
  }
}

function renderVoice(data) {
  const latest = data && data.latest
  voiceState.latest = latest || null
  if (latest) {
    els.latestText.textContent = latest.text || ''
    els.latestMeta.textContent = `${latest.title || latest.speaker || 'AI村长'} · ${latest.player || '玩家'} · ${formatTime(latest.at)}`
  } else {
    els.latestText.textContent = '等待村长回复。'
    els.latestMeta.textContent = ''
  }
  const queue = Array.isArray(data && data.queue) ? data.queue : []
  els.queue.innerHTML = queue.slice(0, 8).map(item => [
    '<div class="queue-item">',
    escapeHtml(item.text || ''),
    '<br><small>',
    escapeHtml(`${item.player || '玩家'} · ${formatTime(item.at)}`),
    '</small></div>'
  ].join('')).join('') || '<div class="queue-item">暂无队列。</div>'
}

function enableVoice() {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    setStatus('当前浏览器不支持语音合成', false)
    return
  }
  voiceState.enabled = true
  if (voiceState.latest && voiceState.latest.at) voiceState.lastSpokenAt = voiceState.latest.at
  loadVoices()
  speak('AI村长语音播报已启用。', true)
  setStatus('已启用，等待新回复', true)
}

function speak(text, force = false) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240)
  if (!clean) return
  if (!voiceState.enabled && !force) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(clean)
  utterance.lang = 'zh-CN'
  utterance.volume = Number(els.volumeRange.value || 1)
  utterance.rate = Number(els.rateRange.value || 1)
  utterance.pitch = 1
  const voice = selectedVoice()
  if (voice) utterance.voice = voice
  window.speechSynthesis.speak(utterance)
}

function loadVoices() {
  if (!('speechSynthesis' in window)) return
  const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : []
  if (!voices.length) {
    els.voiceSelect.innerHTML = '<option value="">浏览器还没有返回声音列表</option>'
    return
  }
  voiceState.voices = voices.slice().sort(sortVoices)
  const previous = els.voiceSelect.value || localStorage.getItem('minecraftAiFriend.voice') || ''
  const recommended = recommendedVoice(voiceState.voices)
  const selected = previous && voiceState.voices.some(voice => voiceKey(voice) === previous)
    ? previous
    : recommended ? voiceKey(recommended) : ''
  els.voiceSelect.innerHTML = voiceState.voices.map(voice => {
    const key = voiceKey(voice)
    const tags = [
      /zh/i.test(voice.lang || '') ? '中文' : '',
      /natural|online|xiaoxiao|xiaoyi|xiaobei|yunxi|yunyang|xiaozhen|xiaoshuang/i.test(voice.name || '') ? '推荐' : '',
      voice.localService ? '本机' : '在线'
    ].filter(Boolean).join(' / ')
    return `<option value="${escapeHtml(key)}"${key === selected ? ' selected' : ''}>${escapeHtml(voice.name)} · ${escapeHtml(voice.lang || '未知')}${tags ? ` · ${escapeHtml(tags)}` : ''}</option>`
  }).join('')
  if (selected) localStorage.setItem('minecraftAiFriend.voice', selected)
}

function selectedVoice() {
  const key = els.voiceSelect.value || localStorage.getItem('minecraftAiFriend.voice') || ''
  return voiceState.voices.find(voice => voiceKey(voice) === key) || recommendedVoice(voiceState.voices)
}

function recommendedVoice(voices) {
  const list = Array.isArray(voices) ? voices : []
  return list.find(voice => /zh-CN/i.test(voice.lang || '') && /xiaoxiao|xiaoyi|xiaobei|xiaozhen|xiaoshuang/i.test(voice.name || ''))
    || list.find(voice => /zh/i.test(voice.lang || '') && /natural|online/i.test(voice.name || ''))
    || list.find(voice => /zh-CN/i.test(voice.lang || ''))
    || list.find(voice => /zh/i.test(voice.lang || ''))
    || list[0]
}

function sortVoices(a, b) {
  return voiceScore(b) - voiceScore(a) || String(a.name || '').localeCompare(String(b.name || ''))
}

function voiceScore(voice) {
  const text = `${voice.lang || ''} ${voice.name || ''}`
  let score = 0
  if (/zh-CN/i.test(voice.lang || '')) score += 100
  else if (/zh/i.test(voice.lang || '')) score += 80
  if (/xiaoxiao|xiaoyi|xiaobei|xiaozhen|xiaoshuang/i.test(text)) score += 40
  if (/natural|online/i.test(text)) score += 30
  if (/Microsoft/i.test(text)) score += 10
  return score
}

function voiceKey(voice) {
  return `${voice.name || ''}|||${voice.lang || ''}|||${voice.voiceURI || ''}`
}

function restoreVoiceSettings() {
  const volume = localStorage.getItem('minecraftAiFriend.voiceVolume')
  const rate = localStorage.getItem('minecraftAiFriend.voiceRate')
  if (volume !== null) els.volumeRange.value = volume
  if (rate !== null) els.rateRange.value = rate
}

function saveVoiceSettings() {
  if (els.voiceSelect.value) localStorage.setItem('minecraftAiFriend.voice', els.voiceSelect.value)
  localStorage.setItem('minecraftAiFriend.voiceVolume', els.volumeRange.value)
  localStorage.setItem('minecraftAiFriend.voiceRate', els.rateRange.value)
}

function setStatus(text, on) {
  els.statusText.textContent = text
  els.statusDot.classList.toggle('on', Boolean(on))
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]))
}
