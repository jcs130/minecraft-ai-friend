package dev.qiandeng.maw;

import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.permission.Mode;
import com.dwinovo.numen.permission.Permission;
import com.dwinovo.numen.pathing.body.Controls;
import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ServerboundInteractPacket;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket;
import net.minecraft.network.protocol.game.ClientboundSetCarriedItemPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.projectile.ProjectileUtil;
import net.minecraft.world.entity.vehicle.Boat;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.phys.*;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** Native body primitives. No OP, teleport, direct inventory creation or tick sleeps. */
public final class NativeControlAccess {
    private static final Map<String,Job> JOBS = new LinkedHashMap<>();
    private NativeControlAccess() {}
    static void register() {
        NeoForge.EVENT_BUS.addListener((ServerTickEvent.Pre e)->tick(e.getServer()));
        NeoForge.EVENT_BUS.addListener((ServerStoppedEvent e)->{for(var j:JOBS.values())j.release();JOBS.clear();});
    }
    private static String snbt(ServerPlayer p,ItemStack s) {return s.isEmpty()?"":s.saveOptional(p.registryAccess()).toString();}
    private static JsonObject pos(Vec3 v) {var o=new JsonObject();o.addProperty("x",v.x);o.addProperty("y",v.y);o.addProperty("z",v.z);return o;}
    private static JsonObject result(ServerPlayer p,String code) {
        var o=new JsonObject();o.addProperty("schemaVersion",1);o.addProperty("ok",true);o.addProperty("bodyId",p.getUUID().toString());
        o.addProperty("playerUuid",p.getUUID().toString());o.addProperty("sampledAt",Instant.now().toString());o.addProperty("code",code);
        o.addProperty("outcomeKnown",true);o.addProperty("retryAutomatically",false);o.add("actualPosition",pos(p.position()));
        o.addProperty("dimension",p.level().dimension().location().toString());return o;
    }
    private static final class Rejected extends RuntimeException {Rejected(String code){super(code);}}
    private static void require(boolean condition,String code) {if(!condition)throw new Rejected(code);}
    private static InteractionHand hand(JsonObject a) {return a.get("hand").getAsString().equals("off")?InteractionHand.OFF_HAND:InteractionHand.MAIN_HAND;}
    private static void held(ServerPlayer p,JsonObject a) {
        require(p.containerMenu==p.inventoryMenu && p.containerMenu.getCarried().isEmpty(),"close_menu_and_clear_cursor_before_body_action");
        require(p.getInventory().selected==a.get("expectedHotbarSlot").getAsInt(),"selected_slot_changed");
        require(snbt(p,p.getItemInHand(hand(a))).equals(a.get("expectedHeldSnbt").getAsString()),"held_components_changed");
    }
    private static void active(ServerPlayer p) {PlayerAuthBridge.requireAuthenticated(p);require(!p.isDeadOrDying()&&!p.isSpectator(),"body_dead_or_spectator");}
    private static void idle(ServerPlayer p) {require(JOBS.values().stream().noneMatch(j->j.player==p&&j.end==null),"native_control_busy");}
    static String menuHash(ServerPlayer p) {
        try {
            MessageDigest md=MessageDigest.getInstance("SHA-256");
            for(var slot:p.containerMenu.slots)digest(md,snbt(p,slot.getItem()));digest(md,snbt(p,p.containerMenu.getCarried()));
            return HexFormat.of().formatHex(md.digest());
        }catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
    private static void digest(MessageDigest md,String s) {byte[] b=s.getBytes(StandardCharsets.UTF_8);md.update(ByteBuffer.allocate(4).putInt(b.length).array());md.update(b);}
    private static String hash(String s) {try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));}catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
    private static void menuCas(ServerPlayer p,JsonObject a) {
        var m=p.containerMenu;require(m.containerId==a.get("windowId").getAsInt()&&m.getStateId()==a.get("expectedStateId").getAsInt(),"stale_menu_state");
        require(m.stillValid(p),"menu_not_valid");require(menuHash(p).equals(a.get("expectedControlHash").getAsString()),"menu_components_changed");
    }
    private record Target(HitResult hit,Entity entity,JsonObject json) {}
    private static Target target(ServerPlayer p) {
        Vec3 eye=p.getEyePosition(), direction=p.getViewVector(1);
        double blockReach=p.blockInteractionRange(),entityReach=p.entityInteractionRange(),reach=Math.max(blockReach,entityReach);
        Vec3 end=eye.add(direction.scale(reach));
        var block=p.level().clip(new ClipContext(eye,end,ClipContext.Block.OUTLINE,ClipContext.Fluid.NONE,p));
        double obstruction=block.getType()==HitResult.Type.BLOCK?eye.distanceToSqr(block.getLocation()):reach*reach;
        var entityHit=ProjectileUtil.getEntityHitResult(p,eye,end,p.getBoundingBox().expandTowards(direction.scale(reach)).inflate(1),
            e->e!=p&&!e.isSpectator()&&e.isPickable(),Math.min(obstruction,entityReach*entityReach));
        Entity entity=entityHit==null?null:entityHit.getEntity();HitResult hit=entityHit!=null?entityHit:block;
        var o=result(p,"target_sampled");String binding=p.level().dimension().location()+":";
        if(entity!=null) {
            o.addProperty("type","entity");o.addProperty("entityId",entity.getId());o.addProperty("uuid",entity.getUUID().toString());
            o.addProperty("entityType",BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString());o.addProperty("name",entity.getName().getString());binding+="entity:"+entity.getUUID();
        } else if(hit.getType()==HitResult.Type.BLOCK&&eye.distanceTo(hit.getLocation())<=blockReach) {
            BlockPos bp=block.getBlockPos();var state=p.level().getBlockState(bp);o.addProperty("type","block");
            o.add("position",pos(Vec3.atLowerCornerOf(bp)));o.addProperty("blockId",BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());o.addProperty("face",block.getDirection().getName());
            binding+="block:"+bp+":"+state;
        }else {o.addProperty("type","air");hit=new BlockHitResult(end,Direction.UP,BlockPos.containing(end),false);binding+="air";}
        o.add("hitPosition",pos(hit.getLocation()));o.addProperty("targetToken",hash(binding+":"+p.getYRot()+":"+p.getXRot()));return new Target(hit,entity,o);
    }
    private static Entity entity(ServerPlayer p,JsonObject a) {
        Entity e=p.level().getEntity(a.get("entityId").getAsInt());
        require(e!=null&&e.getUUID().toString().equalsIgnoreCase(a.get("expectedUuid").getAsString()),"entity_identity_changed");
        require(e!=p&&e.isAlive()&&!e.isSpectator()&&p.hasLineOfSight(e)&&p.canInteractWithEntity(e,0),"entity_not_visible_or_reachable");return e;
    }
    private static void entityAction(ServerPlayer p,Entity e,InteractionHand h,boolean attack) {
        // Go through the very same listener as a real client: native reach,
        // PVP, Forge interaction/cancel hooks, menus and item behaviour remain.
        p.connection.handleInteract(attack?ServerboundInteractPacket.createAttackPacket(e,p.isShiftKeyDown()):
            ServerboundInteractPacket.createInteractionPacket(e,p.isShiftKeyDown(),h));
        p.swing(h,true);
    }
    public static JsonObject invoke(ServerPlayer p,String op,JsonObject a,String requestId) {
        try{return execute(p,op,a,requestId);}
        catch(Rejected rejected){var o=result(p,rejected.getMessage());o.addProperty("ok",false);return o;}
        catch(RuntimeException failure){var o=result(p,"native_control_outcome_unknown");o.addProperty("ok",false);o.addProperty("outcomeKnown",false);o.addProperty("outcomeUnknown",true);return o;}
    }
    private static JsonObject execute(ServerPlayer p,String op,JsonObject a,String requestId) {
        if(op.equals("control.actionStatus")||op.equals("control.cancel")) {
            Job j=JOBS.get(a.get("ticket").getAsString());
            if(j==null||!j.player.getUUID().equals(p.getUUID())) {var o=result(p,"control_ticket_unknown");o.addProperty("ok",false);o.addProperty("outcomeKnown",false);o.addProperty("outcomeUnknown",true);o.addProperty("terminal",true);return o;}
            if(op.equals("control.cancel")&&j.end==null)j.finish(false,"control_cancelled",true);
            return j.state();
        }
        if(op.equals("body.controls"))return controls(p);
        if(op.equals("body.target"))return target(p).json;
        active(p);idle(p);var out=result(p,"control_dispatched");
        switch(op) {
            case "body.look"->{require(p instanceof NumenPlayer,"mineflayer_client_aim_required");look(p,a);out.add("controls",controls(p));}
            case "body.input"->{require(p instanceof NumenPlayer,"mineflayer_client_physics_required");require(!p.isUsingItem(),"body_using_item");if(a.has("yaw"))p.setYRot(a.get("yaw").getAsFloat());if(a.has("pitch"))p.setXRot(a.get("pitch").getAsFloat());return start(p,op,a,null);}
            case "body.swing"->p.swing(hand(a),true);
            case "body.dismount"->{p.stopRiding();out.addProperty("ok",!p.isPassenger());}
            case "body.flight"->{require(p.getAbilities().mayfly,"flight_not_permitted");p.getAbilities().flying=a.get("flying").getAsBoolean();p.onUpdateAbilities();out.add("controls",controls(p));}
            case "body.attack","body.interactEntity"->{held(p,a);require(!op.equals("body.attack")||hand(a)==InteractionHand.MAIN_HAND,"attack_requires_main_hand");Entity e=entity(p,a);entityAction(p,e,hand(a),op.equals("body.attack"));out.addProperty("targetUuid",e.getUUID().toString());out.addProperty("targetType",BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString());out.addProperty("effectVerified",false);}
            case "inventory.selectHotbar"->{require(p.containerMenu==p.inventoryMenu&&p.containerMenu.getCarried().isEmpty(),"close_menu_before_selection");int slot=a.get("hotbarSlot").getAsInt();require(snbt(p,p.getInventory().getItem(slot)).equals(a.get("expectedSnbt").getAsString()),"slot_components_changed");p.getInventory().selected=slot;p.connection.send(new ClientboundSetCarriedItemPacket(slot));}
            case "inventory.swapHands"->{require(p.containerMenu==p.inventoryMenu&&p.containerMenu.getCarried().isEmpty(),"close_menu_before_swap");require(p.getInventory().selected==a.get("expectedHotbarSlot").getAsInt()&&snbt(p,p.getMainHandItem()).equals(a.get("expectedMainSnbt").getAsString())&&snbt(p,p.getOffhandItem()).equals(a.get("expectedOffSnbt").getAsString()),"hands_changed");p.connection.handlePlayerAction(new ServerboundPlayerActionPacket(ServerboundPlayerActionPacket.Action.SWAP_ITEM_WITH_OFFHAND,BlockPos.ZERO,Direction.DOWN));}
            case "inventory.drop"->{held(p,a);if(hand(a)==InteractionHand.MAIN_HAND)p.connection.handlePlayerAction(new ServerboundPlayerActionPacket(a.get("all").getAsBoolean()?ServerboundPlayerActionPacket.Action.DROP_ALL_ITEMS:ServerboundPlayerActionPacket.Action.DROP_ITEM,BlockPos.ZERO,Direction.DOWN));else p.inventoryMenu.clicked(45,a.get("all").getAsBoolean()?1:0,ClickType.THROW,p);}
            case "inventory.useHeld"->{held(p,a);require(!p.isUsingItem(),"body_using_item");return start(p,op,a,null);}
            case "body.mouse"->{
                held(p,a);require(!p.isUsingItem(),"body_using_item");Target t=target(p);require(t.json.get("targetToken").getAsString().equals(a.get("expectedTargetToken").getAsString()),"aim_target_changed");
                if(t.entity!=null){boolean attack=a.get("button").getAsString().equals("left");require(!attack||hand(a)==InteractionHand.MAIN_HAND,"attack_requires_main_hand");entityAction(p,t.entity,hand(a),attack);}
                else if(t.json.get("type").getAsString().equals("block")) {
                    if(a.get("button").getAsString().equals("left")){require(hand(a)==InteractionHand.MAIN_HAND,"mining_requires_main_hand");return start(p,op,a,(BlockHitResult)t.hit);}
                    p.gameMode.useItemOn(p,p.level(),p.getItemInHand(hand(a)),hand(a),(BlockHitResult)t.hit);p.swing(hand(a),true);
                }else if(a.get("button").getAsString().equals("right"))return start(p,"inventory.useHeld",a,null);
                else p.swing(hand(a),true);
                out.add("target",t.json);out.addProperty("effectVerified",false);
            }
            case "menu.nativeClick"->{menuCas(p,a);int slot=a.get("slot").getAsInt(),button=a.get("button").getAsInt();ClickType type=ClickType.valueOf(a.get("clickType").getAsString());
                require(slot==-999||slot>=0&&slot<p.containerMenu.slots.size(),"invalid_menu_slot");
                require(switch(type){case PICKUP,QUICK_MOVE,THROW,PICKUP_ALL->button<=1;case SWAP->button<=8||button==40;case CLONE->button==2&&p.getAbilities().instabuild;case QUICK_CRAFT->Set.of(0,1,2,4,5,6,8,9,10).contains(button)&&(button/4!=2||p.getAbilities().instabuild);},"invalid_click_button_or_permission");
                require(slot!=-999||type==ClickType.PICKUP||type==ClickType.QUICK_CRAFT,"invalid_outside_click");p.containerMenu.clicked(slot,button,type,p);out.addProperty("controlHash",menuHash(p));}
            case "menu.button"->{menuCas(p,a);out.addProperty("ok",p.containerMenu.clickMenuButton(p,a.get("buttonId").getAsInt()));out.addProperty("effectVerified",false);}
            case "body.command"->{String command=a.get("command").getAsString();require(!command.startsWith("/")&&!command.contains("\n")&&!command.contains("\r")&&!command.contains("\0"),"invalid_game_command");p.getServer().getCommands().performPrefixedCommand(p.createCommandSourceStack(),command);out.addProperty("effectVerified",false);}
            default->throw new IllegalArgumentException("control_operation_unavailable");
        }
        p.containerMenu.broadcastChanges();PlayerMenuBridge.publishIfChanged(p);return out;
    }
    private static void look(ServerPlayer p,JsonObject a) {
        boolean relative=a.has("relative")&&a.get("relative").getAsBoolean();p.setYRot(Mth.wrapDegrees((relative?p.getYRot():0)+a.get("yaw").getAsFloat()));
        p.setXRot(Mth.clamp((relative?p.getXRot():0)+a.get("pitch").getAsFloat(),-90,90));p.setYHeadRot(p.getYRot());
    }
    private static JsonObject controls(ServerPlayer p) {
        var o=result(p,"controls_sampled");o.addProperty("yaw",p.getYRot());o.addProperty("pitch",p.getXRot());o.addProperty("angleUnit","minecraft_degrees");
        o.addProperty("onGround",p.onGround());o.addProperty("inWater",p.isInWater());o.addProperty("sprinting",p.isSprinting());o.addProperty("sneaking",p.isShiftKeyDown());
        o.addProperty("usingItem",p.isUsingItem());o.addProperty("flying",p.getAbilities().flying);o.addProperty("mayfly",p.getAbilities().mayfly);
        o.addProperty("vehicleId",p.isPassenger()?p.getVehicle().getId():-1);o.add("velocity",pos(p.getDeltaMovement()));return o;
    }
    private static JsonObject start(ServerPlayer p,String mode,JsonObject a,BlockHitResult hit) {
        // One prolific body must not exhaust the process-wide receipt budget.
        // Durable SDK/Numen receipts outlive this bounded native ticket cache.
        while(JOBS.values().stream().filter(j->j.player.getUUID().equals(p.getUUID())).count()>=64) {
            var old=JOBS.values().stream().filter(j->j.player.getUUID().equals(p.getUUID())&&j.end!=null).findFirst();
            require(old.isPresent(),"control_receipt_capacity_busy");JOBS.remove(old.get().ticket);
        }
        require(JOBS.size()<2048,"control_receipt_capacity_busy");var j=new Job(p,mode,a,hit);JOBS.put(j.ticket,j);return j.state();
    }
    private static void tick(MinecraftServer server) {
        for(Job j:List.copyOf(JOBS.values()))if(j.end==null&&j.player.getServer()==server) {
            try{j.tick();}catch(RuntimeException e){j.finish(false,"native_control_tick_failed",false);}
        }
        long cutoff=System.currentTimeMillis()-600000;JOBS.values().removeIf(j->j.end!=null&&j.finishedAt<cutoff);
    }
    private static final class Job {
        final ServerPlayer player;final String mode,ticket=UUID.randomUUID().toString();final JsonObject args;
        final BlockHitResult hit;final String dimension;final Vec3 initial;final int maxTicks;final long deadline=System.currentTimeMillis()+15000;
        JsonObject end;int ticks;float progress;boolean started;long finishedAt;
        Job(ServerPlayer p,String mode,JsonObject a,BlockHitResult hit){player=p;this.mode=mode;args=a.deepCopy();this.hit=hit;dimension=p.level().dimension().location().toString();initial=p.position();maxTicks=(a.get("durationMs").getAsInt()+49)/50;}
        JsonObject state(){if(end!=null)return end.deepCopy();var o=result(player,"control_running");o.addProperty("pending",true);o.addProperty("terminal",false);o.addProperty("ticket",ticket);o.addProperty("elapsedTicks",ticks);o.addProperty("maxTicks",maxTicks);return o;}
        void release(){
            if(mode.equals("body.input")){if(player instanceof NumenPlayer n)n.controls().releaseAll();player.zza=0;player.xxa=0;player.setSprinting(false);player.setShiftKeyDown(false);if(player.getVehicle() instanceof Boat b)b.setInput(false,false,false,false);}
            else if(hit!=null&&started)player.gameMode.handleBlockBreakAction(hit.getBlockPos(),ServerboundPlayerActionPacket.Action.ABORT_DESTROY_BLOCK,hit.getDirection(),player.level().getMaxBuildHeight(),0);
            else if(started&&player.isUsingItem())player.releaseUsingItem();
        }
        void finish(boolean ok,String code,boolean known){
            if(end!=null)return;try{release();}catch(RuntimeException e){known=false;code="control_release_unknown";ok=false;}
            finishedAt=System.currentTimeMillis();end=result(player,code);end.addProperty("ok",ok);end.addProperty("terminal",true);end.addProperty("pending",false);end.addProperty("ticket",ticket);
            end.addProperty("elapsedTicks",ticks);end.addProperty("outcomeKnown",known);end.addProperty("outcomeUnknown",!known);end.add("startedPosition",pos(initial));end.add("controls",controls(player));
            if(code.equals("control_cancelled"))end.addProperty("cancelled",true);
            if(hit!=null){end.add("blockPosition",pos(Vec3.atLowerCornerOf(hit.getBlockPos())));end.addProperty("actualBlockId",BuiltInRegistries.BLOCK.getKey(player.level().getBlockState(hit.getBlockPos()).getBlock()).toString());}
        }
        void tick(){
            if(player.getServer().getPlayerList().getPlayer(player.getUUID())!=player||!dimension.equals(player.level().dimension().location().toString())||player.isDeadOrDying()){finish(false,"control_body_context_changed",false);return;}
            if(player instanceof NumenPlayer&&Permission.modeOf((NumenPlayer)player)!=Mode.BYPASS){finish(false,"control_permission_changed",true);return;}
            if(!PlayerAuthBridge.authenticated(player)||System.currentTimeMillis()>deadline){finish(false,"control_deadline_or_auth_lost",false);return;}
            if(ticks>=maxTicks){finish(true,"control_completed",true);return;}
            ticks++;
            if(mode.equals("body.input")) {
                Set<String> keys=new HashSet<>();for(var k:args.getAsJsonArray("keys"))keys.add(k.getAsString());
                // 0.1.4.1's Physics.step reads Controls, not ServerPlayer.zza.
                // Use the exact official input body, including normal jumping,
                // swimming, collision and item-use slowdown. Never move by TP.
                var nativeKeys=((NumenPlayer)player).controls();
                for(var key:Controls.Key.values())nativeKeys.set(key,keys.contains(key.name().toLowerCase(Locale.ROOT)));
                if(player.getVehicle() instanceof Boat b)b.setInput(keys.contains("left"),keys.contains("right"),keys.contains("forward"),keys.contains("back"));
                started=true;return;
            }
            if(hit!=null) {
                if(player.containerMenu!=player.inventoryMenu||!player.canInteractWithBlock(hit.getBlockPos(),0)){finish(false,"mining_target_no_longer_reachable",true);return;}
                var state=player.level().getBlockState(hit.getBlockPos());
                if(started&&(state.isAir()||!target(player).json.get("targetToken").getAsString().equals(args.get("expectedTargetToken").getAsString()))){finish(true,"mining_block_changed_inspect_result",true);return;}
                held(player,args);
                if(!started){player.gameMode.handleBlockBreakAction(hit.getBlockPos(),ServerboundPlayerActionPacket.Action.START_DESTROY_BLOCK,hit.getDirection(),player.level().getMaxBuildHeight(),0);started=true;}
                progress+=state.getDestroyProgress(player,player.level(),hit.getBlockPos());player.swing(InteractionHand.MAIN_HAND,true);
                if(progress>=1) {player.gameMode.handleBlockBreakAction(hit.getBlockPos(),ServerboundPlayerActionPacket.Action.STOP_DESTROY_BLOCK,hit.getDirection(),player.level().getMaxBuildHeight(),0);finish(true,"mining_finished_inspect_block",true);}
            }else {
                if(!started){held(player,args);player.gameMode.useItem(player,player.level(),player.getItemInHand(hand(args)),hand(args));started=true;}
                else if(!player.isUsingItem())finish(true,"item_use_finished_inspect_effect",true);
            }
        }
    }
}
