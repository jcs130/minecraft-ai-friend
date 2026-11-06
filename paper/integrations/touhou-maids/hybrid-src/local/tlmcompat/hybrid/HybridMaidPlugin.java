package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.ai.brain.MaidSchedule;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.MaidConfig;
import com.github.tartaricacid.touhoulittlemaid.api.event.MaidTamedEvent;
import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import local.tlmcompat.core.CompatibilityException;
import local.tlmcompat.core.MaidState;
import local.tlmcompat.qiandengji.DialogueInbox;
import local.tlmcompat.qiandengji.ReceiptJournal;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.TamableAnimal;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Real TLM entity and all original task implementations, with a shared vanilla/Agent transport. */
public final class HybridMaidPlugin extends JavaPlugin implements Listener, CommandExecutor {
    public static final String CHANNEL="qiandengji:maids";
    private static final NamespacedKey BINDING=new NamespacedKey("qiandengji","maid_binding");
    private JsonObject registry;
    private Path registryFile;
    private ReceiptJournal receipts;
    private DialogueInbox inbox;
    private VanillaMaidProjection projection;
    private NativeMaidInventory menus;
    private NativeMaidCosmetics cosmetics;
    private NativeCosmeticsMenu cosmeticsMenu;
    private NativeWorldPermissions worldPermissions;
    private HybridPluginPayloads pluginPayloads;
    private LegacyMaidTransport legacyTransport;
    private NativeMaidTransport nativeTransport;
    private NativeMaidAgentSupport agentSupport;
    JsonObject registeredMaids(){return records();}
    private final java.util.function.Consumer<MaidTamedEvent> adopted=event->bindOnMain(event.getMaid());
    private final java.util.function.Consumer<net.neoforged.neoforge.event.entity.EntityJoinLevelEvent> joined=event->{if(!event.getLevel().isClientSide()&&event.getEntity() instanceof EntityMaid maid){local.tlmcompat.numen.MaidVisualRegistry.capture(maid);if(owner(maid)!=null)bindOnMain(maid);}};
    @Override public void onEnable(){
        try{
            if(!Bukkit.getMinecraftVersion().equals("1.21.1"))throw new IllegalStateException("This native adapter requires 1.21.1");
            if(net.minecraft.world.entity.animal.Wolf.class.isAssignableFrom(EntityMaid.class))throw new IllegalStateException("Experimental host on native runtime classpath");
            if(TaskManager.getTaskMap()==null)throw new IllegalStateException("Original mod common setup is incomplete");
            Files.createDirectories(getDataFolder().toPath()); registryFile=getDataFolder().toPath().resolve("native-registry.json");
            registry=Files.exists(registryFile)?JsonParser.parseString(Files.readString(registryFile)).getAsJsonObject():new JsonObject();
            if(!registry.has("schema")){registry.addProperty("schema",1);registry.add("maids",new JsonObject());}
            if(registry.get("schema").getAsInt()!=1)throw new IllegalStateException("Future native registry preserved without rewriting");
            receipts=new ReceiptJournal(getDataFolder().toPath().resolve("native-receipts"));
            inbox=new DialogueInbox(getDataFolder().toPath().resolve("native-dialogue"));
            agentSupport=new NativeMaidAgentSupport(this,receipts);
            getServer().getMessenger().registerOutgoingPluginChannel(this,CHANNEL);
            getServer().getPluginManager().registerEvents(this,this);
            getCommand("qdmaid").setExecutor(this);
            pluginPayloads=new HybridPluginPayloads(this);projection=new VanillaMaidProjection(this); menus=new NativeMaidInventory(this);worldPermissions=new NativeWorldPermissions(this);legacyTransport=new LegacyMaidTransport(this);nativeTransport=new NativeMaidTransport(this);
            getServer().getPluginManager().registerEvents(menus,this);
            cosmetics=new NativeMaidCosmetics(this);cosmeticsMenu=new NativeCosmeticsMenu(this,cosmetics);
            getServer().getPluginManager().registerEvents(cosmeticsMenu,this);
            net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(adopted);
            net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(joined);
            for(World world:Bukkit.getWorlds())for(var entity:world.getEntities()){EntityMaid maid=nativeMaid(entity);if(maid!=null){local.tlmcompat.numen.MaidVisualRegistry.capture(maid);if(owner(maid)!=null)bindOnMain(maid);}}
            getServer().getScheduler().runTaskTimer(this,local.tlmcompat.numen.MaidVisualRegistry::sampleLoaded,1L,2L);
            getLogger().info("Native TLM integration ready: "+TaskManager.getTaskMap().size()+" original tasks; no model loop");
        }catch(Throwable error){getLogger().severe("Native maid integration disabled: "+error);error.printStackTrace();getServer().getPluginManager().disablePlugin(this);}
    }
    @Override public void onDisable(){net.neoforged.neoforge.common.NeoForge.EVENT_BUS.unregister(adopted);net.neoforged.neoforge.common.NeoForge.EVENT_BUS.unregister(joined);if(legacyTransport!=null)legacyTransport.close();if(nativeTransport!=null)nativeTransport.close();if(pluginPayloads!=null)pluginPayloads.close();if(worldPermissions!=null)worldPermissions.close();if(projection!=null)projection.close();if(menus!=null)menus.closeAll();if(cosmeticsMenu!=null)cosmeticsMenu.closeAll();if(cosmetics!=null)cosmetics.close();}
    private void bindOnMain(EntityMaid maid){
        Bukkit.getScheduler().runTask(this,()->{try{if(maid.isAlive()&&owner(maid)!=null)bind(maid);}catch(Exception error){getLogger().warning("Native NPC binding preserved: "+error.getMessage());}});
    }
    public static EntityMaid nativeMaid(org.bukkit.entity.Entity entity){
        if(entity==null)return null;
        Object handle=((CraftEntity)entity).getHandle();return handle instanceof EntityMaid maid?maid:null;
    }
    private JsonObject records(){return registry.getAsJsonObject("maids");}
    private void saveRegistry()throws Exception{ReceiptJournal.write(registryFile,registry,Files.exists(registryFile));}
    private static String fresh(){return UUID.randomUUID().toString();}
    private static UUID owner(EntityMaid maid){return ((TamableAnimal)maid).getOwnerUUID();}
    private JsonObject owned(UUID actor,UUID id){
        JsonObject row=records().getAsJsonObject(id.toString());
        if(row==null||!row.get("ownerId").getAsString().equals(actor.toString()))throw new CompatibilityException("not_owned","No NPC bound to this connection");
        EntityMaid current=nativeMaid(Bukkit.getEntity(id));
        if(current!=null&&!actor.equals(owner(current)))throw new CompatibilityException("owner_mismatch","Native ownership changed");
        return row;
    }
    public EntityMaid ownedLoaded(Player actor,UUID id){
        owned(actor.getUniqueId(),id);EntityMaid maid=nativeMaid(Bukkit.getEntity(id));
        if(maid==null||!maid.isAlive()||!maid.getBukkitEntity().isValid()){JsonObject state=context(actor,id);throw new CompatibilityException(state.has("death")?"maid_dead":"unloaded",state.has("nextStep")?state.get("nextStep").getAsString():"先用 /qdmaid context "+id+" 查看所在维度与状态；靠近后再操作。");}
        return maid;
    }
    public void requireNearby(Player player,EntityMaid maid,double distance){
        if(!player.isOnline()||player.isDead()||!player.getWorld().equals(maid.getBukkitEntity().getWorld())
                ||player.getLocation().distance(maid.getBukkitEntity().getLocation())>distance)throw new CompatibilityException("out_of_range","Approach the NPC in the same dimension");
    }
    private JsonObject bind(EntityMaid maid)throws Exception{
        UUID id=maid.getUUID(),owner=owner(maid);if(owner==null)throw new CompatibilityException("unowned","Complete native cake adoption first");
        JsonObject previous=records().getAsJsonObject(id.toString());
        if(previous!=null){if(!previous.get("ownerId").getAsString().equals(owner.toString()))throw new CompatibilityException("owner_mismatch","Existing persona binding was not transferred");return previous;}
        JsonObject row=new JsonObject();row.addProperty("maidId",id.toString());row.addProperty("hostId",id.toString());row.addProperty("ownerId",owner.toString());
        row.addProperty("name",maid.getName().getString());row.addProperty("agentBindingKey","maid:"+id);row.addProperty("sessionKey","qiandengji:maid:"+id);
        row.addProperty("memoryNamespace","qiandengji:maid:"+id);row.addProperty("inferenceOwner","existing_agent_host");
        records().add(id.toString(),row);saveRegistry();
        maid.getBukkitEntity().getPersistentDataContainer().set(BINDING,PersistentDataType.STRING,row.toString());return row;
    }
    public JsonObject context(Player actor,UUID id){
        JsonObject data=owned(actor.getUniqueId(),id).deepCopy();EntityMaid maid=nativeMaid(Bukkit.getEntity(id));
        data.addProperty("loaded",maid!=null&&maid.isAlive()&&maid.getBukkitEntity().isValid());
        data.addProperty("fullOriginalEntityMaid",true);data.addProperty("hostKind","original_touhou_little_maid");
        data.addProperty("nativeClient",VanillaMaidProjection.nativeClient(actor));
        data.addProperty("viewerAppearance",VanillaMaidProjection.nativeClient(actor)?"original_maid_renderer":local.tlmcompat.numen.MaidVisualRegistry.rendered(actor.getUniqueId(),id)?"bedrock_custom_maid":"vanilla_compat_projection");
        JsonArray capabilities=new JsonArray();for(String item:List.of("chat","lifecycle","context","follow","stay","speak","receipt","dialogue_inbox","dialogue_ack","original_tasks","native_inventory","inventory_transfer","equipment","schedule","pickup","vanilla_menu","original_menu","skins","skin","voices","voice","voice-test","mute","resources","resource-pack","rename"))capabilities.add(item);data.add("capabilities",capabilities);
        if(maid!=null){
            data.addProperty("homeMode",maid.isHomeModeEnable());data.addProperty("sitting",maid.isMaidInSittingPose());data.addProperty("pickup",maid.isPickup());
            data.addProperty("schedule",maid.getSchedule().name());data.addProperty("taskId",maid.getTask().getUid().toString());data.addProperty("taskEnabled",maid.getTask().isEnable(maid));
            data.addProperty("modelId",maid.getModelId());data.addProperty("health",maid.getHealth());data.addProperty("maxHealth",maid.getMaxHealth());
            data.addProperty("name",maid.getName().getString());data.addProperty("soundPackId",maid.getSoundPackId());data.addProperty("silent",maid.isSilent());data.addProperty("voiceAssetsReady",VanillaMaidProjection.nativeClient(actor)||local.tlmcompat.numen.MaidVoiceTransport.ready(actor.getUniqueId()));
            data.addProperty("soundFrequency",maid.getConfigManager().getSoundFreq());
            data.addProperty("workRadius",maid.getRestrictRadius());data.addProperty("canMove",maid.canBrainMoving());
            data.addProperty("activity",maid.getScheduleDetail().getName());
            data.addProperty("dimension",maid.getBukkitEntity().getWorld().getKey().toString());JsonArray position=new JsonArray();position.add(maid.getX());position.add(maid.getY());position.add(maid.getZ());data.add("position",position);
            if(maid.getOwner()!=null)data.addProperty("ownerDistance",maid.distanceTo(maid.getOwner()));else data.add("ownerDistance",JsonNull.INSTANCE);
        }
        agentSupport.enrich(actor,id,data);
        data.addProperty("sampledAt",java.time.Instant.now().toString());return data;
    }
    private JsonObject catalog(Player actor,UUID id){
        EntityMaid maid=ownedLoaded(actor,id);JsonObject result=new JsonObject();result.addProperty("maidId",id.toString());JsonArray tasks=new JsonArray();
        TaskManager.getTaskMap().entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry->{JsonObject row=new JsonObject();row.addProperty("id",entry.getKey().toString());row.addProperty("enabled",entry.getValue().isEnable(maid));row.addProperty("hidden",entry.getValue().isHidden(maid));row.addProperty("summary",entry.getValue().getMaidActionSummary());JsonArray conditions=new JsonArray();for(var condition:entry.getValue().getEnableConditionDesc(maid)){JsonObject value=new JsonObject();value.addProperty("condition",condition.getFirst());value.addProperty("met",condition.getSecond().test(maid));conditions.add(value);}for(var condition:entry.getValue().getConditionDescription(maid)){JsonObject value=new JsonObject();value.addProperty("condition",condition.getFirst());value.addProperty("met",condition.getSecond().test(maid));conditions.add(value);}row.add("conditions",conditions);tasks.add(row);});
        result.add("tasks",tasks);return result;
    }
    public JsonObject inventory(Player actor,UUID id){
        EntityMaid maid=ownedLoaded(actor,id);JsonObject data=new JsonObject();data.addProperty("maidId",id.toString());JsonArray slots=new JsonArray();
        for(int i=0;i<maid.getMaidInv().getSlots();i++){var stack=maid.getMaidInv().getStackInSlot(i);if(!stack.isEmpty()){JsonObject row=item(stack);row.addProperty("slot",i);slots.add(row);}}
        data.add("slots",slots);data.addProperty("slotCount",maid.getMaidInv().getSlots());data.addProperty("availableSlots",NativeMaidInventory.capacity(maid));data.addProperty("backpackId",maid.getMaidBackpackType().getId().toString());data.add("mainHand",item(maid.getMainHandItem()));data.add("offHand",item(maid.getOffhandItem()));data.add("equipment",NativeMaidInventory.equipment(maid));data.addProperty("nextStep","先 transfer put 把物品放进女仆背包，再 equip main|off|head|chest|legs|feet <maidSlot>；空背包槽可卸下对应装备。");return data;
    }
    public static JsonObject item(net.minecraft.world.item.ItemStack stack){
        JsonObject row=new JsonObject();row.addProperty("id",net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());row.addProperty("count",stack.getCount());row.addProperty("damage",stack.getDamageValue());row.addProperty("name",stack.getHoverName().getString());return row;
    }
    private JsonObject receipt(UUID actor,UUID id,String operation)throws Exception{
        JsonObject record=records().getAsJsonObject(id.toString()),receipt=receipts.read(id,operation);
        if(record==null||(!record.get("ownerId").getAsString().equals(actor.toString())&&(receipt==null||!receipt.get("actorId").getAsString().equals(actor.toString()))))throw new CompatibilityException("not_owned","No receipt belongs to this connection");
        if(receipt==null)throw new CompatibilityException("receipt_missing","No original receipt");return agentSupport.reconcile(receipt);
    }
    public JsonObject dispatch(Player actor,String action,UUID id,String operation,String value)throws Exception{
        if(!actor.isOnline()||actor.isDead())throw new CompatibilityException("actor_unavailable","Connected living player required");
        if(action.equals("context"))return context(actor,id);if(action.equals("tasks"))return catalog(actor,id);if(action.equals("inventory"))return inventory(actor,id);
        if(NativeMaidCosmetics.READS.contains(action))return cosmetics.read(actor,ownedLoaded(actor,id),action,value);
        if(action.equals("receipt"))return receipt(actor.getUniqueId(),id,operation);
        if(action.equals("inbox")){JsonObject record=owned(actor.getUniqueId(),id);JsonObject data=inbox.snapshot(id);data.addProperty("sessionKey",record.get("sessionKey").getAsString());return data;}
        // A replay must read the original result even if the entity has since died/unloaded.
        if(receipts.read(id,operation)!=null){receipt(actor.getUniqueId(),id,operation);JsonObject old=receipts.reserve(id,actor.getUniqueId(),operation,action,Objects.requireNonNullElse(value,""));old=agentSupport.reconcile(old);old.addProperty("replayed",true);return old;}
        EntityMaid maid;
        if(action.equals("talk")){maid=nativeMaid(Bukkit.getEntity(id));if(maid==null||!records().has(id.toString()))throw new CompatibilityException("unavailable","No current registered NPC");requireNearby(actor,maid,8);}
        else{maid=ownedLoaded(actor,id);requireNearby(actor,maid,32);}
        if(Set.of("talk","speak","chat").contains(action)&&(value==null||value.isBlank()||value.length()>140||value.codePoints().anyMatch(c->Character.isISOControl(c)||c==0xA7)))throw new CompatibilityException("bad_text","Supply 1-140 plain text characters");
        if(action.equals("task")&&(!TaskManager.getTaskMap().containsKey(ResourceLocation.parse(value))||!TaskManager.getTaskMap().get(ResourceLocation.parse(value)).isEnable(maid)))throw new CompatibilityException("task_requirements","Read original task conditions and provide its equipment first");
        if(action.equals("schedule"))MaidSchedule.valueOf(value);
        if(action.equals("pickup")&&!Set.of("true","false").contains(value))throw new CompatibilityException("bad_boolean","Use true or false");
        if(action.equals("ack")&&!inbox.contains(id,value)){
            JsonObject old=receipts.read(id,operation);if(old==null)throw new CompatibilityException("dialogue_missing","Use the original inbox event ID");
        }
        if(Set.of("menu","native-menu").contains(action))requireNearby(actor,maid,8);
        if(action.equals("native-menu")&&!VanillaMaidProjection.nativeClient(actor))throw new CompatibilityException("native_client_required","Use the common menu on this client");
        if(!Set.of("follow","stay","sit","speak","talk","chat","task","schedule","pickup","ack","transfer","equip","menu","native-menu").contains(action)&&!NativeMaidCosmetics.WRITES.contains(action))throw new CompatibilityException("unsupported_action",action);
        if(NativeMaidCosmetics.WRITES.contains(action)&&receipts.read(id,operation)==null)cosmetics.validate(actor,maid,action,value);
        if(action.equals("chat")){requireNearby(actor,maid,16);agentSupport.validateChat(actor,maid);}
        if(action.equals("equip"))menus.validateEquip(actor,maid,value);
        JsonObject previous=receipts.reserve(id,actor.getUniqueId(),operation,action,Objects.requireNonNullElse(value,""));
        if(previous!=null){JsonObject replay=previous.deepCopy();replay.addProperty("replayed",true);return replay;}
        if(action.equals("chat"))return agentSupport.chat(actor,maid,operation,value);
        JsonObject observation;
        switch(action){
            case "follow"->{maid.setInSittingPose(false);maid.restrictTo(net.minecraft.core.BlockPos.ZERO,MaidConfig.MAID_NON_HOME_RANGE.get());maid.setHomeModeEnable(false);observation=context(actor,id);}
            case "stay"->{maid.setHomeModeEnable(true);maid.getSchedulePos().setHomeModeEnable(maid,maid.blockPosition());maid.setInSittingPose(true);maid.getNavigation().stop();observation=context(actor,id);}
            case "sit"->{maid.setInSittingPose(true);observation=context(actor,id);}
            case "task"->{maid.setTask(TaskManager.getTaskMap().get(ResourceLocation.parse(value)));maid.setInSittingPose(false);observation=context(actor,id);}
            case "schedule"->{maid.setSchedule(MaidSchedule.valueOf(value));observation=context(actor,id);}
            case "pickup"->{maid.setPickup(Boolean.parseBoolean(value));observation=context(actor,id);}
            case "speak"->{int count=0;Component text=Component.text("<"+maid.getName().getString()+"> ",NamedTextColor.AQUA).append(Component.text(value));for(Player player:maid.getBukkitEntity().getLocation().getNearbyPlayers(16)){player.sendMessage(text);count++;}observation=new JsonObject();observation.addProperty("deliveredPlayers",count);}
            case "talk"->{String event=actor.getUniqueId()+":"+operation;inbox.add(id,event,actor.getUniqueId(),actor.getName(),value);observation=new JsonObject();observation.addProperty("eventId",event);Player controller=Bukkit.getPlayer(owner(maid));if(controller!=null&&controller.getListeningPluginChannels().contains(CHANNEL)){JsonObject notice=new JsonObject();notice.addProperty("maidId",id.toString());notice.addProperty("eventId",event);notice.addProperty("sessionKey",records().getAsJsonObject(id.toString()).get("sessionKey").getAsString());reply(controller,"dialogue",operation,notice,null);}}
            case "ack"->{inbox.acknowledge(id,value);observation=new JsonObject();observation.addProperty("eventId",value);}
            case "transfer"->observation=menus.transfer(actor,maid,value);
            case "equip"->observation=menus.equip(actor,maid,value);
            case "menu","native-menu"->{if(action.equals("menu"))menus.open(actor,maid);else maid.openMaidGui(((CraftPlayer)actor).getHandle());observation=new JsonObject();observation.addProperty("maidId",id.toString());observation.addProperty("windowId",((CraftPlayer)actor).getHandle().containerMenu.containerId);}
            default->observation=cosmetics.apply(actor,maid,action,value);
        }
        observation.addProperty("meaning",action.equals("talk")?"human message queued":"operation applied; task objective requires world observation");
        return receipts.finish(id,operation,action.equals("talk")?"queued":"applied",observation);
    }
    public JsonObject create(Player owner,String name)throws Exception{
        var player=((CraftPlayer)owner).getHandle();
        if(!player.getMainHandItem().is(net.minecraft.world.item.Items.CAKE))throw new CompatibilityException("cake_required","Hold a real cake for native adoption");
        Location location=owner.getLocation().clone().add(-2,0,0);
        if(!location.getBlock().isPassable()||!location.clone().add(0,-1,0).getBlock().getType().isSolid())throw new CompatibilityException("unsafe_spawn","Dry open floor required");
        var level=((CraftWorld)owner.getWorld()).getHandle();EntityMaid maid=new EntityMaid(level);
        maid.moveTo(location.getX(),location.getY(),location.getZ(),0,0);maid.setCustomName(net.minecraft.network.chat.Component.literal(name));maid.setCustomNameVisible(true);
        if(!level.addFreshEntity(maid,org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason.CUSTOM))throw new CompatibilityException("spawn_rejected","Server refused native entity");
        maid.mobInteract(player,InteractionHand.MAIN_HAND);
        if(!owner.getUniqueId().equals(owner(maid))){maid.discard();throw new CompatibilityException("native_adoption_refused","Original ownership rules did not allow adoption");}
        bind(maid);return context(owner,maid.getUUID());
    }
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        String action=args.length==0?"help":args[0].toLowerCase(Locale.ROOT),correlation=fresh();
        try{
            if(action.equals("bind")){
                if(!sender.hasPermission("qiandengji.maid.admin")||args.length!=2)throw new CompatibilityException("permission_denied","Operator bind <real UUID> only");
                EntityMaid maid=nativeMaid(Bukkit.getEntity(UUID.fromString(args[1])));if(maid==null)throw new CompatibilityException("unloaded","Load the actual original entity normally first");
                sender.sendMessage(bind(maid).toString());return true;
            }
            if(!(sender instanceof Player actor)){sender.sendMessage("Use the bound player's existing connection for native maid operations.");return true;}
            if(action.equals("create")){
                if(!actor.hasPermission("qiandengji.maid.admin")||args.length<3)throw new CompatibilityException("permission_denied","Operator create <online-owner> <name> only");
                Player target=Bukkit.getPlayerExact(args[1]);if(target==null)throw new CompatibilityException("owner_unavailable","Owner is offline");
                String name=String.join(" ",Arrays.copyOfRange(args,2,args.length));if(name.length()>32||name.codePoints().anyMatch(Character::isISOControl))throw new CompatibilityException("bad_name","Plain name up to 32 characters");
                reply(actor,action,correlation,create(target,name),null);return true;
            }
            if(action.equals("help")){help(actor);return true;}
            if(action.equals("list")){
                correlation=request(args,1);int page=args.length>2?Integer.parseInt(args[2]):0;if(page<0||page>10000||args.length>3)throw new CompatibilityException("bad_arguments","list [requestId] [page]");
                var rows=records().entrySet().stream().filter(e->e.getValue().getAsJsonObject().get("ownerId").getAsString().equals(actor.getUniqueId().toString())).toList();JsonArray list=new JsonArray();
                for(var entry:rows.stream().skip((long)page*8).limit(8).toList())list.add(context(actor,UUID.fromString(entry.getKey())));
                JsonObject result=new JsonObject();result.add("maids",list);result.addProperty("page",page);result.addProperty("hasMore",(long)(page+1)*8<rows.size());reply(actor,action,correlation,result,null);return true;
            }
            if(args.length<2)throw new CompatibilityException("bad_arguments","Read /qdmaid help");UUID id=UUID.fromString(args[1]);
            if(action.equals("menu")){EntityMaid maid=ownedLoaded(actor,id);requireNearby(actor,maid,8);menus.open(actor,maid);return true;}
            if(action.equals("native-menu")){EntityMaid maid=ownedLoaded(actor,id);requireNearby(actor,maid,8);if(!VanillaMaidProjection.nativeClient(actor))throw new CompatibilityException("native_client_required","Use the common menu on this client");maid.openMaidGui(((CraftPlayer)actor).getHandle());return true;}
            correlation=request(args,action.equals("receipt")?3:2);String operation=action.equals("receipt")?request(args,2):correlation;
            String value=args.length>3?String.join(" ",Arrays.copyOfRange(args,3,args.length)):null;
            reply(actor,action,correlation,dispatch(actor,action,id,operation,value),null);
        }catch(Throwable error){String code=error instanceof CompatibilityException compat?compat.code():"invalid_request";if(sender instanceof Player actor){JsonObject details=new JsonObject();details.addProperty("message",error instanceof CompatibilityException?error.getMessage():"参数不正确；请用 /qdmaid help 查询示例。");reply(actor,action,correlation,details,code);}else sender.sendMessage("QD_MAID error="+code);getLogger().fine(action+": "+error);}
        return true;
    }
    private static String request(String[] args,int index){String value=args.length>index?args[index]:fresh();if(!value.matches("[A-Za-z0-9_-]{1,48}"))throw new CompatibilityException("bad_request_id","Invalid request ID");return value;}
    public void reply(Player actor,String action,String request,JsonObject data,String error){
        JsonObject result=new JsonObject();result.addProperty("schema",1);result.addProperty("protocol","qiandengji-maids/v1");result.addProperty("recipientUuid",actor.getUniqueId().toString());result.addProperty("action",action);result.addProperty("requestId",request);result.addProperty("ok",error==null);result.addProperty("sampledAt",java.time.Instant.now().toString());
        if(data!=null)result.add("data",data);if(error!=null){result.addProperty("error",error);result.addProperty("nextStep",guidance(action,error));}byte[] bytes=result.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>24000)throw new IllegalStateException("Response budget exceeded");
        if(actor.getListeningPluginChannels().contains(CHANNEL))actor.sendPluginMessage(this,CHANNEL,bytes);else actor.sendMessage(Component.text("QD_MAID "+result,error==null?NamedTextColor.AQUA:NamedTextColor.RED));
    }
    @EventHandler(ignoreCancelled=true,priority=EventPriority.HIGH)public void interact(PlayerInteractEntityEvent event){
        EntityMaid maid=nativeMaid(event.getRightClicked());if(maid==null||!records().has(maid.getUUID().toString()))return;
        if(!VanillaMaidProjection.nativeClient(event.getPlayer())){event.setCancelled(true);if(event.getHand()!=org.bukkit.inventory.EquipmentSlot.HAND)return;if(event.getPlayer().getUniqueId().equals(owner(maid))){
            var hand=((CraftPlayer)event.getPlayer()).getHandle().getMainHandItem();
            if(hand.is(net.minecraft.world.item.Items.NAME_TAG)&&hand.has(net.minecraft.core.component.DataComponents.CUSTOM_NAME)){
                try{dispatch(event.getPlayer(),"rename",maid.getUUID(),fresh(),null);}catch(Exception error){event.getPlayer().sendMessage("未改名："+error.getMessage());}
            }else menus.open(event.getPlayer(),maid);
        }}
        event.getPlayer().sendMessage(Component.text("[与 "+maid.getName().getString()+" 交谈]",NamedTextColor.AQUA).clickEvent(ClickEvent.suggestCommand("/qdmaid chat "+maid.getUUID()+" "+fresh()+" ")));
    }
    public void openCommonMenu(Player actor,EntityMaid maid){menus.open(actor,maid);}
    public void openCosmetics(Player actor,EntityMaid maid,boolean voices,int page){cosmeticsMenu.open(actor,maid,voices,page);}
    private static String guidance(String action,String error){
        return switch(error){
            case "maid_dead","unloaded"->"/qdmaid list 查看本人女仆真实状态；context <UUID> 查询死亡、遗物位置或未加载原因。";
            case "not_owned","owner_mismatch"->"只能操作本人女仆；先 /qdmaid list 复制 maidId，不能用玩家 UUID 或投影实体编号。";
            case "out_of_range"->"先 /qdmaid context <UUID> 核对维度坐标；走到同维度女仆附近再操作。";
            case "chat_busy","chat_unresolved"->"上一条对话未确认；/qdmaid receipt <UUID> <原requestId>。勿重复提交或把 pending 当回复。";
            default->"/qdmaid help 查询真实用法。每次写操作保留唯一 requestId；结果不明先 receipt，不重复转移物品。";
        };
    }
    private void help(Player actor){
        for(String line:List.of(
            "女仆：先 /qdmaid list 找本人 maidId；/qdmaid context <UUID> 查看生命、维度、位置和死亡遗物。",
            "对话：/qdmaid chat <UUID> <requestId> <话语>，调用她已配置的原生模型；pending 是等待，replied 才收到回复。/qdmaid receipt <UUID> <原requestId> 查结果。",
            "装备：/qdmaid inventory <UUID> 看槽位；/qdmaid transfer <UUID> <requestId> put <女仆槽> <数量> <本人槽0-35>；再 /qdmaid equip <UUID> <新requestId> main|off|head|chest|legs|feet <女仆槽>。空槽用于卸装。",
            "行为：/qdmaid tasks <UUID> 查原生工作与条件；/qdmaid task <UUID> <requestId> <任务ID>。follow/stay/sit 同样用 <UUID> <requestId>。应用模式不等于完成任务。",
            "真人：/qdmaid menu <UUID> 或右键本人女仆，管理原背包及装备。talk 仅为外部宿主留言箱，不是原生模型对话。死亡后先查看 context，不自动补发/复活。"
        ))actor.sendMessage(Component.text(line,NamedTextColor.AQUA));
    }
}
