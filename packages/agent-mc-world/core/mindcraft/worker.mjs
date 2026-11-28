import {gameLibrary} from './catalog.mjs';

// Only the isolated program worker sleeps. The game thread resolves the read asynchronously.
export function programLibrary(bot,read,act) {
  let output='';
  const append=text=>{ output=(output+String(text)+'\n').slice(-2400); };
  Object.defineProperty(bot,'output',{get:()=>output});
  const build=(group,call)=>Object.fromEntries(Object.entries(gameLibrary[group]).map(([name,signature])=>[
    name,(...args)=>{
      if (signature.split(',')[0]==='bot' && args.shift()!==bot) throw new TypeError('Pass this program’s bot to '+group+'.'+name);
      return call(name,args);
    }
  ]));
  const world=build('world',read);
  const skills=build('skills',async(name,args)=>{
    const result=await act(name,args);
    for (const note of result.notes ?? []) append(note);
    return result.value;
  });
  skills.log=(owner,text)=>{ if (owner!==bot) throw new TypeError('Expected bot'); append(text); };
  world.getNearestEntityWhere=(owner,predicate,distance=16)=>{
    if (typeof predicate!=='function') throw new TypeError('Expected an entity predicate');
    return world.getNearbyEntities(owner,distance).find(predicate) ?? null;
  };
  const byId=world.getNearestBlocksWhere;
  world.getNearestBlocksWhere=(owner,predicate,distance=8,count=64)=>{
    if (Array.isArray(predicate)) return byId(owner,predicate,distance,count);
    if (typeof predicate!=='function') throw new TypeError('Expected a block predicate or registry ids');
    return world.getNearestBlocks(owner,null,distance,64).filter(predicate).slice(0,count);
  };
  return {world:harden(world),skills:harden(skills)};
}
