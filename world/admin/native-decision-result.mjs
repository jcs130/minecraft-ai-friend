// Read existing native tasks only. Never submit inference or forward raw native messages.
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:null;
const list=value=>Array.isArray(value)?value:[];
const states=new Set(['pending','queued','running','finished','completed','failed','cancelled','canceled']);
const state=value=>states.has(value)?value:'unknown';
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const MAX_BYTES=2*1024*1024;

export async function readNativeDecisionResult(binding,{baseUrl,fetchImpl=fetch}={}) {
 const turnId=identifier(binding?.turnId),taskId=identifier(binding?.taskId),sessionId=identifier(binding?.sessionId);
 const result={turnId,taskId,availability:'unbound',status:'unknown',finalText:null,tools:[],checkedAt:Date.now(),completedAt:null};
 if(!turnId||!taskId||!sessionId)return result;
 if(!baseUrl)return {...result,availability:'not_configured'};
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),2500);
 let reader;
 try{
  const base=new URL(baseUrl);
  if(base.protocol!=='http:'||!['qwenpaw','127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password||base.search||base.hash)throw Error('source');
  const url=base.href.replace(/\/$/,'')+'/console/chat/task/'+taskId;
  const response=await fetchImpl(url,{method:'GET',headers:{'X-Agent-Id':'qd-survivor'},redirect:'error',signal:abort.signal});
  if(!response.ok||Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('unavailable');
  reader=response.body.getReader();let size=0;const chunks=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw Error('too_large');chunks.push(value);}
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8')),native=payload.result;
  result.status=state(payload.status);
  // A pending task may have no output yet; any content must match the bound life/review session.
  if(!native)return {...result,availability:'available'};
  if(native.session_id!==sessionId)return {...result,availability:'session_mismatch',status:'unknown'};
  result.tools=list(native.output).filter(item=>item?.type==='plugin_call'&&item.role==='assistant').flatMap(item=>
   list(item.content).filter(c=>c?.type==='data'&&identifier(c.data?.name)).map(c=>({
    callId:identifier(c.data.call_id),name:identifier(c.data.name),status:state(item.status)
   }))).slice(-24);
  if(['finished','completed'].includes(result.status)&&native.status==='completed'){
   result.status='completed';result.completedAt=time(native.completed_at);
   // Use only the LAST final assistant message, including empty/sentinel failures.
   let answer='';
   for(const item of list(native.output))if(item?.type==='message'&&item.role==='assistant'&&item.status==='completed')
    answer=list(item.content).filter(c=>c?.type==='text'&&typeof c.text==='string').map(c=>c.text).join('\n').trim();
   if(answer&&answer.length<=6000&&!/^(Doom loop|Max iterations)/i.test(answer))result.finalText=answer;
  }
  return {...result,availability:'available'};
 }catch{return {...result,availability:'unavailable',status:'unknown',finalText:null,tools:[]};}
 finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});}
}
