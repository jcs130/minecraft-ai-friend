package local.qdj.maids.brain;

import com.mojang.logging.LogUtils;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import org.slf4j.Logger;

@Mod("tlm_maid_agents")
public final class MaidAgentsMod {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static volatile MaidAgentsServer running;
    /** Read-only host integration. Only explicitly configured resident UUIDs may receive land membership. */
    public static java.util.Map<java.util.UUID,String> residentIdentities(){
        var current=running;var out=new java.util.LinkedHashMap<java.util.UUID,String>();
        if(current!=null&&current.residents()!=null)for(var id:current.residents().ids())out.put(id,current.residents().name(id));
        return java.util.Map.copyOf(out);
    }
    public static java.util.Map<java.util.UUID,String> visibleResidentIdentities(){
        var current=residents();
        var visible=new java.util.LinkedHashMap<java.util.UUID,String>();
        if(current!=null) for(var id:current.ids()){
            var body=current.body(id);
            if(current.mapVisible(id,body))visible.put(id,current.settings.name(id));
        }
        return java.util.Map.copyOf(visible);
    }
    /** Stock TLM installations have no native custody provider. */
    private static final class Custody {
        static final java.lang.invoke.MethodHandle held = resolve("heldForDriver");
        static final java.lang.invoke.MethodHandle claim = resolve("claimingDriver");
        static java.lang.invoke.MethodHandle resolve(String name) {
            try {
                Class<?> bridge = Class.forName("local.hosting.NativeCustodyFence", false, MaidAgentsMod.class.getClassLoader());
                return java.lang.invoke.MethodHandles.publicLookup().findStatic(bridge, name,
                    java.lang.invoke.MethodType.methodType(boolean.class, java.util.UUID.class));
            } catch (ClassNotFoundException standalone) {
                return null;
            } catch (ReflectiveOperationException badBridge) {
                throw new IllegalStateException("Native body custody interface unavailable", badBridge);
            }
        }
    }
    public static boolean custodyHeld(java.util.UUID id) {
        return custodyState(Custody.held, id);
    }
    public static boolean custodyClaiming(java.util.UUID id) {
        return custodyState(Custody.claim, id);
    }
    private static boolean custodyState(java.lang.invoke.MethodHandle query, java.util.UUID id) {
        if (query == null) return false;
        try { return (boolean) query.invokeExact(id); }
        catch (Throwable failure) { throw new IllegalStateException("Cannot confirm native body custody", failure); }
    }
    static MaidResidents residents(){return running==null?null:running.residents();}
    public static boolean guideRegistrationReady(){return residents()!=null;}
    public static void registerPlayerGuide(java.util.UUID id,java.util.UUID owner,String name){
        var service=residents();
        if(service==null)throw new IllegalStateException("guide_runtime_not_ready");
        service.registerGuide(id,owner,name);
        var body=service.body(id);
        if(body!=null)ResidentRpg.tick(body);
    }
    static MaidCompanions companions(){return running==null?null:running.companions();}
    public static boolean hasExpeditionLeader(java.util.UUID id) {
        var residents = residents();
        return residents != null && residents.expeditionSuppressesNativeFollow(id);
    }
    static MaidAgent runningAgent(java.util.UUID id){return running==null?null:running.agent(id);}
    /** Transient action ownership, never a persisted NoAI/sitting change. */
    public static boolean residentHoldsPosition(java.util.UUID id) {
        var current=running;return current!=null&&current.residents()!=null&&current.residents().holdsPosition(id);
    }
    static boolean managed(com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid maid) {
        return running!=null&&running.agent(maid.getUUID())!=null&&running.agent(maid.getUUID()).matches(maid);
    }

    public MaidAgentsMod() {
        MaidBrainControl.reserveSitePrefix(MaidAgentsConfig.SITE_PREFIX);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::serverStarted);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::serverStopping);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::commands);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::tick);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::interact);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::damage);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::damaged);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::projectile);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::drops);
        NeoForge.EVENT_BUS.addListener(MaidAgentsMod::chat);
    }

    private static void serverStarted(ServerStartedEvent event) {
        try {
            var config = MaidAgentsConfig.read(FMLPaths.CONFIGDIR.get().resolve("tlm-maid-agents.json"));
            running = new MaidAgentsServer(event.getServer(), config);
            // Optional public recruitment. Existing registrations are unchanged when the file is absent.
            running.companions(new MaidCompanions(event.getServer(), running, FMLPaths.CONFIGDIR.get()));
            running.residents(new MaidResidents(event.getServer(), running, FMLPaths.CONFIGDIR.get()));
            LOGGER.info("TLM Maid Agents registered {} fixed entity bindings", running.size());
        } catch (Exception failure) {
            if (running != null) { running.close(); running = null; }
            LOGGER.error("TLM Maid Agents configuration rejected. Check config/tlm-maid-agents.json and native site IDs. Cause type: {}",
                    failure.getClass().getSimpleName());
        }
    }

    private static void serverStopping(ServerStoppingEvent event) {
        MaidAgentsServer previous = running;
        running = null;
        if (previous != null) previous.close();
    }

    private static void commands(RegisterCommandsEvent event) {
        MaidAgentCommands.register(event.getDispatcher(), () -> running);
        CompanionCommands.register(event.getDispatcher(), () -> running == null ? null : running.companions());
        ResidentCommands.register(event.getDispatcher(), () -> running == null ? null : running.residents());
    }

    private static void tick(net.neoforged.neoforge.event.tick.ServerTickEvent.Post event) {
        if (event.getServer().getTickCount() % 20 == 0 && running != null && running.residents() != null)
            running.residents().tick();
        if (event.getServer().getTickCount() % 20 == 0 && running != null && running.companions() != null)
            running.companions().tick();
        if(event.getServer().getTickCount()%5==0&&running!=null&&running.residents()!=null)running.residents().combatTick();
    }

    private static void interact(net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.EntityInteract event) {
        if (running == null || running.companions() == null ||
                !(event.getEntity() instanceof net.minecraft.server.level.ServerPlayer player) ||
                event.getHand() != net.minecraft.world.InteractionHand.MAIN_HAND || !player.getMainHandItem().isEmpty() ||
                !(event.getTarget() instanceof com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid maid) ||
                !running.companions().offered(maid.getUUID()) || !MaidVisitorDialogue.inReach(player, maid)) return;
        if (player.getUUID().equals(maid.getOwnerUUID()) && !player.isShiftKeyDown()) return;
        event.setCanceled(true);
        event.setCancellationResult(net.minecraft.world.InteractionResult.SUCCESS);
        CompanionMenu.open(player, running.companions(), maid.getUUID(), 0);
    }

    private static void damage(net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent event) {
        if (running == null) return;
        var attacker = event.getSource().getEntity();
        if(event.getSource().getDirectEntity() instanceof net.minecraft.world.entity.projectile.Projectile shot
            &&shot.getPersistentData().getBoolean("tlm_resident_shot")&&attacker==null){event.setCanceled(true);return;}
        if(attacker instanceof com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid resident
            &&ResidentProtection.registered(resident)&&!ResidentCombat.hostile(resident,event.getEntity())){event.setCanceled(true);return;}
        // Native jobs may target hostiles. A contract never authorizes harming players, pets, villagers or NPCs.
        if (attacker instanceof com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid maid &&
                running.reserved(maid.getUUID()) && !(event.getEntity() instanceof net.minecraft.world.entity.monster.Enemy))
            event.setCanceled(true);
    }
    private static void projectile(net.neoforged.neoforge.event.entity.EntityJoinLevelEvent event){
        if(event.getEntity() instanceof net.minecraft.world.entity.projectile.Projectile shot
            &&shot.getOwner() instanceof com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid maid
            &&ResidentProtection.registered(maid))shot.getPersistentData().putBoolean("tlm_resident_shot",true);
    }
    private static void damaged(net.neoforged.neoforge.event.entity.living.LivingDamageEvent.Post event){
        if(running!=null&&running.residents()!=null&&event.getSource().getEntity() instanceof com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid maid
            &&ResidentProtection.registered(maid))running.residents().combat.damaged(maid,event.getEntity(),event.getNewDamage(),event.getSource().getDirectEntity() instanceof net.minecraft.world.entity.projectile.Projectile);
    }

    private static void drops(net.neoforged.neoforge.event.entity.living.LivingDropsEvent event) {
        if (running != null && running.companions() != null &&
                event.getEntity() instanceof com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid maid)
            running.companions().died(maid.getUUID());
    }
    private static void chat(net.neoforged.neoforge.event.ServerChatEvent event) {
        if(event.isCanceled()||running==null||running.residents()==null||running.companions()==null)return;
        String raw=event.getRawText();
        for(var id:running.residents().ids()) {
            String prefix="@"+running.residents().settings.name(id)+" ";
            if(raw.startsWith(prefix)) {
                var result=running.companions().ask(event.getPlayer(),id,raw.substring(prefix.length()),0,"public");
                if(!"accepted".equals(result.get("status")))event.getPlayer().sendSystemMessage(net.minecraft.network.chat.Component.literal("暂时无法交谈："+result.get("reason")));
                return;
            }
        }
    }
}
