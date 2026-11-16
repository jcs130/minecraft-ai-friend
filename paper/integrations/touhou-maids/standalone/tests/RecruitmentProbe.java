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
                ServerPlayer player = server.getPlayerList().getPlayerByName("NpcModelQA");
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
                    result.put("history", maid.getAiChatManager().getHistory().getDeque().stream()
                        .map(com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage::message).toList());
                    result.put("bubbleCount", maid.getChatBubbleManager().getChatBubbleDataCollection().size());
                    result.put("ysm", maid.getYsmModelId());
                    return tell(source, result);
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
