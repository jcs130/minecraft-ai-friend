package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.util.UUID;
import net.minecraft.world.item.ItemStack;

/** Narrow in-process bridge. Native inventory remains authoritative; never inserts a player into PlayerList. */
public final class ResidentBodyAccess {
    public static boolean external(UUID id){var r=MaidAgentsMod.residents();return r!=null&&r.external(id);}
    public static void externalReady(UUID id){MaidAgentsMod.residents().externalReady(id);}
    public static void externalGuard(UUID id,boolean enabled){MaidAgentsMod.residents().externalGuard(id,enabled);}
    public static String cast(UUID id,String request,String spell){
        externalReady(id);var r=MaidAgentsMod.residents();var maid=body(id);
        // Preserve the public body request through the native RPG ledger; no new random retry ID.
        UUID original=UUID.nameUUIDFromBytes(("unified-cast:"+id+":"+request).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return new com.google.gson.Gson().toJson(ResidentRpg.cast(maid,r.role(id).profession(),spell,r.allies(maid),original));
    }
    public static String castReceipt(UUID id,String request)throws Exception{
        UUID original=UUID.nameUUIDFromBytes(("unified-cast:"+id+":"+request).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return new com.google.gson.Gson().toJson(ResidentServices.query(id,original));
    }
    public static void speak(UUID id,String text){
        var maid=body(id);maid.getChatBubbleManager().addTextChatBubble(text);
    }
    static java.util.Map<String,Object> conversation(UUID id,net.minecraft.world.entity.LivingEntity speaker,String text,String channel)throws Exception{
        if(!external(id))throw new IllegalArgumentException("unified_controller_not_selected");
        Object pm=Class.forName("org.bukkit.Bukkit").getMethod("getPluginManager").invoke(null);
        if ("private".equals(channel)) {
            Object voice = Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(pm,"QiandengVoice");
            if (voice == null || !(speaker instanceof net.minecraft.server.level.ServerPlayer))
                throw new IllegalArgumentException("npc_private_dialogue_unavailable");
            String request = (String) voice.getClass().getMethod("queueNpcPrivateConversation",UUID.class,UUID.class,String.class)
                    .invoke(voice,id,speaker.getUUID(),text);
            return java.util.Map.of("status","accepted","action","conversation","eventId",request,"channel","private","completed",false);
        }
        Object plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(pm,"QiandengjiMaidBridge");
        if(plugin==null)throw new IllegalStateException("native_body_port_unavailable");
        String event=java.util.UUID.randomUUID().toString();
        plugin.getClass().getMethod("queueResidentConversation",UUID.class,UUID.class,String.class,String.class,String.class)
            .invoke(plugin,id,speaker.getUUID(),speaker.getName().getString(),text,event);
        return java.util.Map.of("status","accepted","action","conversation","eventId",event,"controller","unified","completed",false);
    }
    static Object relationship(UUID body, UUID speaker, boolean privateView) {
        try {
            Object pm = Class.forName("org.bukkit.Bukkit").getMethod("getPluginManager").invoke(null);
            Object voice = Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin", String.class).invoke(pm,"QiandengVoice");
            if (voice == null) return null;
            String result = (String) voice.getClass().getMethod("npcRelationship",UUID.class,UUID.class,boolean.class)
                    .invoke(voice,body,speaker,privateView);
            return result == null ? null : com.google.gson.JsonParser.parseString(result);
        } catch (ReflectiveOperationException | RuntimeException unavailable) {
            return null;
        }
    }
    public static final String DOWNED="tlm_resident_trial_downed";
    public static void downed(UUID id,boolean hold){
        var maid=body(id);var data=maid.getPersistentData();
        if(hold){
            if(!data.getBoolean(DOWNED))data.putBoolean(DOWNED+"_sitting",maid.isMaidInSittingPose());
            data.putBoolean(DOWNED,true);maid.getNavigation().stop();maid.setTarget(null);
            maid.getBrain().eraseMemory(net.minecraft.world.entity.ai.memory.MemoryModuleType.WALK_TARGET);
            maid.getBrain().eraseMemory(net.minecraft.world.entity.ai.memory.MemoryModuleType.ATTACK_TARGET);maid.setInSittingPose(true);
        }else if(data.getBoolean(DOWNED)){maid.setInSittingPose(data.getBoolean(DOWNED+"_sitting"));data.remove(DOWNED);data.remove(DOWNED+"_sitting");}
    }
    private static EntityMaid body(UUID id){var r=MaidAgentsMod.residents();var b=r==null?null:r.body(id);if(r==null||r.role(id)==null||b==null||!b.isAlive())throw new IllegalArgumentException("resident_body_unavailable");return b;}
    public static Object entity(UUID id)throws Exception{return body(id).getClass().getMethod("getBukkitEntity").invoke(body(id));}
    /** Permission queries only: own UUID, survival, never added to the server's PlayerList. */
    public static Object principal(UUID id,UUID worldId,double x,double y,double z)throws Exception{
        var maid=body(id);
        for(var level:maid.getServer().getAllLevels()){
            Object world=level.getClass().getMethod("getWorld").invoke(level);
            if(!worldId.equals(Class.forName("org.bukkit.World").getMethod("getUID").invoke(world)))continue;
            var actor=net.neoforged.neoforge.common.util.FakePlayerFactory.get(level,new com.mojang.authlib.GameProfile(id,"npc_"+id.toString().substring(0,8)));
            actor.setPos(x,y,z);actor.gameMode.changeGameModeForPlayer(net.minecraft.world.level.GameType.SURVIVAL);
            return actor.getClass().getMethod("getBukkitEntity").invoke(actor);
        }
        throw new IllegalArgumentException("resident_destination_world_unavailable");
    }
    public static int capacity(UUID id){var b=body(id);return Math.min(b.getMaidInv().getSlots(),b.getMaidBackpackType().getAvailableMaxContainerIndex());}
    public static int hunger(UUID id){return body(id).getHunger();}
    public static boolean sameParty(UUID a,UUID b){var r=MaidAgentsMod.residents();return r!=null&&r.sameParty(a,b);}
    public static Object item(UUID id,int slot)throws Exception{
        if(slot<0||slot>=capacity(id))throw new IllegalArgumentException("resident_slot_out_of_range");
        return Class.forName("org.bukkit.craftbukkit.inventory.CraftItemStack").getMethod("asBukkitCopy",ItemStack.class).invoke(null,body(id).getMaidInv().getStackInSlot(slot));
    }
    public static void item(UUID id,int slot,Object value)throws Exception{
        var b=body(id);if(slot<0||slot>=capacity(id))throw new IllegalArgumentException("resident_slot_out_of_range");
        var item=(ItemStack)Class.forName("org.bukkit.craftbukkit.inventory.CraftItemStack").getMethod("asNMSCopy",Class.forName("org.bukkit.inventory.ItemStack")).invoke(null,value);
        validate(b,slot,item);
        b.getMaidInv().setStackInSlot(slot,item);
    }
    private static void validate(EntityMaid b,int slot,ItemStack item){
        if(!item.isEmpty()&&(!b.getMaidInv().isItemValid(slot,item)||item.getCount()>Math.min(item.getMaxStackSize(),b.getMaidInv().getSlotLimit(slot))))
            throw new IllegalArgumentException("native_inventory_refused");
    }
    /** Validate the complete write before touching any real native slot. */
    public static void replaceStorage(UUID id,Object[] values)throws Exception{
        var b=body(id);int size=capacity(id);
        if(values==null||values.length!=size)throw new IllegalArgumentException("resident_storage_size_expected:"+size);
        var convert=Class.forName("org.bukkit.craftbukkit.inventory.CraftItemStack").getMethod("asNMSCopy",Class.forName("org.bukkit.inventory.ItemStack"));
        var next=new ItemStack[size];var before=new ItemStack[size];
        for(int i=0;i<size;i++){next[i]=(ItemStack)convert.invoke(null,values[i]);validate(b,i,next[i]);before[i]=b.getMaidInv().getStackInSlot(i).copy();}
        try{for(int i=0;i<size;i++)b.getMaidInv().setStackInSlot(i,next[i]);}
        catch(RuntimeException failure){for(int i=0;i<size;i++)b.getMaidInv().setStackInSlot(i,before[i]);throw failure;}
    }
    public static Object insert(UUID id,Object value)throws Exception{
        var b=body(id);
        var type=Class.forName("org.bukkit.craftbukkit.inventory.CraftItemStack");
        ItemStack remaining=(ItemStack)type.getMethod("asNMSCopy",Class.forName("org.bukkit.inventory.ItemStack")).invoke(null,value);
        // Respect accessible backpack capacity; do not insert into locked expansion slots.
        for(int pass=0;pass<2&&!remaining.isEmpty();pass++)for(int i=0;i<capacity(id)&&!remaining.isEmpty();i++){
            var current=b.getMaidInv().getStackInSlot(i);
            if(pass==0&&current.isEmpty()||pass==1&&!current.isEmpty())continue;
            remaining=b.getMaidInv().insertItem(i,remaining,false);
        }
        return type.getMethod("asBukkitCopy",ItemStack.class).invoke(null,remaining);
    }
    public static void arrived(UUID id){var b=body(id);ResidentHomes.explore(b,b.blockPosition());}
    public static void notice(UUID id,String text)throws Exception{
        body(id);MaidAgentsMod.residents().notice(id,text);
    }
    public static String rpg(UUID id){var b=body(id);return new com.google.gson.Gson().toJson(ResidentRpg.observe(b,MaidAgentsMod.residents().role(id).profession()));}
    public static boolean visibleHostile(UUID id,UUID target,double range){
        if(!Double.isFinite(range)||range<0||range>64)return false;
        var b=body(id);var entity=((net.minecraft.server.level.ServerLevel)b.level()).getEntity(target);
        return entity instanceof net.minecraft.world.entity.LivingEntity living&&ResidentCombat.visibleHostile(b,living,range);
    }
    public static String cliContract(String command){return new com.google.gson.Gson().toJson(ResidentCliContract.describe(command));}
    public static String status(UUID id){
        var maid=body(id);var residents=MaidAgentsMod.residents();var row=new java.util.LinkedHashMap<>(residents.observe(id));
        var allies=residents.allies(maid);
        row.put("nearbyEntities",((net.minecraft.server.level.ServerLevel)maid.level()).getEntitiesOfClass(net.minecraft.world.entity.LivingEntity.class,maid.getBoundingBox().inflate(24),
            e->e!=maid&&e.isAlive()&&maid.distanceToSqr(e)<=576&&maid.hasLineOfSight(e)).stream()
            .sorted(java.util.Comparator.comparingDouble(maid::distanceToSqr)).limit(16)
            .map(e->java.util.Map.of("id",e.getStringUUID(),"name",e.getName().getString(),"position",ResidentActions.point(e.blockPosition()),
                "health",e.getHealth(),"maxHealth",e.getMaxHealth(),"ally",allies.contains(e),"hostile",ResidentCombat.hostile(maid,e))).toList());
        // A status action becomes the next receipt: never recursively embed previous full status results.
        var last=row.remove("lastReceipt");
        if(last instanceof java.util.Map<?,?> receipt){var summary=new java.util.LinkedHashMap<String,Object>();
            for(String key:java.util.List.of("requestId","action","status","reason","completed","observedAt"))if(receipt.containsKey(key))summary.put(key,receipt.get(key));
            row.put("lastRequest",summary);
        }
        return new com.google.gson.Gson().toJson(row);
    }
    public static boolean refillMana(UUID id){var b=body(id);if(ResidentVortex.selected())return ResidentVortex.refill(id);ResidentRpg.data(b).putDouble("mana",ResidentRpg.max(b));return true;}
    public static void combatExperience(UUID id,long cumulative){
        if(cumulative<0)throw new IllegalArgumentException("negative_combat_experience");
        if(ResidentVortex.selected()){ResidentVortex.call("residentCombatExperience",new Class[]{UUID.class,long.class},id,cumulative);return;}
        var d=ResidentRpg.data(body(id));d.putLong("combatXp",Math.max(d.getLong("combatXp"),Math.min(1_000_000,cumulative)));
    }
    /** Entity-only checkpoint for the occupied chunk; no block save, global save or invented player data. */
    public static void save(UUID id){
        var b=body(id);
        var manager=((local.qdj.maids.brain.mixin.ResidentLevelStorage)b.level()).residentEntityManager();
        var storage=(local.qdj.maids.brain.mixin.ResidentEntityStorage)manager;
        if(!storage.residentStoreChunk(b.chunkPosition().toLong(),entity->{}))throw new IllegalStateException("resident_chunk_save_unconfirmed");
        storage.residentStorage().flush(false);
    }
    public static boolean mana(UUID id,double amount,boolean spend){
        if(!Double.isFinite(amount)||amount<0||amount>1000)throw new IllegalArgumentException("invalid_mana_amount");
        return ResidentRpg.mana(body(id),amount,spend);
    }
}
