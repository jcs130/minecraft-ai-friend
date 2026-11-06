import {digest,fail} from './protocol.mjs';
import {publicDialogueText} from '../../agent-portal/src/public-dialogue.mjs';

// Reuse the existing CPU ASR / TTS service. Never accept an endpoint, voice ID
// or upstream credential from the browser. PCM WAV also works on mobile Safari.
export function localConversationVoice({endpoint,token,voiceFor,fetcher=fetch}) {
  const url=new URL(endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Voice endpoint must be explicit loopback origin');
  if(typeof token!=='string'||token.length<32)throw new Error('Dedicated voice transport token required');
  const uuid=value=>{const hex=digest(value);return`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;};
  async function request(path,body,type,actor,id) {
    let response;
    try{response=await fetcher(new URL(path,url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(95000),headers:{
      authorization:`Bearer ${token}`,'content-type':type,'x-actor':uuid(actor),'x-request-id':uuid({actor,id})},body});}
    catch{throw fail('VOICE_RESULT_UNKNOWN','语音服务暂未返回结果，请保留这条录音；不要连续重复提交。',503);}
    if(!response.ok)throw fail('VOICE_BACKEND_UNAVAILABLE','语音服务未完成处理，可先使用文字交流。',503);
    const parts=[];let size=0;
    for await(const part of response.body){size+=part.length;if(size>4*1024*1024)throw fail('VOICE_RESPONSE_INVALID','语音响应超出限制。',503);parts.push(part);}
    return Buffer.concat(parts);
  }
  return {
    async transcribe({actor,id,audio}) {
      if(typeof audio!=='string'||audio.length>4*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(audio))throw fail('VOICE_FORMAT','请录制不超过 30 秒的 PCM WAV。',400);
      const bytes=Buffer.from(audio,'base64');
      if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw fail('VOICE_FORMAT','录音需为 PCM WAV，不能把 WebM 或 MP3 当作 WAV。',400);
      let result;try{result=JSON.parse((await request('/v1/asr',bytes,'audio/wav',actor,id)).toString());}
      catch(error){if(error.code)throw error;throw fail('VOICE_RESPONSE_INVALID','语音识别响应不完整。',503);}
      if(result.state==='silence')return{text:'',state:'silence'};
      const text=publicDialogueText(result.text,1200);
      if(!text)throw fail('VOICE_TEXT_INVALID','没有识别到可发送的对话，请重录或使用文字；不要朗读凭据。',400);
      return{text,state:'transcribed',requiresConfirmation:true};
    },
    async speak({role,actor,id,text}) {
      const clean=publicDialogueText(text,1200);if(!clean)throw fail('VOICE_TEXT_INVALID','这条回复不可朗读。',400);
      const voice=voiceFor(role);if(!voice)throw fail('VOICE_NOT_CONFIGURED','该角色尚未配置音色，可阅读文字回复。',503);
      const bytes=await request('/v1/tts',JSON.stringify({text:clean,voice,actor:uuid(actor),requestId:uuid({actor,id})}),'application/json',actor,id);
      return{mime:'audio/wav',audio:bytes.toString('base64')};
    }
  };
}
