import type { Bot } from 'mineflayer';
export function callGameLibrary(input:{
  family:'world'|'skills';name:string;args:unknown[];bot:Bot;view:Bot;signal:AbortSignal;
  check:()=>void;native:(name:string,args:unknown[])=>Promise<unknown>;
  step:(action:unknown)=>Promise<string>;hostile:(bot:Bot,range:number)=>unknown;
  packBlock:(block:ReturnType<Bot['blockAt']>)=>unknown;
  cleanup:(cb:()=>void)=>void;
  taggedIngredients:(name:string)=>{slots:string[][];output:number}[]; taggedOutput:(name:string)=>number|null;
  escapeFrom:(point:{x:number;y:number;z:number},distance:number,entityId?:number)=>Promise<boolean>;
}): Promise<{value:unknown;notes:string[]}>;
