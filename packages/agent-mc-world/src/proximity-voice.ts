import {attachProximityVoice as attach,inspectVoiceWav as inspect} from '../core/proximity-voice.mjs';
export interface ProximityVoiceBot {
 _client:{state:string;write(name:string,value:unknown):void;on(name:string,fn:(value:any)=>void):unknown;off(name:string,fn:(value:any)=>void):unknown};
 on(name:string,fn:()=>void):unknown;once(name:string,fn:()=>void):unknown;off(name:string,fn:()=>void):unknown;
}
export interface NearbyVoiceHearing {type:'nearby_voice';speaker:string;speakerUuid:string;utteranceId:string;text:string}
export interface ProximityVoiceResult {type?:'voice_result';requestId:string;state:'uploading'|'queued'|'playing'|'sent'|'failed'|'cancelled'|'unknown'|'not_found'|'subscribed';reason?:string;lastState?:string|null}
export interface ProximityVoiceClient {
 say(text:string,options?:{requestId?:string;voice?:string}):Promise<ProximityVoiceResult>;
 upload(wav:Buffer,options?:{requestId?:string;signal?:AbortSignal}):Promise<ProximityVoiceResult>;
 status(requestId:string):Promise<ProximityVoiceResult>;close():void;
}
export interface ProximityVoiceOptions {onHearing?:(row:NearbyVoiceHearing)=>void;onResult?:(row:ProximityVoiceResult)=>void;isAuthenticated?:()=>boolean;seenUtterances?:Set<string>;timeoutMs?:number}
export const attachProximityVoice:(bot:ProximityVoiceBot,options?:ProximityVoiceOptions)=>ProximityVoiceClient=attach;
export const inspectVoiceWav:(wav:Buffer)=>{format:number;channels:number;sampleRate:number;bits:number;durationMs:number;bytes:number;samples:number}=inspect;
