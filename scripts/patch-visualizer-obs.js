'use strict'

const fs = require('node:fs')
const path = require('node:path')

const visualizerDir = process.argv[2]
if (!visualizerDir) throw new Error('Usage: node scripts/patch-visualizer-obs.js <visualizerDir>')

const publicDir = path.join(visualizerDir, 'public')
patchServer(path.join(visualizerDir, 'src', 'index.js'))
patchObsHtml(path.join(publicDir, 'obs.html'))
patchObsJs(path.join(publicDir, 'obs.js'))
patchStyles(path.join(publicDir, 'styles.css'))

function patchServer(filePath) {
  if (!fs.existsSync(filePath)) return
  let text = fs.readFileSync(filePath, 'utf8')
  text = replaceOnce(text,
    '  bulletins: [],\n  events: [],\n  sharedResources: {}\n};',
    '  bulletins: [],\n  events: [],\n  sharedResources: {},\n  livestream: {\n    active: false,\n    observer: \'live\',\n    currentTarget: \'\',\n    switchIntervalMs: 30000,\n    lastSwitchedAt: \'\',\n    lastError: \'\',\n    candidates: []\n  }\n};'
  )
  text = replaceOnce(text,
    '    bulletins: state.bulletins,\n    events: state.events,\n    sharedResources: state.sharedResources\n  };',
    '    bulletins: state.bulletins,\n    events: state.events,\n    sharedResources: state.sharedResources,\n    livestream: state.livestream\n  };'
  )
  text = replaceOnce(text,
    '  if (body.sharedResources && typeof body.sharedResources === \'object\') {\n    state.sharedResources = body.sharedResources;\n  } else {\n    recalculateSharedResources();\n  }\n}',
    '  if (body.sharedResources && typeof body.sharedResources === \'object\') {\n    state.sharedResources = body.sharedResources;\n  } else {\n    recalculateSharedResources();\n  }\n  if (body.livestream && typeof body.livestream === \'object\') {\n    state.livestream = normalizeLivestream(body.livestream);\n  }\n}'
  )
  text = replaceOnce(text,
    '    memory: input.memory ?? previous.memory ?? null,\n    lastAction: input.lastAction ?? previous.lastAction ?? null,\n    lastSeenAt: new Date().toISOString()\n  };\n}',
    '    memory: input.memory ?? previous.memory ?? null,\n    observed: Boolean(input.observed ?? previous.observed ?? false),\n    cameraLabel: String(input.cameraLabel ?? previous.cameraLabel ?? \'\'),\n    lastAction: input.lastAction ?? previous.lastAction ?? null,\n    lastSeenAt: new Date().toISOString()\n  };\n}\n\nfunction normalizeLivestream(input) {\n  const previous = state.livestream ?? {};\n  return {\n    active: Boolean(input.active ?? previous.active ?? false),\n    observer: String(input.observer ?? previous.observer ?? \'live\'),\n    currentTarget: String(input.currentTarget ?? previous.currentTarget ?? \'\'),\n    switchIntervalMs: nullableNumber(input.switchIntervalMs ?? previous.switchIntervalMs) ?? 30000,\n    lastSwitchedAt: String(input.lastSwitchedAt ?? previous.lastSwitchedAt ?? \'\'),\n    lastError: String(input.lastError ?? previous.lastError ?? \'\'),\n    candidates: Array.isArray(input.candidates) ? input.candidates : previous.candidates ?? []\n  };\n}'
  )
  fs.writeFileSync(filePath, text)
}

function patchObsHtml(filePath) {
  if (!fs.existsSync(filePath)) return
  let text = fs.readFileSync(filePath, 'utf8')
  if (!text.includes('id="obsCamera"')) {
    text = text.replace('<div id="obsOverlay" class="obs-overlay">', '<div id="obsOverlay" class="obs-overlay">\n      <div id="obsCamera" class="obs-camera">镜头状态：等待同步</div>')
  }
  fs.writeFileSync(filePath, text)
}

function patchObsJs(filePath) {
  if (!fs.existsSync(filePath)) return
  let text = fs.readFileSync(filePath, 'utf8')
  if (text.includes('snapshot.livestream?.currentTarget')) return
  text = text.replace('let activeIndex = 0;', 'let activeIndex = 0;\nlet lastCameraTarget = \'\';\nlet switchTimer = null;')
  text = text.replace("overlay: document.querySelector('#obsOverlay'),", "overlay: document.querySelector('#obsOverlay'),\n  camera: document.querySelector('#obsCamera'),")
  text = text.replace('if (!fixedAgent && snapshot?.agents?.length) {', 'if (!fixedAgent && snapshot?.agents?.length && !snapshot?.livestream?.currentTarget) {')
  text = text.replace(`  const agent = fixedAgent
    ? snapshot.agents.find((candidate) => candidate.id === fixedAgent || candidate.name === fixedAgent) ?? snapshot.agents[0]
    : snapshot.agents[activeIndex % snapshot.agents.length];

  elements.overlay.style.setProperty('--agent-color', agent.color);`, `  const liveTarget = snapshot.livestream?.currentTarget || '';
  const liveAgent = liveTarget
    ? snapshot.agents.find((candidate) => candidate.id === liveTarget || candidate.name === liveTarget)
    : null;
  const agent = fixedAgent
    ? snapshot.agents.find((candidate) => candidate.id === fixedAgent || candidate.name === fixedAgent) ?? snapshot.agents[0]
    : liveAgent ?? snapshot.agents[activeIndex % snapshot.agents.length];

  if (!fixedAgent && liveAgent) activeIndex = snapshot.agents.indexOf(liveAgent);
  updateSwitchHighlight(liveTarget || agent.name);

  elements.overlay.style.setProperty('--agent-color', agent.color);`)
  text = text.replace("elements.task.textContent = actionLabel(agent.currentTask ?? 'idle');", "elements.camera.textContent = cameraLabel(snapshot.livestream, agent);\n  elements.task.textContent = actionLabel(agent.currentTask ?? 'idle');")
  text = text.replace('function actionLabel(action) {', `function cameraLabel(livestream, agent) {
  if (!livestream) return \`镜头：观察 \${agent.name}\`;
  const interval = Math.round(Number(livestream.switchIntervalMs || 0) / 1000) || '?';
  const target = livestream.currentTarget || agent.name || '等待中';
  const mode = livestream.active ? \`自动轮换 \${interval}s\` : '手动镜头';
  const error = livestream.lastError ? \`｜异常：\${livestream.lastError}\` : '';
  return \`镜头：\${livestream.observer || 'live'} → \${target}｜\${mode}\${error}\`;
}

function updateSwitchHighlight(target) {
  if (!target || target === lastCameraTarget) return;
  lastCameraTarget = target;
  elements.overlay.classList.add('obs-switching');
  if (switchTimer) clearTimeout(switchTimer);
  switchTimer = setTimeout(() => {
    elements.overlay.classList.remove('obs-switching');
  }, 1800);
}

function actionLabel(action) {`)
  fs.writeFileSync(filePath, text)
}

function patchStyles(filePath) {
  if (!fs.existsSync(filePath)) return
  let text = fs.readFileSync(filePath, 'utf8')
  if (!text.includes('.obs-camera')) {
    text += `

.obs-camera {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  margin-bottom: 10px;
  padding: 5px 9px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #e8f1ff;
  font-size: 13px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.obs-overlay.obs-switching {
  animation: obsSwitchPulse 1.2s ease-out;
}

@keyframes obsSwitchPulse {
  0% {
    border-color: rgba(255, 255, 255, 0.6);
    box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.28);
  }
  45% {
    border-color: var(--agent-color, var(--blue));
    box-shadow: 0 0 0 8px rgba(96, 165, 250, 0.18);
  }
  100% {
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow: 0 20px 80px rgba(0, 0, 0, 0.32);
  }
}
`
  }
  fs.writeFileSync(filePath, text)
}

function replaceOnce(text, from, to) {
  if (text.includes(to) || !text.includes(from)) return text
  return text.replace(from, to)
}