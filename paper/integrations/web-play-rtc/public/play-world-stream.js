/** Same-origin parent only. Preserve the original native identity/registry/build
 * validator and SSE recovery. Switching waits for a fresh RTC identity packet. */
export function createPlayWorldStream(options,legacy,win=globalThis.window){
  let sse=null,unsubscribe=null,disposed=false,rtcActive=false;
  function startSse(){if(!disposed&&!sse)sse=legacy({...options,onMessage:m=>{if(!rtcActive)options.onMessage(m)}})}
  function lost(reason){
    unsubscribe?.();unsubscribe=null;rtcActive=false;
    if(!disposed){options.onUnavailable(reason);startSse()}
  }
  function attach(){
    if(disposed||unsubscribe)return;
    let bridge;try{if(win.parent===win||win.parent.location.origin!==win.location.origin)return;bridge=win.parent.QdPlayRtc}catch{return}
    if(!bridge?.status().ready)return;
    unsubscribe=bridge.subscribeWorld(message=>{
      if(disposed)return;
      if(!rtcActive){let value;try{value=JSON.parse(message.data)}catch{return}
        if(value.type!=='identity')return;
        rtcActive=true;sse?.close();sse=null;
      }
      options.onMessage(message);
    },lost);
  }
  startSse();attach();win?.addEventListener('qd-play-rtc-ready',attach);
  return {close(){if(disposed)return;disposed=true;sse?.close();unsubscribe?.();win?.removeEventListener('qd-play-rtc-ready',attach)},
    get readyState(){return disposed?2:rtcActive?1:sse?.readyState??0}};
}
