/**
 * Lifecycle —— 轻量生命周期上下文（脱 cordis 壳后，替代 ctx 的定时器/清理管理）。
 *
 * cordis 的 Context 提供「受管理」的 setTimeout/setInterval/effect：
 * 插件 dispose 时自动清定时器、逆序执行 effect 清理钩子。
 * 世界进程脱壳（去 @deepseek-ai/cordis）后，用本模块等价替代：
 *   - setTimeout / setInterval 返回 stop 函数，且被自动跟踪
 *   - onDispose 注册清理钩子
 *   - dispose 时：清全部定时器 → 逆序执行清理钩子（幂等）
 *
 * 用法：每个服务工厂内部自建一个 Lifecycle，定时器走 lc.setTimeout/lc.setInterval，
 * 返回的 dispose() 里 lc.dispose() 一次性回收。语义与 cordis 插件 fiber 对齐。
 */

export interface Lifecycle {
  /** 受管 setTimeout：到点执行 fn，返回提前取消函数。 */
  setTimeout(fn: () => void, ms: number): () => void
  /** 受管 setInterval：周期执行 fn，返回取消函数。 */
  setInterval(fn: () => void, ms: number): () => void
  /** 注册清理钩子（dispose 时逆序执行）。 */
  onDispose(fn: () => void): void
  /** 清理全部定时器与钩子（幂等）。 */
  dispose(): void
}

export function createLifecycle(): Lifecycle {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const disposers: Array<() => void> = []
  let disposed = false

  return {
    setTimeout(fn, ms) {
      const t = setTimeout(() => {
        timers.delete(t)
        fn()
      }, ms)
      timers.add(t)
      return () => {
        clearTimeout(t)
        timers.delete(t)
      }
    },
    setInterval(fn, ms) {
      const t = setInterval(fn, ms)
      timers.add(t)
      return () => {
        clearInterval(t)
        timers.delete(t)
      }
    },
    onDispose(fn) {
      disposers.push(fn)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const t of timers) clearTimeout(t)
      timers.clear()
      for (let i = disposers.length - 1; i >= 0; i--) {
        try {
          disposers[i]()
        } catch {
          /* 清理失败不阻断其余清理 */
        }
      }
      disposers.length = 0
    },
  }
}
