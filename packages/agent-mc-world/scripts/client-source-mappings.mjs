import fs from'node:fs/promises';import{createHash}from'node:crypto';
/** Build-time namespace mapping; inputs must be the exact 1.21.1 official/intermediary/Mojang tuple. */
export async function clientSourceMappings(file){
 const bytes=await fs.readFile(file),lines=bytes.toString('utf8').split(/\r?\n/);
 if(lines[0]!=='tiny\t2\t0\tofficial\tintermediary\tnamed')throw Error('Expected official/intermediary/Mojang named mappings');
 const classes=new Map(),names=new Map();
 for(const line of lines){const p=line.split('\t');if(p[0]==='c')classes.set(p[2],p[3]);else if(p[0]===''&&(p[1]==='f'||p[1]==='m')&&p[4]){let values=names.get(p[4]);if(!values)names.set(p[4],values=new Set());values.add(p[5]);}}
 const rewritten=new Set();
 function translate(source){
  let value=source.replace(/net\/minecraft\/class_\d+(?:\$class_\d+)*/g,id=>{const name=classes.get(id);if(!name)throw Error('Unmapped Minecraft class '+id);rewritten.add(id);return name;});
  value=value.replace(/(?:net\.minecraft\.)?class_\d+(?:\.class_\d+)*/g,id=>{
   const key=(id.startsWith('net.minecraft.')?id.replace(/^net\.minecraft\./,'') :id).replaceAll('.','$'),name=classes.get('net/minecraft/'+key);
   if(!name)throw Error('Unmapped Minecraft source class '+id);rewritten.add('net/minecraft/'+key);return name.replaceAll('/','.').replaceAll('$','.');
  });
  value=value.replace(/\b(?:method|field)_\d+\b/g,id=>{const found=names.get(id);if(!found||found.size!==1)throw Error('Ambiguous or missing Minecraft member '+id+': '+JSON.stringify(found?[...found]:[]));rewritten.add(id);return[...found][0];});
  for(const name of['ClientTickEvents','ClientLifecycleEvents','ClientPlayConnectionEvents','ClientReceiveMessageEvents','HudRenderCallback','WorldRenderEvents','KeyBindingHelper','ClientPlayNetworking','PayloadTypeRegistry'])value=value.replace(new RegExp('import net\\.fabricmc\\.[^;]+\\.'+name+';','g'),'import org.agentmc.platform.ClientRuntime.'+name+';');
  value=value.replaceAll('import net.fabricmc.api.ClientModInitializer;','import org.agentmc.platform.ClientRuntime.ClientEntrypoint;').replaceAll('ClientModInitializer','ClientEntrypoint');
  value=value.replaceAll('import net.fabricmc.loader.api.FabricLoader;','import org.agentmc.platform.ClientRuntime.ClientLoader;').replaceAll('FabricLoader','ClientLoader');
  if(/net\.fabricmc|class_\d+|\b(?:method|field)_\d+\b/.test(value))throw Error('Fabric/intermediary reference survived native translation');
  return value;
 }
 return{translate,report:()=>({sourceSha256:createHash('sha256').update(bytes).digest('hex'),namespaces:['official','intermediary','named'],rewritten:[...rewritten].sort()})};
}
