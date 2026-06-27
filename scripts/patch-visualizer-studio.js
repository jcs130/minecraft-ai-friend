'use strict'

const fs = require('node:fs')
const path = require('node:path')

const visualizerDir = process.argv[2]
if (!visualizerDir) throw new Error('Usage: node scripts/patch-visualizer-studio.js <visualizerDir>')

const root = path.resolve(__dirname, '..')
const templateDir = path.join(root, 'scripts', 'visualizer-studio')
const publicDir = path.join(visualizerDir, 'public')

copyTemplate('studio.html')
copyTemplate('studio.js')
copyTemplate('studio.css')
patchServer(path.join(visualizerDir, 'src', 'index.js'))

function copyTemplate(fileName) {
  const source = path.join(templateDir, fileName)
  const target = path.join(publicDir, fileName)
  if (!fs.existsSync(source)) throw new Error(`Missing studio template: ${source}`)
  fs.copyFileSync(source, target)
}

function patchServer(filePath) {
  if (!fs.existsSync(filePath)) return
  let text = fs.readFileSync(filePath, 'utf8')
  text = replaceOnce(text,
    '  sharedResources: {},\n  livestream: {',
    '  sharedResources: {},\n  world: {},\n  village: {},\n  models: {},\n  interaction: {\n    enabled: false,\n    title: \'弹幕互动预留\',\n    description: \'后续可接入 B 站、抖音、YouTube 或 Twitch 弹幕，让观众投票影响村庄宏观目标。\'\n  },\n  livestream: {'
  )
  text = replaceOnce(text,
    '    sharedResources: state.sharedResources,\n    livestream: state.livestream\n  };',
    '    sharedResources: state.sharedResources,\n    livestream: state.livestream,\n    world: state.world,\n    village: state.village,\n    models: state.models,\n    interaction: state.interaction\n  };'
  )
  text = replaceOnce(text,
    '  if (body.livestream && typeof body.livestream === \'object\') {\n    state.livestream = normalizeLivestream(body.livestream);\n  }\n}',
    '  if (body.livestream && typeof body.livestream === \'object\') {\n    state.livestream = normalizeLivestream(body.livestream);\n  }\n  if (body.world && typeof body.world === \'object\') {\n    state.world = body.world;\n  }\n  if (body.village && typeof body.village === \'object\') {\n    state.village = body.village;\n  }\n  if (body.interaction && typeof body.interaction === \'object\') {\n    state.interaction = body.interaction;\n  }\n}'
  )
  text = replaceOnce(text,
    '  village: {},\n  interaction: {',
    '  village: {},\n  models: {},\n  interaction: {'
  )
  text = replaceOnce(text,
    '    village: state.village,\n    interaction: state.interaction',
    '    village: state.village,\n    models: state.models,\n    interaction: state.interaction'
  )
  text = replaceOnce(text,
    '  if (body.interaction && typeof body.interaction === \'object\') {\n    state.interaction = body.interaction;\n  }',
    '  if (body.models && typeof body.models === \'object\') {\n    state.models = body.models;\n  }\n  if (body.interaction && typeof body.interaction === \'object\') {\n    state.interaction = body.interaction;\n  }'
  )
  text = replaceOnce(text,
    `    : pathname === '/obs'
      ? '/obs.html'
      : pathname === '/viewer'
        ? '/viewer.html'
        : pathname;`,
    `    : pathname === '/obs'
      ? '/obs.html'
      : pathname === '/viewer'
        ? '/viewer.html'
        : pathname === '/studio' || pathname === '/live'
          ? '/studio.html'
          : pathname;`
  )
  fs.writeFileSync(filePath, text)
}

function replaceOnce(text, from, to) {
  if (text.includes(to) || !text.includes(from)) return text
  return text.replace(from, to)
}