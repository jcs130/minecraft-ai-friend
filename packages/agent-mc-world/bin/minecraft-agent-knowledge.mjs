#!/usr/bin/env node
/** Explicit local preparation/query. Installation never downloads or indexes a corpus. */
import {readFileSync} from 'node:fs';
const [command,...argv]=process.argv.slice(2);
if(!command||['help','--help','-h'].includes(command)) {
  console.log(`Minecraft external reference index (Node.js 22.13+ / 24)
  prepare --inputs <Wiki JSON file/directory> [...] --output <absolute index.sqlite> [--embeddings-config <private JSON>]
  search --index <absolute index.sqlite> --query <question> [--limit 5] [--retrieval hybrid|lexical|local-vector|semantic] [--embeddings-config <private JSON>]
  get --index <absolute index.sqlite> --id <returned page id> [--offset 0] [--length 2000]
  status --index <absolute index.sqlite>
Input data retains its own source/license. No source downloads, game actions or chat-model calls.
Preparation refuses overwrite; keep corpora/indexes outside the installed plugin and personal notebook.
See installed docs/minedojo-knowledge.md for original downloads, limits and source/version caveats.`);
  process.exit(0);
}
try {
  const options={};
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];if(!key.startsWith('--')||Object.hasOwn(options,key))throw Error('Unknown/duplicate option');
    if(key==='--inputs') {const values=[];while(i+1<argv.length&&!argv[i+1].startsWith('--'))values.push(argv[++i]);options[key]=values;}
    else {if(i+1>=argv.length||argv[i+1].startsWith('--'))throw Error('Option needs a value');options[key]=argv[++i];}
  }
  const allowed={prepare:['--inputs','--output','--embeddings-config'],search:['--index','--query','--limit','--retrieval','--embeddings-config'],get:['--index','--id','--offset','--length'],status:['--index']};
  if(!allowed[command]||Object.keys(options).some(key=>!allowed[command].includes(key)))throw Error('Unknown knowledge command/option; use --help');
  const {buildReferenceIndex,readReferenceIndex}=await import('agent-mc-world/client');
  const embeddings=options['--embeddings-config']?JSON.parse(readFileSync(options['--embeddings-config'],'utf8')):undefined;
  const signal=AbortSignal.any([AbortSignal.timeout(30*60*1000)]);
  const result=command==='prepare'?await buildReferenceIndex({inputs:options['--inputs']??[],output:options['--output'],embeddings},signal)
    :await readReferenceIndex(command==='status'?{action:'help'}:command==='get'?{action:'get',id:options['--id'],offset:options['--offset']===undefined?0:Number(options['--offset']),length:options['--length']===undefined?2000:Number(options['--length'])}
      :{action:'search',query:options['--query'],limit:options['--limit']===undefined?5:Number(options['--limit'])},
      {indexFile:options['--index'],retrieval:options['--retrieval'],embeddings},signal);
  console.log(JSON.stringify(result,null,2));
} catch(error) {console.error(error instanceof Error?error.message:'Reference operation failed');process.exitCode=1;}
