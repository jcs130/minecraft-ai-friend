/** Immutable tool-text snapshots. Offsets are UTF-16 code units, never prompt
 * offsets or game actions. A displayed continuation advances only past text
 * actually delivered to the model. */
export interface TextPage {
  protocol:'agent-mc-text-page/v1';handle:string;unit:'utf16';mime:string;
  offset:number;text:string;returnedChars:number;totalChars:number;
  nextOffset:number|null;hasMore:boolean;
}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const handleOk=(v:unknown):v is string=>typeof v==='string'&&/^log:[a-f0-9]{64}$/.test(v);
const high=(n:number)=>n>=0xd800&&n<=0xdbff,low=(n:number)=>n>=0xdc00&&n<=0xdfff;
function head(text:string,max:number){let end=Math.min(text.length,max);if(end>0&&end<text.length&&high(text.charCodeAt(end-1))&&low(text.charCodeAt(end)))end--;return text.slice(0,end);}
export interface TextPageFailure {
  protocol:'agent-mc-text-read-error/v1';
  code:'TEXT_HANDLE_INVALID'|'TEXT_OFFSET_OUT_OF_RANGE'|'TEXT_PAGE_SIZE_INVALID'|'TEXT_OFFSET_SPLITS_CHARACTER';
  handle:string|null;unit:'utf16';requestedOffset:number|null;maxChars:number|null;totalChars:number;
  returnedChars:0;nextOffset:null;
}
/** A rejected read exposes its bounds; it never invents a successful page or
 * advances a cursor. Callers decide whether an earlier part is still needed. */
export class TextPageRangeError extends Error {
  readonly data:TextPageFailure;
  constructor(code:TextPageFailure['code'],handle:unknown,offset:number,max:number,totalChars:number){
    super((code==='TEXT_OFFSET_SPLITS_CHARACTER'?'Text offset splits a Unicode character':'Invalid immutable text page range')
      +`; requested offset ${Number.isFinite(offset)?offset:'unknown'}, text length ${totalChars} UTF-16 units. No text was returned and no continuation was produced. `
      +'Do not add maxChars to a rejected offset. Follow a previously returned nextOffset; hasMore:false / nextOffset:null ends that document. If an earlier part is needed, explicitly select a valid range.');
    this.name='TextPageRangeError';
    this.data={protocol:'agent-mc-text-read-error/v1',code,handle:handleOk(handle)?handle:null,unit:'utf16',
      requestedOffset:Number.isFinite(offset)?offset:null,maxChars:Number.isFinite(max)?max:null,totalChars,returnedChars:0,nextOffset:null};
  }
}
export function readTextPage(text:string,handle:string,options:{offset?:number;maxChars?:number;mime?:string}={}):TextPage {
  const offset=options.offset??0,max=options.maxChars??Math.max(1,text.length);
  const fail=(code:TextPageFailure['code']):never=>{throw new TextPageRangeError(code,handle,offset,max,text.length);};
  if(!handleOk(handle))fail('TEXT_HANDLE_INVALID');
  if(!Number.isSafeInteger(offset)||offset<0||offset>text.length)fail('TEXT_OFFSET_OUT_OF_RANGE');
  if(!Number.isSafeInteger(max)||max<1)fail('TEXT_PAGE_SIZE_INVALID');
  if(offset>0&&offset<text.length&&low(text.charCodeAt(offset))&&high(text.charCodeAt(offset-1)))fail('TEXT_OFFSET_SPLITS_CHARACTER');
  let part=head(text.slice(offset),max);
  if(!part&&offset<text.length)part=text.slice(offset,offset+2); // one atomic surrogate pair
  const end=offset+part.length;
  return{protocol:'agent-mc-text-page/v1',handle,unit:'utf16',mime:options.mime??'text/plain',offset,text:part,
    returnedChars:part.length,totalChars:text.length,nextOffset:end<text.length?end:null,hasMore:end<text.length};
}
export function textPageMeta(page:TextPage){const{text:_text,...meta}=page;return meta;}
export interface TextToolResult {structuredContent?:Record<string,any>;content?:readonly unknown[];isError?:boolean;[key:string]:unknown}

/** Bounded read evidence for a host's next normal request. Feed only the actual
 * model projection, never an unrendered full-text result. Does not dispatch,
 * block tools, infer body idleness, rewrite history or adopt a lesson. */
export class TextReadRecoveryBook {
  private run:string|null=null;
  private seen=new Set<string>();
  private ends=new Map<string,{at:number;requestId:string;totalChars:number}>();
  private latest:{at:number;handle:string;requestId:string;totalChars:number;failure:TextPageFailure|null;attempts:number}|null=null;
  constructor(private options:{now?:()=>number;ttlMs?:number}={}){
    if(options.ttlMs!==undefined&&(!Number.isSafeInteger(options.ttlMs)||options.ttlMs<1))throw Error('Invalid text-read recovery TTL');
  }
  observe(input:{run:string;requestId:string;name:string;result:TextToolResult}):void {
    if(!input.run||!input.requestId)return;
    if(this.run!==input.run){this.run=input.run;this.seen.clear();this.ends.clear();this.latest=null;}
    if(this.seen.has(input.requestId))return;
    this.seen.add(input.requestId);while(this.seen.size>64)this.seen.delete(this.seen.values().next().value!);
    const now=(this.options.now??Date.now)(),s=input.result.structuredContent??input.result;
    const p=s?.meta?.textPage,f=s?.data;
    if(!input.result.isError&&s?.failed===false&&p?.protocol==='agent-mc-text-page/v1'&&handleOk(p.handle)
      &&Number.isSafeInteger(p.totalChars)&&p.totalChars>=0&&Number.isSafeInteger(p.offset)&&p.offset>=0
      &&typeof s.text==='string'&&s.text.length===p.returnedChars&&p.offset+p.returnedChars===p.totalChars
      &&p.hasMore===false&&p.nextOffset===null){
      this.ends.delete(p.handle);this.ends.set(p.handle,{at:now,requestId:input.requestId,totalChars:p.totalChars});
      while(this.ends.size>8)this.ends.delete(this.ends.keys().next().value!);
      this.latest={at:now,handle:p.handle,requestId:input.requestId,totalChars:p.totalChars,failure:null,attempts:0};return;
    }
    if((input.result.isError||s?.failed===true)&&f?.protocol==='agent-mc-text-read-error/v1'&&handleOk(f.handle)
      &&['TEXT_OFFSET_OUT_OF_RANGE','TEXT_PAGE_SIZE_INVALID','TEXT_OFFSET_SPLITS_CHARACTER'].includes(f.code)
      &&Number.isSafeInteger(f.totalChars)&&f.totalChars>=0&&f.returnedChars===0&&f.nextOffset===null){
      const previous=this.latest;
      const failure:TextPageFailure={protocol:f.protocol,code:f.code,handle:f.handle,unit:'utf16',
        requestedOffset:typeof f.requestedOffset==='number'&&Number.isFinite(f.requestedOffset)?f.requestedOffset:null,
        maxChars:typeof f.maxChars==='number'&&Number.isFinite(f.maxChars)?f.maxChars:null,totalChars:f.totalChars,returnedChars:0,nextOffset:null};
      this.latest={at:now,handle:f.handle,requestId:input.requestId,totalChars:f.totalChars,failure,
        attempts:previous&&previous.handle===f.handle&&previous.failure?.code===f.code&&now-previous.at<=(this.options.ttlMs??120000)?previous.attempts+1:1};return;
    }
    this.latest=null;
  }
  context(run:string){
    const latest=this.latest,now=(this.options.now??Date.now)();
    if(run!==this.run||!latest||now-latest.at>(this.options.ttlMs??120000))return null;
    const end=this.ends.get(latest.handle);
    return{protocol:'agent-mc-text-read-recovery/v1',run,...latest,
      observedEnd:end?.totalChars===latest.totalChars?{...end,hasMore:false,nextOffset:null}:null,
      guidance:'A returned end is final for this immutable document. A failed read returns no text and creates no next offset; do not keep incrementing it. Use only actual returned cursors. An observed final page does not prove every earlier page was read. Choose another needed observation or action, or explicitly read a missing valid part. This is read evidence, not game progress or a completed goal.'};
  }
  snapshot(){return{run:this.run,seenRequests:this.seen.size,knownEnds:this.ends.size,latest:this.latest&&{...this.latest}};}
}

/** Archive only an oversized, successful, declared read. Original values stay
 * intact; content addressing deduplicates repeated identical guide reads. */
export function referenceToolText<T extends TextToolResult>(value:T,options:{readOnly:boolean;budgetChars:number;save:(text:string)=>string}):T {
  const s=value.structuredContent;
  if(!options.readOnly||value.isError||s?.failed!==false||s.data!==undefined||typeof s.text!=='string'
    ||!s.text||s.meta?.textReference||JSON.stringify(s).length<=options.budgetChars)return value;
  const handle=options.save(s.text);if(!handleOk(handle))throw new Error('Text archive did not return an immutable log handle');
  return{...value,structuredContent:{...s,meta:{...s.meta,textReference:{protocol:'agent-mc-text-reference/v1',handle,totalChars:s.text.length,mime:'text/plain'}}}};
}

/** Null means the ordinary renderer owns this value. A non-null string is a
 * complete model envelope: do not truncate it a second time. */
export function renderToolTextPage(value:TextToolResult,options:{budgetChars:number;toolPrefix:string}):string|null {
  const s=value.structuredContent;if(!s||value.isError||s.failed!==false)return null;
  let page:TextPage;
  if(s.data?.protocol==='agent-mc-text-page/v1')page=s.data as TextPage;
  else if(s.data===undefined&&s.meta?.textReference?.protocol==='agent-mc-text-reference/v1'
    &&handleOk(s.meta.textReference.handle)&&typeof s.text==='string')page=readTextPage(s.text,s.meta.textReference.handle,{mime:s.meta.textReference.mime});
  else return null;
  if(!handleOk(page.handle)||!Number.isSafeInteger(page.offset)||typeof page.text!=='string'||page.offset+page.text.length>page.totalChars)
    throw new Error('Invalid model text-page evidence');
  const {text:_text,data:_data,meta:rawMeta,...rest}=s;
  const {textReference:_reference,textPage:_page,readback:_readback,...meta}=object(rawMeta)?rawMeta:{};
  const present=(chars:number,over=false)=>{
    const text=head(page.text,chars),end=page.offset+text.length,hasMore=end<page.totalChars;
    const next=hasMore?{tool:options.toolPrefix+'_read_text',arguments:{handle:page.handle,offset:end,maxChars:Math.min(16000,Math.max(16,text.length))}}:null;
    return JSON.stringify({...rest,meta:{...meta,textPage:{protocol:page.protocol,handle:page.handle,unit:'utf16',mime:page.mime,
      offset:page.offset,returnedChars:text.length,totalChars:page.totalChars,nextOffset:hasMore?end:null,hasMore,next,
      ...(over?{presentationBudgetExceeded:true}:{} )}},text});
  };
  let lo=0,hi=page.text.length,best='';
  while(lo<=hi){const mid=Math.floor((lo+hi)/2),candidate=present(mid);if(candidate.length<=options.budgetChars){best=candidate;lo=mid+1;}else hi=mid-1;}
  if((best&&JSON.parse(best).meta.textPage.returnedChars>0)||!page.text.length)return best||present(0);
  // Irreducible control metadata may exceed a deliberately tiny soft budget.
  // Preserve a useful page and an honest cursor rather than an empty-page loop.
  return present(Math.min(page.text.length,Math.max(64,high(page.text.charCodeAt(0))?2:1)),true);
}
