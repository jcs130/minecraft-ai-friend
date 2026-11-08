"""Compile actual spawn/view selection methods with a minimal transport fixture, no server."""
from pathlib import Path
import argparse,re,subprocess,tempfile,os
p=argparse.ArgumentParser();p.add_argument('--jdk',type=Path,required=True);p.add_argument('--extension-source',type=Path);p.add_argument('--view-source',type=Path);a=p.parse_args()
root=Path(__file__).resolve().parents[1]
extension=(a.extension_source or root/'geyser-src/local/tlmcompat/geyser/MaidGeyserExtension.java').read_text(encoding='utf-8-sig')
view=(a.view_source or root/'platform-src/local/tlmcompat/numen/VanillaMaidView.java').read_text(encoding='utf-8-sig')
spawn=re.search(r'^    public void spawn\(ServerSpawnEntityEvent event\) \{[\s\S]*?^    \}',extension,re.M)[0]
type_method=re.search(r'^    static EntityType<\?> type\(Entity entity,ServerPlayer viewer\)\{[\s\S]*?^    \}',view,re.M)[0]
code='''import java.util.*;
public class BedrockVisualRuleQa {
 record Identifier(String value){static Identifier of(String s){return new Identifier(s);}}
 record JavaType(String value){boolean is(Identifier id){return value.equals(id.value());}}
 record State(UUID uuid,String modelId,boolean ysm,float width,float height){}
 record Connection(UUID javaUuid){}
 static class MaidVisualRegistry{static Map<UUID,State> states=new HashMap<>();static Map<UUID,Boolean> visible=new HashMap<>();static State get(UUID id){return states.get(id);}static void rendered(UUID viewer,UUID maid,boolean value){visible.put(maid,value);}}
 static class GeyserEntityDefinition{static String of(Identifier id){return id.value();}}
 static class GeyserEntityDataTypes{static String VERTICAL_OFFSET="offset",WIDTH="width",HEIGHT="height";}
 static class WireEntity{String applied;void override(String key,float value){}}
 static class ServerSpawnEntityEvent{UUID id;Connection c;JavaType t;String d;java.util.function.Consumer<WireEntity> before;
 ServerSpawnEntityEvent(UUID id,Connection c,String type){this.id=id;this.c=c;t=new JavaType(type);d=type;}
 UUID uuid(){return id;}Connection connection(){return c;}JavaType entityType(){return t;}void definition(String def){d=def;}void preSpawnConsumer(java.util.function.Consumer<WireEntity> f){before=f;}}
 boolean enabled=true,packRegistered=true;Set<Connection> offered=new HashSet<>();Map<String,Object> models=new HashMap<>();String definition="qiandengji:maid";
 void apply(WireEntity entity,State state){entity.applied=state.modelId();}
 void apply(WireEntity entity,State state,boolean immediate){entity.applied=state.modelId();}
 SPAWN
 static class EntityType<T>{String name;EntityType(String s){name=s;}static EntityType<?> VILLAGER=new EntityType<>("villager"),ALLAY=new EntityType<>("allay"),VEX=new EntityType<>("vex"),SMALL_FIREBALL=new EntityType<>("small_fireball"),SNOWBALL=new EntityType<>("snowball");}
 static class Entity{String kind;Entity(String k){kind=k;}} static class LivingEntity extends Entity{LivingEntity(String k){super(k);}}
 static class ServerPlayer{boolean bedrock;ServerPlayer(boolean value){bedrock=value;}}
 static String kind(Entity e){return e.kind;}static boolean bedrock(ServerPlayer p){return p!=null&&p.bedrock;}
 TYPE_METHOD
 static int n;static void check(boolean value,String label){if(!value)throw new AssertionError(label);n++;}
 public static void main(String[] args){
  var q=new BedrockVisualRuleQa();var c=new Connection(UUID.randomUUID());q.offered.add(c);UUID maid=UUID.randomUUID();
  String key=local.tlmcompat.numen.MaidVisualKey.ysm("qd_dafeiyu","pearl");q.models.put(key,new Object());MaidVisualRegistry.states.put(maid,new State(maid,key,true,.6f,1.5f));
  var e=new ServerSpawnEntityEvent(maid,c,"minecraft:villager");q.spawn(e);check(e.d.equals(q.definition),"known YSM maid must receive its resource-pack model instead of remaining a villager");
  var wire=new WireEntity();e.before.accept(wire);check(key.equals(wire.applied),"original model/texture key applied");check(MaidVisualRegistry.visible.get(maid),"custom rendered status follows exact spawn");
  e=new ServerSpawnEntityEvent(maid,c,"minecraft:allay");q.spawn(e);check(e.d.equals(q.definition),"allay carrier reaches custom model");
  q.offered.clear();e=new ServerSpawnEntityEvent(maid,c,"minecraft:villager");q.spawn(e);check(e.d.equals("minecraft:allay"),"no offered pack falls back to allay");check(!MaidVisualRegistry.visible.get(maid),"fallback clears rendered status");
  q.offered.add(c);q.models.clear();e=new ServerSpawnEntityEvent(maid,c,"minecraft:villager");q.spawn(e);check(e.d.equals("minecraft:allay"),"unknown/encrypted model falls back to allay");
  q.models.put(key,new Object());q.enabled=false;e=new ServerSpawnEntityEvent(maid,c,"minecraft:villager");q.spawn(e);check(e.d.equals("minecraft:allay"),"disabled mapping remains allay");q.enabled=true;
  e=new ServerSpawnEntityEvent(UUID.randomUUID(),c,"minecraft:villager");q.spawn(e);check(e.d.equals("minecraft:villager"),"ordinary villager never replaced");
  e=new ServerSpawnEntityEvent(UUID.randomUUID(),c,"minecraft:allay");q.spawn(e);check(e.d.equals("minecraft:allay"),"ordinary allay never replaced");
  e=new ServerSpawnEntityEvent(maid,c,"minecraft:zombie");q.spawn(e);check(e.d.equals("minecraft:zombie"),"other entity types untouched");
  MaidVisualRegistry.states.put(maid,new State(maid,"tlm:native",false,.6f,1.5f));q.models.put("tlm:native",new Object());e=new ServerSpawnEntityEvent(maid,c,"minecraft:allay");q.spawn(e);check(e.d.equals(q.definition),"original native maid mapping retained");
  check(type(new LivingEntity("maid"),new ServerPlayer(true))==EntityType.ALLAY,"Bedrock wire default must be allay");check(type(new LivingEntity("maid"),new ServerPlayer(false))==EntityType.ALLAY,"Java wire default allay");check(type(new LivingEntity("maid"),null)==EntityType.ALLAY,"observer allay");
  check(type(new LivingEntity("fairy"),null)==EntityType.VEX,"hostile fairy unchanged");check(type(new Entity("danmaku"),null)==EntityType.SMALL_FIREBALL,"projectile unchanged");
  String unicode=local.tlmcompat.numen.MaidVisualKey.ysm("大肥鱼/公开.zip","月光");check(unicode.startsWith("ysm:")&&!unicode.contains("\\t")&&!unicode.contains("\\n"),"safe unicode selection key");check(!key.equals(local.tlmcompat.numen.MaidVisualKey.ysm("qd_dafeiyu","moon")),"textures stay distinct");check(local.tlmcompat.numen.MaidVisualKey.ysm(null,"a").isEmpty(),"invalid model stays unmapped");
  System.out.println(n+" production-method Bedrock visual checks passed");
 }
}'''.replace('SPAWN',spawn).replace('TYPE_METHOD',type_method)
with tempfile.TemporaryDirectory(prefix='maid-visual-rules-') as tmp:
    t=Path(tmp);(t/'BedrockVisualRuleQa.java').write_text(code,encoding='utf-8')
    suffix='.exe' if os.name=='nt' else ''
    subprocess.run([str(a.jdk/'bin'/('javac'+suffix)),'--release','21','-encoding','UTF-8','-d',tmp,str(t/'BedrockVisualRuleQa.java'),str(root/'platform-src/local/tlmcompat/numen/MaidVisualKey.java')],check=True)
    subprocess.run([str(a.jdk/'bin'/('java'+suffix)),'-cp',tmp,'BedrockVisualRuleQa'],check=True)
