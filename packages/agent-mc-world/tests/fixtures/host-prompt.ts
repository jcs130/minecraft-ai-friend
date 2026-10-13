import {readFileSync} from 'node:fs';
import {renderTemplate} from '../../core/support/runtime.mjs';
import type {World} from '../../src/client/contracts.ts';
export async function renderWorldEnvPrompt(world:World) { const vars=await world.envPromptVars();return {sourceKey:world.console?.().promptDocs?.find(doc=>doc.role==='envPrompt')?.key,text:(world.console?.().promptDocs??[]).filter(doc=>doc.role==='envPrompt').map(doc=>renderTemplate(readFileSync(doc.path,'utf8'),vars??{})).join('\n\n')}; }
