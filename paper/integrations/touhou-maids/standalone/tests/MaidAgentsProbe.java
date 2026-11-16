package local.maidagent.test;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.ChatClientInfo;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.response.ResponseChat;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.mojang.authlib.GameProfile;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.net.http.HttpRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

@Mod("tlm_maid_agents_test")
public final class MaidAgentsProbe {
    private static final UUID MAID_A = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID MAID_B = UUID.fromString("10000000-0000-0000-0000-000000000002");
    private static final UUID UNBOUND = UUID.fromString("10000000-0000-0000-0000-000000000003");
    private static final UUID OWNER_A = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID OWNER_B = UUID.fromString("20000000-0000-0000-0000-000000000002");
    private int unboundCode;

    public MaidAgentsProbe() { NeoForge.EVENT_BUS.addListener(this::commands); }

    private void commands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("maidagenttest").requires(source -> source.hasPermission(4))
                .then(Commands.literal("seed").executes(context -> {
                    var source = context.getSource();
                    var level = source.getLevel();
                    add(level, MAID_A, OWNER_A, 0).getMaidInv().setStackInSlot(0, new ItemStack(Items.IRON_SWORD));
                    add(level, MAID_B, OWNER_B, 2).getMaidInv().setStackInSlot(0, new ItemStack(Items.GOLDEN_HELMET));
                    add(level, UNBOUND, OWNER_A, 4);
                    return say(source, "seeded");
                }))
                .then(Commands.literal("chat").then(Commands.argument("signal", StringArgumentType.word())
                        .executes(context -> {
                            var source = context.getSource();
                            var signal = StringArgumentType.getString(context, "signal");
                            if (!signal.equals("second-only")) chat(source.getLevel(), MAID_A, OWNER_A, "A", "A-" + signal);
                            if (!signal.equals("late-only")) chat(source.getLevel(), MAID_B, OWNER_B, "B", "B-" + signal);
                            return say(source, "submitted " + signal);
                        })))
                .then(Commands.literal("check").executes(context -> {
                    var source = context.getSource();
                    return say(source, results(maid(source.getLevel(), MAID_A)) + "\n" +
                            results(maid(source.getLevel(), MAID_B)) + "\nunboundCode=" + unboundCode);
                }))
                .then(Commands.literal("as-a").then(Commands.argument("command", StringArgumentType.greedyString())
                        .executes(context -> {
                            var source = context.getSource();
                            var a = maid(source.getLevel(), MAID_A);
                            var owner = FakePlayerFactory.get(source.getLevel(), new GameProfile(OWNER_A, "FixtureOwnerA"));
                            owner.setPos(a.getX(), a.getY(), a.getZ());
                            return source.getServer().getCommands().getDispatcher().execute(
                                    StringArgumentType.getString(context, "command"), source.withEntity(owner));
                        })))
                .then(Commands.literal("unbound").executes(context -> {
                    var source = context.getSource();
                    var maid = maid(source.getLevel(), UNBOUND);
                    maid.getAiChatManager().llmSite = "maidagent_a_dsh";
                    maid.getAiChatManager().llmModel = "fixture-a";
                    var callback = new LLMCallback(maid.getAiChatManager(), new ArrayList<>(List.of(LLMMessage.userChat(maid, "unbound")))) {
                        @Override public void onFailure(HttpRequest request, Throwable error, int code) { unboundCode = code; }
                        @Override public void onSuccess(ResponseChat response) { unboundCode = 200; }
                    };
                    AvailableSites.getLLMSite("maidagent_a_dsh").client().chat(callback);
                    return say(source, "unboundCode=" + unboundCode);
                })));
    }

    private static void chat(ServerLevel level, UUID id, UUID ownerId, String name, String signal) {
        var maid = maid(level, id);
        var owner = FakePlayerFactory.get(level, new GameProfile(ownerId, "FixtureOwner" + name));
        owner.setPos(maid.getX(), maid.getY(), maid.getZ());
        maid.getAiChatManager().chat(signal, new ChatClientInfo("en_us", name, List.of("Stock fixture")), owner);
    }

    private static EntityMaid add(ServerLevel level, UUID id, UUID owner, int offset) {
        var kind = BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.fromNamespaceAndPath("touhou_little_maid", "maid"));
        var maid = (EntityMaid) kind.create(level);
        var spawn = level.getSharedSpawnPos();
        maid.setUUID(id);
        maid.setTame(true, false);
        maid.setOwnerUUID(owner);
        maid.setPersistenceRequired();
        maid.moveTo(spawn.getX() + offset, spawn.getY() + 1, spawn.getZ(), 0, 0);
        maid.getAiChatManager().customSetting = "A synthetic NPC for stock TLM tests.";
        if (!level.addFreshEntity(maid)) throw new IllegalStateException("Could not seed stock test maid");
        return maid;
    }

    private static EntityMaid maid(ServerLevel level, UUID id) {
        var spawn = level.getSharedSpawnPos();
        level.getChunkAt(spawn);
        level.getChunkAt(spawn.offset(4, 0, 0));
        if (!(level.getEntity(id) instanceof EntityMaid maid)) throw new IllegalStateException("Fixture maid is unavailable " + id);
        return maid;
    }

    private static String results(EntityMaid maid) {
        var chat = maid.getAiChatManager();
        var history = chat.getHistory().getDeque().stream().map(LLMMessage::message).toList();
        return (maid.getUUID().equals(MAID_A) ? "A" : "B") + " site=" + chat.llmSite + " voice=" + chat.ttsModel
                + " sit=" + maid.isMaidInSittingPose() + " main=" + maid.getItemBySlot(EquipmentSlot.MAINHAND).getItem()
                + " head=" + maid.getItemBySlot(EquipmentSlot.HEAD).getItem()
                + " bag0=" + maid.getMaidInv().getStackInSlot(0).getItem() + " history=" + history;
    }

    private static int say(CommandSourceStack source, String value) {
        source.sendSuccess(() -> Component.literal(value), false);
        return 1;
    }
}
