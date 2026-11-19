const corners=[
  [[0,0,0],[0,1,0],[0,1,1],[0,0,1]],[[1,0,1],[1,1,1],[1,1,0],[1,0,0]],
  [[0,0,1],[1,0,1],[1,0,0],[0,0,0]],[[0,1,0],[1,1,0],[1,1,1],[0,1,1]],
  [[1,0,0],[1,1,0],[0,1,0],[0,0,0]],[[0,0,1],[0,1,1],[1,1,1],[1,0,1]]
];
const tones=[.84,.93,.68,1.08,.77,.95];
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function showLocalScene(panel,data) {
  if(data.schema!=='local-scene-preview/v1'||!Array.isArray(data.faces)||!data.faces.length)throw Error('此场景没有可显示的表面');
  const faces=data.faces;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  const mesh=faces.map(([x,y,z,face,colour])=>{
    const vertices=corners[face].map(([dx,dy,dz])=>[x+dx,y+dy,z+dz]);
    for(const point of vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
    const rgb=[colour>>16,(colour>>8)&255,colour&255].map(c=>clamp(Math.round(c*tones[face]),0,255));
    return {vertices,color:'rgb('+rgb.join(',')+')'};
  });
  const center=min.map((value,i)=>(value+max[i])/2);
  const radius=Math.max(2,Math.hypot(...max.map((v,i)=>v-min[i]))/2);
  panel.innerHTML='<canvas tabindex="0" role="img" aria-label="照片拍摄时可见的方块表面，可用方向键旋转"></canvas><div class="scene-controls"><span>拖动或用方向键旋转</span><button type="button" data-scene-control="closer" aria-label="放大场景">＋</button><button type="button" data-scene-control="farther" aria-label="缩小场景">－</button><button type="button" data-scene-control="reset">复位</button></div>';
  const canvas=panel.querySelector('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('当前浏览器无法绘制场景');
  let yaw,pitch,zoom,frame=0;
  function reset(){yaw=Number(data.yaw)||0;pitch=.38;zoom=1;}
  function draw(){
    frame=0;
    const width=canvas.clientWidth||500,height=canvas.clientHeight||300,scale=Math.min(2,devicePixelRatio||1);
    canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);ctx.setTransform(scale,0,0,scale,0,0);
    const bg=ctx.createLinearGradient(0,0,0,height);bg.addColorStop(0,'#a7c5d6');bg.addColorStop(1,'#ecede0');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
    const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
    const dist=radius*3.1, focal=Math.min(width,height)*1.3*zoom;
    function point([x,y,z]){
      x-=center[0];y-=center[1];z-=center[2];const forward=x*sy+z*cy,depth=dist-forward*cp-y*sp;
      return [width/2+(x*cy-z*sy)*focal/depth,height/2-(y*cp-forward*sp)*focal/depth,depth];
    }
    const projected=mesh.map(f=>{const pts=f.vertices.map(point);return {pts,color:f.color,depth:pts.reduce((s,v)=>s+v[2],0)/4};});
    projected.sort((a,b)=>b.depth-a.depth);
    ctx.lineWidth=.4;
    for(const {pts,color} of projected){
      ctx.beginPath();pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
      ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=color;ctx.stroke();
    }
  }
  function paint(){if(!frame)frame=requestAnimationFrame(draw);}
  reset();draw();
  let drag=null;
  canvas.addEventListener('pointerdown',event=>{drag=[event.pointerId,event.clientX,event.clientY];canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag[0])return;yaw-=(event.clientX-drag[1])*.012;pitch=clamp(pitch+(event.clientY-drag[2])*.012,-1.25,1.25);drag=[event.pointerId,event.clientX,event.clientY];paint();});
  canvas.addEventListener('lostpointercapture',()=>{drag=null;});
  canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','+','-'].includes(event.key))return;event.preventDefault();if(event.key==='Home')reset();else if(event.key==='+'||event.key==='-')zoom=clamp(zoom*(event.key==='+'?1.15:1/1.15),.5,3);else{yaw+=event.key==='ArrowLeft'?-.15:event.key==='ArrowRight'?.15:0;pitch=clamp(pitch+(event.key==='ArrowUp'?.12:event.key==='ArrowDown'?-.12:0),-1.25,1.25);}paint();});
  panel.querySelector('.scene-controls').addEventListener('click',event=>{const action=event.target.closest('button')?.dataset.sceneControl;if(!action)return;if(action==='reset')reset();else zoom=clamp(zoom*(action==='closer'?1.25:.8),.5,3);paint();});
  const observer=new ResizeObserver(paint);observer.observe(canvas);
  return ()=>{observer.disconnect();cancelAnimationFrame(frame);};
}
