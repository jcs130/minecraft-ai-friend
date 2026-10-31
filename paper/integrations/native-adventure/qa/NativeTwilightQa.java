package dev.qiandeng.twilightqa;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.nio.file.Files;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.CameraType;
import net.minecraft.commands.arguments.EntityAnchorArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.common.NeoForge;
import org.lwjgl.glfw.GLFW;

/** QA-only native client. Actual input/menu actions; fixture setup is audited separately. */
@Mod("qd_twilight_client_qa")
public final class NativeTwilightQa {
    private final JsonObject report = new JsonObject();
    private final String scenario = System.getProperty("qd.twilight.scenario", "first");
    private int ticks, joined, menuTicks, nextSlot, combatTicks;
    private boolean done, opened, looted;
    private int originalCount;
    private final BlockPos chest = new BlockPos(105, 201, 105);
    private final long deadline = System.nanoTime() + 180_000_000_000L;
    private float healthBefore;
    private net.minecraft.world.entity.LivingEntity combatTarget;
    private boolean requestedCatalog;

    public NativeTwilightQa() {
        if (!Boolean.getBoolean("qd.twilight.qa")) throw new IllegalStateException("QA launch property required");
        report.addProperty("schemaVersion", 1);
        report.addProperty("scenario", scenario);
        report.addProperty("productionModified", false);
        NeoForge.EVENT_BUS.addListener(this::tick);
    }
    private void finish(Minecraft mc, Throwable error) {
        if (done) return;
        done = true;
        mc.options.keyAttack.setDown(false);
        report.addProperty("pass", error == null);
        report.addProperty("observedAt", java.time.Instant.now().toString());
        if (error != null) report.addProperty("error", error.toString());
        try { Files.writeString(mc.gameDirectory.toPath().resolve("twilight-client-qa.json"),
                new GsonBuilder().setPrettyPrinting().create().toJson(report)); }
        catch (Exception failure) { failure.printStackTrace(); }
        mc.stop();
    }
    private JsonArray contents(Minecraft mc, int start, int count) {
        JsonArray array = new JsonArray();
        for (int i = start; i < Math.min(start + count, mc.player.containerMenu.slots.size()); i++) {
            ItemStack stack = mc.player.containerMenu.getSlot(i).getItem();
            if (!stack.isEmpty()) {
                JsonObject row = new JsonObject();
                row.addProperty("slot", i);
                row.addProperty("id", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
                row.addProperty("count", stack.getCount());
                row.addProperty("name", stack.getHoverName().getString());
                row.addProperty("components", stack.getComponentsPatch().toString());
                array.add(row);
            }
        }
        return array;
    }
    private void tick(ClientTickEvent.Post event) {
        Minecraft mc = Minecraft.getInstance();
        if (done) return;
        try {
            if (++ticks == 1) GLFW.glfwHideWindow(mc.getWindow().getWindow());
            if (ticks > 2400 || System.nanoTime() > deadline) throw new IllegalStateException("Client timeout: " + (mc.screen == null ? "world" : mc.screen.getClass().getName()));
            if (mc.level == null || mc.player == null || mc.gameMode == null) return;
            if (mc.getCurrentServer() == null || !"127.0.0.1:39761".equals(mc.getCurrentServer().ip))
                throw new IllegalStateException("Only this private QA endpoint is permitted");
            if (!mc.player.getGameProfile().getName().matches("TwilightQA[12]"))
                throw new IllegalStateException("Only fixture identities are permitted");
            if (!scenario.equals("dimension") && mc.player.position().distanceTo(Vec3.atCenterOf(chest)) > 8) return;
            if (scenario.equals("dimension") && !mc.level.dimension().location().toString().equals("twilightforest:twilight_forest")) return;
            if (++joined == 1) {
                report.addProperty("playerUuid", mc.player.getUUID().toString());
                report.addProperty("username", mc.player.getGameProfile().getName());
                report.addProperty("dimension", mc.level.dimension().location().toString());
                report.addProperty("x", mc.player.getX()); report.addProperty("y", mc.player.getY()); report.addProperty("z", mc.player.getZ());
                report.addProperty("nagaRegistered", BuiltInRegistries.ENTITY_TYPE.containsKey(net.minecraft.resources.ResourceLocation.parse("twilightforest:naga")));
                report.addProperty("lootrChestRegistered", BuiltInRegistries.BLOCK.containsKey(net.minecraft.resources.ResourceLocation.parse("lootr:lootr_chest")));
                for (String id : new String[]{"yes_steve_model", "bettercombat", "touhou_little_maid", "twilightforest", "lootr"})
                    ModList.get().getModContainerById(id).ifPresent(mod -> report.addProperty(id, mod.getModInfo().getVersion().toString()));
            }
            if (scenario.equals("combat")) {
                if (combatTarget == null) for (var entity : mc.level.entitiesForRendering())
                    if (entity instanceof net.minecraft.world.entity.monster.Husk husk && entity.distanceTo(mc.player) < 6) combatTarget = husk;
                if (combatTarget == null) return;
                int sword = -1;
                for (int i = 0; i < 9; i++) if (mc.player.getInventory().getItem(i).is(net.minecraft.world.item.Items.IRON_SWORD)) sword = i;
                if (sword == -1) return;
                combatTicks++;
                mc.player.getInventory().selected = sword;
                mc.player.lookAt(EntityAnchorArgument.Anchor.EYES, combatTarget.getEyePosition());
                if (combatTicks == 30) {
                    healthBefore = combatTarget.getHealth();
                    report.addProperty("targetUuid", combatTarget.getUUID().toString());
                    report.addProperty("targetType", BuiltInRegistries.ENTITY_TYPE.getKey(combatTarget.getType()).toString());
                    report.addProperty("targetHealthBefore", healthBefore);
                    report.addProperty("distance", mc.player.distanceTo(combatTarget));
                    mc.options.setCameraType(CameraType.THIRD_PERSON_BACK);
                }
                if (combatTicks == 70) {
                    Screenshot.grab(mc.gameDirectory, "ysm-native-player.png", mc.getMainRenderTarget(), value -> {});
                    mc.options.setCameraType(CameraType.FIRST_PERSON);
                }
                if (combatTicks == 90) {
                    mc.options.keyAttack.setDown(true);
                    net.minecraft.client.KeyMapping.click(mc.options.keyAttack.getKey());
                }
                if (combatTicks == 160) mc.options.keyAttack.setDown(false);
                if (combatTicks == 180) {
                    report.addProperty("targetHealthAfter", combatTarget.getHealth());
                    report.addProperty("input", "normal held attack key; original Better Combat input and server network");
                    Screenshot.grab(mc.gameDirectory, "better-combat-native.png", mc.getMainRenderTarget(), value -> {});
                    if (combatTarget.getHealth() >= healthBefore) throw new IllegalStateException("Actual Better Combat input caused no observed target damage");
                    finish(mc, null);
                }
                return;
            }
            if (scenario.equals("catalog")) {
                if (joined >= 30 && !requestedCatalog) {
                    requestedCatalog = true;
                    var dispatcher = mc.player.connection.getCommands();
                    String[] inputs = {"ysm model set TwilightQA2 ", "ysm auth TwilightQA2 add ", "ysm export "};
                    java.util.ArrayList<java.util.concurrent.CompletableFuture<?>> futures = new java.util.ArrayList<>();
                    for (String input : inputs) {
                        var parsed = dispatcher.parse(input, mc.player.connection.getSuggestionsProvider());
                        futures.add(dispatcher.getCompletionSuggestions(parsed).thenAccept(suggestions -> {
                            JsonArray names = new JsonArray();
                            for (var suggestion : suggestions.getList()) {
                                if (names.size() >= 256) break;
                                names.add(suggestion.getText());
                            }
                            synchronized (report) { report.add(input, names); }
                        }));
                    }
                    java.util.concurrent.CompletableFuture.allOf(futures.toArray(java.util.concurrent.CompletableFuture[]::new))
                            .thenRun(() -> mc.execute(() -> finish(mc, null)));
                }
                return;
            }
            if (scenario.equals("dimension")) {
                if (!mc.level.dimension().location().toString().equals("twilightforest:twilight_forest")) return;
                if (joined == 80) {
                    report.addProperty("biome", mc.level.getBiome(mc.player.blockPosition()).unwrapKey().orElseThrow().location().toString());
                    report.addProperty("support", BuiltInRegistries.BLOCK.getKey(mc.level.getBlockState(mc.player.blockPosition().below()).getBlock()).toString());
                    JsonArray mobs = new JsonArray();
                    for (var entity : mc.level.entitiesForRendering()) {
                        String id = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
                        if (!id.startsWith("twilightforest:")) continue;
                        JsonObject mob = new JsonObject(); mob.addProperty("id", id);
                        mob.addProperty("uuid", entity.getUUID().toString());
                        mob.addProperty("entityClass", entity.getClass().getName());
                        mob.addProperty("rendererClass", mc.getEntityRenderDispatcher().getRenderer(entity).getClass().getName());
                        mobs.add(mob);
                    }
                    report.add("nativeEntities", mobs);
                    if (mobs.isEmpty()) throw new IllegalStateException("Expected actual Twilight entity/renderer");
                    Screenshot.grab(mc.gameDirectory, "twilight-native-world.png", mc.getMainRenderTarget(), value -> {});
                    finish(mc, null);
                }
                return;
            }
            if (joined == 30) {
                report.addProperty("chestBlock", BuiltInRegistries.BLOCK.getKey(mc.level.getBlockState(chest).getBlock()).toString());
                mc.player.setYRot(0); mc.player.setXRot(20);
                mc.gameMode.useItemOn(mc.player, InteractionHand.MAIN_HAND,
                        new BlockHitResult(Vec3.atCenterOf(chest), Direction.NORTH, chest, false));
            }
            if (mc.player.containerMenu == mc.player.inventoryMenu) {
                if (joined > 160 && !opened) throw new IllegalStateException("Actual right-click did not open native Lootr container");
                return;
            }
            if (!opened) {
                opened = true;
                report.addProperty("menuClass", mc.player.containerMenu.getClass().getName());
                report.addProperty("screenClass", mc.screen == null ? "none" : mc.screen.getClass().getName());
                report.addProperty("windowId", mc.player.containerMenu.containerId);
                report.addProperty("totalSlots", mc.player.containerMenu.slots.size());
            }
            menuTicks++;
            if (menuTicks == 20) {
                JsonArray initial = contents(mc, 0, 27);
                originalCount = initial.size();
                report.add("initialChest", initial);
                report.add("initialInventory", contents(mc, 27, 36));
                Screenshot.grab(mc.gameDirectory, "lootr-native-menu.png", mc.getMainRenderTarget(), value -> {});
                if (scenario.equals("reconnect")) {
                    if (originalCount != 0) throw new IllegalStateException("Loot was regenerated after reconnect/restart");
                    report.add("retainedInventory", contents(mc, 27, 36));
                    finish(mc, null);
                    return;
                }
                if (originalCount == 0) throw new IllegalStateException("New participant received empty private loot");
            }
            if (menuTicks > 30 && menuTicks % 4 == 0 && nextSlot < 27) {
                if (!mc.player.containerMenu.getSlot(nextSlot).getItem().isEmpty())
                    mc.gameMode.handleInventoryMouseClick(mc.player.containerMenu.containerId, nextSlot, 0, ClickType.QUICK_MOVE, mc.player);
                nextSlot++;
            }
            if (menuTicks > 155 && !looted) {
                looted = true;
                JsonArray remaining = contents(mc, 0, 27), inventory = contents(mc, 27, 36);
                report.add("remainingChest", remaining); report.add("finalInventory", inventory);
                if (!remaining.isEmpty() || inventory.isEmpty()) throw new IllegalStateException("Actual shift-click transfer did not reach server-confirmed empty chest/inventory");
                mc.player.closeContainer();
                finish(mc, null);
            }
        } catch (Throwable error) { finish(mc, error); }
    }
}
