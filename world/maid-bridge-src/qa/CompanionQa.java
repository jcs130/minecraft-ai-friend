package dev.qiandeng.maidqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.core.tools.interact.InteractEntityTool;
import com.dwinovo.numen.core.tools.work.MoveToTool;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.MaidAIChatSerializable;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.setting.SettingReader;
import com.github.tartaricacid.touhoulittlemaid.api.event.MaidTamedEvent;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.AIConfig;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.init.InitDataAttachment;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** Fresh isolated world only. Exercises installed Numen tools, never calls tame/setOwnerUUID. */
@Mod("qiandeng_companion_qa")
public final class CompanionQa {
    private static final UUID OWNER = UUID.fromString("ec782851-295d-4d60-8847-8b5084de4241");
    private static final UUID HUMAN = UUID.fromString("40faf2cc-c96b-49e0-a951-8e55e4a7f159");
    private static final UUID MAID = UUID.fromString("43e4eb68-80b2-4a3e-b9ad-04851ea92a38");
    private int tameEvents;
    private String lastReply = "";
    public CompanionQa() {
        NeoForge.EVENT_BUS.addListener(this::register);
        NeoForge.EVENT_BUS.addListener((MaidTamedEvent e) -> tameEvents++);
    }
    private void register(RegisterCommandsEvent event) {
        if (!"isolated-maid-bridge".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("QA fixture requires isolated environment");
        event.getDispatcher().register(Commands.literal("qdmaidcompanionqa")
            .requires(s -> s.getEntity() == null && s.hasPermission(4))
            .then(Commands.argument("action", StringArgumentType.word()).executes(c -> {
                var server = c.getSource().getServer(); var level = server.overworld();
                String action = StringArgumentType.getString(c, "action");
                NumenPlayer owner = (NumenPlayer) server.getPlayerList().getPlayer(OWNER);
                EntityMaid maid = level.getEntity(MAID) instanceof EntityMaid m ? m : null;
                JsonObject out = new JsonObject();
                try {
                    if (action.equals("setup")) {
                        Path marker = Path.of("companion-qa-created");
                        if (Files.exists(marker)) throw new IllegalStateException("fixture_already_created");
                        var directory = SettingReader.getSettingsFolder(); Files.createDirectories(directory);
                        String setting = "meta:\n  version: 1\n  author: QA fixture\n  model_id: [\"touhou_little_maid:hakurei_reimu\"]\n  language: en_us\nsetting: Isolated companion QA.\n";
                        Files.writeString(directory.resolve("companion-qa.yml"), setting);
                        Path persistent = Path.of("tlm_custom_pack/companion-qa/assets/companion_qa/settings");
                        Files.createDirectories(persistent); Files.writeString(persistent.resolve("companion-qa.yml"), setting);
                        SettingReader.reloadSettings(); AIConfig.LLM_ENABLED.set(true);
                        owner = CompanionFactory.spawn(server, OWNER, "CompanionQA", HUMAN, level, new Vec3(0.5, -60, 0.5));
                        owner.getInventory().setItem(0, new ItemStack(Items.IRON_SWORD));
                        owner.getInventory().setItem(40, new ItemStack(Items.CAKE, 3));
                        owner.getInventory().selected = 0;
                        maid = new EntityMaid(level); maid.setUUID(MAID); maid.setPos(2.0, -60, 0.5);
                        maid.setCustomName(Component.literal("QA Companion")); maid.setPersistenceRequired();
                        maid.setInvulnerable(true); maid.setNoAi(true); level.addFreshEntity(maid);
                        maid.getAiChatManager().ttsSite = MaidAIChatSerializable.NO_TTS_SITE;
                        Files.writeString(marker, MAID.toString());
                    } else if (action.equals("adopt_far")) {
                        owner.moveTo(8.5, -60, 0.5, 0, 0);
                    } else if (action.equals("adopt_near")) {
                        owner.moveTo(0.5, -60, 0.5, 0, 0);
                    } else if (action.equals("speech_other_dimension")) {
                        owner.teleportTo(server.getLevel(Level.NETHER), 0.5, 120, 0.5, java.util.Set.of(), 0, 0);
                    } else if (action.equals("speech_restore_dimension")) {
                        owner.teleportTo(level, 0.5, -60, 0.5, java.util.Set.of(), 0, 0);
                    } else if (action.equals("adopt_wall") || action.equals("adopt_clear_wall")) {
                        var block = action.equals("adopt_wall") ? Blocks.STONE : Blocks.AIR;
                        level.setBlockAndUpdate(new BlockPos(1, -60, 0), block.defaultBlockState());
                        level.setBlockAndUpdate(new BlockPos(1, -59, 0), block.defaultBlockState());
                    } else if (action.equals("adopt_no_item")) {
                        owner.getInventory().setItem(40, ItemStack.EMPTY);
                    } else if (action.equals("adopt_restore_item")) {
                        owner.getInventory().setItem(40, new ItemStack(Items.CAKE, 3));
                    } else if (action.equals("restore_owner")) {
                        if (owner == null) owner = CompanionFactory.spawn(server, OWNER, "CompanionQA", HUMAN, level, null);
                        AIConfig.LLM_ENABLED.set(true);
                    } else if (action.equals("adopt")) {
                        if (owner == null || maid == null || maid.isTame() || maid.getOwnerUUID() != null
                            || owner.distanceToSqr(maid) > 9 || !owner.hasLineOfSight(maid)
                            || !maid.getTamedItem().test(owner.getMainHandItem()))
                            throw new IllegalStateException("unowned_nearby_maid_and_native_taming_item_required");
                        var args = new JsonObject(); args.addProperty("button", "right");
                        args.addProperty("entity_id", maid.getId()); args.addProperty("hold_ticks", 0);
                        args.addProperty("item_id", "minecraft:cake");
                        new InteractEntityTool().onServerCall("companion_qa_adopt", args, owner, reply -> lastReply = reply);
                    } else if (action.equals("follow_walk")) {
                        maid.setNoAi(false); maid.setInSittingPose(false);
                        var args = new JsonObject(); args.addProperty("x", 8.5); args.addProperty("y", -60.0);
                        args.addProperty("z", 0.5); args.addProperty("walk_only", true);
                        new MoveToTool().onServerCall("companion_qa_walk", args, owner, reply -> lastReply = reply);
                    } else if (action.equals("far_owner")) {
                        owner.moveTo(32.5, -60, 0.5, owner.getYRot(), owner.getXRot());
                    } else if (action.equals("owner_offline")) {
                        CompanionFactory.despawn(server, owner); owner = null;
                    } else if (action.equals("close_menu")) {
                        owner.closeContainer();
                    } else if (action.equals("disable_native_chat")) {
                        AIConfig.LLM_ENABLED.set(false);
                    } else if (action.equals("enable_native_chat")) {
                        AIConfig.LLM_ENABLED.set(true);
                    } else if (!action.equals("status")) throw new IllegalStateException("unknown_action");
                    out.addProperty("ok", true);
                } catch (Exception e) {
                    out.addProperty("ok", false); out.addProperty("failure", e.getClass().getSimpleName() + ":" + e.getMessage());
                }
                out.addProperty("maidUuid", MAID.toString()); out.addProperty("expectedOwnerUuid", OWNER.toString());
                out.addProperty("ownerOnline", owner != null); out.addProperty("maidLoaded", maid != null);
                out.addProperty("tameEvents", tameEvents); out.addProperty("lastReply", lastReply);
                if (owner != null) {
                    out.addProperty("ownerClass", owner.getClass().getName());
                    out.addProperty("ownerUuid", owner.getStringUUID()); out.addProperty("ownerX", owner.getX());
                    out.addProperty("cakeCount", owner.getInventory().countItem(Items.CAKE));
                    out.addProperty("maidCount", owner.getData(InitDataAttachment.MAID_NUM).get());
                    out.addProperty("menuClosed", owner.containerMenu == owner.inventoryMenu);
                    out.addProperty("mainHand", BuiltInRegistries.ITEM.getKey(owner.getMainHandItem().getItem()).toString());
                }
                if (maid != null) {
                    out.addProperty("tame", maid.isTame()); out.addProperty("maidX", maid.getX());
                    out.addProperty("actualOwnerUuid", maid.getOwnerUUID() == null ? "" : maid.getOwnerUUID().toString());
                    out.addProperty("ownerResolved", maid.getOwner() != null);
                    out.addProperty("following", !maid.isHomeModeEnable()); out.addProperty("sitting", maid.isMaidInSittingPose());
                    out.addProperty("nativeSetting", maid.getAiChatManager().getSetting().isPresent());
                    out.addProperty("llmSite", maid.getAiChatManager().llmSite);
                    out.addProperty("llmModel", maid.getAiChatManager().llmModel);
                    out.addProperty("ttsSite", maid.getAiChatManager().ttsSite);
                    if (owner != null) out.addProperty("distance", Math.sqrt(maid.distanceToSqr(owner)));
                }
                final String text = "QD_COMPANION_QA " + out;
                c.getSource().sendSuccess(() -> Component.literal(text), false); return out.get("ok").getAsBoolean() ? 1 : 0;
            })));
    }
}
