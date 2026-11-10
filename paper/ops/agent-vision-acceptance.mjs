// Finite read-only acceptance sampling. Does not install, restart, move, or respawn players.
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {command} from './rcon-client.mjs';

export function parseMspt(raw){
 const text=raw.replace(/§[0-9a-fk-or]/gi,'');
 if(!/avg.*min.*max/i.test(text)||!/last 5s, 10s, 1m/.test(text))throw Error('MSPT_FORMAT_UNKNOWN');
 const numbers=[...text.matchAll(/\d+\.\d+/g)].map(x=>Number(x[0]));
 if(numbers.length!==9||numbers.some(x=>!Number.isFinite(x)))throw Error('MSPT_VALUES_UNKNOWN');
 return {fiveSeconds:{avg:numbers[0],min:numbers[1],max:numbers[2]},tenSeconds:{avg:numbers[3],min:numbers[4],max:numbers[5]},minute:{avg:numbers[6],min:numbers[7],max:numbers[8]}};
}
export function parseVision(raw){
 const start=raw.indexOf('MC_VISION ');if(start<0)throw Error('VISION_STATUS_UNKNOWN');
 const data=JSON.parse(raw.slice(start+'MC_VISION '.length).trim());
 if(typeof data.enabled!=='boolean'||!Number.isSafeInteger(data.tick)||data.tick<0)throw Error('VISION_STATUS_INCOMPLETE');
 return {enabled:data.enabled,tick:data.tick,platform:data.platform,viewers:data.viewers,checks:data.checks,deferred:data.deferred,maxTickMicros:data.maxTickMicros};
}
export function accumulate(previous,sample){
 const out=structuredClone(previous??{samples:0,errors:0,restarts:0,coverageGaps:0,disabledSamples:0,peakMspt:0,sumWindowAverages:0});
 if(!sample.ok){out.errors++;out.lastFailureAt=sample.at;out.continuousObservation24h=false;out.accepted24h=false;return out;}
 if(out.lastTick!==undefined&&sample.vision.tick<out.lastTick){out.restarts++;out.epochStartedAt=sample.at;}
 if(out.lastGoodAt!==undefined&&sample.at-out.lastGoodAt>60_000)out.coverageGaps++;
 out.epochStartedAt??=sample.at;out.lastGoodAt=sample.at;out.lastTick=sample.vision.tick;out.samples++;
 if(!sample.vision.enabled)out.disabledSamples++;
 out.peakMspt=Math.max(out.peakMspt,sample.mspt.minute.max);
 out.sumWindowAverages+=sample.mspt.fiveSeconds.avg;
 out.meanObservedFiveSecondWindowMspt=out.sumWindowAverages/out.samples;
 out.observedMs=sample.at-out.epochStartedAt;
 out.continuousObservation24h=out.observedMs>=86_400_000&&out.errors===0&&out.restarts===0&&out.coverageGaps===0&&out.disabledSamples===0;
 // A global tick peak is not evidence that this plugin caused it.
 out.performanceTargetObserved=out.meanObservedFiveSecondWindowMspt>=12&&out.meanObservedFiveSecondWindowMspt<=15&&out.peakMspt<69;
 out.accepted24h=false;out.pendingEvidence=['archive-backed NPE audit','actual mixed-scene evidence'];
 return out;
}
async function main(){
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--output'||args[2]!=='--seconds')throw Error('Use --output <fresh private directory> --seconds <1..86400>');
 const out=resolve(args[1]),seconds=Number(args[3]);if(!Number.isSafeInteger(seconds)||seconds<1||seconds>86400)throw Error('DURATION_INVALID');
 await mkdir(out,{recursive:false});
 const startedAt=Date.now(),end=startedAt+seconds*1000;let summary=null;
 await writeFile(resolve(out,'run.json'),JSON.stringify({startedAt:new Date(startedAt).toISOString(),seconds,queries:['agentvision status','mspt'],productionActions:false})+'\n');
 do{
  const at=Date.now();let sample;
  try{sample={at,ok:true,vision:parseVision(await command('agentvision status',8000)),mspt:parseMspt(await command('mspt',8000))};}
  catch(error){sample={at,ok:false,error:String(error).slice(0,300)};}
  summary=accumulate(summary,sample);summary.startedAt=new Date(startedAt).toISOString();summary.observedAt=new Date().toISOString();summary.finished=false;
  await appendFile(resolve(out,'samples.jsonl'),JSON.stringify(sample)+'\n');
  await writeFile(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  if(Date.now()>=end)break;await sleep(Math.min(5000,Math.max(0,end-Date.now())));
 }while(true);
 summary.finished=true;await writeFile(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify({output:out,...summary}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(String(error));process.exitCode=1;});
