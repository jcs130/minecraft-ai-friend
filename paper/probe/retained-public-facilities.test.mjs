// Node's built-in runner. Resolve js-yaml from the existing ops dependency set;
// on another host set MC_PROBE_PACKAGE_JSON to a package.json with js-yaml.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const yaml=createRequire(process.env.MC_PROBE_PACKAGE_JSON??'E:/MC/ops/yaml-check/package.json')('js-yaml');
const template=new URL('../content/block-access-public-facilities.yml',import.meta.url);
const config=yaml.load(fs.readFileSync(template,'utf8'));
const contains=(r,x,z)=>r.world==='world'&&x>=r['min-x']&&x<=r['max-x']&&z>=r['min-z']&&z<=r['max-z'];
const retained=(x,z)=>config.villages.some(r=>contains(r,x,z));

test('public facility template fits the running plugin limit and preserves merge semantics',()=>{
 assert.equal(config['schema-version'],1);assert.equal(config.enabled,true);
 assert(config.villages.length<=8);assert.deepEqual(config.editors,[]);
});

const facilities=[
 ['main village',-634,-458,-530,-365],
 ['new spawn village',-1146,-1078,-638,-567],
 ['trial grounds and raised entrance',-610,-570,-338,-270],
 ['old trial entrance contained in trial grounds',-593,-587,-328,-318],
 ['deep trial wing',-530,-490,-325,-285],
 ['challenge wing',-374,-326,-329,-281],
 ['PvP arena',-716,-684,-566,-534],
 ['natural crypt access',-468,-423,650,686],
 ['village mine stairs, floor, gate and lights',-701,-653,-490,-478],
 ['mine road outside village',-652,-635,-484,-473],
];
for(const[name,x0,x1,z0,z1]of facilities)test(name+' is excluded from outside-open coverage',()=>{
 for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)assert(retained(x,z),name+' uncovered '+[x,z]);
});

test('west mining face stays free immediately beyond the public landing',()=>{
 for(let x=-710;x<=-702;x++)for(let z=-490;z<=-478;z++)assert.equal(retained(x,z),false,'do not extend into mining '+[x,z]);
});
test('nearby northern and southern wild ground stays open',()=>{
 for(const p of [[-660,-471],[-660,-491],[-702,-484]])assert.equal(retained(...p),false);
});
test('retained area cap is not wasted on a fully contained duplicate',()=>{
 for(let i=0;i<config.villages.length;i++)for(let j=0;j<config.villages.length;j++)if(i!==j){const a=config.villages[i],b=config.villages[j];assert(!(contains(b,a['min-x'],a['min-z'])&&contains(b,a['max-x'],a['max-z'])),'redundant retained area');}
});
