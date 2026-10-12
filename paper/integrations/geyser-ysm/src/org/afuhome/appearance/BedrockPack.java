package org.afuhome.appearance;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import javax.imageio.ImageIO;

/** Immutable, per-connection resource pack. Never changes a gameplay entity or shrinks textures.
 * The vanilla template is fetched separately at a pinned revision, not copied into the repository. */
final class BedrockPack {
    static final String TEMPLATE_SHA="7e520d872fc72be266223b3db2883c2818742a9a450330753a6de4d2ad813608";
    static final String SLOT="qdysm:model", EXTRA="qdysm:extra";
    static final int MAX_VARIANTS=128;
    record Variant(int slot,String model,String texture,String sha,Map<String,Integer> extras) { }
    record Snapshot(String revision,Path path,Map<String,Variant> variants,Map<String,String> rejected) {
        Variant select(BedrockState.Entry row) {
            Variant v=variants.get(row.modelId()+":"+row.texture());
            return v!=null && v.sha.equals(row.sha256()) ? v : null;
        }
    }
    private final Path template,output;
    BedrockPack(Path template,Path output) throws Exception {
        this.template=template;this.output=output;
        if(!template.isAbsolute() || Files.isSymbolicLink(template) || Files.size(template)>64*1024 || !ModelCatalog.sha(Files.readAllBytes(template)).equals(TEMPLATE_SHA))throw new IOException("YSM_BEDROCK_TEMPLATE_MISMATCH");
        Files.createDirectories(output);
        if(!output.isAbsolute() || Files.isSymbolicLink(output))throw new IOException("YSM_BEDROCK_PACK_PATH_INVALID");
    }
    Snapshot build(ModelCatalog catalog) throws Exception {
        JsonObject player=JsonParser.parseString(Files.readString(template)).getAsJsonObject();
        JsonObject d=player.getAsJsonObject("minecraft:client_entity").getAsJsonObject("description");
        String enabled="query.property('"+SLOT+"') > 0 && !query.is_spectator";
        // Normal players retain the pinned vanilla scripts, animations, skin, cape and attachables.
        JsonArray originalRender=d.getAsJsonArray("render_controllers");
        for(JsonElement e:originalRender)for(var rule:e.getAsJsonObject().entrySet())rule.setValue(new JsonPrimitive("("+rule.getValue().getAsString()+") && !("+enabled+")"));
        d.getAsJsonObject("scripts").addProperty("scale","("+enabled+") ? 1.0 : 0.9375");
        d.getAsJsonObject("scripts").add("animate",array(Map.of("root","!("+enabled+")")));
        Map<String,byte[]> entries=new TreeMap<>();Map<String,Variant> variants=new TreeMap<>();Map<String,String> rejected=new TreeMap<>();
        JsonObject render=new JsonObject(),controllers=new JsonObject(),allAnimations=new JsonObject();
        int modelNumber=0;long bytes=0;
        for(String id:new TreeSet<>(catalog.catalog().keySet())) {
            if(modelNumber>=32){rejected.put(id,"YSM_BEDROCK_PACK_MODEL_BUDGET");continue;}
            var asset=catalog.get(id);
            try {
                JsonObject bundle=bundle(asset),spec=json(file(bundle,"ysm.json"));
                JsonObject source=json(file(bundle,bundle.get("model").getAsString()));validateGeometry(source);
                if(bundle.has("controllers") && !bundle.getAsJsonArray("controllers").isEmpty())throw new IOException("YSM_BEDROCK_CUSTOM_CONTROLLERS_UNSUPPORTED");
                String prefix="qdysm.m"+modelNumber;
                JsonObject animations=readAnimations(bundle,prefix);
                JsonObject properties=spec.getAsJsonObject("properties");
                float height=scale(properties,"height_scale"),width=scale(properties,"width_scale");
                animations.add("__qdysm_scale",new Gson().toJsonTree(Map.of("loop",true,"bones",Map.of("qdysm_scale_root",Map.of("scale",List.of(width,height,width))))));
                JsonObject playerFiles=spec.getAsJsonObject("files").getAsJsonObject("player");
                JsonObject main=geometry(source,prefix+".main",height,width);
                JsonObject arm=null;
                if(playerFiles.getAsJsonObject("model").has("arm")) {
                    arm=json(file(bundle,playerFiles.getAsJsonObject("model").get("arm").getAsString()));validateGeometry(arm);
                    arm=geometry(arm,prefix+".arm",height,width);
                }
                Map<String,byte[]> modelEntries=new TreeMap<>();
                modelEntries.put("models/entity/"+prefix+".geo.json",encode(main));
                if(arm!=null)modelEntries.put("models/entity/"+prefix+".arm.geo.json",encode(arm));
                Map<String,byte[]> pngs=new TreeMap<>();
                for(String texture:new TreeSet<>(asset.textures())) {
                    byte[] png=file(bundle,bundle.getAsJsonObject("textures").get(texture).getAsString());validateTexture(png,source);
                    pngs.put(texture,png);
                }
                long modelBytes=modelEntries.values().stream().mapToLong(a->a.length).sum()+pngs.values().stream().mapToLong(a->a.length).sum()+encode(animations).length;
                if(bytes+modelBytes>48L*1024*1024 || variants.size()+pngs.size()>MAX_VARIANTS)throw new IOException("YSM_BEDROCK_PACK_BYTE_BUDGET");
                bytes+=modelBytes;modelNumber++;
                entries.putAll(modelEntries);
                Map<String,Integer> extras=extras(animations);
                JsonObject aliases=d.getAsJsonObject("animations");
                for(var a:animations.entrySet()) {String alias=alias(prefix,a.getKey());aliases.addProperty(alias,animationId(prefix,a.getKey()));allAnimations.add(animationId(prefix,a.getKey()),a.getValue());}
                String ctl="controller.animation."+prefix+".movement";
                controllers.add(ctl,movement(animations,prefix));aliases.addProperty(prefix+".movement",ctl);
                d.getAsJsonObject("scripts").getAsJsonArray("animate").add(new Gson().toJsonTree(Map.of(prefix+".movement","variable."+prefix.replace('.','_')+"_active")));
                String active="("+enabled+") && (";
                List<String> predicates=new ArrayList<>();
                for(var png:pngs.entrySet()) {
                    int slot=variants.size()+1;String name=prefix+".t"+slot;
                    variants.put(id+":"+png.getKey(),new Variant(slot,id,png.getKey(),asset.sha256(),extras));
                    String condition="query.property('"+SLOT+"') == "+slot;predicates.add(condition);
                    String texturePath="textures/qdysm/"+name;
                    entries.put(texturePath+".png",png.getValue());
                    d.getAsJsonObject("textures").addProperty(name,texturePath);
                    d.getAsJsonObject("geometry").addProperty(name,"geometry."+prefix+".main");
                    addRender(d,render,name,"("+enabled+") && "+condition+" && !variable.is_first_person",name);
                    if(arm!=null) {
                        d.getAsJsonObject("geometry").addProperty(name+"_arm","geometry."+prefix+".arm");
                        addRender(d,render,name+"_arm","("+enabled+") && "+condition+" && variable.is_first_person",name);
                    } else {
                        // Preserve functional vanilla first-person hands when a model has no arm geometry.
                        originalRender.add(new Gson().toJsonTree(Map.of("controller.render.player.first_person","("+enabled+") && "+condition+" && variable.is_first_person")));
                    }
                }
                d.getAsJsonObject("scripts").getAsJsonArray("pre_animation").add("variable."+prefix.replace('.','_')+"_active = "+active+String.join(" || ",predicates)+");");
                for(String always:List.of("__qdysm_scale","head:default","pre_parallel0","pre_parallel1","pre_parallel2","parallel2","parallel3","parallel4"))if(animations.has(always))
                    d.getAsJsonObject("scripts").getAsJsonArray("animate").add(new Gson().toJsonTree(Map.of(alias(prefix,always),"variable."+prefix.replace('.','_')+"_active")));
                addActions(d,controllers,animations,prefix,extras);
                // Embedded source metadata is retained for attribution; it contains no account/private state.
                modelEntries.put("attribution/"+prefix+".json",encode(spec.getAsJsonObject("metadata")));
                entries.put("attribution/"+prefix+".json",modelEntries.get("attribution/"+prefix+".json"));
            } catch(Exception error) {rejected.put(id,reason(error));}
        }
        entries.put("entity/player.entity.json",encode(player));
        entries.put("render_controllers/qdysm.json",encode(Map.of("format_version","1.8.0","render_controllers",render)));
        entries.put("animation_controllers/qdysm.json",encode(Map.of("format_version","1.10.0","animation_controllers",controllers)));
        entries.put("animations/qdysm.animation.json",encode(Map.of("format_version","1.8.0","animations",allAnimations)));
        String revision=ModelCatalog.sha(encode(entries.entrySet().stream().map(e->e.getKey()+":"+sha(e.getValue())).toList()));
        UUID pack=UUID.nameUUIDFromBytes(("qdysm:pack:"+revision).getBytes(StandardCharsets.UTF_8)),module=UUID.nameUUIDFromBytes(("qdysm:module:"+revision).getBytes(StandardCharsets.UTF_8));
        entries.put("manifest.json",encode(Map.of("format_version",2,"header",Map.of("name","千灯纪角色外观","description","服务器角色模型、高清贴图与动作；更新后重新连接","uuid",pack.toString(),"version",List.of(1,0,0),"min_engine_version",List.of(1,26,0)),"modules",List.of(Map.of("type","resources","uuid",module.toString(),"version",List.of(1,0,0))))));
        Path target=output.resolve(revision+".mcpack");
        if(!Files.exists(target)) {
            Path tmp=Files.createTempFile(output,".pack-",".tmp");
            try {
                try(var zip=new ZipOutputStream(Files.newOutputStream(tmp))) {for(var e:entries.entrySet()){var entry=new ZipEntry(e.getKey());entry.setTime(0);zip.putNextEntry(entry);zip.write(e.getValue());zip.closeEntry();}}
                if(Files.size(tmp)>32L*1024*1024)throw new IOException("YSM_BEDROCK_PACK_COMPRESSED_BUDGET");
                Files.move(tmp,target,StandardCopyOption.ATOMIC_MOVE);
            } finally {Files.deleteIfExists(tmp);}
        }
        return new Snapshot(revision,target,Map.copyOf(variants),Map.copyOf(rejected));
    }
    private static String sha(byte[] b){try{return ModelCatalog.sha(b);}catch(Exception e){throw new IllegalStateException(e);}}
    static JsonObject bundle(ModelCatalog.Asset asset) throws Exception {
        try(var in=new GZIPInputStream(new ByteArrayInputStream(asset.gzip()))) {
            byte[] bytes=in.readNBytes(ModelCatalog.RAW_LIMIT+1);if(bytes.length>ModelCatalog.RAW_LIMIT)throw new IOException("YSM_BEDROCK_BUNDLE_BUDGET");return json(bytes);
        }
    }
    static byte[] file(JsonObject bundle,String path) throws Exception {
        JsonObject f=bundle.getAsJsonObject("files").getAsJsonObject(path);
        if(f==null)throw new IOException("YSM_BEDROCK_REFERENCED_FILE_MISSING");
        byte[] bytes=Base64.getDecoder().decode(f.get("base64").getAsString());
        if(bytes.length!=f.get("bytes").getAsInt() || !ModelCatalog.sha(bytes).equals(f.get("sha256").getAsString()))throw new IOException("YSM_BEDROCK_SOURCE_HASH_MISMATCH");return bytes;
    }
    private static JsonObject json(byte[] bytes){return JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();}
    private static byte[] encode(Object value){return new Gson().toJson(value).getBytes(StandardCharsets.UTF_8);}
    private static JsonArray array(Object value){JsonArray a=new JsonArray();a.add(new Gson().toJsonTree(value));return a;}
    static String reason(Exception e){return e.getMessage()!=null && e.getMessage().startsWith("YSM_")?e.getMessage():"YSM_BEDROCK_PACK_MODEL_INVALID";}
    private static float scale(JsonObject p,String name) throws IOException {float v=p.has(name)?p.get(name).getAsFloat():1; if(!Float.isFinite(v)||v<0.1||v>4)throw new IOException("YSM_BEDROCK_SCALE_INVALID");return v;}
    static void validateGeometry(JsonObject geo) throws IOException {
        JsonArray gs=geo.getAsJsonArray("minecraft:geometry");if(gs==null||gs.size()!=1)throw new IOException("YSM_BEDROCK_GEOMETRY_UNSUPPORTED");
        JsonArray bones=gs.get(0).getAsJsonObject().getAsJsonArray("bones");if(bones==null||bones.isEmpty()||bones.size()>512)throw new IOException("YSM_BEDROCK_BONE_BUDGET");
        Map<String,String> parents=new HashMap<>();int cubes=0;
        for(var b:bones){var bone=b.getAsJsonObject();String name=bone.get("name").getAsString();if(name.isEmpty()||name.length()>96||parents.containsKey(name))throw new IOException("YSM_BEDROCK_BONE_INVALID");parents.put(name,bone.has("parent")?bone.get("parent").getAsString():null);if(bone.has("cubes"))cubes+=bone.getAsJsonArray("cubes").size();}
        if(cubes>4096 || encode(geo).length>1024*1024)throw new IOException("YSM_BEDROCK_GEOMETRY_BYTE_BUDGET");
        for(String name:parents.keySet()){Set<String> path=new HashSet<>();while(name!=null){if(!parents.containsKey(name)||!path.add(name))throw new IOException("YSM_BEDROCK_BONE_HIERARCHY_INVALID");name=parents.get(name);}}
    }
    static void validateTexture(byte[] png,JsonObject geo) throws IOException {
        if(png.length<33)throw new IOException("YSM_BEDROCK_PNG_INVALID");var b=java.nio.ByteBuffer.wrap(png);int w=b.getInt(16),h=b.getInt(20);
        if(w<1||h<1||w>2048||h>2048)throw new IOException("YSM_BEDROCK_TEXTURE_DIMENSIONS_BUDGET");
        JsonObject desc=geo.getAsJsonArray("minecraft:geometry").get(0).getAsJsonObject().getAsJsonObject("description");
        if(desc.get("texture_width").getAsInt()!=w||desc.get("texture_height").getAsInt()!=h)throw new IOException("YSM_BEDROCK_UV_DIMENSIONS_MISMATCH");
        var image=ImageIO.read(new ByteArrayInputStream(png));if(image==null||image.getWidth()!=w||image.getHeight()!=h)throw new IOException("YSM_BEDROCK_PNG_INVALID");
    }
    private static JsonObject geometry(JsonObject geo,String id,float height,float width) throws IOException {
        JsonObject result=geo.deepCopy(),g=result.getAsJsonArray("minecraft:geometry").get(0).getAsJsonObject();g.getAsJsonObject("description").addProperty("identifier","geometry."+id);
        JsonArray bones=g.getAsJsonArray("bones");Set<String> names=new HashSet<>();for(var b:bones)names.add(b.getAsJsonObject().get("name").getAsString());
        String root="qdysm_scale_root";if(names.contains(root))throw new IOException("YSM_BEDROCK_RESERVED_BONE");
        for(var b:bones)if(!b.getAsJsonObject().has("parent"))b.getAsJsonObject().addProperty("parent",root);
        JsonObject scale=new JsonObject();scale.addProperty("name",root);scale.add("pivot",new Gson().toJsonTree(List.of(0,0,0)));bones.add(scale);
        // Bedrock native items bind to these bones; original animated hand locators remain parents.
        for(String side:List.of("Left","Right")) {
            String name=side.toLowerCase()+"Item";
            if(!names.contains(name)) {String parent=names.contains(side+"HandLocator")?side+"HandLocator":names.contains(side+"Hand")?side+"Hand":null;
                if(parent!=null){JsonObject parentBone=null;for(var b:bones)if(b.getAsJsonObject().get("name").getAsString().equals(parent)){parentBone=b.getAsJsonObject();break;}
                    JsonObject bone=new JsonObject();bone.addProperty("name",name);bone.addProperty("parent",parent);bone.add("pivot",parentBone.has("pivot")?parentBone.get("pivot").deepCopy():new Gson().toJsonTree(List.of(0,0,0)));bones.add(bone);}}
        }
        return result;
    }
    private static String alias(String prefix,String name){return prefix+".a"+sha(name.getBytes(StandardCharsets.UTF_8)).substring(0,16);}
    private static String animationId(String prefix,String name){return "animation."+alias(prefix,name);}
    private static JsonObject readAnimations(JsonObject bundle,String prefix) throws Exception {
        JsonObject out=new JsonObject();
        for(String kind:List.of("main","arm","extra")) {
            if(!bundle.getAsJsonObject("animations").has(kind))continue;
            JsonObject source=json(file(bundle,bundle.getAsJsonObject("animations").get(kind).getAsString())).getAsJsonObject("animations");
            if(source.size()>256)throw new IOException("YSM_BEDROCK_ANIMATION_BUDGET");
            for(var a:source.entrySet()) {
                // Some models repeat idle in their hand file. Movement uses main;
                // distinct action names from arm/extra are appended without replacing it.
                if(out.has(a.getKey()))continue;
                String raw=new Gson().toJson(a.getValue());
                // YSM's no-argument head queries use the first head; Bedrock requires an index.
                raw=raw.replaceAll("(query|q)\\.head_([xy])_rotation(?![\\w(])","$1.head_$2_rotation(0)");
                JsonObject animation=JsonParser.parseString(raw).getAsJsonObject();
                if(animation.has("sound_effects")||animation.has("particle_effects"))throw new IOException("YSM_BEDROCK_ANIMATION_EFFECTS_UNSUPPORTED");
                out.add(a.getKey(),animation);
            }
        }
        return out;
    }
    private static void addRender(JsonObject d,JsonObject render,String geometry,String condition,String texture) {
        String name="controller.render."+geometry;
        render.add(name,new Gson().toJsonTree(Map.of("geometry","Geometry."+geometry,"materials",List.of(Map.of("*","Material.default")),"textures",List.of("Texture."+texture))));
        d.getAsJsonArray("render_controllers").add(new Gson().toJsonTree(Map.of(name,condition)));
    }
    private static JsonObject movement(JsonObject animations,String prefix) {
        LinkedHashMap<String,String> conditions=new LinkedHashMap<>();
        conditions.put("sleep","query.is_sleeping");conditions.put("ride","query.is_riding");conditions.put("swim","query.is_swimming");conditions.put("elytra_fly","query.is_gliding");conditions.put("fly","query.can_fly && !query.is_on_ground");conditions.put("jump","!query.is_on_ground");conditions.put("sneaking","query.is_sneaking && query.modified_move_speed > 0.01");conditions.put("sneak","query.is_sneaking");conditions.put("run","query.is_sprinting && query.modified_move_speed > 0.01");conditions.put("walk","query.modified_move_speed > 0.01");conditions.put("idle","1.0");
        JsonObject states=new JsonObject();Map<String,String> selected=new LinkedHashMap<>();String prior="0.0";
        for(var c:conditions.entrySet())if(animations.has(c.getKey())) {
            String when="("+c.getValue()+") && !("+prior+")";selected.put(c.getKey(),when);prior="("+prior+") || ("+c.getValue()+")";
        }
        if(!selected.containsKey("idle"))selected.put("default","!("+prior+")");
        Set<String> all=new LinkedHashSet<>(selected.keySet());all.add("default");
        for(String state:all) {
            JsonArray transitions=new JsonArray();selected.forEach((next,when)->{if(!next.equals(state))transitions.add(new Gson().toJsonTree(Map.of(next,when)));});
            Map<String,Object> data=new LinkedHashMap<>();data.put("transitions",transitions);data.put("blend_transition",0.1);
            if(animations.has(state))data.put("animations",List.of(alias(prefix,state)));
            states.add(state,new Gson().toJsonTree(data));
        }
        return new Gson().toJsonTree(Map.of("initial_state","default","states",states)).getAsJsonObject();
    }
    private static Map<String,Integer> extras(JsonObject animations){Map<String,Integer> out=new TreeMap<>();for(int n=1;n<=16;n++)if(animations.has("extra"+n))out.put("extra"+n,n);return Map.copyOf(out);}
    private static String items(String hand,String... names){return "query.is_item_name_any('slot.weapon."+hand+"', 0, "+String.join(", ",Arrays.stream(names).map(n->"'"+(n.contains(":")?n:"minecraft:"+n)+"'").toList())+")";}
    private static void addActions(JsonObject d,JsonObject controllers,JsonObject animations,String prefix,Map<String,Integer> extras) {
        Map<String,String> actions=new LinkedHashMap<>();
        String sword="(query.equipped_item_any_tag('slot.weapon.mainhand', 'minecraft:is_sword') || "+items("mainhand","wooden_sword","stone_sword","iron_sword","golden_sword","diamond_sword","netherite_sword","qiandengji:frost_sword","qiandengji:blink_dagger","qiandengji:abyss_verdict")+")";
        String axe="(query.equipped_item_any_tag('slot.weapon.mainhand', 'minecraft:is_axe') || "+items("mainhand","wooden_axe","stone_axe","iron_axe","golden_axe","diamond_axe","netherite_axe")+")";
        String bow=items("mainhand","bow"),drink=items("mainhand","potion","milk_bucket","honey_bottle");
        String[] foods={"apple","golden_apple","enchanted_golden_apple","bread","carrot","golden_carrot","potato","baked_potato","poisonous_potato","beetroot","beetroot_soup","mushroom_stew","rabbit_stew","suspicious_stew","beef","cooked_beef","porkchop","cooked_porkchop","chicken","cooked_chicken","mutton","cooked_mutton","rabbit","cooked_rabbit","cod","cooked_cod","salmon","cooked_salmon","tropical_fish","pufferfish","rotten_flesh","spider_eye","melon_slice","sweet_berries","glow_berries","dried_kelp","cookie","pumpkin_pie","chorus_fruit"};
        String food=items("mainhand",foods),offFood=items("offhand",foods);
        String detailed="0.0";
        if(animations.has("swing:sword"))detailed+=" || "+sword;
        if(animations.has("swing:axe"))detailed+=" || "+axe;
        actions.put("hold_mainhand:sword","!query.is_using_item && variable.attack_time <= 0 && "+sword);
        actions.put("hold_mainhand:axe","!query.is_using_item && variable.attack_time <= 0 && "+axe);
        actions.put("hold_mainhand:bow","!query.is_using_item && variable.attack_time <= 0 && "+bow);
        actions.put("hold_offhand:shield",items("offhand","shield"));
        actions.put("swing:sword","variable.attack_time > 0.0 && "+sword);
        actions.put("swing:axe","variable.attack_time > 0.0 && "+axe);
        actions.put("swing_hand","variable.attack_time > 0.0 && !("+detailed+")");
        actions.put("use_mainhand:eat","query.is_using_item && "+food);
        actions.put("use_offhand:eat","query.is_using_item && !("+food+") && "+offFood);
        actions.put("use_mainhand:drink","query.is_using_item && "+drink);
        actions.put("use_mainhand:bow","query.is_using_item && "+bow);
        actions.put("use_mainhand:spyglass","query.is_using_item && "+items("mainhand","spyglass"));
        actions.put("use_mainhand","query.is_using_item && !("+food+" || "+offFood+" || "+drink+" || "+bow+" || "+items("mainhand","spyglass")+")");
        for(var a:actions.entrySet())if(animations.has(a.getKey()))d.getAsJsonObject("scripts").getAsJsonArray("animate").add(new Gson().toJsonTree(Map.of(alias(prefix,a.getKey()),"variable."+prefix.replace('.','_')+"_active && ("+a.getValue()+")")));
        for(var a:extras.entrySet())d.getAsJsonObject("scripts").getAsJsonArray("animate").add(new Gson().toJsonTree(Map.of(alias(prefix,a.getKey()),"variable."+prefix.replace('.','_')+"_active && query.property('"+EXTRA+"') == "+a.getValue())));
    }
}
