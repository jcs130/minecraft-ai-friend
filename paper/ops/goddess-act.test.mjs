import test from 'node:test';
import assert from 'node:assert/strict';
import {peekCommands,nativeMetrics} from './goddess-act.mjs';

test('existing performance modes select the real read-only Youer command',()=>{
  for(const mode of ['tps','mspt'])assert.deepEqual(peekCommands(mode),['neoforge tps']);
  assert.deepEqual(peekCommands('list'),['minecraft:list']);
  assert.deepEqual(peekCommands('time'),['minecraft:time query day']);
  for(const mode of ['__proto__','constructor','tps; stop','stop','neoforge tps'])assert.equal(peekCommands(mode),null);
});
test('aggregate performance is parsed from the native server response',()=>{
  assert.deepEqual(nativeMetrics('Overworld: 20.000 TPS (6.015 ms/tick)\nOverall: 20.000 TPS (15.092 ms/tick)\n'),{source:'youer_neoforge',tps:20,mspt:15.092});
  assert.deepEqual(nativeMetrics('§aOverall: 8.500 TPS (117.900 ms/tick)§r'),{source:'youer_neoforge',tps:8.5,mspt:117.9});
});
test('missing or invalid telemetry never becomes a healthy default',()=>{
  for(const text of ['', '(empty response)', 'Unknown command', 'Overworld: 20 TPS (2 ms/tick)', 'Overall: NaN TPS (0 ms/tick)','Overall: 99 TPS (1 ms/tick)','Overall: 20 TPS (-1 ms/tick)','Overall: 20 TPS (1 ms/tick)\nOverall: 20 TPS (2 ms/tick)'])assert.equal(nativeMetrics(text),null);
});
