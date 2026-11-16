package local.maidagent.test;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.Gson;
import com.mojang.authlib.GameProfile;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.ItemStack;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/** Installed only in a SYNTHETIC_STOCK_NEOFORGE fixture. Never distributed in the addon. */
@Mod("tlm_maid_agents_test")
public final class RecruitmentProbe {
    public RecruitmentProbe() { NeoForge.EVENT_BUS.addListener(this::commands); }
    private void commands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("companiontest").requires(s -> s.hasPermission(4))
            .then(Commands.argument("input", StringArgumentType.greedyString()).executes(ctx -> {
                String[] a = StringArgumentType.getString(ctx, "input").split(" ", 3);
                var source = ctx.getSource();
                var server = source.getServer();
                boolean synthetic=false;
                for(var marker:Map.of(".resident-hybrid-qa","SYNTHETIC_RESIDENT_HYBRID_ONLY",".standalone-maid-agents-lab","SYNTHETIC_STOCK_NEOFORGE").entrySet())
                    try{synthetic|=java.nio.file.Files.readString(java.nio.file.Path.of(marker.getKey())).strip().equals(marker.getValue());}catch(java.io.IOException missing){}
                if(!synthetic)throw new IllegalArgumentException("synthetic_fixture_marker_required");
                ServerPlayer player = server.getPlayerList().getPlayerByName("NpcModelQA");
                if(a[0].equals("notice")){
                    try{Class.forName("local.qdj.maids.brain.ResidentBodyAccess").getMethod("notice",UUID.class,String.class).invoke(null,UUID.fromString(a[1]),a[2]);return tell(source,Map.of("recorded",true));}
                    catch(ReflectiveOperationException failed){throw new IllegalArgumentException(failed);}
                }
                if(a[0].equals("trial-mobs")){
                    var rows=new java.util.ArrayList<Object>();
                    for(var level:server.getAllLevels())for(var entity:level.getAllEntities())if((entity.getTags().contains("afu_dungeon_mob")||entity.getTags().contains("afu_site_dungeon"))&&entity instanceof net.minecraft.world.entity.Mob mob){
                        var row=new LinkedHashMap<String,Object>();row.put("uuid",mob.getStringUUID());row.put("type",net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(mob.getType()).toString());
                        row.put("position",java.util.List.of(mob.getX(),mob.getY(),mob.getZ()));row.put("health",mob.getHealth());row.put("noAi",mob.isNoAi());row.put("mainhand",mob.getMainHandItem().toString());
                        row.put("target",mob.getTarget()==null?"none":mob.getTarget().getStringUUID());row.put("lastAttacker",mob.getLastHurtByMob()==null?"none":mob.getLastHurtByMob().getStringUUID());rows.add(row);
                    }return tell(source,Map.of("mobs",rows,"observedAt",java.time.Instant.now().toString()));
                }
                if(a[0].equals("npc-ask")) {
                    UUID speakerId=UUID.fromString(a[1]);String[] rest=a[2].split(" ",2);UUID target=UUID.fromString(rest[0]);EntityMaid speaker=null;
                    for(var level:server.getAllLevels())if(level.getEntity(speakerId)instanceof EntityMaid found)speaker=found;
                    if(speaker==null)throw new IllegalArgumentException("test_body_missing");
                    try {
                        var type=Class.forName("local.qdj.maids.brain.MaidAgentsMod");var running=type.getDeclaredField("running");running.setAccessible(true);var runtime=running.get(null);
                        var get=runtime.getClass().getDeclaredMethod("companions");get.setAccessible(true);var companions=get.invoke(runtime);
                        var ask=companions.getClass().getDeclaredMethod("ask",net.minecraft.world.entity.LivingEntity.class,UUID.class,String.class,int.class);ask.setAccessible(true);
                        return tell(source,ask.invoke(companions,speaker,target,rest[1],1));
                    }catch(ReflectiveOperationException failed){throw new IllegalArgumentException(failed);}
                }
                if(a[0].equals("block")) {
                    var xyz=(a[1]+" "+a[2]).split(" ");var pos=new net.minecraft.core.BlockPos(Integer.parseInt(xyz[0]),Integer.parseInt(xyz[1]),Integer.parseInt(xyz[2]));
                    var block=source.getLevel().getBlockState(pos);
                    return tell(source,Map.of("id",net.minecraft.core.registries.BuiltInRegistries.BLOCK.getKey(block.getBlock()).toString(),"state",block.toString()));
                }
                if(a[0].equals("photo-hold")) {
                    UUID id=UUID.fromString(a[1]);EntityMaid maid=null;
                    for(var level:server.getAllLevels())if(level.getEntity(id) instanceof EntityMaid found)maid=found;
                    if(maid==null)throw new IllegalArgumentException("test_body_missing");
                    try {
                    var type=Class.forName("local.qdj.maids.brain.MaidAgentsMod");var get=type.getDeclaredMethod("residents");get.setAccessible(true);var residents=get.invoke(null);
                    var submit=residents.getClass().getDeclaredMethod("submit",UUID.class,UUID.class,com.google.gson.JsonObject.class);submit.setAccessible(true);
                    var input=com.google.gson.JsonParser.parseString("{\"action\":\"cli\",\"command\":\"photo take acceptance third 1\"}").getAsJsonObject();
                    UUID request=UUID.randomUUID();Object receipt=submit.invoke(residents,id,request,input);
                    return tell(source,Map.of("requestId",request.toString(),"receipt",receipt,"canMove",maid.canBrainMoving(),"noAi",maid.isNoAi()));
                    }catch(ReflectiveOperationException failed){throw new IllegalArgumentException(failed);}
                }
                if(a[0].equals("arena-start")||a[0].equals("arena-info")){
                    if(player==null)throw new IllegalArgumentException("QA player not connected");
                    try{
                        var bukkit=Class.forName("org.bukkit.Bukkit");Object manager=bukkit.getMethod("getPluginManager").invoke(null);
                        Object plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(manager,"AgentFriend");
                        Object actor=player.getClass().getMethod("getBukkitEntity").invoke(player);
                        if(a[0].equals("arena-start"))bukkit.getMethod("dispatchCommand",Class.forName("org.bukkit.command.CommandSender"),String.class).invoke(null,actor,"mycli arena start");
                        var get=plugin.getClass().getDeclaredMethod("dungeon");get.setAccessible(true);Object dungeon=get.invoke(plugin);
                        var guide=dungeon.getClass().getDeclaredMethod("guidance",Class.forName("org.bukkit.entity.Player"));guide.setAccessible(true);
                        return tell(source,guide.invoke(dungeon,actor));
                    }catch(ReflectiveOperationException bad){throw new IllegalArgumentException(bad);}
                }
                if(a[0].equals("player-count"))return tell(source,Map.of("onlinePlayers",server.getPlayerList().getPlayerCount()));
                if(a[0].equals("trust")||a[0].equals("untrust")){
                    var owner=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));
                    var principal=FakePlayerFactory.get(source.getLevel(),new GameProfile(owner.getUUID(),"npc_"+owner.getStringUUID().substring(0,8)));
                    principal.setPos(owner.position());principal.gameMode.changeGameModeForPlayer(net.minecraft.world.level.GameType.SURVIVAL);
                    try{
                        Object bukkit=principal.getClass().getMethod("getBukkitEntity").invoke(principal);
                        Object dispatched=Class.forName("org.bukkit.Bukkit").getMethod("dispatchCommand",Class.forName("org.bukkit.command.CommandSender"),String.class)
                            .invoke(null,bukkit,"mycli land "+a[0]+" resident_own "+a[2]);
                        return tell(source,Map.of("dispatched",dispatched));
                    }catch(ReflectiveOperationException bad){throw new IllegalArgumentException(bad);}
                }
                if(a[0].equals("position")){
                    var maid=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));var xyz=a[2].split(" ");
                    maid.stopSleeping();maid.setHomeModeEnable(false);maid.setInSittingPose(true);maid.getNavigation().stop();
                    maid.getBrain().eraseMemory(net.minecraft.world.entity.ai.memory.MemoryModuleType.WALK_TARGET);
                    maid.teleportTo(Double.parseDouble(xyz[0]),Double.parseDouble(xyz[1]),Double.parseDouble(xyz[2]));
                    return tell(source,Map.of("actual",java.util.List.of(maid.getX(),maid.getY(),maid.getZ())));
                }
                if(a[0].equals("reset-home-fixture")){
                    var maid=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));
                    maid.stopSleeping();maid.setHomeModeEnable(false);maid.setInSittingPose(true);
                    maid.getNavigation().stop();maid.getBrain().eraseMemory(net.minecraft.world.entity.ai.memory.MemoryModuleType.WALK_TARGET);
                    maid.getPersistentData().remove("tlm_resident_home_installed");
                    return tell(source,Map.of("syntheticHomeReset",true));
                }
                if(a[0].equals("photo-proof")){
                    try{
                    var manager=Class.forName("org.bukkit.Bukkit").getMethod("getPluginManager").invoke(null);
                    var image=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(manager,"ImageFrame");
                    var maps=image.getClass().getField("imageMapManager").get(null);
                    var values=(java.util.Collection<?>)maps.getClass().getMethod("getFromCreator",UUID.class).invoke(maps,UUID.fromString(a[1]));
                    var proof=new java.util.ArrayList<Object>();
                    for(var map:values)proof.add(Map.of("owner",map.getClass().getMethod("getCreator").invoke(map).toString(),
                        "name",map.getClass().getMethod("getName").invoke(map),"index",map.getClass().getMethod("getImageIndex").invoke(map),
                        "valid",map.getClass().getMethod("isValid").invoke(map)));
                    return tell(source,Map.of("maps",proof));
                    }catch(ReflectiveOperationException unavailable){throw new IllegalStateException("actual_photo_proof_unavailable",unavailable);}
                }
                if(a[0].equals("native-permission")){
                    var maid=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));var xyz=a[2].split(" ");
                    var at=new net.minecraft.core.BlockPos(Integer.parseInt(xyz[0]),Integer.parseInt(xyz[1]),Integer.parseInt(xyz[2]));
                    return tell(source,Map.of("destroy",maid.canDestroyBlock(at),"place",maid.canPlaceBlock(at),"blockState",maid.level().getBlockState(at).toString(),"light",maid.level().getMaxLocalRawBrightness(at)));
                }
                if(a[0].equals("path")){
                    var maid=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));var xyz=a[2].split(" ");
                    var at=new net.minecraft.core.BlockPos(Integer.parseInt(xyz[0]),Integer.parseInt(xyz[1]),Integer.parseInt(xyz[2]));
                    var path=maid.getNavigation().createPath(at,1);var nodes=new java.util.ArrayList<Object>();
                    if(path!=null)for(int n=0;n<path.getNodeCount();n++){var node=path.getNode(n);nodes.add(java.util.List.of(node.x,node.y,node.z,node.type.toString()));}
                    return tell(source,Map.of("pathPresent",path!=null,"canReach",path!=null&&path.canReach(),"nodes",nodes,
                        "height",maid.getBbHeight(),"width",maid.getBbWidth(),"canMove",maid.canBrainMoving(),
                        "walkMemory",maid.getBrain().getMemory(net.minecraft.world.entity.ai.memory.MemoryModuleType.WALK_TARGET).map(w->w.getTarget().currentBlockPosition().toShortString()).orElse("none")));
                }
                if(a[0].equals("wireless")){
                    var maid=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));var xyz=a[2].split(" ");
                    var at=new net.minecraft.core.BlockPos(Integer.parseInt(xyz[0]),Integer.parseInt(xyz[1]),Integer.parseInt(xyz[2]));
                    var chest=(net.minecraft.world.level.block.entity.ChestBlockEntity)source.getLevel().getBlockEntity(at);
                    chest.clearContent();chest.setItem(0,new ItemStack(net.minecraft.world.item.Items.AMETHYST_SHARD,7));
                    var stack=new ItemStack(net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("touhou_little_maid:wireless_io")));
                    com.github.tartaricacid.touhoulittlemaid.item.ItemWirelessIO.setBindingPos(stack,at);
                    com.github.tartaricacid.touhoulittlemaid.item.ItemWirelessIO.setMode(stack,false);
                    com.github.tartaricacid.touhoulittlemaid.item.ItemWirelessIO.setFilterMode(stack,true);
                    int tick=maid.tickCount;maid.tickCount=100;
                    try{new com.github.tartaricacid.touhoulittlemaid.item.bauble.WirelessIOBauble().onTick(maid,stack);}finally{maid.tickCount=tick;}
                    return tell(source,Map.of("remainingInChest",chest.getItem(0).getCount(),"actualItem",chest.getItem(0).toString()));
                }
                if (a[0].equals("as")) {
                    if (a[1].equals("visitor")) {
                        player = FakePlayerFactory.get(source.getLevel(), new GameProfile(UUID.fromString(
                                "30000000-0000-0000-0000-000000000001"), "RecruitVisitor"));
                        var active = server.getPlayerList().getPlayerByName("NpcModelQA");
                        if (active != null) player.setPos(active.position());
                    }
                    if (player == null) throw new IllegalArgumentException("QA player not connected");
                    return server.getCommands().getDispatcher().execute(a[2],
                        source.withEntity(player).withPermission(0).withPosition(player.position()).withLevel(player.serverLevel()));
                }
                if (a[0].equals("body")) {
                    UUID id = UUID.fromString(a[1]);
                    EntityMaid maid = null;
                    for (var level : server.getAllLevels()) if (level.getEntity(id) instanceof EntityMaid found) maid = found;
                    if (maid == null) return tell(source, Map.of("loaded", false));
                    var result = new LinkedHashMap<String, Object>();
                    result.put("uuid", maid.getUUID()); result.put("owner", maid.getOwnerUUID());
                    result.put("position", java.util.List.of(maid.getX(), maid.getY(), maid.getZ()));
                    result.put("task", maid.getTask().getUid().toString()); result.put("sit", maid.isMaidInSittingPose());
                    result.put("home", maid.isHomeModeEnable()); result.put("center", maid.getRestrictCenter().toShortString());
                    result.put("health", maid.getHealth()); result.put("mainhand", maid.getMainHandItem().toString());
                    var armor=new java.util.ArrayList<String>();for(var slot:java.util.List.of(EquipmentSlot.HEAD,EquipmentSlot.CHEST,EquipmentSlot.LEGS,EquipmentSlot.FEET))armor.add(maid.getItemBySlot(slot).toString());result.put("armor",armor);
                    result.put("hunger",maid.getHunger());result.put("downed",maid.getPersistentData().getBoolean("tlm_resident_trial_downed"));
                    result.put("attackTarget",maid.getTarget()==null?"none":maid.getTarget().getStringUUID());
                    result.put("brainAttackTarget",maid.getBrain().getMemory(net.minecraft.world.entity.ai.memory.MemoryModuleType.ATTACK_TARGET).map(e->e.getStringUUID()).orElse("none"));
                    result.put("history", maid.getAiChatManager().getHistory().getDeque().stream()
                        .map(com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage::message).toList());
                    result.put("bubbleCount", maid.getChatBubbleManager().getChatBubbleDataCollection().size());
                    result.put("ysm", maid.getYsmModelId());
                    result.put("sleeping",maid.isSleeping());
                    result.put("dimension",maid.level().dimension().location().toString());
                    result.put("canMove",maid.canBrainMoving());result.put("noAi",maid.isNoAi());
                    result.put("sitting",maid.isMaidInSittingPose());result.put("passenger",maid.isPassenger());result.put("leashed",maid.isLeashed());
                    try {result.put("residentHoldsPosition",Class.forName("local.qdj.maids.brain.MaidAgentsMod",true,EntityMaid.class.getClassLoader()).getMethod("residentHoldsPosition",UUID.class).invoke(null,maid.getUUID()));}
                    catch(ReflectiveOperationException error){throw new IllegalStateException("resident_motion_probe_unavailable",error);}
                    result.put("rpg",maid.getPersistentData().getCompound("tlm_resident_rpg").toString());
                    result.put("mainhand",maid.getMainHandItem().toString());
                    return tell(source, result);
                }
                if(a[0].equals("resident-fixture")) {
                    var maid=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));int x=Integer.parseInt(a[2]);
                    var level=source.getLevel();
                    for(var p:net.minecraft.core.BlockPos.betweenClosed(x-4,80,96,x+10,80,110))level.setBlock(p,net.minecraft.world.level.block.Blocks.STONE.defaultBlockState(),3);
                    for(var p:net.minecraft.core.BlockPos.betweenClosed(x-4,81,96,x+10,86,110))level.setBlock(p,net.minecraft.world.level.block.Blocks.AIR.defaultBlockState(),3);
                    maid.teleportTo(x+.5,81,100.5);maid.setInSittingPose(false);maid.setNoAi(false);
                    var s=maid.getSchedulePos();var home=new net.minecraft.core.BlockPos(x,81,100);
                    maid.setHomeModeEnable(true);s.setWorkPos(home);s.setIdlePos(home);s.setSleepPos(home);s.setDimension(level.dimension().location());s.setConfigured(true);s.restrictTo(maid);
                    maid.setItemSlot(EquipmentSlot.MAINHAND,new ItemStack(net.minecraft.world.item.Items.IRON_PICKAXE));
                    maid.getMaidInv().setStackInSlot(0,new ItemStack(net.minecraft.world.item.Items.OAK_PLANKS,3));
                    maid.getMaidInv().setStackInSlot(1,new ItemStack(net.minecraft.world.item.Items.IRON_SWORD));
                    maid.getMaidInv().setStackInSlot(2,new ItemStack(net.minecraft.world.item.Items.IRON_HELMET));
                    level.setBlock(new net.minecraft.core.BlockPos(x+3,81,100),net.minecraft.world.level.block.Blocks.IRON_ORE.defaultBlockState(),3);
                    return tell(source,Map.of("fixture",true,"x",x));
                }
                if(a[0].equals("item-fixture")){
                    var maid=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));
                    String[] fields=a[2].split(" ");int slot=Integer.parseInt(fields[0]),count=Integer.parseInt(fields[2]);
                    var item=net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse(fields[1]));
                    if(slot<0||slot>=Math.min(maid.getMaidInv().getSlots(),maid.getMaidBackpackType().getAvailableMaxContainerIndex())||count<0||count>item.getDefaultMaxStackSize())throw new IllegalArgumentException("fixture_slot_or_count");
                    maid.getMaidInv().setStackInSlot(slot,count==0?ItemStack.EMPTY:new ItemStack(item,count));
                    return tell(source,Map.of("fixture",true,"slot",slot,"count",count));
                }
                if(a[0].equals("service")){
                    try{
                    var manager=Class.forName("org.bukkit.Bukkit").getMethod("getPluginManager").invoke(null);
                    var af=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(manager,"AgentFriend");
                    var service=af.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.ResidentCli");
                    var id=UUID.fromString(a[1]);var fields=a[2].split(" ",2);var request=UUID.fromString(fields[0]);
                    String result=fields.length==1?(String)service.getMethod("query",UUID.class,UUID.class).invoke(null,id,request)
                        :(String)service.getMethod("run",UUID.class,UUID.class,String.class).invoke(null,id,request,fields[1]);
                    source.sendSuccess(()->Component.literal(result),false);return 1;
                    }catch(ReflectiveOperationException failed){throw new IllegalArgumentException(failed);}
                }
                if(a[0].equals("book-fixture")){
                    var maid=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));
                    maid.getMaidInv().setStackInSlot(0,new ItemStack(net.minecraft.world.item.Items.WRITABLE_BOOK));
                    return tell(source,Map.of("blankBook",true));
                }
                if(a[0].equals("inventory")){
                    var maid=(EntityMaid)source.getLevel().getEntity(UUID.fromString(a[1]));var items=new java.util.ArrayList<Object>();
                    for(int i=0;i<maid.getMaidInv().getSlots();i++){var stack=maid.getMaidInv().getStackInSlot(i);if(!stack.isEmpty())items.add(Map.of("slot",i,"id",net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(),"count",stack.getCount(),"name",stack.getHoverName().getString()));}
                    return tell(source,Map.of("items",items));
                }
                if (a[0].equals("meet")) {
                    // Arrange a nearby encounter only in the marked synthetic fixture.
                    var maid = (EntityMaid) source.getLevel().getEntity(UUID.fromString(a[1]));
                    var home = player.blockPosition().offset(2, 0, 2);
                    maid.teleportTo(home.getX()+.5,home.getY(),home.getZ()+.5);
                    maid.setHomeModeEnable(true);
                    var schedule = maid.getSchedulePos();
                    schedule.setWorkPos(home); schedule.setIdlePos(home); schedule.setSleepPos(home);
                    schedule.setDimension(player.level().dimension().location()); schedule.setConfigured(true);
                    schedule.restrictTo(maid);
                    return tell(source, Map.of("arrangedSyntheticEncounter", true));
                }
                if (a[0].equals("menu")) {
                    if (player == null) throw new IllegalArgumentException("QA player not connected");
                    if (a[1].equals("close")) { player.closeContainer(); return tell(source, Map.of("closed", true)); }
                    if (a[1].equals("click")) {
                        var parts = a[2].split(" ");
                        player.containerMenu.clicked(Integer.parseInt(parts[0]), 0, ClickType.valueOf(parts[1]), player);
                    }
                    var contents = new java.util.ArrayList<Map<String,Object>>();
                    for (int i = 0; i < player.containerMenu.slots.size(); i++) {
                        ItemStack item = player.containerMenu.getSlot(i).getItem();
                        if (!item.isEmpty()) contents.add(Map.of("slot", i, "name", item.getHoverName().getString(), "count", item.getCount()));
                    }
                    return tell(source, Map.of("menuId", player.containerMenu.containerId,
                        "contents", contents, "cursorEmpty", player.containerMenu.getCarried().isEmpty()));
                }
                throw new IllegalArgumentException("unknown QA action");
            })));
    }
    private static int tell(CommandSourceStack source, Object value) {
        source.sendSuccess(() -> Component.literal(new Gson().toJson(value)), false);
        return 1;
    }
}
