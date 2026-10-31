import {it,expect}from'vitest';
import {declareDecodedChannels}from'../core/decoded-channels.ts';
it('declares only installed decoder names on the actual play connection',()=>{
 const writes:any[]=[];const client={state:'play',write:(...v:any[])=>writes.push(v)};
 expect(declareDecodedChannels(client,['mcagent:state','mcagent:state',undefined,'bad\0channel','mcagent:protection'])).toBe(true);
 expect(writes).toHaveLength(1);expect(writes[0][0]).toBe('custom_payload');
 expect(writes[0][1].channel).toBe('minecraft:register');expect(writes[0][1].data.toString()).toBe('mcagent:state\0mcagent:protection');
 expect(writes[0][1].data.toString()).not.toMatch(/password|identity|token|key|permission/);
});
it('configuration, observation and closed transport do not send or interrupt game entry',()=>{
 for(const state of ['configuration','observation',undefined])expect(declareDecodedChannels({state,write(){throw Error('read only');}},['mcagent:state'])).toBe(false);
 expect(declareDecodedChannels({state:'play',write(){throw Error('closed');}},['mcagent:state'])).toBe(false);
 expect(declareDecodedChannels({state:'play',write(){throw Error('unused');}},[])).toBe(false);
});
