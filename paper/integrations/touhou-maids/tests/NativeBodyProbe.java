package local.maidagent.bodyqa;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import com.mojang.authlib.GameProfile;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.nio.file.*;
import java.util.*;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/** Separate test-only mod: refuses to execute without two synthetic fixture markers. */
@Mod("tlm_native_body_test")
public final class NativeBodyProbe {
    public NativeBodyProbe(){NeoForge.EVENT_BUS.addListener(this::commands);}
    private static Object field(Object object,String name)throws Exception{var f=object.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(object);}
    private static Object method(Object object,String name,Class<?>[] types,Object...args)throws Exception{var m=object.getClass().getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(object,args);}
    private void commands(RegisterCommandsEvent event){
        event.getDispatcher().register(Commands.literal("bodyportqa").requires(s->s.hasPermission(4))
            .then(Commands.argument("input",StringArgumentType.greedyString()).executes(ctx->{
                try{
                    if(!Files.readString(Path.of(".native-body-qa")).equals("SYNTHETIC_NATIVE_BODY_ONLY")||!Files.readString(Path.of(".resident-hybrid-qa")).equals("SYNTHETIC_RESIDENT_HYBRID_ONLY"))throw new IllegalArgumentException("synthetic_fixture_required");
                    String[] a=StringArgumentType.getString(ctx,"input").split(" ",3);UUID id=UUID.fromString(a[1]);
                    if(!id.toString().startsWith("10000000-"))throw new IllegalArgumentException("synthetic_body_required");
                    var source=ctx.getSource();var maid=(EntityMaid)source.getLevel().getEntity(id);if(maid==null)throw new IllegalArgumentException("body_not_loaded");
                    var manager=Class.forName("org.bukkit.Bukkit").getMethod("getPluginManager").invoke(null);
                    var plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(manager,"QiandengjiMaidBridge");
                    var out=new JsonObject();
                    switch(a[0]){
                        case "controller"->{out.addProperty("active",(boolean)method(plugin,"nativeControlled",new Class<?>[]{UUID.class},id));out.addProperty("epoch",(long)method(plugin,"nativeControlEpoch",new Class<?>[]{UUID.class},id));}
                        case "takeover"->{UUID actor=UUID.fromString(a[2]);var port=field(plugin,"bodyPort");method(port,"ownerTakeover",new Class<?>[]{UUID.class,UUID.class},actor,id);out.addProperty("active",(boolean)method(plugin,"nativeControlled",new Class<?>[]{UUID.class},id));}
                        case "owner"->{maid.setOwnerUUID(UUID.fromString(a[2]));out.addProperty("owner",maid.getOwnerUUID().toString());}
                        case "gui"->{maid.guiOpening=Boolean.parseBoolean(a[2]);out.addProperty("gui",maid.guiOpening);}
                        case "noai"->{maid.setNoAi(Boolean.parseBoolean(a[2]));out.addProperty("noAi",maid.isNoAi());}
                        case "legacy","dialogue"->{
                            String[] messageArgs=a[2].split(" ",2);String request=messageArgs[0];UUID speaker=messageArgs.length>1?UUID.fromString(messageArgs[1]):maid.getOwnerUUID();
                            if(!speaker.toString().startsWith("20000000-"))throw new IllegalArgumentException("synthetic_speaker_required");Object journal=field(plugin,"receipts");
                            journal.getClass().getMethod("reserve",UUID.class,UUID.class,String.class,String.class,String.class).invoke(journal,id,speaker,request,"chat","synthetic conversation");
                            if(a[0].equals("legacy"))out=(JsonObject)journal.getClass().getMethod("finish",UUID.class,String.class,String.class,JsonObject.class).invoke(journal,id,request,"unknown",new JsonObject());
                            else{var actor=FakePlayerFactory.get(source.getLevel(),new GameProfile(speaker,speaker.equals(maid.getOwnerUUID())?"BodyOwnerQA":"BodyVisitorQA"));
                                out=(JsonObject)method(plugin,"nativeConversation",new Class<?>[]{Class.forName("org.bukkit.entity.Player"),EntityMaid.class,String.class,String.class},actor.getBukkitEntity(),maid,request,"一起去冒险吧");}
                        }
                        case "legacy-write"->{var actor=FakePlayerFactory.get(source.getLevel(),new GameProfile(maid.getOwnerUUID(),"BodyOwnerQA"));
                            try{method(plugin,"dispatch",new Class<?>[]{Class.forName("org.bukkit.entity.Player"),String.class,UUID.class,String.class,String.class},actor.getBukkitEntity(),"stay",id,a[2],null);out.addProperty("blocked",false);}
                            catch(java.lang.reflect.InvocationTargetException refused){out.addProperty("blocked",true);out.addProperty("code",String.valueOf(refused.getCause().getClass().getMethod("code").invoke(refused.getCause())));}
                        }
                        default->throw new IllegalArgumentException("unknown_synthetic_action");
                    }
                    String result=new Gson().toJson(out);source.sendSuccess(()->Component.literal(result),false);return 1;
                }catch(Exception failure){throw new IllegalArgumentException("native_body_probe_failed",failure);}
            })));
    }
}
