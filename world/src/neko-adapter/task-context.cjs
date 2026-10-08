'use strict'
// The objective must survive upstream's 500-character history summary. This
// repeats operator intent, never a generated action plan or a success claim.
function attachTaskContext (prompter, getContext) {
  if (typeof prompter?.promptConvo !== 'function' || typeof prompter?.profile?.conversing !== 'string') throw Error('NEKO_TASK_PROMPTER_UNAVAILABLE')
  const original = prompter.promptConvo.bind(prompter), base = prompter.profile.conversing
  prompter.promptConvo = async (...args) => {
    const context = getContext()
    if (typeof context !== 'string' || Buffer.byteLength(context, 'utf8') > 24576) throw Error('NEKO_TASK_CONTEXT_INVALID')
    prompter.profile.conversing = base + '\nPersistent operator objective (keep across memory summaries):\n' + context
    try { return await original(...args) }
    finally { prompter.profile.conversing = base }
  }
}
module.exports = { attachTaskContext }
