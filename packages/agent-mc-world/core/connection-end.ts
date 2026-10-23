/** One native end listener per connection; each feature keeps a disposable subscription. */
import type {EventEmitter} from 'node:events';
const ended=new WeakSet<object>();
const groups=new WeakMap<object,{listeners:Map<symbol,(reason?:string)=>void>;dispatch:(reason?:string)=>void}>();
export function onConnectionEnd(target: object, listener: (reason?:string)=>void):()=>void {
  if(ended.has(target)) return ()=>{};
  const emitter=target as EventEmitter;
  let group=groups.get(target);
  if(!group) {
    const listeners=new Map<symbol,(reason?:string)=>void>();
    const dispatch=(reason?:string)=>{
      ended.add(target);groups.delete(target);
      const callbacks=[...listeners.values()];listeners.clear();
      for(const callback of callbacks) try {callback(reason);} catch(error) {
        process.emitWarning('Minecraft connection cleanup failed',{type:'MinecraftCleanupWarning',detail:error instanceof Error?error.name:typeof error});
      }
    };
    group={listeners,dispatch};groups.set(target,group);emitter.once('end',dispatch);
  }
  const owner=group,key=Symbol('connection end');owner.listeners.set(key,listener);
  return ()=>{
    owner.listeners.delete(key);
    if(!owner.listeners.size && groups.get(target)===owner) {
      emitter.removeListener('end',owner.dispatch);groups.delete(target);
    }
  };
}
