/** Recorded collision inputs, not a simulation of Paper plugins or opponent policy. */
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {Vec3} from 'vec3';
import type {VoxelScene,SceneBlockType,ScenePoint} from '../contracts/voxel-scene.ts';
import {procedureHash,procedureId} from '../../core/support/procedure.ts';
import {validatePracticeCase,type PracticeCase} from './practice.ts';
const require=createRequire(import.meta.url);
export interface RecordedScene {
  schema:'agent-mc-recorded-practice/v1';id:string;scene:VoxelScene;
  initial:{velocity:ScenePoint;onGround:boolean;health:number};
  goal:Extract<PracticeCase['goal'],{kind:'reach'}>;
  evidence:string[];
  /** Only external terrain inputs; never replay old agent outputs as candidate effects. */
  events:Array<{tick:number;position:ScenePoint;block:SceneBlockType;source:string}>;
}
export function recordedCase(record:RecordedScene):PracticeCase {
  procedureId(record.id);const s=record.scene;
  if(record.schema!=='agent-mc-recorded-practice/v1'||s?.schema!=='agent-mc-voxel-scene/v1'||s.order!=='x-y-z'
    ||s.source.minecraftVersion!=='1.21.1'||!s.source.realmVerified||!s.source.dimension||!Number.isFinite(Date.parse(s.sampledAt)))throw Error('Verified Java 1.21.1 recorded scene required');
  const {min,max}=s.bounds,n=min.reduce((v,x,i)=>v*(max[i]-x+1),1);
  if(min.length!==3||max.length!==3||![...min,...max].every(Number.isSafeInteger)||min.some((x,i)=>x>max[i])||n>250000||s.cells.length!==n
    ||s.cells.some(i=>!Number.isInteger(i)||i< -1||i>=s.palette.length))throw Error('Invalid recorded volume');
  if(!record.evidence.length||record.evidence.some(v=>typeof v!=='string'||v.length>500)||!Number.isFinite(record.initial.health)
    ||record.initial.velocity.length!==3||![...s.camera.feet,...record.initial.velocity,s.camera.yaw,s.camera.pitch].every(Number.isFinite)
    ||typeof record.initial.onGround!=='boolean')throw Error('Missing recorded initial state/evidence');
  if(!Array.isArray(record.events)||record.events.length>10000||record.events.some((e,i)=>!Number.isInteger(e.tick)||e.tick<0||e.tick>1000
    ||(i>0&&e.tick<record.events[i-1].tick)||e.position.length!==3||!e.position.every(Number.isSafeInteger)||!e.source))throw Error('Invalid ordered external terrain events');
  const fixture:PracticeCase={id:record.id,snapshotId:procedureHash({bounds:s.bounds,palette:s.palette,cells:s.cells,camera:s.camera,initial:record.initial,goal:record.goal,events:record.events}),environmentVersion:'java-1.21.1/recorded-collision-v1',goal:record.goal};
  validatePracticeCase(fixture);if(record.goal.dimension!==s.source.dimension)throw Error('Recorded goal dimension mismatch');return fixture;
}
export function reconstructRecordedScene(input:RecordedScene){
  const record=structuredClone(input),fixture=recordedCase(record),s=record.scene;
  const data=require('minecraft-data')('1.21.1'),Block=require('prismarine-block')('1.21.1'),{Physics}=require('prismarine-physics');
  const convert=(entry:SceneBlockType)=>{
    if(!Number.isInteger(entry.stateId)||entry.stateId===null)throw Error('Missing exact vanilla block state');
    const block=Block.fromStateId(entry.stateId,0);
    const sort=(x:object)=>JSON.stringify(Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))));
    if('minecraft:'+block.name!==entry.name||sort(block.getProperties())!==sort(entry.properties)
      ||entry.collisionShapes===null||JSON.stringify(block.shapes)!==JSON.stringify(entry.collisionShapes))throw Error('Recorded registry or collision differs from Java 1.21.1; matching simulator required');
    return entry.stateId;
  };
  const states=s.palette.map(convert),cells=[...s.cells],{min,max}=s.bounds;
  const index=(p:ScenePoint)=>p.some((x,i)=>x<min[i]||x>max[i])?-1:((p[0]-min[0])*(max[1]-min[1]+1)+(p[1]-min[1]))*(max[2]-min[2]+1)+(p[2]-min[2]);
  const world={getBlock:(p:Vec3)=>{
    const position=[Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)] as ScenePoint,i=index(position);
    if(i<0||cells[i]===-1)throw Error('Recorded geometry unknown at '+position.join(',')+'; not treated as air');
    const block=Block.fromStateId(states[cells[i]],0);block.position=new Vec3(...position);return block;
  }};
  const player={version:'1.21.1',entity:{position:new Vec3(...s.camera.feet),velocity:new Vec3(...record.initial.velocity),yaw:s.camera.yaw,pitch:s.camera.pitch,
    onGround:record.initial.onGround,isInWater:false,isInLava:false,isInWeb:false,isCollidedHorizontally:false,isCollidedVertically:false,elytraFlying:false,effects:{},attributes:{}},
    inventory:{slots:Array(46).fill(null)},jumpTicks:0,jumpQueued:false,fireworkRocketDuration:0};
  let eventIndex=0;
  return {fixture,player,world,physics:Physics(data,world),goal:[record.goal.position.x,record.goal.position.y,record.goal.position.z],dimension:s.source.dimension,health:record.initial.health,
    beforeTick:(tick:number)=>{while(record.events[eventIndex]?.tick<=tick){const e=record.events[eventIndex++],i=index(e.position);if(i<0)throw Error('Terrain event outside recorded bounds');
      const state=convert(e.block);states.push(state);cells[i]=states.length-1;}}};
}
export class RecordedSceneStore {
  constructor(private readonly directory:string){}
  save(record:RecordedScene){const fixture=recordedCase(record);mkdirSync(this.directory,{recursive:true});
    writeFileSync(join(this.directory,record.id+'.json'),JSON.stringify(record),{flag:'wx',mode:0o600});return this.summary(record,fixture);}
  read(id:string):RecordedScene{procedureId(id);const value=JSON.parse(readFileSync(join(this.directory,id+'.json'),'utf8'));recordedCase(value);if(value.id!==id)throw Error('Recorded case identity mismatch');return value;}
  list(){return existsSync(this.directory)?readdirSync(this.directory).filter(f=>/^[a-z][a-z0-9-]{0,63}\.json$/.test(f)).sort().slice(-20).map(f=>{const r=this.read(f.slice(0,-5));return this.summary(r,recordedCase(r));}):[];}
  private summary(r:RecordedScene,f:PracticeCase){return {id:r.id,hash:f.snapshotId,capturedAt:r.scene.sampledAt,goal:r.goal,coverage:r.scene.coverage,evidence:r.evidence,
    capabilities:'Recorded collision/controls and external terrain events only; no combat damage, oxygen depletion, inventory changes or plugin rules.'};}
}
