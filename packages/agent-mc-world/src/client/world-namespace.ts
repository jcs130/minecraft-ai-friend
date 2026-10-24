import type {WorldHost, StoragePart,ToolOutcome,EventRangeQuery} from '../contracts/index.ts';

function namespace(value: string, from: string, to: string): string {
  return value === from || value.startsWith(from + '.') || value.startsWith(from + ':')
    ? to + value.slice(from.length) : value;
}
function senderNamespace(value:string,from:string,to:string):string {
  // Bare sender ids may be real Minecraft names, including "minecraft" or "mymc".
  return value.startsWith(from+'.')||value.startsWith(from+':')?to+value.slice(from.length):value;
}

/** Change envelope ownership only. Player text, dimension ids, attachments and evidence stay original. */
export function mapWorldEventNamespace<T extends {type: string; source?: string; senderKey?: string}>(
  event: T, from: string, to: string): T {
  return {...event, type: namespace(event.type, from, to),
    ...(event.source !== undefined ? {source: namespace(event.source, from, to)} : {}),
    ...(event.senderKey !== undefined ? {senderKey: senderNamespace(event.senderKey, from, to)} : {})};
}

/** A naming boundary retains live host getters and methods, including optional capabilities. */
export function namespaceWorldHost<T extends WorldHost>(host: T, from: string, to: string): T {
  const pushEvent: WorldHost['pushEvent'] = async (event, options) =>
    mapWorldEventNamespace(await host.pushEvent(mapWorldEventNamespace(event, from, to), options), to, from);
  const pushDeferred: WorldHost['pushDeferred'] = (event, options) =>
    host.pushDeferred(mapWorldEventNamespace(event, from, to), options);
  const drainPendingEvents: WorldHost['drainPendingEvents'] = async filter =>
    (await host.drainPendingEvents(event => filter(mapWorldEventNamespace(event, to, from))))
      .map(event => mapWorldEventNamespace(event, to, from));
  const query = <Q extends EventRangeQuery>(value:Q):Q => ({...value,
    ...(value.source ? {source:namespace(value.source,from,to)} : {}),
    ...(value.senderKey ? {senderKey:senderNamespace(value.senderKey,from,to)} : {})});
  const stored = (event:ReturnType<WorldHost['store']['get']>) => event ? mapWorldEventNamespace(event,to,from) : undefined;
  return extendWorldHost(host,{pushEvent, pushDeferred, drainPendingEvents,store:{
    get:cursor=>stored(host.store.get(cursor)),latestCursor:()=>host.store.latestCursor(),
    range:value=>host.store.range(query(value)).map(e=>mapWorldEventNamespace(e,to,from)),
    around:(...args)=>host.store.around(...args).map(e=>mapWorldEventNamespace(e,to,from)),
    grep:value=>host.store.grep(query(value)).map(row=>({...row,events:row.events.map(e=>mapWorldEventNamespace(e,to,from))})),
  }});
}

export function mapWorldOutcomeNamespace(outcome:string|ToolOutcome,from:string,to:string):string|ToolOutcome {
  return typeof outcome==='string'||!outcome.events?outcome:{...outcome,events:outcome.events.map(event=>mapWorldEventNamespace(event,from,to))};
}

/** Add observation ports without snapshotting getters or dropping non-enumerable capabilities. */
export function extendWorldHost<T extends WorldHost>(host:T,overrides:Partial<WorldHost>):T {
  return new Proxy(host, {get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides,key,overrides);
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
}

/** Rename the public key while retaining each original stat/clear closure. */
export function namespaceWorldStorage(parts: readonly StoragePart[] | undefined, from: string, to: string): StoragePart[] {
  return (parts ?? []).map(part => ({...part,
    key: part.key === from || part.key.startsWith(from + '-') ? to + part.key.slice(from.length) : part.key}));
}
