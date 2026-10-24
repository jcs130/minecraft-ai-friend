import {describe, expect, it, vi} from 'vitest';
import {createHttpDecisionPort} from '../src/decisions/http-port.ts';
const input={state:{health:8},questions:{action:{type:'choice' as const,instructions:'measured only',criteria:{run:'retreat',keep:'continue'}}}};
const answers={action:{type:'choice',choice:'run',confidence:.8,probabilities:{run:.8,keep:.2}}};
describe('explicit decision transport',()=>{
  it('uses the supplied endpoint and secret port, returns measured usage and no history',async()=>{
    const fetch=vi.fn(async(_url:any,options:any)=>{expect(JSON.parse(options.body)).toEqual({...input,model:'fixture'});expect(options.headers.authorization).toBe('Bearer fixture-value');return Response.json({answers,usage:{input_tokens:123,output_tokens:0}});});
    const rows:any[]=[];const port=createHttpDecisionPort(()=>({endpoint:'http://127.0.0.1:4000/v1/systemone',model:'fixture',apiKeyEnv:'LOCAL_KEY'}),{secret:()=> 'fixture-value',fetch,observe:r=>rows.push(r)});
    const result=await port.request(input);expect(result.answers).toEqual(answers);expect(result.usage).toEqual({input_tokens:123,output_tokens:0,cached_input_tokens:null});expect(rows.map(r=>r.state)).toEqual(['started','completed']);expect(JSON.stringify(rows)).not.toContain('fixture-value');
  });
  it('does not access private named providers or guess an endpoint',async()=>{
    const fetch=vi.fn();const port=createHttpDecisionPort(()=>({endpoint:'http://localhost:4000/systemone'}),{fetch});
    await expect(port.request(input,{provider:'old-private-id'})).rejects.toThrow('Named host');expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects malformed choices and masks raw provider errors',async()=>{
    const port=createHttpDecisionPort(()=>({endpoint:'http://localhost:4000/systemone'}),{fetch:async()=>Response.json({answers:{action:{choice:'imaginary',probabilities:{imaginary:1}}},error:'private-value'})});
    await expect(port.request(input)).rejects.toThrow('invalid response');
  });
  it('aborts during a request and rejects late results after reconfiguration',async()=>{
    let model='one';const controller=new AbortController();
    const port=createHttpDecisionPort(()=>({endpoint:'http://localhost:4000/systemone',model}),{fetch:async()=>{model='two';return Response.json({answers});}});
    await expect(port.request(input)).rejects.toThrow('invalid response');controller.abort();
    await expect(port.request(input,{signal:controller.signal})).rejects.toThrow('cancelled');
  });
});
