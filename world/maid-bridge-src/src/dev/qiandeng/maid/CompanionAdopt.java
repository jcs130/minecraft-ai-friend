package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.init.InitDataAttachment;
import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.level.GameType;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

/** Bounded console setup: one normal held-item interaction, without tool auto-pathing. */
public final class CompanionAdopt {
    private static final ReceiptJournal JOURNAL = new ReceiptJournal(Path.of("data/qiandeng-maid-bridge/adoption-receipts"));
    private CompanionAdopt() {}
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("qdmaid")
            .requires(s -> s.hasPermission(4) && s.getEntity() == null)
            .then(Commands.literal("companion_adopt")
                .then(Commands.argument("requestId", StringArgumentType.word())
                    .then(Commands.argument("maidUuid", StringArgumentType.word())
                        .then(Commands.argument("ownerUuid", StringArgumentType.word()).executes(c -> adopt(
                            c.getSource(), StringArgumentType.getString(c, "requestId"),
                            StringArgumentType.getString(c, "maidUuid"), StringArgumentType.getString(c, "ownerUuid"))))))));
    }
    private static int adopt(CommandSourceStack source, String requestId, String maidId, String ownerId) {
        BridgeProtocol.Request request = null;
        JsonObject result;
        boolean claimed = false, interacted = false;
        try {
            MaidBridge.requireThread(source.getServer());
            if (!requestId.matches("[A-Za-z0-9_-]{16,80}")) throw new BridgeProtocol.Failure("invalid_request_id");
            var maidUuid = BridgeProtocol.uuid(maidId); var ownerUuid = BridgeProtocol.uuid(ownerId);
            request = new BridgeProtocol.Request(requestId, maidUuid, ownerUuid, "companion_adopt", new JsonObject(),
                BridgeProtocol.sha256(("companion_adopt_v1\n" + maidUuid + "\n" + ownerUuid).getBytes(StandardCharsets.UTF_8)));
            var maid = MaidBridge.find(source.getServer(), maidUuid);
            if (maid.getOwnerUUID() != null && !ownerUuid.equals(maid.getOwnerUUID()))
                throw new BridgeProtocol.Failure("owner_changed");
            var owner = source.getServer().getPlayerList().getPlayer(ownerUuid);
            if (owner == null || !owner.getClass().getName().equals("com.dwinovo.numen.entity.NumenPlayer")
                || !owner.isAlive() || owner.hasDisconnected()) throw new BridgeProtocol.Failure("online_numen_owner_required");
            var previous = JOURNAL.claim(request);
            if (previous != null) return emit(source, previous);
            claimed = true;
            if (maid.isTame() || maid.getOwnerUUID() != null) throw new BridgeProtocol.Failure("already_owned");
            if (owner.gameMode.getGameModeForPlayer() != GameType.SURVIVAL)
                throw new BridgeProtocol.Failure("survival_owner_required");
            if (owner.level() != maid.level() || owner.distanceToSqr(maid) > 9)
                throw new BridgeProtocol.Failure("within_three_blocks_required");
            if (!owner.hasLineOfSight(maid)) throw new BridgeProtocol.Failure("line_of_sight_required");
            if (owner.containerMenu != owner.inventoryMenu || !owner.containerMenu.getCarried().isEmpty())
                throw new BridgeProtocol.Failure("closed_empty_menu_required");
            var hand = maid.getTamedItem().test(owner.getMainHandItem()) ? InteractionHand.MAIN_HAND : InteractionHand.OFF_HAND;
            var item = owner.getItemInHand(hand);
            if (item.isEmpty() || !maid.getTamedItem().test(item)) throw new BridgeProtocol.Failure("held_native_taming_item_required");
            var count = owner.getData(InitDataAttachment.MAID_NUM);
            if (!count.canAdd()) throw new BridgeProtocol.Failure("native_maid_limit_reached");
            int itemsBefore = item.getCount(), maidsBefore = count.get();
            // This is the native EntityMaid interaction/tameMaid path, including item cost,
            // count limit, attachment, advancement and MaidTamedEvent. Never call tame/setOwnerUUID.
            interacted = true;
            var interaction = maid.interact(owner, hand);
            int itemsAfter = owner.getItemInHand(hand).getCount();
            boolean applied = interaction.consumesAction() && maid.isTame() && ownerUuid.equals(maid.getOwnerUUID())
                && maid.getOwner() == owner && itemsAfter == itemsBefore - 1 && count.get() == maidsBefore + 1;
            result = MaidBridge.response(request, applied, applied ? "normally_adopted" : "native_adoption_unconfirmed",
                applied ? "applied" : "outcome_unknown");
            result.add("identity", MaidBridge.identity(maid)); result.add("state", MaidBridge.state(maid));
            result.addProperty("hand", hand.name()); result.addProperty("itemsBefore", itemsBefore);
            result.addProperty("itemsAfter", itemsAfter); result.addProperty("maidCountBefore", maidsBefore);
            result.addProperty("maidCountAfter", count.get()); result.addProperty("autoPathing", false);
            result.addProperty("modelCalled", false);
        } catch (BridgeProtocol.Failure error) {
            result = MaidBridge.response(request, false, error.code,
                interacted || error.code.equals("outcome_unknown") ? "outcome_unknown" : "rejected");
        } catch (Exception error) {
            result = MaidBridge.response(request, false, interacted ? "outcome_unknown" : "adoption_unavailable",
                interacted ? "outcome_unknown" : "rejected");
        }
        if (claimed) {
            try { JOURNAL.finish(request, result); }
            catch (Exception error) { result = MaidBridge.response(request, false, "outcome_unknown", "outcome_unknown"); }
        }
        return emit(source, result);
    }
    private static int emit(CommandSourceStack source, JsonObject result) {
        String text = BridgeProtocol.PREFIX + result;
        source.sendSuccess(() -> Component.literal(text), false);
        return result.get("ok").getAsBoolean() ? 1 : 0;
    }
}
