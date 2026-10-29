import {randomUUID, createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {attachProximityVoice, inspectVoiceWav, type ProximityVoiceBot, type ProximityVoiceClient,
  type ProximityVoiceResult, type NearbyVoiceHearing} from '../src/proximity-voice.ts';
import type {ToolDef, ToolOutcome} from './support/host-contract.ts';

export interface ProximityVoiceConfig {
  enabled: boolean;
  /** Explicit audio-artifact producer. This is not a TTS provider or credentials endpoint. */
  audioProducerUrl: string;
  outputMode: 'game-only' | 'live-and-game';
}
export interface ProximityVoiceContext {
  bot: ProximityVoiceBot;
  generation: string;
  world: {key: string | null; source?: string; revision?: number; observedAt?: string | null};
  /** Re-read authentication AND the native world identity during upload. */
  stillCurrent(): boolean;
  disableAutoSpeech(): void;
}
export interface GameVoiceReceipt {
  requestId: string; fingerprint: string; source: 'text' | 'artifact'; createdAt: string;
  world: ProximityVoiceContext['world']; generation: string;
  outputMode: ProximityVoiceConfig['outputMode'];
  game: {state: string; reason?: string};
  broadcast: {requested: boolean; state: string; actionId?: string; reason?: string; updatedAt?:number};
  audioProducerUrl?: string;
  audioSha256?: string; generationComplete: boolean | null;
  /** Authored synthesis input, not a transcript or proof of complete spoken words. */
  requestedText?:string;
  goal_completed: false; recipientHeard: 'unknown';
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terminal = new Set(['sent','failed','cancelled','unknown','not_found']);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const PROXIMITY_VOICE_TOOL: Omit<ToolDef,'handler'> = {
  name: 'mc_voice', tags: ['speak'],
  description: 'Optional speech to nearby Minecraft players, using the existing authenticated game connection. '
    + 'Not audience commentary, private chat or shout. {} shows availability and output mode. '
    + '{action:"speak",text,requestId?} synthesizes ONE full line through the configured audio producer; '
    + '{action:"upload",audio_handle,requestId?} uploads a PCM16 WAV blob (0.1–30s, max4MiB). '
    + 'Game-only mode sends only game audio; live-and-game mirrors the SAME audio to the livestream, whose own queue still applies. '
    + 'Ordinary audience commentary stays in the presentation World, never forwarded here. No automatic dubbing of game text. '
    + 'Returns immediately with separate game/broadcast receipts; {action:"status",requestId} checks the SAME request after timeout. '
    + 'Never change ID to replay an unknown effect. sent means server frames sent, not heard or full text generated. '
    + 'Nearby voice input retains real speaker UUID and utterance ID. Captions, nearby text, shout and private chat remain separate.',
  parameters: {type:'object',additionalProperties:false,properties:{
    action:{type:'string',enum:['speak','upload','status']}, text:{type:'string',minLength:1,maxLength:2000},
    audio_handle:{type:'string',minLength:1,maxLength:300},requestId:{type:'string',format:'uuid'},
  }},
};

/** Separate I/O lane. Never acquires, pauses or cancels the game body or a host turn. */
export class ProximityVoiceLane {
  private client: ProximityVoiceClient | null = null;
  private context: ProximityVoiceContext | null = null;
  private connectionKey = '';
  private readonly seen = new Set<string>();
  private readonly receipts = new Map<string, GameVoiceReceipt>();
  private active: {requestId:string;abort:AbortController} | null = null;
  private job: Promise<void> | null = null;
  private loaded = false;
  private loading?: Promise<void>;
  private saveTail: Promise<void> = Promise.resolve();
  private autoSpeechOffRequested = false;
  private connectionError: string | null = null;
  private serverAcknowledged = false;
  private readonly broadcastReads = new Set<string>();
  constructor(private readonly options: {
    config(): ProximityVoiceConfig;
    context(): ProximityVoiceContext | null;
    blob(handle:string): {bytes:Uint8Array;mime:string} | null;
    hearing(row:NearbyVoiceHearing,world:ProximityVoiceContext['world']):void;
    changed(receipt:GameVoiceReceipt):void;
    file?: string | null;
    timeoutMs?: number;
  }) {}
  private async load() {
    if(this.loaded)return;
    if(this.loading)return this.loading;
    this.loading=(async()=>{
      if(this.options.file)try {
        const rows=JSON.parse(await readFile(this.options.file,'utf8'));
        if(rows.schema!=='agent-mc/proximity-voice/v1'||!Array.isArray(rows.requests))throw Error('VOICE_LEDGER_INVALID');
        for(const row of rows.requests.slice(-128)) {
          if(!uuid.test(row.requestId)||typeof row.fingerprint!=='string'||!row.game||!row.broadcast)throw Error('VOICE_LEDGER_INVALID');
          if(!terminal.has(row.game.state))row.game={state:'unknown',reason:'Process changed; query same request, never replay'};
          if(row.broadcast.requested&&['pending','submitting'].includes(row.broadcast.state))row.broadcast={requested:true,state:'unknown',reason:'Process changed; playback not verified'};
          this.receipts.set(row.requestId,row);
        }
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      this.loaded=true;
    })();
    try {await this.loading;} finally {this.loading=undefined;}
  }
  private save() {
    if(!this.options.file)return Promise.resolve();
    const file=this.options.file, body=JSON.stringify({schema:'agent-mc/proximity-voice/v1',requests:[...this.receipts.values()].slice(-128)});
    const job=this.saveTail.catch(()=>{}).then(async()=>{await mkdir(dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,body);await rename(temp,file);});
    this.saveTail=job;return job;
  }
  private publish(receipt:GameVoiceReceipt) {
    // Persist failures are observable, never silently treated as durable deduplication.
    void this.save().catch(error=>{receipt.game={state:'unknown',reason:'Voice ledger persistence failed: '+String(error).slice(0,160)};this.options.changed(structuredClone(receipt));});
    this.options.changed(structuredClone(receipt));
  }
  sync() {
    const context=this.options.config().enabled?this.options.context():null;
    const key=context?JSON.stringify([context.generation,context.world.key,context.world.revision]):'';
    if(key===this.connectionKey&&this.client&&context?.stillCurrent())return;
    this.disconnect('Game connection or native world changed; query original request');
    if(!context||!context.world.key||!context.stillCurrent())return;
    this.context=context;this.connectionKey=key;
    try {this.client=attachProximityVoice(context.bot,{timeoutMs:this.options.timeoutMs,
      isAuthenticated:()=>context.stillCurrent()&&this.context===context,
      seenUtterances:this.seen,
      onHearing:row=>{if(context.stillCurrent())this.options.hearing(row,structuredClone(context.world));},
      onResult:row=>this.serverResult(row,true),
    });
    context.disableAutoSpeech();this.autoSpeechOffRequested=true;this.connectionError=null;
    }catch(error){this.disconnect('Voice attachment failed');this.connectionError=String(error).slice(0,240);}
  }
  disconnect(reason='Game voice stopped') {
    this.connectionKey='';this.context=null;this.autoSpeechOffRequested=false;this.serverAcknowledged=false;
    this.active?.abort.abort(Error(reason));this.client?.close();this.client=null;
  }
  async stop() {this.disconnect();await this.job;await this.saveTail;}
  private serverResult(result:ProximityVoiceResult,attested=false) {
    if(attested)this.serverAcknowledged=true;
    const receipt=this.receipts.get(result.requestId);if(!receipt)return;
    // Server status is stronger than a local timeout, but a nonterminal reply
    // cannot erase a previously observed terminal transmission outcome.
    if(['sent','failed','cancelled'].includes(receipt.game.state)&&!terminal.has(result.state))return;
    receipt.game={state:result.state,...(result.reason?{reason:result.reason}:{})};this.publish(receipt);
  }
  private outcome(row:GameVoiceReceipt):ToolOutcome {return {text:JSON.stringify(row),data:structuredClone(row) as unknown as Record<string,unknown>};}
  async call(args:Record<string,unknown>):Promise<ToolOutcome> {
    try {
      await this.load();this.sync();
      const action=args.action??'status';
      if(!['status','speak','upload'].includes(String(action)))throw Error('VOICE_ACTION_INVALID');
      if(action==='status') {
        if(args.text!==undefined||args.audio_handle!==undefined)throw Error('VOICE_STATUS_NO_NEW_CONTENT');
        if(args.requestId!==undefined){if(typeof args.requestId!=='string'||!uuid.test(args.requestId))throw Error('VOICE_REQUEST_UUID_REQUIRED');
          const row=this.receipts.get(args.requestId);if(!row)throw Error('VOICE_REQUEST_NOT_IN_THIS_CLIENT_LEDGER');
          if(row.broadcast.actionId&&row.audioProducerUrl&&!['completed','failed','cancelled'].includes(row.broadcast.state))void this.refreshBroadcast(row);
          if(this.client&&!this.active&&['unknown','queued','playing','uploading'].includes(row.game.state)) {
            // Read-only status runs asynchronously too; it never re-uploads audio.
            const client=this.client;this.active={requestId:row.requestId,abort:new AbortController()};
            this.job=client.status(row.requestId).then(result=>this.serverResult(result),()=>{}).finally(()=>{if(this.active?.requestId===row.requestId)this.active=null;});
          }return this.outcome(row);
        }
        return {text:JSON.stringify({enabled:this.options.config().enabled,connected:!!this.client,
          world:this.context?.world??null,outputMode:this.options.config().outputMode,connectionError:this.connectionError,serverAcknowledged:this.serverAcknowledged,
          audioProducerConfigured:!!this.options.config().audioProducerUrl,autoSpeechOff:'requested; server acknowledgement not verified',
          autoSpeechOffRequested:this.autoSpeechOffRequested,activeRequest:this.active?.requestId??null,
          recent:[...this.receipts.values()].slice(-6),audience:'nearby game players; livestream mirror only in live-and-game mode'})};
      }
      if(!this.client||!this.context)throw Error('VOICE_AUTHENTICATED_PLAY_AND_NATIVE_WORLD_REQUIRED');
      const requestId=args.requestId??randomUUID();if(typeof requestId!=='string'||!uuid.test(requestId))throw Error('VOICE_REQUEST_UUID_REQUIRED');
      let bytes:Buffer|undefined;
      if(action==='speak') {if(typeof args.text!=='string'||!args.text.trim()||args.text.length>2000||args.audio_handle!==undefined)throw Error('VOICE_SPEAK_TEXT_REQUIRED');}
      else {if(typeof args.audio_handle!=='string'||args.text!==undefined)throw Error('VOICE_AUDIO_HANDLE_REQUIRED');
        const blob=this.options.blob(args.audio_handle);if(!blob||!/^audio\/(wav|x-wav|wave)$/.test(blob.mime))throw Error('VOICE_WAV_BLOB_REQUIRED');
        bytes=Buffer.from(blob.bytes);inspectVoiceWav(bytes);
      }
      const fingerprint=hash(JSON.stringify([action,action==='speak'?args.text:hash(bytes!)]));
      const existing=this.receipts.get(requestId);if(existing){if(existing.fingerprint!==fingerprint)throw Error('VOICE_REQUEST_ID_REUSED_WITH_DIFFERENT_CONTENT');return this.outcome(existing);}
      if(this.active)throw Error('VOICE_BUSY_READ_EXISTING_REQUEST_'+this.active.requestId);
      const config=structuredClone(this.options.config());
      if(!['game-only','live-and-game'].includes(config.outputMode))throw Error('VOICE_OUTPUT_MODE_INVALID');
      if(action==='speak'||config.outputMode==='live-and-game')this.producer(config.audioProducerUrl);
      const receipt:GameVoiceReceipt={requestId,fingerprint,source:action==='speak'?'text':'artifact',createdAt:new Date().toISOString(),
        world:structuredClone(this.context.world),generation:this.context.generation,outputMode:config.outputMode,
        game:{state:'accepted'},broadcast:{requested:config.outputMode==='live-and-game',state:config.outputMode==='live-and-game'?'pending':'not-requested'},
        ...(config.audioProducerUrl?{audioProducerUrl:this.producer(config.audioProducerUrl)}:{}),
        ...(action==='speak'?{requestedText:args.text as string}:{}),
        generationComplete:null,goal_completed:false,recipientHeard:'unknown'};
      this.receipts.set(requestId,receipt);while(this.receipts.size>128)this.receipts.delete(this.receipts.keys().next().value!);
      // Admission is durable BEFORE any synthesis, upload or broadcast effect.
      const context=this.context,client=this.client,abort=new AbortController();this.active={requestId,abort};
      try {await this.save();}catch(error){this.active=null;this.receipts.delete(requestId);throw error;}
      this.job=this.run(receipt,config,context,client,abort,args.text as string|undefined,bytes)
        .catch(error=>{this.connectionError=String(error).slice(0,240);})
        .finally(()=>{if(this.active?.requestId===requestId)this.active=null;});
      return this.outcome(receipt);
    }catch(error){return {text:String(error),failed:true,data:{goal_completed:false}};}
  }
  private producer(value:string) {
    const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('VOICE_AUDIO_PRODUCER_URL_INVALID');
    return url.href.replace(/\/$/,'');
  }
  private async run(receipt:GameVoiceReceipt,config:ProximityVoiceConfig,context:ProximityVoiceContext,client:ProximityVoiceClient,abort:AbortController,text?:string,bytes?:Buffer) {
    const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(180000)]);
    const current=()=>{signal.throwIfAborted();if(this.context!==context||!context.stillCurrent())throw Error('VOICE_WORLD_CHANGED_DO_NOT_REPLAY');};
    let uploadStarted=false;
    try {
      if(!bytes){receipt.game={state:'synthesizing'};this.publish(receipt);
        const response=await fetch(this.producer(config.audioProducerUrl)+'/api/voice-artifacts',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:receipt.requestId,text}),signal,redirect:'error'});
        if(!response.ok||!response.body)throw Error('VOICE_ARTIFACT_HTTP_'+response.status);
        let size=0;const chunks:Buffer[]=[],reader=response.body.getReader();
        try {for(;;){const {done,value}=await reader.read();if(done)break;
          size+=value.length;if(size>4*1024*1024){abort.abort();throw Error('VOICE_AUDIO_MAX_4_MIB');}chunks.push(Buffer.from(value));}}
        finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
        bytes=Buffer.concat(chunks);const completion=response.headers.get('x-voice-generation-complete');
        receipt.generationComplete=completion==='true'?true:completion==='false'?false:null;
        if(receipt.generationComplete===false)throw Error('VOICE_GENERATION_KNOWN_INCOMPLETE_NOT_UPLOADED');
      }
      current();inspectVoiceWav(bytes);receipt.audioSha256=hash(bytes);
      current();receipt.game={state:'uploading'};uploadStarted=true;this.publish(receipt);
      const game=client.upload(bytes,{requestId:receipt.requestId,signal});
      const broadcast=receipt.broadcast.requested?this.mirror(receipt,config,signal,text===undefined?bytes:undefined):Promise.resolve();
      const [result]=await Promise.all([game,broadcast]);this.serverResult(result);
    }catch(error){receipt.game={state:uploadStarted||abort.signal.aborted?'unknown':'failed',reason:String(error).slice(0,240)};
      if(receipt.broadcast.state==='pending')receipt.broadcast={...receipt.broadcast,state:'not-submitted',reason:'Game preparation failed'};
      this.publish(receipt);
    }
  }
  private async mirror(receipt:GameVoiceReceipt,config:ProximityVoiceConfig,parent:AbortSignal,bytes?:Buffer) {
    const signal=AbortSignal.any([parent,AbortSignal.timeout(15000)]);let mayHaveSubmitted=false;
    receipt.broadcast={...receipt.broadcast,state:'submitting'};this.publish(receipt);
    try {
      // Import only existing artifacts. Its failure must not block the independent game upload.
      if(bytes){const imported=await fetch(this.producer(config.audioProducerUrl)+'/api/voice-artifacts/'+receipt.requestId,{
        method:'PUT',headers:{'Content-Type':'audio/wav'},body:new Uint8Array(bytes),signal,redirect:'error'});
        if(!imported.ok)throw Error('VOICE_ARTIFACT_IMPORT_HTTP_'+imported.status);}
      mayHaveSubmitted=true;
      const response=await fetch(this.producer(config.audioProducerUrl)+'/api/voice-artifacts/'+receipt.requestId+'/broadcast',{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal,redirect:'error'});
      if(!response.ok){mayHaveSubmitted=false;throw Error('VOICE_BROADCAST_HTTP_'+response.status);}
      const value=await response.json() as {accepted?:boolean;id?:string;status?:string;reason?:string};
      receipt.broadcast={requested:true,state:value.accepted?'accepted':String(value.status??'not-admitted'),
        ...(typeof value.id==='string'?{actionId:value.id}:{}),...(typeof value.reason==='string'?{reason:value.reason.slice(0,200)}:{})};
    }catch(error){receipt.broadcast={requested:true,state:mayHaveSubmitted?'unknown':'failed',reason:String(error).slice(0,240)};}
    this.publish(receipt);
  }
  private async refreshBroadcast(receipt:GameVoiceReceipt) {
    if(this.broadcastReads.has(receipt.requestId))return;
    this.broadcastReads.add(receipt.requestId);
    try {
      const response=await fetch(this.producer(receipt.audioProducerUrl!)+'/api/actions/'+encodeURIComponent(receipt.broadcast.actionId!),{
        signal:AbortSignal.timeout(5000),redirect:'error'});
      if(!response.ok)return;
      const row=await response.json() as {id?:string;status?:string;updatedAt?:number};
      if(row.id!==receipt.broadcast.actionId||!['queued','playing','completed','failed','cancelled'].includes(row.status??''))return;
      receipt.broadcast={...receipt.broadcast,state:row.status!,...(typeof row.updatedAt==='number'?{updatedAt:row.updatedAt}:{})};this.publish(receipt);
    }catch{/* Preserve the previous dated admission; a failed read never establishes playback. */}
    finally{this.broadcastReads.delete(receipt.requestId);}
  }
}
