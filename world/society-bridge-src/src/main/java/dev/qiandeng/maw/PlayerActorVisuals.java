package dev.qiandeng.maw;

import com.google.gson.*;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.chatbubble.IChatBubbleData;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.network.chat.Component;
import net.minecraft.core.registries.BuiltInRegistries;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.ServerChatEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import java.lang.reflect.Field;
import java.util.*;

/** Display-only, loaded local actors. Public chat and the maid's already public
 * native bubbles only; never commands, DMs, credentials or model prompts.
 * The same optional scene subscription and authentication fence are reused. */
final class PlayerActorVisuals {
    private record Speech(String text,long until){}
    private static final Map<UUID,Speech> SPEECH=new LinkedHashMap<>();
    static void register(){
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST,PlayerActorVisuals::chat);
        NeoForge.EVENT_BUS.addListener(PlayerActorVisuals::logout);
    }
    private static void chat(ServerChatEvent event){
        if(event.isCanceled()||!PlayerAuthBridge.authenticated(event.getPlayer()))return;
        var player=event.getPlayer();String text=clean(event.getMessage().getString(),160);
        if(text.isBlank())return;
        player.getServer().execute(()->{
            SPEECH.entrySet().removeIf(e->e.getValue().until<System.currentTimeMillis());
            if(SPEECH.size()>=256)SPEECH.remove(SPEECH.keySet().iterator().next());
            SPEECH.put(player.getUUID(),new Speech(text,System.currentTimeMillis()+8000));
        });
    }
    private static void logout(PlayerEvent.PlayerLoggedOutEvent e){SPEECH.remove(e.getEntity().getUUID());}
    static String clean(String text,int limit){
        text=text.replaceAll("§.","").replaceAll("[\\p{Cntrl}\\p{Cf}]"," ").strip();
        return text.codePointCount(0,text.length())>limit?text.substring(0,text.offsetByCodePoints(0,limit))+"…":text;
    }
    // The locked TLM 1.5.3 classes expose serializers but no text getter. Read
    // only the exact known Component field; never instantiate client renderers.
    private static final ClassValue<Optional<Field>> TEXT=new ClassValue<>(){
        protected Optional<Field> computeValue(Class<?> type){
            if(!Set.of("TextChatBubbleData","WaitingChatBubbleData","ProgressChatBubbleData").contains(type.getSimpleName())||
               !type.getName().startsWith("com.github.tartaricacid.touhoulittlemaid.entity.chatbubble.implement."))return Optional.empty();
            try{Field f=type.getDeclaredField("text");if(f.getType()!=Component.class||!f.trySetAccessible())return Optional.empty();return Optional.of(f);}
            catch(ReflectiveOperationException e){return Optional.empty();}
        }
    };
    private static JsonArray bubbles(EntityMaid maid){
        JsonArray rows=new JsonArray();var collection=maid.getChatBubbleManager().getChatBubbleDataCollection();long now=System.currentTimeMillis();
        var keys=collection.keySet().iterator();
        while(keys.hasNext()&&rows.size()<3){
            long until=keys.nextLong();if(until<=now)continue;IChatBubbleData data=collection.get(until);
            var field=TEXT.get(data.getClass());if(field.isEmpty())continue;
            try{
                String text=clean(((Component)field.get().get(data)).getString(),160);if(text.isBlank())continue;
                JsonObject b=new JsonObject();b.addProperty("id",Long.toString(until));b.addProperty("text",text);
                b.addProperty("kind",data.getClass().getSimpleName().startsWith("Waiting")?"thinking":data.getClass().getSimpleName().startsWith("Progress")?"progress":"speech");
                b.addProperty("remainingMs",Math.min(30000,until-now));b.addProperty("priority",data.priority());rows.add(b);
            }catch(ReflectiveOperationException|RuntimeException ignored){/* unsupported type stays explicit, never read arbitrary fields */}
        }return rows;
    }
    private static int pose(LivingEntity e){
        if(e.isSleeping())return 5;
        if(e instanceof EntityMaid m&&m.isMaidInSittingPose())return 4;
        if(e.isPassenger())return 4;
        if(e.isSwimming())return 6;
        if(e.isCrouching())return 7;
        if(e.isFallFlying()||e instanceof ServerPlayer p&&p.getAbilities().flying)return 8;
        if(!e.onGround()&&!e.isInWater())return 3;
        double dx=e.getX()-e.xo,dz=e.getZ()-e.zo;
        if(dx*dx+dz*dz>0.000025)return e.isSprinting()||dx*dx+dz*dz>.035?2:1;
        return 0;
    }
    static JsonArray snapshot(ServerPlayer viewer){
        JsonArray rows=new JsonArray();if(viewer.isDeadOrDying())return rows;
        var entities=viewer.serverLevel().getEntitiesOfClass(LivingEntity.class,viewer.getBoundingBox().inflate(32),
            e->e.isAlive()&&!e.isInvisibleTo(viewer)&&(e instanceof EntityMaid||e instanceof ServerPlayer||e instanceof Villager||WandscapeAccess.wizard(e)));
        entities.sort(Comparator.comparingDouble(e->e.distanceToSqr(viewer)));
        for(var e:entities){
            if(rows.size()>=24)break;if(e.distanceToSqr(viewer)>1024)continue;
            JsonObject r=new JsonObject();r.addProperty("uuid",e.getUUID().toString());r.addProperty("entityId",e.getId());
            r.addProperty("type",BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());JsonObject pos=new JsonObject();
            pos.addProperty("x",e.getX());pos.addProperty("y",e.getY());pos.addProperty("z",e.getZ());r.add("position",pos);
            r.addProperty("height",e.getBbHeight());r.addProperty("bodyYaw",e.yBodyRot);r.addProperty("headYaw",e.yHeadRot);r.addProperty("pitch",e.getXRot());
            r.addProperty("pose",pose(e));r.addProperty("swinging",e.swinging);r.addProperty("hurt",e.hurtTime>0);r.addProperty("usingItem",e.isUsingItem());
            String name=e.hasCustomName()?e.getCustomName().getString():e instanceof EntityMaid?"女仆":e.getName().getString();
            r.addProperty("name",clean(name,40));JsonArray bs=new JsonArray();
            if(e instanceof EntityMaid maid){
                bs=bubbles(maid);r.addProperty("role","女仆");
            }else if(WandscapeAccess.wizard(e)){
                JsonObject visual=WandscapeAccess.visual(e);r.add("wandscape",visual);r.addProperty("name",clean(visual.get("name").getAsString(),40));r.addProperty("role","小镇法师");
                String text=clean(visual.get("status").getAsString(),160);if(!text.isBlank()){JsonObject b=new JsonObject();b.addProperty("id","wandscape-status");b.addProperty("text",text);b.addProperty("kind","status");b.addProperty("remainingMs",1500);b.addProperty("priority",0);bs.add(b);}
            }else if(e instanceof ServerPlayer player){
                r.add("ysm",PlayerYsmState.snapshot(player));var speech=SPEECH.get(player.getUUID());
                if(speech!=null&&speech.until>System.currentTimeMillis()){
                    JsonObject b=new JsonObject();b.addProperty("id",Long.toString(speech.until));b.addProperty("text",speech.text);b.addProperty("kind","speech");b.addProperty("remainingMs",speech.until-System.currentTimeMillis());b.addProperty("priority",0);bs.add(b);
                }
            }else if(e instanceof Villager villager){
                String profession=BuiltInRegistries.VILLAGER_PROFESSION.getKey(villager.getVillagerData().getProfession()).getPath();
                r.addProperty("role",switch(profession){case "farmer"->"农夫";case "armorer"->"盔甲匠";case "weaponsmith"->"武器匠";case "toolsmith"->"工具匠";case "librarian"->"图书管理员";case "cleric"->"牧师";case "fisherman"->"渔夫";case "butcher"->"屠夫";case "cartographer"->"制图师";case "fletcher"->"制箭师";case "leatherworker"->"皮匠";case "mason"->"石匠";case "shepherd"->"牧羊人";default->"村民";});
                if(!e.hasCustomName())r.addProperty("name",r.get("role").getAsString());
            }
            r.add("bubbles",bs);rows.add(r);
        }return rows;
    }
}
