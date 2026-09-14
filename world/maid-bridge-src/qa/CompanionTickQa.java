package dev.qiandeng.maidqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.qiandeng.maid.CompanionTick;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.core.BlockPos;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** Isolated far-from-spawn fixture only. No model or production identity is used. */
@Mod("qiandeng_companion_tick_qa")
public final class CompanionTickQa {
    private static final UUID OWNER = UUID.fromString("ec782851-295d-4d60-8847-8b5084de4241");
    private static final UUID HUMAN = UUID.fromString("40faf2cc-c96b-49e0-a951-8e55e4a7f159");
    private static final UUID MAID = UUID.fromString("43e4eb68-80b2-4a3e-b9ad-04851ea92a38");
    private static BlockPos lastMaidPos = new BlockPos(1060, -60, 1024);
    public CompanionTickQa() { NeoForge.EVENT_BUS.addListener(this::register); }
    private void register(RegisterCommandsEvent event) {
        if (!"isolated-maid-bridge".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("QA fixture requires isolated environment");
        event.getDispatcher().register(Commands.literal("qdmaidtickqa")
            .requires(s -> s.getEntity() == null && s.hasPermission(4))
            .then(Commands.argument("action", StringArgumentType.word()).executes(c -> {
                var server = c.getSource().getServer(); var level = server.overworld();
                String action = StringArgumentType.getString(c, "action");
                NumenPlayer owner = (NumenPlayer) server.getPlayerList().getPlayer(OWNER);
                EntityMaid maid = level.getEntity(MAID) instanceof EntityMaid m ? m : null;
                JsonObject out = new JsonObject();
                try {
                    if (action.equals("setup")) {
                        if (Files.exists(Path.of("companion-tick-qa-created"))) throw new IllegalStateException("already_created");
                        owner = CompanionFactory.spawn(server, OWNER, "CompanionQA", HUMAN, level, new Vec3(1024.5, -60, 1024.5));
                        CompanionRegistry.get(server).put(OWNER, new CompanionRegistry.Entry(
                            "CompanionQA", HUMAN, level.dimension(), new BlockPos(1024, -60, 1024)));
                        owner.getInventory().setItem(40, new ItemStack(Items.CAKE, 2));
                        maid = new EntityMaid(level); maid.setUUID(MAID); maid.setPos(1026, -60, 1024.5);
                        maid.setCustomName(Component.literal("Tick QA")); maid.setPersistenceRequired();
                        maid.setInvulnerable(true); maid.setNoAi(true); level.addFreshEntity(maid);
                        Files.writeString(Path.of("companion-tick-qa-created"), MAID.toString());
                    } else if (action.equals("place_behind")) {
                        if (!maid.isTame() || !OWNER.equals(maid.getOwnerUUID())) throw new IllegalStateException("native_adoption_required");
                        maid.setPos(1060.5, -60, 1024.5); maid.setNoAi(false); maid.setInSittingPose(true);
                    } else if (action.equals("follow")) {
                        maid.setInSittingPose(false);
                    } else if (action.equals("shift_owner")) {
                        // Fixture displacement. The maid must return using its own installed TLM brain.
                        owner.moveTo(1088.5, -60, 1024.5, owner.getYRot(), owner.getXRot());
                    } else if (action.equals("owner_offline")) {
                        CompanionFactory.despawn(server, owner); owner = null;
                    } else if (!action.equals("status")) throw new IllegalStateException("unknown_action");
                    out.addProperty("ok", true);
                } catch (Exception e) { out.addProperty("ok", false); out.addProperty("failure", e.toString()); }
                out.addProperty("serverTick", server.getTickCount());
                out.addProperty("maidUuid", MAID.toString()); out.addProperty("ownerUuid", OWNER.toString());
                out.addProperty("ownerOnline", owner != null); out.addProperty("maidLoaded", maid != null);
                if (maid != null) {
                    lastMaidPos = maid.blockPosition();
                    out.add("ticking", CompanionTick.status(maid));
                    out.addProperty("following", !maid.isHomeModeEnable()); out.addProperty("sitting", maid.isMaidInSittingPose());
                    out.addProperty("bodyTickCount", maid.tickCount); out.addProperty("tame", maid.isTame());
                    out.addProperty("actualOwnerUuid", maid.getOwnerUUID() == null ? "" : maid.getOwnerUUID().toString());
                    JsonArray pos = new JsonArray(); pos.add(maid.getX()); pos.add(maid.getY()); pos.add(maid.getZ()); out.add("position", pos);
                    if (owner != null) out.addProperty("distance", Math.sqrt(maid.distanceToSqr(owner)));
                }
                out.addProperty("lastPositionEntityTicking", level.isPositionEntityTicking(lastMaidPos));
                String text = "QD_COMPANION_TICK_QA " + out;
                c.getSource().sendSuccess(() -> Component.literal(text), false);
                return out.get("ok").getAsBoolean() ? 1 : 0;
            })));
    }
}
