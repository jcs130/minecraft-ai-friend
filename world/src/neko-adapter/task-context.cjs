'use strict'
// The objective must survive upstream's 500-character history summary. This
// repeats operator intent, never a generated action plan or a success claim.
function attachTaskContext (prompter, getContext) {
  if (typeof prompter?.promptConvo !== 'function' || typeof prompter?.profile?.conversing !== 'string') throw Error('NEKO_TASK_PROMPTER_UNAVAILABLE')
  for (const [method, field] of [['promptConvo', 'conversing'], ['promptMemSaving', 'saving_memory']]) {
    if (typeof prompter[method] !== 'function' || typeof prompter.profile[field] !== 'string') continue
    const original = prompter[method].bind(prompter), base = prompter.profile[field]
    prompter[method] = async (...args) => {
      const context = getContext()
      if (typeof context !== 'string' || Buffer.byteLength(context, 'utf8') > 24576) throw Error('NEKO_TASK_CONTEXT_INVALID')
      prompter.profile[field] = base + '\nPersistent operator objective and independently verified receipts (missing observations do not mean empty inventory or no progress):\n' + context
      try { return await original(...args) }
      finally { prompter.profile[field] = base }
    }
  }
}
module.exports = { attachTaskContext }
