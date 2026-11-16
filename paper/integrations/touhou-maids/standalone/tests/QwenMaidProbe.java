package local.maidagent.test;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.ChatClientInfo;
import com.github.tartaricacid.touhoulittlemaid.entity.ai.brain.MaidSchedule;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.Gson;
import com.mojang.authlib.GameProfile;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.animal.Sheep;
import net.minecraft.world.entity.monster.Husk;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.CropBlock;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

@Mod("tlm_maid_agents_test")
public final class QwenMaidProbe {
    private static final String[] ROLES = {"禾穗", "绒铃", "灯守"};
    private static final String[] DUTIES = {
        "你是苗圃管事禾穗。照料小麦田，收割成熟庄稼并补种。",
        "你是牧场看护绒铃。照料羊群，用剪刀收取羊毛。",
        "你是驿站守卫灯守。用剑清理驿站附近的敌对怪物。"
    };
    private static final String[] REQUESTS = {
        "苗圃的小麦熟了。请你根据你的岗位和手里的装备切到正确的原生工作模式，然后继续在家工作。",
        "牧场的羊长满羊毛了。请你根据你的岗位和手里的装备切到正确的原生工作模式，然后继续在家工作。",
        "驿站的守卫班开始了。请根据你的岗位和手里的铁剑直接切换到原生近战工作模式。之后由日常工作判断实际敌对目标。"
    };
    private Sheep sheep;
    private Husk husk;

    public QwenMaidProbe() { NeoForge.EVENT_BUS.addListener(this::commands); }

    private static UUID maidId(int i) { return UUID.fromString("10000000-0000-0000-0000-00000000001" + (i + 1)); }
    private static UUID ownerId(int i) { return UUID.fromString("20000000-0000-0000-0000-00000000002" + (i + 1)); }
    private static BlockPos base(int i) { return new BlockPos(8 + i * 40, -60, 8); }

    private void commands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("qwenmaidtest").requires(s -> s.hasPermission(4))
            .then(Commands.literal("seed").executes(ctx -> {
                var level = ctx.getSource().getLevel();
                for (int i = 0; i < ROLES.length; i++) add(level, i);
                return tell(ctx.getSource(), "seeded");
            }))
            .then(Commands.literal("assign").executes(ctx -> {
                var level = ctx.getSource().getLevel();
                for (int i = 0; i < ROLES.length; i++) {
                    var body = maid(level, i);
                    var owner = FakePlayerFactory.get(level, new GameProfile(ownerId(i), "QwenMaidOwner" + i));
                    owner.setPos(body.getX(), body.getY(), body.getZ());
                    body.getAiChatManager().chat(REQUESTS[i], new ChatClientInfo("zh_cn", owner.getGameProfile().getName(), List.of("NPC exercise")), owner);
                }
                return tell(ctx.getSource(), "assigned");
            }))
            .then(Commands.literal("work").executes(ctx -> {
                seedWork(ctx.getSource().getLevel());
                return tell(ctx.getSource(), "stocked");
            }))
            .then(Commands.literal("check").executes(ctx -> tell(ctx.getSource(), snapshot(ctx.getSource().getLevel())))));
    }

    private static EntityMaid maid(ServerLevel level, int i) {
        level.getChunkAt(base(i));
        return (EntityMaid) level.getEntity(maidId(i));
    }

    private static void add(ServerLevel level, int i) {
        var kind = BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.fromNamespaceAndPath("touhou_little_maid", "maid"));
        var body = (EntityMaid) kind.create(level);
        var pos = base(i);
        level.getChunkAt(pos);
        body.setUUID(maidId(i));
        body.setTame(true, false);
        body.setOwnerUUID(ownerId(i));
        body.setPersistenceRequired();
        body.setCustomName(Component.literal(ROLES[i]));
        body.setCustomNameVisible(true);
        body.moveTo(pos.getX() + .5, pos.getY(), pos.getZ() + .5, 0, 0);
        body.setSchedule(MaidSchedule.ALL);
        body.getAiChatManager().customSetting = DUTIES[i];
        body.setItemSlot(EquipmentSlot.MAINHAND, new ItemStack(switch (i) {
            case 0 -> Items.IRON_HOE;
            case 1 -> Items.SHEARS;
            default -> Items.IRON_SWORD;
        }));
        if (i == 0) body.getMaidInv().setStackInSlot(0, new ItemStack(Items.WHEAT_SEEDS, 24));
        if (!level.addFreshEntity(body)) throw new IllegalStateException("could not seed fixture maid");
    }

    private void seedWork(ServerLevel level) {
        for (var pos : crops()) {
            level.setBlockAndUpdate(pos.below(), Blocks.FARMLAND.defaultBlockState());
            level.setBlockAndUpdate(pos, Blocks.WHEAT.defaultBlockState().setValue(CropBlock.AGE, 7));
        }
        if (sheep != null && !sheep.isRemoved()) sheep.discard();
        sheep = EntityType.SHEEP.create(level);
        sheep.moveTo(50.5, -60, 8.5, 0, 0);
        sheep.setPersistenceRequired();
        level.addFreshEntity(sheep);
        if (husk != null && !husk.isRemoved()) husk.discard();
        husk = EntityType.HUSK.create(level);
        husk.moveTo(92.5, -60, 8.5, 0, 0);
        husk.setHealth(16);
        husk.setPersistenceRequired();
        level.addFreshEntity(husk);
    }

    private static List<BlockPos> crops() {
        return List.of(base(0).offset(2, 0, 0), base(0).offset(3, 0, 0), base(0).offset(2, 0, 1));
    }

    private String snapshot(ServerLevel level) {
        var result = new LinkedHashMap<String, Object>();
        for (int i = 0; i < ROLES.length; i++) {
            var body = maid(level, i);
            if (body == null) continue;
            var bag = body.getMaidInv();
            var count = 0;
            for (int slot = 0; slot < bag.getSlots(); slot++) {
                var stack = bag.getStackInSlot(slot);
                if (stack.is(i == 0 ? Items.WHEAT : Items.WHITE_WOOL)) count += stack.getCount();
            }
            var chat = body.getAiChatManager();
            result.put(ROLES[i], Map.of("task", body.getTask().getUid().toString(),
                "site", chat.llmSite, "x", body.getX(), "inventory", count,
                "homeX", body.getRestrictCenter().getX(),
                "history", chat.getHistory().getDeque().size(), "health", body.getHealth()));
        }
        result.put("onlinePlayers", level.getServer().getPlayerList().getPlayerCount());
        result.put("matureCrops", crops().stream().filter(pos -> {
            var block = level.getBlockState(pos);
            return block.is(Blocks.WHEAT) && block.getValue(CropBlock.AGE) == 7;
        }).count());
        result.put("sheared", sheep != null && sheep.isSheared());
        result.put("huskHealth", husk == null ? -1 : husk.getHealth());
        return new Gson().toJson(result);
    }

    private static int tell(CommandSourceStack source, String value) {
        source.sendSuccess(() -> Component.literal(value), false);
        return 1;
    }
}
