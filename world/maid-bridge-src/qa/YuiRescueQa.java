package dev.qiandeng.maidqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.AIConfig;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.StringArgumentType;
import dev.qiandeng.maid.CompanionProtection;
import dev.qiandeng.maid.YuiRescue;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** Fresh internal-network QA world only. These are fixtures, never the production entities. */
@Mod("qiandeng_yui_rescue_qa")
public final class YuiRescueQa {
    public YuiRescueQa() { NeoForge.EVENT_BUS.addListener(this::register); }
    private void register(RegisterCommandsEvent event) {
        if (!"isolated-maid-bridge".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("isolated_fixture_required");
        event.getDispatcher().register(Commands.literal("qdyuiqa").requires(s -> s.getEntity() == null && s.hasPermission(4))
            .then(Commands.argument("action", StringArgumentType.word()).executes(c -> {
                var server = c.getSource().getServer(); var level = server.overworld();
                String action = StringArgumentType.getString(c, "action"); JsonObject out = new JsonObject();
                try {
                    AIConfig.LLM_ENABLED.set(false);
                    ServerPlayer kirito = server.getPlayerList().getPlayer(YuiRescue.KIRITO);
                    EntityMaid yui = level.getEntity(YuiRescue.YUI) instanceof EntityMaid m ? m : null;
                    if (action.equals("setup")) {
                        Path marker = Path.of("rescue-qa-created");
                        if (Files.exists(marker)) throw new IllegalStateException("fixture_already_created");
                        for (int x = -5; x <= 5; x++) for (int z = -5; z <= 5; z++)
                            level.setBlockAndUpdate(new BlockPos(x, -52, z), Blocks.STONE.defaultBlockState());
                        kirito = CompanionFactory.spawn(server, YuiRescue.KIRITO, "Kirito", UUID.fromString("ec782851-295d-4d60-8847-8b5084de4241"),
                            level, new Vec3(0.5, -60, 0.5));
                        yui = new EntityMaid(level); yui.setUUID(YuiRescue.YUI); yui.setPos(-1.5, -60, 0.5);
                        yui.setOwnerUUID(YuiRescue.KIRITO); yui.setTame(true, false); yui.setNoAi(true); yui.setPersistenceRequired();
                        level.addFreshEntity(yui); Files.writeString(marker, "isolated_fixture");
                    } else if (action.equals("restore_owner") && kirito == null) {
                        kirito = CompanionFactory.spawn(server, YuiRescue.KIRITO, "Kirito", UUID.fromString("ec782851-295d-4d60-8847-8b5084de4241"), level, null);
                    } else if (action.equals("protection")) {
                        float before = yui.getHealth(); UUID id = yui.getUUID(); UUID owner = yui.getOwnerUUID();
                        boolean noAi = yui.isNoAi();
                        out.addProperty("ordinaryRejected", !yui.hurt(yui.damageSources().generic(), 1000));
                        out.addProperty("voidRejected", !yui.hurt(yui.damageSources().fellOutOfWorld(), 1000));
                        yui.kill(); out.addProperty("killPrevented", yui.isAlive() && yui.getHealth() == before);
                        out.addProperty("healthUnchanged", yui.getHealth() == before);
                        yui.setHealth(0); yui.die(yui.damageSources().genericKill());
                        out.addProperty("directDeathPrevented", yui.isAlive() && yui.getHealth() > 0);
                        yui.setHealth(before);
                        CompoundTag saved = new CompoundTag(); yui.saveWithoutId(saved);
                        out.addProperty("savedInvulnerable", saved.getBoolean("Invulnerable"));
                        EntityMaid restored = new EntityMaid(level); restored.load(saved);
                        out.addProperty("nativeLoadInvulnerable", restored.isInvulnerable() && restored.getIsInvulnerable());
                        EntityMaid other = new EntityMaid(level); other.setPos(6.5, -60, 0.5);
                        other.setOwnerUUID(owner); float otherHealth = other.getHealth();
                        out.addProperty("otherBodyUnprotected", !CompanionProtection.matches(other) && other.hurt(other.damageSources().generic(), 1)
                            && other.getHealth() < otherHealth);
                        EntityMaid wrong = new EntityMaid(level); wrong.setUUID(id); wrong.setOwnerUUID(UUID.randomUUID());
                        out.addProperty("wrongOwnerUnprotected", !CompanionProtection.matches(wrong));
                        out.addProperty("identityAiPreserved", id.equals(yui.getUUID()) && owner.equals(yui.getOwnerUUID()) && noAi == yui.isNoAi());
                    } else if (action.equals("move_kirito")) {
                        kirito.moveTo(kirito.getX() + 2, kirito.getY(), kirito.getZ(), 0, 0);
                    } else if (!action.equals("status") && !action.equals("restore_owner")) throw new IllegalStateException("unknown_fixture_action");
                    out.addProperty("ok", true);
                    if (kirito != null) { out.addProperty("kiritoUuid", kirito.getStringUUID()); out.addProperty("kiritoY", kirito.getY()); }
                    if (yui != null) { out.addProperty("yuiUuid", yui.getStringUUID()); out.addProperty("yuiY", yui.getY()); out.add("protection", CompanionProtection.status(yui)); }
                    out.addProperty("llmEnabled", AIConfig.LLM_ENABLED.get());
                } catch (Exception error) { out.addProperty("ok", false); out.addProperty("failure", error.getClass().getSimpleName() + ":" + error.getMessage()); }
                c.getSource().sendSuccess(() -> Component.literal("QD_YUI_QA " + out), false); return out.get("ok").getAsBoolean() ? 1 : 0;
            })));
    }
}
