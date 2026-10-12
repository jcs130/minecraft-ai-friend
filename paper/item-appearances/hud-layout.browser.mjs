// Geometry/pixel regression of the actual HUD sources with explicit state fixtures.
// Gameplay state is not modified. The separate browser.integration test uses live packets.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const root=process.env.MC_TEST_VIEWER_ROOT,assets=process.env.MC_TEST_VIEWER_ASSETS,out=process.env.MC_TEST_REPORT_DIR;
assert(root&&assets&&out);
const source=root+'/packages/modern-viewer/renderer-src',run=process.env.MC_TEST_RUN_LABEL??'1';assert.match(run,/^[a-z0-9-]{1,16}$/);
const require=createRequire(process.env.MC_TEST_BROWSER_DEPS??'E:/MC/ops/photo-camera-0.4.19/package.json');
const puppeteer=require('puppeteer-core'),vr=createRequire(root+'/package.json'),express=vr('express');
const css=fs.readFileSync(source+'/src/viewer.css','utf8'),template=fs.readFileSync(source+'/src/page-template.html','utf8');
const html=template.slice(template.indexOf('<div class="corti-survival"'),template.indexOf('<div class="corti-survival"')+template.slice(template.indexOf('<div class="corti-survival"')).indexOf('\n</div>')+7);
const scripts=['minecraft-viewer-item-icon.js','minecraft-viewer-hud.js'].map(n=>fs.readFileSync(source+'/tools/'+n,'utf8')).join('\n');
const app=express();app.get('/',(_q,res)=>res.type('html').send(`<html><head><style>${css}</style></head><body>${html}<script>${scripts}</script></body></html>`));
app.use('/textures',express.static(assets+'/public/textures/1.20.6'));
const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const report={scope:'actual HUD source with explicit layout state fixtures',checks:[],errors:[]};let browser;
const check=(name,value)=>{report.checks.push({name,...value});assert(value.pass,name);console.log('PASS '+name);};
try{
 browser=await puppeteer.launch({executablePath:process.env.MC_TEST_BROWSER_PATH,headless:true,pipe:true});
 const page=await browser.newPage();await page.setViewport({width:1280,height:720});await page.goto('http://127.0.0.1:'+server.address().port);
 for(const[mode,state]of Object.entries({normal:{health:20,maxHealth:20,food:20,armor:0},armored:{health:20,maxHealth:20,food:15,armor:20},multipleRows:{health:48,maxHealth:60,absorption:12,food:14,armor:18},underwater:{health:36,maxHealth:40,food:17,armor:20,inWater:true,oxygen:8},afterWater:{health:20,maxHealth:20,food:18,armor:0}})){
   for(const scale of [1,1.5]){
     const geometry=await page.evaluate(({state,scale})=>{
       renderCortiSurvivalHud({...state,quickBarSlot:4,experienceLevel:32,experienceProgress:.65,hotbar:[]});
       document.querySelector('#corti-survival').style.transform=`translateX(-50%) scale(${scale})`;
       document.querySelector('#corti-survival').style.transformOrigin='center bottom';
       const box=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height,display:s.display,rows:s.gridTemplateRows,row:s.gridRow,gap:s.rowGap,position:s.position,top:s.top,min:s.minHeight};};
       const boxes=Object.fromEntries(['.corti-vitals','[data-corti-hearts]','[data-corti-food]','.corti-xp','.corti-level','.corti-hotbar','[data-corti-air]','[data-corti-mana-vital]'].map(s=>[s,box(s)]));
       const xp=boxes['.corti-xp'],level=boxes['.corti-level'];
       const rows=['[data-corti-hearts]','[data-corti-food]','[data-corti-air]','[data-corti-mana-vital]'].map(s=>boxes[s]).filter(b=>b.w&&b.h);
       const intersects=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>.5;
       return {pass:rows.every(r=>!intersects(r,xp)&&!intersects(r,level))&&xp.bottom<=boxes['.corti-hotbar'].y,boxes};
     },{state,scale});
     check(`${mode} scale=${scale}: XP/level do not cover health/food/air/mana`,geometry);
   }
 }
 await page.screenshot({path:path.join(out,'hud-layout-'+run+'.png')});
}catch(error){report.errors.push(error.stack??String(error));}
finally{await browser?.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'hud-layout-'+run+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});process.exitCode=report.errors.length?1:0;}
