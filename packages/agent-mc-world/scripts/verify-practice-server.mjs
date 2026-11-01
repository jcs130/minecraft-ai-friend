/** Explicit scripted regression verifier; never claims a real LLM experiment. */
import {runConnectedCraftingExperiment} from '../examples/connected-crafting.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(v=>v.split(/=(.*)/s).slice(0,2)));
const report=await runConnectedCraftingExperiment({java:args['--java'],serverJar:args['--serverJar'],python:args['--python'],
  directory:args['--directory'],acceptEula:args['--acceptEula']==='true',scripted:true});
console.log(JSON.stringify({report:args['--directory']+'/report.json',gate:report.result.gate,trials:report.result.trials,
  realModelApiCalls:0,scripted:true,adopted:false}));
