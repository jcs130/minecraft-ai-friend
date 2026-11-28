import { BOT_METHODS, type BotMethod } from './method-capabilities.ts';

// JSON argument names for the existing public program primitives. Models may also pass
// {args:[...]} in native argument order. Never turn user input into JavaScript source.
const parameters: Record<BotMethod | 'chat', readonly string[]> = {
  read:['field'], blockAt:['point','extraInfos'], findBlocks:['options'], findBlock:['options'],
  canSeeBlock:['block'], canDigBlock:['block'], digTime:['block'], 'inventory.items':[],
  getControlState:['control'], setQuickBarSlot:['slot'], look:['yaw','pitch','force'], lookAt:['point','force'],
  setControlState:['control','state'], clearControlStates:[], waitForTicks:['ticks'],
  'pathfinder.goto':['goal'], dig:['block','forceLook','digFace'], stopDigging:[], placeBlock:['referenceBlock','faceVector'],
  equip:['item','destination'], unequip:['destination'], activateBlock:['block','direction','cursorPos'],
  activateItem:['offHand'], deactivateItem:[], elytraFly:[], mount:['entity'], dismount:[],
  moveVehicle:['left','forward','ticks'], chat:['message'],
};
const methods = new Map<string, keyof typeof parameters>();
for (const name of [...BOT_METHODS,'chat'] as const) {
  methods.set(name,name);
  methods.set(name.replaceAll('.','_'),name);
  methods.set(name.replace(/[A-Z]/g, c=>'_'+c.toLowerCase()).replaceAll('.','_'),name);
}
const optionalCount:Partial<Record<keyof typeof parameters,number>> = {
  blockAt:1, equip:1, look:1, lookAt:1, dig:2, activateBlock:2, activateItem:1, moveVehicle:1,
};
function methodOf(name:string){
  const match=/^(?:bot|mineflayer)[._](.+)$/.exec(name);
  return match ? methods.get(match[1]!) : undefined;
}
function target(method:keyof typeof parameters,prefix:string){
  return prefix+'_'+(method==='inventory.items'?'bag':method==='chat'?'do':'script');
}
export function mineflayerCallHelp(name:string,prefix='mc') {
  const method=methodOf(name);
  if(method)return {method:'bot.'+method,canonicalTool:target(method,prefix),argumentOrder:parameters[method],
    requiredArguments:parameters[method].length-(optionalCount[method]??0),
    ...(method==='inventory.items'?{result:'Slot summary. For native item stacks use the script tool with native:{name:"inventory.items",args:[]}.'}:{})};
}

/** Map a native tool call to a canonical grant before authorization, validation and journaling. */
export function resolveMineflayerCall(name:string, input:Record<string,unknown>, prefix='mc'):
  {name:string;args:Record<string,unknown>} | undefined {
  const method=methodOf(name);
  if(!method)return;
  if(!input || typeof input!=='object' || Array.isArray(input))throw Error('Mineflayer calls require an argument object.');
  const keys=parameters[method];
  let argv:unknown[];
  if(Object.hasOwn(input,'args')){
    if(Object.keys(input).length!==1 || !Array.isArray(input.args) || input.args.length>keys.length)
      throw Error('Use only {args:[...]} with the native argument order for bot.'+method+'.');
    argv=input.args;
  }else{
    if(Object.keys(input).some(key=>!keys.includes(key)))throw Error('Unexpected bot.'+method+' argument. Expected '+keys.join(', ')+' or {args:[...]}.');
    let last=keys.length-1;
    while(last>=0 && !Object.hasOwn(input,keys[last]!))last--;
    if(keys.slice(0,last+1).some(key=>!Object.hasOwn(input,key)))throw Error('Missing an earlier positional argument for bot.'+method+'.');
    argv=keys.slice(0,last+1).map(key=>input[key]);
  }
  if(argv.length<keys.length-(optionalCount[method]??0))throw Error('Missing bot.'+method+' arguments: '+keys.join(', ')+'.');
  const canonical=target(method,prefix);
  if(method==='inventory.items')return {name:canonical,args:{detail:'slots'}};
  if(method==='chat'){
    if(typeof argv[0]!=='string'||!argv[0].trim())throw Error('bot.chat requires a nonempty message.');
    return {name:canonical,args:{steps:[{skill:'chat',text:argv[0]}]}};
  }
  return {name:canonical,args:{native:{name:method,args:argv},waitMs:1000}};
}

export interface NativeInvocation {
  name: BotMethod;
  args: unknown[];
}

// The method list is discoverable through api:index and depends on the connected body.
export const NATIVE_INVOCATION_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1 }, args: { type: 'array', items: {} } },
  required: ['name', 'args'],
  additionalProperties: false,
};

export function nativeInvocation(input: Record<string, unknown>): NativeInvocation | undefined {
  if (input.native === undefined) return;
  const options = ['native', 'waitMs', 'durationMs', 'name', 'language'];
  if (Object.keys(input).some(key => !options.includes(key)) ||
      (input.language !== undefined && input.language !== 'javascript')) {
    throw new Error('Use native on its own, optionally with name, waitMs or durationMs.');
  }

  const call = input.native as Partial<NativeInvocation> | null;
  if (!call || typeof call !== 'object' || !call.name || !BOT_METHODS.includes(call.name) ||
      !Array.isArray(call.args) || Object.keys(call).some(key => key !== 'name' && key !== 'args')) {
    throw new Error('Expected native:{name,args:[...]} with an available public method.');
  }
  const max = parameters[call.name].length;
  const min = max - (optionalCount[call.name] ?? 0);
  if (call.args.length < min || call.args.length > max) {
    throw new Error('Invalid native argument count for ' + call.name + ': expected ' + min + '..' + max + '.');
  }
  return { name: call.name, args: call.args };
}

/** Historical single-call identity used only for run hashes and persisted SDK request receipts. */
export function nativeCallSource(name: BotMethod): string {
  return 'return await bot.' + name + '(...params.args)';
}
