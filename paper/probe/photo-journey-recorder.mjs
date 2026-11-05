// Opt-in observation hooks for an ISOLATED run. Never sends commands, creates a
// player, changes config, publishes a photo, or substitutes pixels/worker ACKs.
import {mkdirSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function createPhotoJourneyRecorder({directory,owner,gameAddress,evidenceKind}) {
  if(!path.isAbsolute(directory)||!uuid.test(owner)||!/^127\.0\.0\.1:\d+$/.test(gameAddress)
    ||!['real-client','synthetic-fixture'].includes(evidenceKind))throw Error('Explicit isolated loopback run and evidence kind required');
  if(existsSync(directory))throw Error('Use a fresh evidence directory; never overwrite a previous run');
  mkdirSync(directory,{recursive:true,mode:0o700});
  writeFileSync(path.join(directory,'run.json'),JSON.stringify({schema:'photo-journey/v1',owner,gameAddress,evidenceKind,at:Date.now()}),{mode:0o600});
  let sequence=0;
  const record=(kind,data)=>appendFileSync(path.join(directory,'events.jsonl'),JSON.stringify({sequence:++sequence,at:Date.now(),kind,data})+'\n',{mode:0o600});
  return {
    // Attach to the existing QA Agent connection; no substitute Agent or decision loop.
    attach(bot) {
      if(bot.entity?.uuid?.toLowerCase()!==owner.toLowerCase())throw Error('Agent UUID mismatch');
      const message=(text,position)=>{
        if(position!=='system')return;
        const match=/^MC_(COACH|PHOTO|PHOTO_RECORD) (\{.*\})$/.exec(text);if(!match)return;
        try{const row=JSON.parse(match[2]);
          if(match[1]==='COACH'&&row.type==='adventure_hint'&&row.recipient===owner)record('hint',row);
          // Authoritative photo receipts arrive on the plugin channel below.
        }catch{}
      };
      const payload=packet=>{
        if(packet.channel!=='mcagent:photo'||packet.data.length>16384)return;
        try{const row=JSON.parse(packet.data.toString('utf8'));if(row.status&&row.owner===owner)record('receipt',row);}catch{}
      };
      const end=()=>record('disconnect',{owner});
      bot.on('messagestr',message);bot.on('end',end);bot._client.on('custom_payload',payload);
      record('connected',{owner});
      return ()=>{bot.off('messagestr',message);bot.off('end',end);bot._client.off('custom_payload',payload);};
    },
    // Call from the existing model host's completed tool-call hook, BEFORE execution.
    // This function does not decide, infer, or manufacture a model response.
    decision({model,responseId,toolCallId,command,hintId,observation,trace}) {
      if(!trace||typeof trace!=='object')throw Error('Original model-host response/tool-call trace is required');
      const bytes=Buffer.from(JSON.stringify(trace));if(bytes.length>1024*1024)throw Error('Use the scoped model turn, not complete account history');
      const traceFile='decision-'+(sequence+1)+'.json';writeFileSync(path.join(directory,traceFile),bytes,{flag:'wx',mode:0o600});
      record('decision',{source:'model-host-tool-call',model,responseId,toolCallId,command,hintId,observation,traceFile,traceSha256:createHash('sha256').update(bytes).digest('hex')});
    },
    // Call only when the existing host actually submits this command to Minecraft.
    submitted({command,toolCallId}) {record('submitted',{command,toolCallId});},
    // Pass this to startGoddessPhotoCamera's existing onCapture option. These are
    // the exact worker PNG bytes AFTER upload, not a preview or synthetic receipt.
    async onCapture({job,owner:creator,world,mode,png,diagnostics}) {
      if(creator!==owner||!uuid.test(job))throw Error('Unexpected capture identity');
      const file=job+'.png';writeFileSync(path.join(directory,file),png,{flag:'wx',mode:0o600});
      record('image',{job,owner,world,mode,file,bytes:png.length,sha256:createHash('sha256').update(png).digest('hex'),diagnostics});
    },
    // Use read-only results exported from the same isolated server, scoped to owner.
    album(row) {if(row.owner!==owner)throw Error('Album owner mismatch');record('album',row);},
    stash({imageIndex,mapIds,storedMapIds,pendingMapIds}) {record('stash',{owner,imageIndex,mapIds,storedMapIds,pendingMapIds});}
  };
}
