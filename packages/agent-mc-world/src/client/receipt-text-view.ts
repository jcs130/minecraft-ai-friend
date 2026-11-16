type TextReference = string | {pointer:string;start:number;length:number;unit:'utf16'}
  | {pointer:string;encoding:'json';prefix:string};

/** Lossless request view. Only exact copies and canonical JSON encodings of
 * already-visible data are referenced. The durable receipt is never changed. */
export function receiptTextView(original: string): string {
  let value: any; try { value = JSON.parse(original); } catch { return original; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.text !== 'string'
    || value.text.length < 400 || Object.hasOwn(value, 'requestTextReferences')) return original;
  const refs: Record<string,TextReference> = {};
  // Capture parent encodings before touching child text. References form an
  // acyclic tree; restore child data before serializing a parent's reference.
  const jsonCopies: Array<{object:any;path:string;ref:TextReference}> = [];
  for (const [object,path] of [[value,''],[value.data?.reply,'/data/reply']] as const) {
    if (!object || typeof object.text !== 'string' || !object.data || typeof object.data !== 'object') continue;
    const encoded=JSON.stringify(object.data);
    if(encoded.length<256 || !object.text.endsWith(encoded))continue;
    jsonCopies.push({object,path,ref:{pointer:path+'/data',encoding:'json',prefix:object.text.slice(0,-encoded.length)}});
  }
  const evidence = value.execution?.evidence;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence) && evidence.receipt === value.text) {
    delete evidence.receipt; refs['/execution/evidence/receipt'] = '/text';
  }
  // Reuse only complete details still present verbatim in the visible text.
  // Truncated or paraphrased results never qualify as identical evidence.
  if (evidence?.format === 'agent-mc/compact-execution-evidence/v1' && Array.isArray(evidence.steps)) {
    for (const [index,step] of evidence.steps.entries()) {
      const detail=step?.detail?.text;
      if (typeof detail!=='string'||detail.length<120) continue;
      const start=value.text.indexOf(detail);if(start<0)continue;
      refs[`/execution/evidence/steps/${index}/detail/text`]={pointer:'/text',start,length:detail.length,unit:'utf16'};
      delete step.detail.text;
    }
  }
  // Keep the key's insertion position: deleting/re-adding a child text key
  // would change its parent's canonical JSON string during reconstruction.
  for(const {object,path,ref} of jsonCopies){refs[path+'/text']=ref;object.text=null;}
  if (!Object.keys(refs).length) return original;
  value.requestTextReferences = {protocol:jsonCopies.length?'agent-mc/receipt-text-references/v2':'agent-mc/receipt-text-references/v1', pointers:refs,
    meaning:'Exact repeated text only. For encoding=json, text is prefix + JSON.stringify(referenced data), restoring child references first. All distinct facts, native status, effects and failures remain. Original receipt is archived; this is only a request view.'};
  const view = JSON.stringify(value);
  return view.length < original.length ? view : original;
}
