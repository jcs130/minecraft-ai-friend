/** Display only. Never changes the game camera, controls or scene identity. */
function installViewerFullscreen({document,window,root=document.documentElement??document.body,button,onChange=()=>{}}={}){
  if(!root||!button)return{toggle(){},dispose(){}}
  let disposed=false,expanded=false,pending=false,previousOverflow
  const active=()=>document.fullscreenElement===root||document.webkitFullscreenElement===root||expanded
  const update=()=>{if(disposed)return;const value=active();button.textContent=value?'退出全屏':'全屏';button.setAttribute('aria-label',value?'退出全屏观看':'全屏观看');button.setAttribute('aria-pressed',String(value));onChange(value)}
  const collapse=()=>{if(!expanded)return;expanded=false;delete root.dataset.viewerFullscreen;document.body.style.overflow=previousOverflow??'';previousOverflow=undefined;update()}
  const exit=async()=>{
    collapse()
    if(document.fullscreenElement===root)await document.exitFullscreen?.()
    else if(document.webkitFullscreenElement===root)await document.webkitExitFullscreen?.()
  }
  const expandWindow=()=>{if(disposed)return;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';expanded=true;root.dataset.viewerFullscreen='window';update()}
  async function toggle(){
    if(disposed||pending)return
    pending=true
    try{
      if(active())await exit()
      else{
        const request=root.requestFullscreen??root.webkitRequestFullscreen
        if(request){try{await request.call(root);if(disposed)await exit()}catch{expandWindow()}}
        else expandWindow()
      }
    }finally{pending=false;update()}
  }
  const key=e=>{if(expanded&&(e.key==='Escape'||e.code==='Escape')){e.preventDefault?.();collapse()}}
  const click=()=>{void toggle()}
  button.addEventListener('click',click)
  document.addEventListener('fullscreenchange',update);document.addEventListener('webkitfullscreenchange',update)
  window.addEventListener('keydown',key)
  update()
  return{toggle,active,dispose(){if(disposed)return;collapse();if(document.fullscreenElement===root)void Promise.resolve(document.exitFullscreen?.()).catch(()=>{});else if(document.webkitFullscreenElement===root)void Promise.resolve(document.webkitExitFullscreen?.()).catch(()=>{});disposed=true;button.removeEventListener('click',click);document.removeEventListener('fullscreenchange',update);document.removeEventListener('webkitfullscreenchange',update);window.removeEventListener('keydown',key)}}
}

window.QdViewerFullscreen = { install: installViewerFullscreen };
