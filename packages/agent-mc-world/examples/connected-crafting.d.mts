import type {Harness2Options} from '../dist/types/src/decisions/harness2.js';
export interface ConnectedCraftingOptions {
  java:string;serverJar:string;python:string;directory:string;acceptEula:true;
  model?:Harness2Options['model'];
  provenance?:{kind:'registered-host-llm';provider?:string;model?:string;sessionId?:string};
  /** Scripted regression test only; mutually exclusive with model. */
  scripted?:boolean;wallMs?:number;signal?:AbortSignal;
}
export function runConnectedCraftingExperiment(options:ConnectedCraftingOptions):Promise<{
  result:import('../dist/types/src/decisions/harness2.js').Harness2Result;
  modelCosts:Record<string,unknown>;adopted:false;liveAgentsModified:false;
  [key:string]:unknown;
}>;
