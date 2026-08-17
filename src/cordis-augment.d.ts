/**
 * Module augmentation (this file is a module via `export {}`).
 *
 * 1. `ctx.tools` — provided at runtime by the dsh ToolRuntime plugin whose
 *    types are PnP-only and unreachable for plain tsc. Typed as any on
 *    purpose.
 * 2. `get`/`set`/`provide`/`effect` — cordis 4 mixes these ReflectService /
 *    Fiber methods onto the context proxy at runtime, and the vendored
 *    cordis declares them via augmentations that don't surface through the
 *    package specifier under our tsconfig (skipLibCheck + `.ts`-extension
 *    imports inside the vendored .d.ts chain). Mirrored here with the same
 *    signatures as vendor cordis lib/types/reflect.d.ts / fiber.d.ts.
 */
export {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: any
    /** Read a service without the inject requirement. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(name: string, strict?: boolean): any
    /** Overwrite a provided service's value (same fiber only). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(name: string, value: any): void
    /** Register a service implementation owned by the current fiber. */
    provide(name: string, value?: unknown): () => void
    /** Register a cleanup-aware effect; may return a disposer. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    effect(execute: () => any, label?: string): any
  }
}

// The vendored cordis .d.ts chain imports Context via the relative specifier
// './context.ts', which TypeScript treats as a SEPARATE module identity from
// the package specifier above — so the two Context interfaces never merge and
// ctx.plugin() contravariance checks explode. Augment the vendored file path
// with the same members so both identities agree.
declare module '../../vendor/cordis/lib/types/context' {
  interface Context {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(name: string, strict?: boolean): any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(name: string, value: any): void
    provide(name: string, value?: unknown): () => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    effect(execute: () => any, label?: string): any
    mcbot: import('./mc-bot.ts').McBotService
    mcRcon: import('./mc-rcon.ts').RconService
    mcMagic: import('./mc-magic.ts').MagicService
    mcWorlddb: import('./mc-worlddb.ts').WorlddbService
    mcMemory: import('./mc-memory.ts').MemoryService
    mcMystic: import('./mc-mystic.ts').MysticService
    mcTransmigrators: import('./mc-transmigrator.ts').TransmigratorService
    mcGod: import('./mc-god.ts').GodService
    mcWiki: import('./mc-wiki.ts').WikiService
  }
}
