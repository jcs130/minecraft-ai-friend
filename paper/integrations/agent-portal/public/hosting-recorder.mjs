export function pcmWav(chunks,rate) {
  const count=chunks.reduce((sum,row)=>sum+row.length,0);
  if(!Number.isInteger(rate)||rate<8000||rate>96000||count<rate*.2||count>rate*30)throw Error('请录制 0.2–30 秒的语音。');
  const bytes=new Uint8Array(44+count*2),view=new DataView(bytes.buffer);
  const ascii=(offset,text)=>{for(let n=0;n<text.length;n++)bytes[offset+n]=text.charCodeAt(n);};
  ascii(0,'RIFF');view.setUint32(4,36+count*2,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,count*2,true);
  let index=44;for(const chunk of chunks)for(const sample of chunk){const s=Math.max(-1,Math.min(1,sample));view.setInt16(index,Math.round(s<0?s*32768:s*32767),true);index+=2;}
  return bytes;
}
export function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
export async function recordVoice(onLimit) {
  if(!navigator.mediaDevices?.getUserMedia||!window.AudioWorkletNode)throw Error('当前浏览器不支持录音，请使用文字交流。');
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
  let context,source,processor,timer,closed=false;const chunks=[];let samples=0;
  const close=async()=>{if(closed)return;closed=true;clearTimeout(timer);stream.getTracks().forEach(track=>track.stop());source?.disconnect();processor?.disconnect();await context?.close();};
  try {
    context=new AudioContext();await context.audioWorklet.addModule('/hosting-pcm-worklet.js');await context.resume();
    processor=new AudioWorkletNode(context,'hosted-pcm-recorder');source=context.createMediaStreamSource(stream);
    processor.port.onmessage=event=>{if(closed)return;const max=context.sampleRate*30-samples;if(max<=0)return;const row=event.data.subarray(0,max);chunks.push(row);samples+=row.length;};
    source.connect(processor);processor.connect(context.destination); // Worklet emits silence, never microphone feedback.
    timer=setTimeout(()=>onLimit(),29500);
    return{cancel:close,async stop(){
      await close();if(samples<context.sampleRate*.2)throw Error('录音太短，请说完一句话再结束。');
      const buffer=new AudioBuffer({length:samples,numberOfChannels:1,sampleRate:context.sampleRate});let offset=0;
      for(const row of chunks){buffer.copyToChannel(row,0,offset);offset+=row.length;}
      const resampler=new OfflineAudioContext(1,Math.ceil(samples*16000/context.sampleRate),16000),input=resampler.createBufferSource();
      input.buffer=buffer;input.connect(resampler.destination);input.start();const resampled=await resampler.startRendering();
      return base64(pcmWav([resampled.getChannelData(0)],16000));
    }};
  }catch(error){await close();throw error;}
}
