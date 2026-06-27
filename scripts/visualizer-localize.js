'use strict';

(() => {
  const STATUS_LABELS = {
    online: '在线',
    offline: '离线',
    waiting: '等待中',
    booting: '启动中',
    spawned: '已出生',
    disconnected: '已断开',
    respawning: '重生中'
  }

  const KIND_LABELS = {
    working: '进行中',
    active: '执行中',
    risk: '风险',
    blocked: '受阻',
    done: '完成',
    idle: '空闲',
    info: '信息',
    status: '状态',
    thought: '思考',
    memory: '记忆',
    system: '系统',
    need_help: '需要帮助'
  }

  const EVENT_TYPE_LABELS = {
    'status:update': '状态更新',
    'task:active': '任务执行中',
    'task:working': '任务进行中',
    'task:done': '任务完成',
    'task:blocked': '任务受阻',
    'task:info': '任务记录',
    'infra:started': '设施开工',
    'infra:done': '设施完成',
    'infra:blocked': '设施受阻',
    'infra:planned': '设施计划',
    'control:ready': '控制台就绪',
    'agent:update': '居民状态更新',
    'event:new': '新事件',
    init: '初始化'
  }

  const ITEM_LABELS = {
    cobblestone: '圆石',
    stone: '石头',
    dirt: '泥土',
    grass_block: '草方块',
    sand: '沙子',
    gravel: '砂砾',
    granite: '花岗岩',
    diorite: '闪长岩',
    andesite: '安山岩',
    torch: '火把',
    coal: '煤炭',
    charcoal: '木炭',
    raw_iron: '粗铁',
    iron_ingot: '铁锭',
    raw_copper: '粗铜',
    oak_log: '橡木原木',
    oak_planks: '橡木木板',
    oak_sapling: '橡树树苗',
    oak_door: '橡木门',
    oak_fence: '橡木栅栏',
    stick: '木棍',
    chest: '箱子',
    crafting_table: '工作台',
    furnace: '熔炉',
    wooden_pickaxe: '木镐',
    wooden_axe: '木斧',
    wooden_hoe: '木锄',
    stone_pickaxe: '石镐',
    stone_axe: '石斧',
    stone_hoe: '石锄',
    glass: '玻璃',
    wheat_seeds: '小麦种子',
    wheat: '小麦',
    apple: '苹果',
    bread: '面包',
    porkchop: '生猪排',
    cooked_porkchop: '熟猪排',
    beef: '生牛肉',
    cooked_beef: '牛排',
    chicken: '生鸡肉',
    cooked_chicken: '熟鸡肉',
    salmon: '鲑鱼',
    cooked_salmon: '熟鲑鱼',
    leather: '皮革',
    bone_meal: '骨粉',
    arrow: '箭'
  }

  let scheduled = false

  function schedule() {
    if (scheduled) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      localize()
    })
  }

  function localize() {
    document.title = '我的世界 AI 村庄直播台'
    setText('h1', '我的世界 AI 小队')
    setText('#modeBadge', text => (/模拟/i.test(text) ? '模拟模式' : '实机模式'))
    setText('#connectionBadge', text => label(text, STATUS_LABELS) || (text === 'live' ? '在线' : text))
    setText('.viewer-band .section-title span', '实机视角')

    forEachText('.agent-status', text => label(text, STATUS_LABELS) || text)
    forEachText('.agent-thought', cleanupText)
    forEachText('.bulletin-message', cleanupText)
    forEachText('.event-row span', cleanupText)
    forEachText('.resource-name', text => label(text, ITEM_LABELS) || text)
    forEachText('.event-row strong', text => label(text, EVENT_TYPE_LABELS) || label(text, KIND_LABELS) || text)

    document.querySelectorAll('.bulletin-meta span').forEach(element => {
      const parts = element.textContent.split('|').map(part => part.trim())
      if (parts.length >= 2) {
        const kind = label(parts.slice(1).join(' | '), KIND_LABELS) || parts.slice(1).join(' | ')
        setElementText(element, `${parts[0]} | ${kind}`)
      }
    })
  }

  function setText(selector, value) {
    const element = document.querySelector(selector)
    if (!element) return
    setElementText(element, typeof value === 'function' ? value(element.textContent.trim()) : value)
  }

  function forEachText(selector, mapper) {
    document.querySelectorAll(selector).forEach(element => {
      setElementText(element, mapper(element.textContent.trim()))
    })
  }

  function setElementText(element, value) {
    if (value && element.textContent !== value) element.textContent = value
  }

  function label(value, dictionary) {
    const key = String(value || '').trim()
    return dictionary[key] || dictionary[key.toLowerCase()] || ''
  }

  function cleanupText(value) {
    return String(value || '')
      .replace(/\bONLINE\b/g, '在线')
      .replace(/\bOFFLINE\b/g, '离线')
      .replace(/\bonline\b/g, '在线')
      .replace(/\boffline\b/g, '离线')
      .replace(/\bThink\s*[:：]\s*/gi, '思考：')
      .replace(/\bThought\s*[:：]\s*/gi, '思考：')
      .replace(/想\s*[:：]\s*/g, '思考：')
      .replace(/\bHAVE\s*[:：]?\s*/gi, '已有：')
      .replace(/\bNEED\s*[:：]?\s*/gi, '需要：')
      .replace(/\bDOING\s*[:：]?\s*/gi, '正在做：')
      .replace(/\bDONE\s*[:：]?\s*/gi, '完成：')
      .replace(/\bBLOCKED\s*[:：]?\s*/gi, '受阻：')
      .replace(/![a-zA-Z_]\w*\([^)]*\)/g, '')
      .replace(/![a-zA-Z_]\w*\([^。！？；\n]*/g, '')
      .trim()
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true })
  } else {
    schedule()
  }
  window.setInterval(schedule, 2000)
})()
