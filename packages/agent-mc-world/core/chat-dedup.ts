/** Suppress repeated player-facing sends only; commands and new conversations are independent. */
const states=new WeakMap<object,{window:()=>number;incoming:Map<string,number>;sent:Map<string,{at:number;epoch:number}>}>();
export function configureChatDedup(bot:object,window:()=>number):void {
  const state=states.get(bot);
  if(state) state.window=window; else states.set(bot,{window,incoming:new Map(),sent:new Map()});
}
export function noteChatInput(bot:object,sender:string,privateMessage:boolean):void {
  const state=states.get(bot);if(!state)return;
  const scope=privateMessage?'private:'+sender.toLowerCase():'public';
  state.incoming.set(scope,(state.incoming.get(scope)??0)+1);
}
export function sendDeduplicatedChat(bot:object,text:string,send:()=>void,now=Date.now()):{sent:boolean;previousAt?:number;windowMs?:number} {
  const state=states.get(bot),window=state?.window()??0;
  const value=text.trim();
  const privateMessage=/^\/(?:minecraft:)?(?:msg|tell|w)\s+(\w{1,16})\s+([\s\S]+)$/i.exec(value);
  if(!state || !Number.isFinite(window) || window<=0 || (value.startsWith('/')&&!privateMessage)) {send();return{sent:true};}
  const scope=privateMessage?'private:'+privateMessage[1]!.toLowerCase():'public';
  const key=JSON.stringify([scope,privateMessage?.[2]?.trim()??value]);
  for(const [k,old] of state.sent) if(now-old.at>=window) state.sent.delete(k);
  const previous=state.sent.get(key),epoch=state.incoming.get(scope)??0;
  if(previous && previous.epoch===epoch && now-previous.at<window) return{sent:false,previousAt:previous.at,windowMs:window};
  send();state.sent.set(key,{at:now,epoch});
  if(state.sent.size>256) state.sent.delete(state.sent.keys().next().value!);
  return{sent:true};
}
