package dev.qiandeng.irons;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.npc.AbstractVillager;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.trading.MerchantOffer;
import net.minecraft.world.level.GameType;
import java.util.TreeMap;
import java.util.Map;

/** One physical vanilla merchant transaction. No custom prices, grants, or remote trades. */
public final class TradeBridge {
    private TradeBridge() {}
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        var root = Commands.literal("qdtrade").requires(s -> s.hasPermission(2));
        for (String action : new String[]{"offers", "trade"}) {
            var entity = Commands.argument("entity", IntegerArgumentType.integer(1));
            if (action.equals("offers")) entity.executes(c -> run(c.getSource(), action,
                StringArgumentType.getString(c, "actor"), IntegerArgumentType.getInteger(c, "entity"), 0, ""))
                .then(Commands.argument("offset", IntegerArgumentType.integer(0, 19)).executes(c -> run(c.getSource(), action,
                    StringArgumentType.getString(c, "actor"), IntegerArgumentType.getInteger(c, "entity"),
                    IntegerArgumentType.getInteger(c, "offset"), "")));
            else entity.then(Commands.argument("offer", IntegerArgumentType.integer(0, 19))
                .then(Commands.argument("quote", StringArgumentType.word()).executes(c -> run(c.getSource(), action,
                    StringArgumentType.getString(c, "actor"), IntegerArgumentType.getInteger(c, "entity"),
                    IntegerArgumentType.getInteger(c, "offer"), StringArgumentType.getString(c, "quote")))));
            root.then(Commands.literal(action).then(Commands.argument("actor", StringArgumentType.string()).then(entity)));
        }
        dispatcher.register(root);
    }

    private static int run(CommandSourceStack source, String action, String actorId, int entityId, int index, String quote) {
        var out = new JsonObject();
        out.addProperty("schema", 1);
        out.addProperty("capability", "vanilla_merchant_v1");
        out.addProperty("entityId", entityId);
        out.addProperty("ok", false);
        ServerPlayer actor = null;
        boolean started = false;
        Map<String, Integer> originalInventory = null;
        try {
            actor = QiandengIronsBridge.resolve(source.getServer(), actorId);
            out.addProperty("actorUuid", actor.getStringUUID());
            if (!actor.isAlive() || actor.hasDisconnected() || actor.gameMode.getGameModeForPlayer() != GameType.SURVIVAL)
                throw new Refusal("survival_body_required");
            var entity = actor.serverLevel().getEntity(entityId);
            if (!(entity instanceof AbstractVillager merchant) || !merchant.isAlive() || merchant.isBaby())
                throw new Refusal("merchant_unavailable");
            out.addProperty("merchantUuid", merchant.getStringUUID());
            if (actor.distanceToSqr(merchant) > 20.25 || !actor.hasLineOfSight(merchant)) throw new Refusal("merchant_out_of_reach");
            if (merchant.getTradingPlayer() != null) throw new Refusal("merchant_busy");
            if (actor.containerMenu != actor.inventoryMenu || !actor.containerMenu.getCarried().isEmpty())
                throw new Refusal("close_current_container_first");
            var offers = merchant.getOffers();
            if (action.equals("offers")) {
                var rows = new JsonArray();
                int end = Math.min(Math.min(offers.size(), 20), index + 4);
                for (int i = index; i < end; i++) rows.add(describe(actor, merchant, i, offers.get(i)));
                out.add("offers", rows);
                out.addProperty("truncated", offers.size() > 20);
                out.addProperty("offset", index);
                out.addProperty("nextOffset", end < Math.min(offers.size(), 20) ? end : -1);
                out.addProperty("ok", true);
                out.addProperty("code", "ok");
            } else {
                if (!TradeRules.validIndex(index, offers.size()) || !TradeRules.validQuote(quote)) throw new Refusal("invalid_offer");
                var offer = offers.get(index);
                if (!quote.equals(fingerprint(actor, merchant, index, offer))) throw new Refusal("quote_changed");
                if (offer.isOutOfStock()) throw new Refusal("out_of_stock");
                // Empty space guarantees returning payment stacks and the single result cannot drop items.
                long empty = actor.getInventory().items.stream().filter(ItemStack::isEmpty).count();
                if (empty < 3) throw new Refusal("three_inventory_slots_required");
                InteractionHand hand = actor.getMainHandItem().isEmpty() ? InteractionHand.MAIN_HAND
                    : actor.getOffhandItem().isEmpty() ? InteractionHand.OFF_HAND : null;
                if (hand == null) throw new Refusal("empty_hand_required");
                var previousA = offer.getCostA().copy();
                var previousB = offer.getCostB().copy();
                var expected = offer.getResult().copy();
                var inventoryBefore = inventory(actor);
                originalInventory = componentInventory(actor);
                var expectedInventory = new TreeMap<>(originalInventory);
                int uses = offer.getUses();
                started = true;
                // Use the entity's normal interaction, including profession, sleeping and native refusal checks.
                merchant.interact(actor, hand);
                if (!(actor.containerMenu instanceof MerchantMenu menu) || merchant.getTradingPlayer() != actor)
                    throw new Refusal("merchant_refused_interaction");
                if (menu.getOffers().size() <= index || menu.getOffers().get(index) != offer)
                    throw new Refusal("quote_changed");
                // Opening may apply the player's reputation discount. Never silently accept a price increase.
                if (!samePriceOrCheaper(previousA, offer.getCostA()) || !samePriceOrCheaper(previousB, offer.getCostB())
                        || !ItemStack.matches(expected, offer.getResult())) throw new Refusal("quote_changed");
                var paidA = item(offer.getCostA());
                var paidB = item(offer.getCostB());
                change(expectedInventory, key(actor, offer.getCostA()), -offer.getCostA().getCount());
                change(expectedInventory, key(actor, offer.getCostB()), -offer.getCostB().getCount());
                change(expectedInventory, key(actor, expected), expected.getCount());
                if (expectedInventory.values().stream().anyMatch(n -> n < 0)) throw new Refusal("exact_payment_unavailable");
                menu.setSelectionHint(index);
                menu.tryMoveItems(index);
                if (!ItemStack.matches(menu.getSlot(2).getItem(), expected)) throw new Refusal("payment_or_result_unavailable");
                // PICKUP executes exactly one MerchantResultSlot.onTake; QUICK_MOVE can repeat trades.
                menu.clicked(2, 0, ClickType.PICKUP, actor);
                if (!ItemStack.matches(menu.getCarried(), expected) || offer.getUses() != uses + 1)
                    throw new IllegalStateException("native_trade_receipt_mismatch");
                actor.closeContainer(); // vanilla returns remaining payment and carried output to the inventory
                if (actor.containerMenu != actor.inventoryMenu || !actor.containerMenu.getCarried().isEmpty())
                    throw new IllegalStateException("native_trade_close_unconfirmed");
                if (!componentInventory(actor).equals(expectedInventory)) throw new IllegalStateException("native_inventory_receipt_mismatch");
                var receipt = new JsonObject();
                receipt.addProperty("usesBefore", uses);
                receipt.addProperty("usesAfter", offer.getUses());
                receipt.add("costA", paidA);
                receipt.add("costB", paidB);
                receipt.add("result", item(expected));
                var ids = new java.util.HashSet<>(java.util.List.of(paidA.get("id").getAsString(), paidB.get("id").getAsString(),
                    item(expected).get("id").getAsString()));
                receipt.add("inventoryBefore", relevant(inventoryBefore, ids));
                receipt.add("inventoryAfter", relevant(inventory(actor), ids));
                receipt.addProperty("offerIndex", index);
                receipt.addProperty("inventoryVerified", true);
                out.add("receipt", receipt);
                out.addProperty("ok", true);
                out.addProperty("code", "traded");
            }
        } catch (Refusal e) {
            out.addProperty("code", e.getMessage());
        } catch (Exception e) {
            out.addProperty("code", started ? "outcome_unknown" : "trade_unavailable");
        } finally {
            if (started && actor != null && actor.containerMenu instanceof MerchantMenu) {
                try { actor.closeContainer(); }
                catch (Exception e) { out.addProperty("ok", false); out.addProperty("code", "outcome_unknown"); }
            }
            if (started && actor != null && !out.get("ok").getAsBoolean()) {
                try {
                    if (actor.hasDisconnected() || !actor.isAlive() || !componentInventory(actor).equals(originalInventory))
                        out.addProperty("code", "outcome_unknown");
                } catch (Exception e) { out.addProperty("code", "outcome_unknown"); }
            }
        }
        source.sendSuccess(() -> Component.literal("QD_TRADE_JSON " + out), false);
        return out.get("ok").getAsBoolean() ? 1 : 0;
    }

    private static boolean samePriceOrCheaper(ItemStack quoted, ItemStack current) {
        return quoted.isEmpty() ? current.isEmpty() : ItemStack.isSameItemSameComponents(quoted, current)
            && current.getCount() <= quoted.getCount();
    }
    private static String key(ServerPlayer actor, ItemStack stack) {
        return stack.isEmpty() ? "" : stack.copyWithCount(1).saveOptional(actor.registryAccess()).toString();
    }
    private static void change(Map<String, Integer> counts, String key, int delta) {
        if (key.isEmpty() || delta == 0) return;
        int n = counts.getOrDefault(key, 0) + delta;
        if (n == 0) counts.remove(key); else counts.put(key, n);
    }
    private static Map<String, Integer> componentInventory(ServerPlayer actor) {
        var counts = new TreeMap<String, Integer>();
        for (var stack : actor.getInventory().items) change(counts, key(actor, stack), stack.getCount());
        return counts;
    }
    private static JsonObject inventory(ServerPlayer actor) {
        var out = new JsonObject();
        for (var stack : actor.getInventory().items) if (!stack.isEmpty()) {
            String id = BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
            out.addProperty(id, (out.has(id) ? out.get(id).getAsInt() : 0) + stack.getCount());
        }
        return out;
    }
    private static JsonObject relevant(JsonObject counts, java.util.Set<String> ids) {
        var out = new JsonObject();
        for (String id : ids) if (counts.has(id)) out.add(id, counts.get(id));
        return out;
    }
    private static JsonObject item(ItemStack stack) {
        var out = new JsonObject();
        out.addProperty("id", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        out.addProperty("count", stack.getCount());
        return out;
    }
    private static String fingerprint(ServerPlayer actor, AbstractVillager merchant, int index, MerchantOffer offer) {
        return TradeRules.quote(merchant.getStringUUID(), index, offer.getCostA().saveOptional(actor.registryAccess()).toString(),
            offer.getCostB().saveOptional(actor.registryAccess()).toString(), offer.getResult().saveOptional(actor.registryAccess()).toString());
    }
    private static JsonObject describe(ServerPlayer actor, AbstractVillager merchant, int index, MerchantOffer offer) {
        var out = new JsonObject();
        out.addProperty("index", index);
        out.addProperty("quote", fingerprint(actor, merchant, index, offer));
        out.add("costA", item(offer.getCostA()));
        out.add("costB", item(offer.getCostB()));
        out.add("result", item(offer.getResult()));
        out.addProperty("uses", offer.getUses());
        out.addProperty("maxUses", offer.getMaxUses());
        out.addProperty("outOfStock", offer.isOutOfStock());
        return out;
    }
    private static final class Refusal extends RuntimeException { Refusal(String code) { super(code); } }
}
