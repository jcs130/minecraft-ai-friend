// Bounded transport context, not another model loop or a keyword classifier.
export function createGoddessDialogueState({now=Date.now,maxPeers=256}={}) {
  const peers=new Map(),historyMs=15*60*1000,duplicateMs=120000,noticeMs=60000;
  const normalized=text=>String(text).replace(/\s+/g,' ').trim();
  function peer(player) {
    const key=String(player).toLowerCase(),time=now();
    for(const [name,value] of peers)if(!value.pending&&time-value.touchedAt>=historyMs)peers.delete(name);
    if(!peers.has(key)) {
      if(peers.size>=maxPeers) {
        const oldest=[...peers].filter(([,v])=>!v.pending).sort((a,b)=>a[1].touchedAt-b[1].touchedAt)[0];
        if(!oldest)throw Error('Dialogue capacity unavailable');
        peers.delete(oldest[0]);
      }
      peers.set(key,{touchedAt:time});
    }
    const value=peers.get(key);value.touchedAt=time;return value;
  }
  return {
    inspect(player,text) {
      const value=peer(player),same=value.input===normalized(text);
      if(value.pending)return {ok:false,reason:'inflight',quiet:same};
      if(same&&now()-value.acceptedAt<duplicateMs)return {ok:false,reason:'duplicate',quiet:true};
      return {ok:true};
    },
    begin(player,text,request) {
      const value=peer(player);
      if(value.pending)throw Error('Peer dialogue already in flight');
      value.pending=request;value.input=normalized(text);value.acceptedAt=now();
    },
    context(player) {
      const value=peer(player);
      return {lastReply:value.lastReply??null,lastDecision:value.lastDecision??null,
        replyAgeMs:value.repliedAt==null?null:Math.max(0,now()-value.repliedAt)};
    },
    complete(player,request,message,{delivered=true}={}) {
      const value=peer(player);
      if(value.pending!==request)throw Error('Unmatched original dialogue request');
      value.pending=null;
      value.lastDecision=message===null?'silent':delivered?'reply':'undelivered';
      if(typeof message==='string'&&delivered){value.lastReply=message;value.repliedAt=now();}
    },
    fail(player,request) {
      const value=peer(player);
      if(value.pending===request){value.pending=null;value.lastDecision='unknown';}
    },
    allowNotice(player) {
      const value=peer(player),time=now();
      if(value.noticeAt!=null&&time-value.noticeAt<noticeMs)return false;
      value.noticeAt=time;return true;
    },
  };
}
