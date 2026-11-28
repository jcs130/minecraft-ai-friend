import { setImmediate, setTimeout } from 'node:timers/promises';
import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { createGameData } from './data.mjs';
import { createWorld } from './world.mjs';
import { createSkills } from './skills.mjs';
import { gameLibrary } from './catalog.mjs';

const registryLibraries = new WeakMap();
function libraries(registry) {
  let result = registryLibraries.get(registry);
  if (!result) {
    const data = createGameData(registry);
    result = { data, world:createWorld(data) };
    registryLibraries.set(registry,result);
  }
  return result;
}

function natural(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(label + ' must be an integer in ' + min + '..' + max);
  return value;
}

function position(value) {
  if (!value || ![value.x,value.y,value.z].every(n=>Number.isFinite(n) && Math.abs(n)<=30_000_000))
    throw new TypeError('Expected a finite in-world position');
  return new Vec3(value.x,value.y,value.z);
}

export async function callGameLibrary({family, name, args, bot, view, signal, check, native, step, hostile, packBlock, cleanup, escapeFrom, taggedIngredients, taggedOutput}) {
  if (!Object.hasOwn(gameLibrary,family) || !Object.hasOwn(gameLibrary[family],name)) throw new TypeError('Unknown Mindcraft helper');
  const {data,world} = libraries(bot.registry);
  const notes = [];
  const note = text => { if (notes.length < 16) notes.push(String(text).slice(0,320)); };
  const limits = opts => ({...opts,
    maxDistance:Math.min(32,natural(opts.maxDistance ?? 16,1,512,'search radius')),
    count:Math.min(64,natural(opts.count ?? 1,1,10000,'search count'))});
  const owned = new Set();
  function closeOwned() {
    for (const win of owned) {
      if (win === bot.currentWindow) cleanup(() => win.close());
      owned.delete(win);
    }
  }
  signal.addEventListener('abort',closeOwned,{once:true});
  const scoped = new Proxy(view,{get(target,key) {
    check();
    if (key==='interrupt_code') return signal.aborted;
    if (key==='taggedIngredients') return taggedIngredients;
    if (key==='yieldRead') return () => setImmediate(undefined,{signal});
    if (key==='walkProfile') return () => new pf.Movements(bot);
    if (key==='findBlocks') return opts => target.findBlocks(limits(opts));
    if (key==='openContainer' || key==='openFurnace' || key==='openVillager') return async subject => {
      if (bot.currentWindow) throw new Error('A different window is already open');
      const win = await bot[key](subject);
      owned.add(win);
      if (signal.aborted) { closeOwned(); check(); }
      return win;
    };
    return Reflect.get(target,key);
  }});
  const noteStep = async action => { const receipt=await step(action); note(receipt); return true; };
  const actions={
    note, taggedOutput, point:(x,y,z)=>position({x,y,z}).floored(), step:noteStep,
    wait:ms=>setTimeout(natural(ms,0,120000,'wait ms'),undefined,{signal}),
    goto:async goal=>{ await native('pathfinder.goto',[goal]); return true; },
    nearestHostile:range=>hostile(scoped,range),
    away:escapeFrom,
    hit:async e=>{
      if (bot.entity.position.distanceTo(e.position)>3) return false;
      await bot.lookAt(e.position.offset(0,e.height/2,0));
      check();
      if (!view.entities[e.id] || bot.entity.position.distanceTo(e.position)>3) return false;
      await bot.attack(e);
      note('One attack was sent. Damage and kill attribution require server evidence.');
      return true;
    },
    equip:async item=>{
      if (item==='hand') { await native('unequip',['hand']); return true; }
      const stack=bot.inventory.items().find(s=>s.name===item);
      if (!stack) return false;
      const slot=item.endsWith('_leggings')?'legs':item.endsWith('_boots')?'feet':item.endsWith('_helmet')?'head':
        item.endsWith('_chestplate') || item==='elytra'?'torso':item==='shield'?'off-hand':'hand';
      await native('equip',[stack.type,slot]); return true;
    },
    breakAt:async(x,y,z)=>{
      const at=position({x,y,z}).floored();
      const block=view.blockAt(at);
      if (!block || !block.diggable || block.boundingBox==='empty' && block.name==='air') return false;
      if (!bot.canDigBlock(block)) await native('pathfinder.goto',[{x:at.x,y:at.y,z:at.z,rangeSq:4}]);
      await native('dig',[packBlock(block)]);
      const after=view.blockAt(at);
      return !!after && after.stateId!==block.stateId;
    },
    place:async(item,x,y,z,side)=>{
      const dirs={bottom:[0,-1,0],top:[0,1,0],north:[0,0,-1],south:[0,0,1],east:[1,0,0],west:[-1,0,0]};
      if (side !== 'side' && !Object.hasOwn(dirs,side)) throw new Error('Unknown supporting face: '+side);
      const at=position({x,y,z}).floored();
      if (bot.entity.position.distanceTo(at)>4) await native('pathfinder.goto',[{x:at.x,y:at.y,z:at.z,rangeSq:4}]);
      const current=view.blockAt(at);
      if (!current || current.boundingBox!=='empty') return false;
      const preferred=side==='side'?['north','south','east','west']:[side];
      const order=[...new Set([...preferred,...Object.keys(dirs)])];
      const offset=order.map(key=>new Vec3(...dirs[key])).find(d=>view.blockAt(at.plus(d))?.boundingBox==='block');
      if (!offset) return false;
      const ref=view.blockAt(at.plus(offset));
      const stack=bot.inventory.items().find(i=>i.name===item);
      if (!ref || !stack) return false;
      await native('equip',[stack.type,'hand']);
      await native('placeBlock',[packBlock(ref),offset.scaled(-1)]);
      return view.blockAt(at)?.name===item;
    }
  };
  try {
    const methods=family==='world'?world:createSkills(world,data,actions);
    const formals=gameLibrary[family][name].split(',').map(s=>s.trim().split('=')[0].trim());
    const takesBot=formals[0]==='bot';
    if (takesBot) formals.shift();
    if (args.length>formals.length) throw new TypeError(name+' received extra arguments');
    const projected=args.map((arg,i)=>{
      const field=formals[i];
      if (field==='entity' || field==='target' && name==='isClearPath') {
        if (!Number.isSafeInteger(arg?.id)) throw new TypeError('Pass an observed entity with its id');
        const entity=view.entities[arg.id];
        if (!entity) throw new Error('Entity is no longer visible on this connection');
        return entity;
      }
      if (field==='block' && name==='useToolOnBlock') {
        const block=view.blockAt(position(arg?.position));
        if (!block || block.stateId!==arg.stateId) throw new Error('Observed block changed');
        return block;
      }
      if (field==='index' && name==='tradeWithVillager') return natural(arg,1,256,'one-based trade index');
      if (field==='kill' && typeof arg!=='boolean') throw new TypeError('kill must be a boolean');
      if (field==='size') return natural(arg,1,8,'footprint');
      if (['distance','maxDistance','range'].includes(field)) return natural(arg,0,128,field);
      if (field==='min_distance') return natural(arg,0,16,field);
      if (field==='count' || field==='num') {
        if (arg===-1 && ['discard','takeFromChest','putInChest'].includes(name)) return -1;
        return natural(arg,1,family==='world'?10000:2304,field);
      }
      if (['x','y','z'].includes(field) && (typeof arg!=='number' || !Number.isFinite(arg) || Math.abs(arg)>30_000_000))
        throw new TypeError('Invalid coordinate');
      if (field==='predicate' && (!Array.isArray(arg)||!arg.every(Number.isSafeInteger)))
        throw new TypeError('Host block predicate requires registry ids');
      return arg;
    });
    const value=await methods[name](...(takesBot?[scoped]:[]),...projected);
    check();
    function pack(v) {
      if (v==null) return null;
      if (Array.isArray(v)) return v.map(pack);
      if (v.stateId!==undefined && v.position) return packBlock(v);
      if (v.id!==undefined && v.position) return {id:v.id,uuid:v.uuid??null,name:v.name??null,username:v.username??null,type:v.type??null,position:v.position};
      return v;
    }
    return {value:pack(value),notes};
  } finally {
    signal.removeEventListener('abort',closeOwned);
    closeOwned();
  }
}
