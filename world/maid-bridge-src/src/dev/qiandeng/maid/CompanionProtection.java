package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.api.event.MaidAttackEvent;
import com.github.tartaricacid.touhoulittlemaid.api.event.MaidDeathEvent;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** Native damage/death protection only. Never moves, recreates, retames, heals on a timer or runs an LLM. */
public final class CompanionProtection {
    public static final Path CONFIG = Path.of("config/qiandeng-companion-protection.json");
    private static CompanionProtectionPolicy policy = CompanionProtectionPolicy.disabled();
    private static String configState = "not_loaded";
    private static boolean installed;
    private CompanionProtection() {}

    public static synchronized void install() {
        if (installed) return;
        installed = true;
        try {
            if (!Files.exists(CONFIG)) configState = "missing";
            else if (Files.isSymbolicLink(CONFIG) || !Files.isRegularFile(CONFIG) || Files.size(CONFIG) > 4096)
                configState = "invalid";
            else {
                policy = CompanionProtectionPolicy.parse(Files.readString(CONFIG, StandardCharsets.UTF_8));
                configState = policy.enabled() ? "enabled" : "disabled";
            }
        } catch (Exception ignored) { policy = CompanionProtectionPolicy.disabled(); configState = "invalid"; }
        // The file is read once at startup, never synchronously from a tick/damage callback.
        NeoForge.EVENT_BUS.addListener(CompanionProtection::onJoin);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, CompanionProtection::onAttack);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, CompanionProtection::onMaidDeath);
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, CompanionProtection::onDeath);
    }

    public static boolean matches(EntityMaid maid) {
        return !maid.level().isClientSide && !maid.isRemoved()
            && policy.matches(maid.getUUID(), maid.getOwnerUUID());
    }
    static void onJoin(EntityJoinLevelEvent event) {
        if (!event.getLevel().isClientSide && event.getEntity() instanceof EntityMaid maid
                && matches(maid) && maid.isAlive()) maid.setEntityInvulnerable(true);
    }
    static void onAttack(MaidAttackEvent event) {
        EntityMaid maid = event.getMaid();
        if (matches(maid)) {
            // TLM's setter updates both vanilla and synced/saved Invulnerable state.
            maid.setEntityInvulnerable(true);
            event.setCanceled(true);
        }
    }
    static void onDeath(LivingDeathEvent event) {
        if (event.getEntity() instanceof EntityMaid maid && matches(maid)) {
            // Covers death entering NeoForge directly. Does not recreate an already removed body.
            maid.setEntityInvulnerable(true);
            if (!(maid.getHealth() > 0)) maid.setHealth(Math.min(1.0f, maid.getMaxHealth()));
            event.setCanceled(true);
        }
    }
    static void onMaidDeath(MaidDeathEvent event) {
        EntityMaid maid = event.getMaid();
        if (matches(maid)) {
            maid.setEntityInvulnerable(true);
            if (!(maid.getHealth() > 0)) maid.setHealth(Math.min(1.0f, maid.getMaxHealth()));
            event.setCanceled(true);
        }
    }
    public static JsonObject status(EntityMaid maid) {
        JsonObject out = new JsonObject();
        out.addProperty("configState", configState);
        out.addProperty("configMatched", matches(maid));
        out.addProperty("nativeInvulnerable", maid.isInvulnerable());
        out.addProperty("tlmInvulnerable", maid.getIsInvulnerable());
        out.addProperty("damageGuard", matches(maid));
        out.addProperty("deathGuard", matches(maid));
        out.addProperty("health", maid.getHealth());
        out.addProperty("alive", maid.isAlive());
        out.addProperty("removalGuard", false);
        return out;
    }
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("qdmaid").requires(s -> s.hasPermission(4) && s.getEntity() == null)
            .then(Commands.literal("protection_status")
                .then(Commands.argument("uuid", StringArgumentType.word()).executes(c -> {
                    EntityMaid maid = MaidBridge.find(c.getSource().getServer(),
                        UUID.fromString(StringArgumentType.getString(c, "uuid")));
                    JsonObject out = status(maid);
                    out.addProperty("schema", 1); out.add("identity", MaidBridge.identity(maid));
                    out.addProperty("ok", true); out.addProperty("observedAt", System.currentTimeMillis());
                    c.getSource().sendSuccess(() -> Component.literal("QD_MAID_JSON " + out), false);
                    return 1;
                }))));
    }
}
