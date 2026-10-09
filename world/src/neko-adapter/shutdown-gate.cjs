'use strict'

// A stop signal and the startup path must await the same cleanup. In particular,
// a death while awaiting a task must not exit before status/locks are finalized.
function createShutdownGate (cleanup) {
  let pending
  function shutdown (...args) {
    if (pending) return pending
    let resolve, reject
    pending = new Promise((yes, no) => { resolve = yes; reject = no })
    try { Promise.resolve(cleanup(...args)).then(resolve, reject) } catch (error) { reject(error) }
    return pending
  }
  shutdown.wait = () => pending ?? Promise.resolve()
  return shutdown
}
module.exports = { createShutdownGate }
