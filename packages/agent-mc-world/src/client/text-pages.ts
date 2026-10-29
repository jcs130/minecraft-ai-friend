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
export function readTextPage(text:string,handle:string,options:{offset?:number;maxChars?:number;mime?:string}={}):TextPage {
  const offset=options.offset??0,max=options.maxChars??Math.max(1,text.length);
  if(!handleOk(handle)||!Number.isSafeInteger(offset)||offset<0||offset>text.length||!Number.isSafeInteger(max)||max<1)
    throw new Error('Invalid immutable text page range');
  if(offset>0&&offset<text.length&&low(text.charCodeAt(offset))&&high(text.charCodeAt(offset-1)))throw new Error('Text offset splits a Unicode character');
  let part=head(text.slice(offset),max);
  if(!part&&offset<text.length)part=text.slice(offset,offset+2); // one atomic surrogate pair
  const end=offset+part.length;
  return{protocol:'agent-mc-text-page/v1',handle,unit:'utf16',mime:options.mime??'text/plain',offset,text:part,
    returnedChars:part.length,totalChars:text.length,nextOffset:end<text.length?end:null,hasMore:end<text.length};
}
export function textPageMeta(page:TextPage){const{text:_text,...meta}=page;return meta;}
export interface TextToolResult {structuredContent?:Record<string,any>;content?:readonly unknown[];isError?:boolean;[key:string]:unknown}

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
