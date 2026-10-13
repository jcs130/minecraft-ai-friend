// An offline engine port. It creates no Mineflayer bot and opens no sockets.
export function createEngine() {
  let host,rounds=0,stopped=false;
  return {
    id:'minecraft',start:async h=>{host=h;host.pushDeferred({type:'fixture.deferred',render:()=>({text:'original deferred image',blobs:[{bytes:new Uint8Array([4,5,6]),mime:'image/png',fallbackText:'deferred'}]})},{trigger:'flush'});},stop:async()=>{stopped=true;},
    console:()=>({lamps:[],storage:[]}),envPromptVars:()=>({}),
    envPromptRuntimeVars:()=>({'minecraft.current_task':'offline fixture','minecraft.goals':''}),
    requestFacts:()=>({text:'',snapshotTypes:[],parts:[{key:'rounds',text:String(rounds)}]}),
    onTurnEnded:async()=>{rounds++;await host.pushEvent({ts:'now',source:'minecraft',type:'turn.ended',text:String(rounds)});},
    tools:()=>[{name:'mc_fixture',description:'Offline protocol fixture',parameters:{type:'object'},tags:['flow'],handler:async(args,ctx)=>{
      if(args.hold) {
        await host.pushEvent({ts:'now',source:'minecraft',type:'fixture.waiting',text:ctx.callId});
        await new Promise((resolve,reject)=>{ctx.signal.addEventListener('abort',()=>{
          void host.pushEvent({ts:'now',source:'minecraft',type:'fixture.cancelled',text:ctx.callId}).finally(()=>reject(new Error('cancelled')));
        },{once:true});});
      }
      if(stopped)throw new Error('stopped');
      ctx.queueExternalEvents([{cursor:8,type:'fixture.reply',ts:'now',source:'minecraft',origin:'external',text:'raw',trigger:'preempt'}]);
      return {text:JSON.stringify({turnId:ctx.turnId,round:ctx.round}),endsTurn:true,
        execution:{kind:'observation',id:'fixture:1',phase:'completed',terminal:true,goalCompleted:false},
        blobs:[{bytes:new Uint8Array([1,2,3]),mime:'application/octet-stream',fallbackText:'original bytes'}]};
    }}],
  };
}
