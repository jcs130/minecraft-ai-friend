/** Thin, evidence-linked bridge to the existing scoped mc_memory notebook. */
export interface PracticeLessonReport {
  jobHash: string; jobId: string; upstreamRevision: string; evidenceRefs: string[];
  selectedReference: {handle:string;revision:string} | null;
  gate: {eligible:boolean;reason:string;adopted:false};
  experience: {cue:string;lesson:string;evidence:string;confidence?:string} | null;
}
export interface PracticeMemoryPort {
  /** Calls the existing, correctly scoped mc_memory tool; no separate store or model. */
  call(args: Record<string,unknown>,signal: AbortSignal): Promise<Record<string,unknown>>;
}
const short=(text: unknown,limit:number)=>typeof text==='string'?text.slice(0,limit):'';
export function createPracticeGameMemory(port: PracticeMemoryPort): {
  remember(report: PracticeLessonReport,signal: AbortSignal): Promise<void>;
  recall(query: string,signal: AbortSignal): Promise<Array<{cue:string;lesson:string;evidenceRefs:string[]}>>;
} {
  return {
    async remember(report,signal) {
      signal.throwIfAborted();
      if(!/^[a-f0-9]{64}$/.test(report.jobHash) || !report.evidenceRefs.length)throw Error('Practice memory requires exact evidence');
      const tag=`h2:${report.jobHash.slice(0,40)}`, reference=`harness2:${report.jobHash}`;
      const found=await port.call({action:'search',kind:'lesson',tags:[tag],dimension:'*',limit:20},signal);
      const entries=found.entries as Array<{source?:{reference?:string}}> | undefined;
      if(!Array.isArray(entries))throw Error('Practice memory search did not return scoped entries');
      if(entries.some(e=>e.source?.reference===reference))return;
      const content={schema:'agent-mc.practice-lesson/v1',jobId:report.jobId,jobHash:report.jobHash,upstreamRevision:report.upstreamRevision,
        cue:short(report.experience?.cue,400)||'A comparable isolated Minecraft practice task',
        lesson:short(report.experience?.lesson,1600)||`Practice did not establish an improved applicable method: ${report.gate.reason}.`,
        modelInterpretation:short(report.experience?.evidence,1600),confidence:short(report.experience?.confidence,400),
        evidenceRefs:report.evidenceRefs.slice(0,8),totalEvidenceRefs:report.evidenceRefs.length,
        selectedReference:report.selectedReference,gate:report.gate,
        limitation:'Isolated practice only. This is an attributed game lesson, not a live-world fact, general mastery or adoption permission.'};
      const saved=await port.call({action:'remember',kind:'lesson',summary:`Harness2 ${short(report.jobId,90)}: ${report.gate.eligible?'isolated candidate':'retain baseline'}`,
        content:JSON.stringify(content),source:{kind:'agent_note',speaker:'harness2-practice',reference},tags:['harness2','practice-only',tag]},signal);
      if(saved.saved!==true)throw Error('Practice lesson persistence unconfirmed');
    },
    async recall(query,signal) {
      signal.throwIfAborted();
      const found=await port.call({action:'search',kind:'lesson',query:query.slice(0,200),tags:['harness2'],dimension:'*',limit:8},signal);
      if(!Array.isArray(found.entries))throw Error('Practice memory search did not return scoped entries');
      const out:Array<{cue:string;lesson:string;evidenceRefs:string[]}>=[];
      for(const entry of found.entries as Array<{id:string}>) {
        const reply=await port.call({action:'get',id:entry.id},signal);
        try {
          const note=JSON.parse((reply.entry as {content:string}).content);
          if(note.schema!=='agent-mc.practice-lesson/v1'||!Array.isArray(note.evidenceRefs)||!note.evidenceRefs.length)continue;
          out.push({cue:short(note.cue,400),
            lesson:`[isolated practice; eligible=${note.gate?.eligible===true}; ${short(note.gate?.reason,100)}] ${short(note.lesson,1300)} Recheck applicability; this is not live-world success or adoption permission.`,
            evidenceRefs:note.evidenceRefs.slice(0,8)});
        }catch{/* Other historical notes remain data and are not injected as optimizer policy. */}
      }
      return out;
    },
  };
}
