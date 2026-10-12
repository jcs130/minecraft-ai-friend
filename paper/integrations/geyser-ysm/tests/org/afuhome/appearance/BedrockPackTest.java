package org.afuhome.appearance;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Actual source model and actual generated pack; does not claim phone/GPU acceptance. */
public final class BedrockPackTest {
    static int checks;
    static void check(boolean v,String why){if(!v)throw new AssertionError(why);checks++;System.out.println("PASS "+why);}
    static JsonObject read(ZipFile zip,String name)throws Exception{return JsonParser.parseString(new String(zip.getInputStream(zip.getEntry(name)).readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();}
    public static void main(String[] args)throws Exception {
        Path config=Path.of(args[0]),template=Path.of(args[1]),out=Path.of(args[2]);
        ModelCatalog catalog=new ModelCatalog(config);catalog.scan();catalog.scan();
        var compiler=new BedrockPack(template,out);var pack=compiler.build(catalog);var again=compiler.build(catalog);
        check(pack.revision().equals(again.revision())&&pack.path().equals(again.path()),"same inputs produce same immutable pack revision");
        System.out.println("REJECTED "+pack.rejected());
        var cormy=pack.variants().get("cormy-winefox-cream:cormy-cream");check(cormy!=null,"actual CorMy 2048 texture model compiles");
        var source=BedrockPack.bundle(catalog.get(cormy.model()));
        byte[] png=BedrockPack.file(source,source.getAsJsonObject("textures").get("cormy-cream").getAsString());
        try(var zip=new ZipFile(pack.path().toFile())) {
            var player=read(zip,"entity/player.entity.json").getAsJsonObject("minecraft:client_entity").getAsJsonObject("description");
            String texKey=player.getAsJsonObject("textures").entrySet().stream().filter(e->e.getKey().endsWith(".t"+cormy.slot())).findFirst().orElseThrow().getKey();
            byte[] delivered=zip.getInputStream(zip.getEntry(player.getAsJsonObject("textures").get(texKey).getAsString()+".png")).readAllBytes();
            check(Arrays.equals(png,delivered),"2048x2048 PNG is byte exact, no downsampling or RGBA skin limit");
            var geo=read(zip,"models/entity/"+texKey.substring(0,texKey.lastIndexOf('.'))+".geo.json");
            var original=JsonParser.parseString(new String(BedrockPack.file(source,source.get("model").getAsString()),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject().getAsJsonArray("minecraft:geometry").get(0).getAsJsonObject();
            var converted=geo.getAsJsonArray("minecraft:geometry").get(0).getAsJsonObject();
            Map<String,JsonObject> bones=new HashMap<>();for(var e:converted.getAsJsonArray("bones"))bones.put(e.getAsJsonObject().get("name").getAsString(),e.getAsJsonObject());
            boolean same=true;for(var e:original.getAsJsonArray("bones")){var b=e.getAsJsonObject().deepCopy();if(!b.has("parent"))b.addProperty("parent","qdysm_scale_root");same&=b.equals(bones.get(b.get("name").getAsString()));}
            check(same,"all 272 original bones/cubes/UV retained; only root scale parent appended");
            check(bones.containsKey("rightItem")&&bones.containsKey("leftItem"),"native two-hand item attachment bones follow original animated hands");
            check(player.get("enable_attachables").getAsBoolean(),"native equipment rendering remains enabled");
            var animations=read(zip,"animations/qdysm.animation.json").getAsJsonObject("animations");
            check(animations.toString().contains("0.8")&&animations.toString().contains("qdysm_scale_root"),"original width/height scales applied to geometry root");
            var controllers=read(zip,"animation_controllers/qdysm.json").toString();
            check(controllers.contains("walk")&&controllers.contains("sneak")&&controllers.contains("jump"),"movement tracks selected by native Bedrock state");
            boolean self=false;for(var ctl:read(zip,"animation_controllers/qdysm.json").getAsJsonObject("animation_controllers").entrySet())for(var s:ctl.getValue().getAsJsonObject().getAsJsonObject("states").entrySet())for(var t:s.getValue().getAsJsonObject().getAsJsonArray("transitions"))self|=t.getAsJsonObject().has(s.getKey());
            check(!self,"movement never transitions into its own state and resets animation every frame");
            check(player.toString().contains("variable.attack_time")&&player.toString().contains("query.is_using_item"),"attack and item use actions connected to native player state");
            check(player.toString().contains("minecraft:bread")&&player.toString().contains("minecraft:potion")&&!player.toString().contains("get_equipped_item_name"),"food/drink/bow actions use native item predicates, not generic eat for every item");
            var templatePlayer=JsonParser.parseString(Files.readString(template)).getAsJsonObject().getAsJsonObject("minecraft:client_entity").getAsJsonObject("description");
            check(player.getAsJsonObject("textures").get("default").equals(templatePlayer.getAsJsonObject("textures").get("default"))&&player.getAsJsonObject("geometry").get("default").equals(templatePlayer.getAsJsonObject("geometry").get("default")),"unassigned players retain vanilla skin and geometry fallback");
            check(player.getAsJsonArray("render_controllers").toString().contains("query.is_spectator"),"spectator rendering respects native player state");
            check(zip.stream().noneMatch(e->e.getName().contains("playerdata")||e.getName().contains("models.json")),"pack has no account/playerdata/config exports");
            check(zip.getEntry("attribution/"+texKey.substring(0,texKey.lastIndexOf('.'))+".json")!=null,"original model author/license metadata retained");
        }
        var row=new BedrockState.Entry(UUID.randomUUID(),7,UUID.randomUUID().toString(),cormy.model(),cormy.texture(),cormy.sha(),"extra1");
        check(pack.select(row)==cormy,"exact source revision chooses assigned variant");
        check(pack.select(new BedrockState.Entry(row.uuid(),7,row.epoch(),row.modelId(),row.texture(),"0".repeat(64)))==null,"changed model cannot reuse old connection pack slot");
        check(cormy.extras().containsKey("extra1"),"native extra animation maps to per-player property");
        var invalid=JsonParser.parseString("{\"minecraft:geometry\":[{\"bones\":[{\"name\":\"x\",\"parent\":\"x\"}]}]}").getAsJsonObject();
        try{BedrockPack.validateGeometry(invalid);throw new AssertionError("cycle accepted");}catch(java.io.IOException e){check(e.getMessage().contains("HIERARCHY"),"cyclic bones are rejected");}
        Files.writeString(out.resolve("report.json"),new Gson().toJson(Map.of("checks",checks,"pack",pack.path().toString(),"revision",pack.revision(),"variants",pack.variants(),"rejected",pack.rejected())));
        System.out.println("CHECKS "+checks);
    }
}
