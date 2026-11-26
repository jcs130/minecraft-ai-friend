import {describe, expect, it, vi} from 'vitest';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHttpDecisionPort, type HttpDecisionObservation} from '../src/decisions/http-port.ts';
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

  it('matches a real HTTP disconnect to its trace and effective client deadline', async () => {
    let observed!: (value: { trace?: string; premature: boolean }) => void;
    const closed = new Promise<{ trace?: string; premature: boolean }>(resolve => { observed = resolve; });
    const server = createServer((req, res) => {
      const trace = req.headers['x-litellm-trace-id'] as string | undefined;
      req.resume();
      res.once('close', () => observed({trace, premature: !res.writableEnded}));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"answers":');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as { port: number };
    const rows: HttpDecisionObservation[] = [];
    try {
      const port = createHttpDecisionPort(() => ({ endpoint: `http://127.0.0.1:${address.port}/v1/systemone`, timeoutMs: 1500 }),
        { observe: record => rows.push(record) });
      await expect(port.request(input, { timeoutMs: 180, correlationId: 'battle:19' })).rejects.toThrow('timed out');
      expect(await closed).toEqual({ trace: rows[0].id, premature: true });
      expect(rows.at(-1)).toMatchObject({ state: 'failed', id: rows[0].id, correlationId: 'battle:19',
        timeoutMs: 180, status: 200, failureKind: 'timeout' });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it.each(['caller-cancelled', 'world-stop'] as const)('records %s with the same trace, suppressing the raw abort reason', async failureKind => {
    const caller = new AbortController(), world = new AbortController();
    const rows: HttpDecisionObservation[] = [];
    const fetch = (async (_url, init) => {
      if (failureKind === 'world-stop') world.abort(new Error('private-abort-detail'));
      else caller.abort(new Error('private-abort-detail'));
      init?.signal?.throwIfAborted();
      throw Error('unreachable');
    }) as typeof globalThis.fetch;
    const port = createHttpDecisionPort(() => ({ endpoint: 'http://localhost:4000/systemone' }),
      { fetch, signal: world.signal, observe: record => rows.push(record) });
    await expect(port.request(input,{ signal: caller.signal })).rejects.toThrow('cancelled');
    expect(rows.at(-1)).toMatchObject({ id: rows[0].id, failureKind });
    expect(JSON.stringify(rows)).not.toContain('private-abort-detail');
  });
});
