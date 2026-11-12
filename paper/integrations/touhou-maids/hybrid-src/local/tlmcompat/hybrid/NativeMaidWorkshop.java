package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.FunctionTool;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.NumberParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.ObjectParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.function.schema.parameter.StringParameter;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import local.tlmcompat.core.CompatibilityException;
import local.tlmcompat.qiandengji.ReceiptJournal;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.LockCode;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.ai.memory.WalkTarget;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.ChestBlock;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.block.state.properties.ChestType;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.entity.Player;

/** Owns in-flight work only. Item changes commit together to one native inventory. */
final class NativeMaidWorkshop {
    static final String ACTION = "make";
    static final String TOOL = "make_at_workshop";
    private static final int MAX_BATCHES = 16;
    private static final long TIMEOUT = 90_000_000_000L;
    private static final Set<String> INTERRUPTING = Set.of("follow", "stay", "sit", "task", "schedule");

    private record Site(String id, UUID maid, UUID owner, UUID world, BlockPos chest, BlockPos table,
                        List<ResourceLocation> recipes) {}
    private record Order(String site, ResourceLocation recipe, int quantity, boolean backpack) {}
    private enum Phase { SUPPLIES, TABLE, DELIVERY }
    private static final class Job {
        final Player owner;
        final EntityMaid maid;
        final ServerLevel level;
        final String request;
        final Order order;
        final int batches;
        final int expectedQuantity;
        final Site site;
        final long revision;
        final long deadline = System.nanoTime() + TIMEOUT;
        final Inventory inventory;
        final List<ItemStack> before;
        Phase phase;
        MaidWorkshopRecipes.Plan plan;
        WalkTarget walk;
        long nextPath;
        long pathFailedSince;
        final JsonArray visits = new JsonArray();
        boolean defending;
        Job(Player owner, EntityMaid maid, ServerLevel level, String request, Order order, Site site, Inventory inventory, int perCraft) {
            this.owner = owner;
            this.maid = maid;
            this.level = level;
            this.request = request;
            this.order = order;
            expectedQuantity = order.quantity == 0 ? perCraft : order.quantity;
            if (expectedQuantity % perCraft != 0 || expectedQuantity / perCraft > MAX_BATCHES) {
                throw new CompatibilityException("workshop_quantity", "这个配方每次产出 " + perCraft
                    + " 件，请填 " + perCraft + " 的倍数，最多 " + (perCraft * MAX_BATCHES) + " 件。");
            }
            batches = expectedQuantity / perCraft;
            this.site = site;
            this.inventory = inventory;
            revision = MaidCompanionActions.revision(maid);
            before = inventory.snapshot();
            phase = order.backpack ? Phase.TABLE : Phase.SUPPLIES;
        }
    }
    private record Inventory(EntityMaid maid, ChestBlockEntity chest, int slots, int stackLimit) {
        static Inventory backpack(EntityMaid maid) {
            return new Inventory(maid, null, maid.getAvailableBackpackInv().getSlots(), 64);
        }
        static Inventory chest(ChestBlockEntity chest) {
            return new Inventory(null, chest, chest.getContainerSize(), chest.getMaxStackSize());
        }
        private ItemStack item(int slot) {
            return chest == null ? maid.getMaidInv().getStackInSlot(slot) : chest.getItem(slot);
        }
        List<ItemStack> snapshot() {
            List<ItemStack> copy = new ArrayList<>(slots);
            for (int slot = 0; slot < slots; slot++) copy.add(item(slot).copy());
            return copy;
        }
        boolean matches(List<ItemStack> expected) {
            for (int slot = 0; slot < slots; slot++) if (!ItemStack.matches(item(slot), expected.get(slot))) return false;
            return true;
        }
        void write(List<ItemStack> contents) {
            for (int slot = 0; slot < slots; slot++) {
                ItemStack expected = contents.get(slot);
                if (ItemStack.matches(item(slot), expected)) continue;
                if (chest == null) maid.getMaidInv().setStackInSlot(slot, expected.copy());
                else chest.setItem(slot, expected.copy());
            }
            if (chest != null) chest.setChanged();
            if (!matches(contents)) throw new IllegalStateException("Inventory write failed verification");
        }
    }

    private final HybridMaidPlugin plugin;
    private final ReceiptJournal journal;
    private final Map<String, Site> sites;
    private final Map<UUID, Job> jobs = new HashMap<>();

    NativeMaidWorkshop(HybridMaidPlugin plugin, ReceiptJournal journal) {
        this.plugin = plugin;
        this.journal = journal;
        Map<String, Site> loaded;
        try {
            loaded = readSites(plugin.getDataFolder().toPath().resolve("workshops.json"));
        } catch (IOException | RuntimeException failure) {
            plugin.getLogger().warning("Workshop configuration disabled: " + failure.getMessage());
            loaded = Map.of();
        }
        sites = loaded;
        if (!sites.isEmpty()) {
            Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 4, 4);
            plugin.getLogger().info("Native maid workshops configured: " + sites.size());
        }
    }

    private static Map<String, Site> readSites(Path file) throws IOException {
        if (!Files.exists(file)) return Map.of();
        JsonObject root = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        if (root.get("schema").getAsInt() != 1) throw new IllegalArgumentException("Unsupported workshop schema");
        Map<String, Site> result = new LinkedHashMap<>();
        for (var row : root.getAsJsonArray("workshops")) {
            JsonObject data = row.getAsJsonObject();
            String id = data.get("id").getAsString();
            UUID maid = UUID.fromString(data.get("maidId").getAsString());
            UUID owner = UUID.fromString(data.get("ownerId").getAsString());
            UUID world = UUID.fromString(data.get("worldId").getAsString());
            BlockPos chest = position(data.getAsJsonArray("chest"));
            BlockPos table = position(data.getAsJsonArray("table"));
            List<ResourceLocation> recipes = data.getAsJsonArray("recipes").asList().stream()
                .map(value -> ResourceLocation.parse(value.getAsString())).distinct().toList();
            if (!id.matches("[a-z0-9_-]{1,24}") || chest.equals(table) || recipes.isEmpty() || recipes.size() > 16
                    || result.putIfAbsent(id, new Site(id, maid, owner, world, chest, table, recipes)) != null) {
                throw new IllegalArgumentException("Invalid or duplicate workshop " + id);
            }
        }
        return Map.copyOf(result);
    }

    private static BlockPos position(JsonArray coordinates) {
        if (coordinates.size() != 3) throw new IllegalArgumentException("Expected three block coordinates");
        return new BlockPos(coordinates.get(0).getAsBigDecimal().intValueExact(),
            coordinates.get(1).getAsBigDecimal().intValueExact(), coordinates.get(2).getAsBigDecimal().intValueExact());
    }

    JsonObject describe(UUID maidId, UUID owner) {
        JsonObject result = new JsonObject();
        result.addProperty("maidId", maidId.toString());
        JsonArray catalog = new JsonArray();
        for (Site site : sites.values()) {
            if (!site.maid.equals(maidId) || !site.owner.equals(owner)) continue;
            JsonObject row = new JsonObject();
            row.addProperty("id", site.id);
            var world = Bukkit.getWorld(site.world);
            if (world != null) row.addProperty("dimension", world.getKey().toString());
            JsonArray recipes = new JsonArray();
            JsonObject productsPerCraft = new JsonObject();
            for (ResourceLocation recipe : site.recipes) {
                if (!(world instanceof CraftWorld craftWorld)) continue;
                try {
                    productsPerCraft.addProperty(recipe.toString(), MaidWorkshopRecipes.perCraft(craftWorld.getHandle(), recipe));
                    recipes.add(recipe.toString());
                } catch (CompatibilityException unavailable) {
                    // Expose only recipes the current server can resolve.
                }
            }
            row.add("recipes", recipes);
            row.add("productsPerCraft", productsPerCraft);
            catalog.add(row);
        }
        result.add("workshops", catalog);
        result.addProperty("maxBatches", MAX_BATCHES);
        Job job = jobs.get(maidId);
        if (job != null && job.owner.getUniqueId().equals(owner)) result.add("currentOrder", observation(job));
        return result;
    }

    void addTool(ChatCompletion request, EntityMaid maid, Player actor) {
        JsonArray available = describe(maid.getUUID(), actor.getUniqueId()).getAsJsonArray("workshops");
        List<JsonObject> active = available.asList().stream().map(value -> value.getAsJsonObject())
            .filter(site -> !site.getAsJsonArray("recipes").isEmpty()).toList();
        if (active.isEmpty()) return;
        var site = StringParameter.create().setDescription("已授权的工位ID。")
            .addEnumValues(active.stream().map(row -> row.get("id").getAsString()).toArray(String[]::new));
        var recipe = StringParameter.create().setDescription("工位清单中的配方ID。");
        var quantity = NumberParameter.create().setMinimum(1)
            .setDescription("最终需要的成品件数，整数。例如做四支火把填4。省略则使用配方的一次产出。");
        var source = StringParameter.create().addEnumValues("chest", "backpack")
            .setDescription("材料和成品所在处。chest 为已授权补给箱，backpack 为自己的背包。");
        request.addTool(FunctionTool.create().setName(TOOL)
            .setDescription("用真实工作台制作指定数量的成品。pending 是接单，完成后有单独回执。")
            .setParameters(ObjectParameter.create().addProperties("workshop", site).addProperties("recipe", recipe)
                .addProperties("quantity", quantity, false).addProperties("inventory", source)).build());
    }

    static String modelOrder(JsonObject args) {
        try {
            if (!Set.of("workshop", "recipe", "quantity", "inventory").containsAll(args.keySet())) throw badOrder();
            String site = stringArgument(args, "workshop");
            String recipe = stringArgument(args, "recipe");
            String source = stringArgument(args, "inventory");
            String quantity = "once";
            if (args.has("quantity")) {
                if (!(args.get("quantity") instanceof JsonPrimitive value) || !value.isNumber()
                        || value.getAsBigDecimal().intValueExact() <= 0) throw badOrder();
                quantity = Integer.toString(value.getAsInt());
            }
            return site + " " + recipe + " " + quantity + " " + source;
        } catch (RuntimeException invalid) {
            throw badOrder();
        }
    }

    private static String stringArgument(JsonObject args, String field) {
        if (!(args.get(field) instanceof JsonPrimitive value) || !value.isString()
                || !value.getAsString().matches("[a-z0-9_:/.-]{1,120}")) throw badOrder();
        return value.getAsString();
    }

    JsonObject start(Player actor, EntityMaid maid, String request, String value) throws Exception {
        UUID id = maid.getUUID();
        Job job;
        try {
            Order order = parse(value);
            Site site = sites.get(order.site);
            if (site == null || !site.maid.equals(id) || !site.owner.equals(actor.getUniqueId())
                    || !site.recipes.contains(order.recipe)) {
                throw new CompatibilityException("workshop_not_allowed", "请用 /qdmaid workshop 查看本人女仆获准的工位与配方。");
            }
            if (jobs.containsKey(id)) throw new CompatibilityException("workshop_busy", "她已有一张工单，请先查询当前进度。");
            if (!(maid.level() instanceof ServerLevel level) || !site.world.equals(actor.getWorld().getUID())
                    || !site.world.equals(maid.getBukkitEntity().getWorld().getUID()) || actor.isInvisible()
                    || !actor.canSee(maid.getBukkitEntity()) || actor.getGameMode() == GameMode.SPECTATOR) {
                throw new CompatibilityException("workshop_world", "请用在场角色带她到工位所在维度。");
            }
            if (!ready(maid) || !MaidCompanionActions.IDLE.equals(maid.getTask().getUid().toString())) {
                throw new CompatibilityException("workshop_maid_busy", "等她结束战斗或手选工作、起身后再下单。");
            }
            table(level, site.table);
            access(actor, site.table, false);
            Inventory inventory = order.backpack ? Inventory.backpack(maid) : Inventory.chest(chest(level, site.chest));
            if (!order.backpack) access(actor, site.chest, true);
            int perCraft = MaidWorkshopRecipes.perCraft(level, order.recipe);
            job = new Job(actor, maid, level, request, order, site, inventory, perCraft);
            // Report missing materials/capacity before spending time walking. Re-read the recipe at the table.
            plan(job);
        } catch (CompatibilityException error) {
            return journal.finish(id, request, "rejected", reason(error, false));
        }
        JsonObject queued = journal.finish(id, request, "pending", observation(job));
        jobs.put(id, job);
        return queued;
    }

    private static Order parse(String value) {
        String[] words = value == null ? new String[0] : value.strip().split("\\s+");
        try {
            if (words.length >= 2 && words.length <= 4) {
                boolean once = words.length == 2 || words[2].equals("once");
                int quantity = once ? 0 : Integer.parseInt(words[2]);
                String source = words.length == 4 ? words[3] : "chest";
                if ((once || quantity > 0) && Set.of("chest", "backpack").contains(source)) {
                    return new Order(words[0], ResourceLocation.parse(words[1]), quantity, source.equals("backpack"));
                }
            }
        } catch (RuntimeException ignored) {
            // Use the same actionable syntax for malformed counts and recipe IDs.
        }
        throw badOrder();
    }

    private static CompatibilityException badOrder() {
        return new CompatibilityException("bad_workshop_order",
            "用法 /qdmaid make <女仆ID> <请求ID> <工位ID> <配方ID> [成品数量|once] [chest|backpack]。例如 home minecraft:torch 4 chest。");
    }

    private static MaidWorkshopRecipes.Plan plan(Job job) {
        var plan = MaidWorkshopRecipes.plan(job.level, job.order.recipe, job.batches, job.before, job.inventory.stackLimit);
        if (plan.product().getCount() != job.expectedQuantity) {
            throw new CompatibilityException("recipe_changed", "配方产出变化，请重新查询工位和每次产出数量。");
        }
        return plan;
    }

    private static boolean ready(EntityMaid maid) {
        return maid.canBrainMoving() && !maid.isHomeModeEnable() && !maid.isNoAi() && !maid.guiOpening;
    }

    private static void table(ServerLevel level, BlockPos pos) {
        if (!level.hasChunkAt(pos) || !level.getBlockState(pos).is(Blocks.CRAFTING_TABLE)) {
            throw new CompatibilityException("workshop_table_unavailable", "登记的原版工作台暂不可用，请检查区块或补回工作台。");
        }
    }

    private static ChestBlockEntity chest(ServerLevel level, BlockPos pos) {
        if (!level.hasChunkAt(pos)) throw new CompatibilityException("workshop_chest_unavailable", "补给箱所在区块暂未加载。");
        var state = level.getBlockState(pos);
        if (!state.is(Blocks.CHEST) || state.getValue(ChestBlock.TYPE) != ChestType.SINGLE
                || !(level.getBlockEntity(pos) instanceof ChestBlockEntity box) || box.getLootTable() != null
                || !LockCode.NO_LOCK.equals(box.lockKey) || ChestBlock.isChestBlockedAt(level, pos)) {
            throw new CompatibilityException("workshop_chest_unavailable", "登记点需要可打开、未上锁的普通单箱。请核对箱子和上方净空。");
        }
        return box;
    }

    private static void access(Player actor, BlockPos pos, boolean chest) {
        if (!Bukkit.getPluginManager().isPluginEnabled("WorldGuard")) return;
        boolean allowed;
        try {
            var owner = com.sk89q.worldguard.bukkit.WorldGuardPlugin.inst().wrapPlayer(actor);
            var at = com.sk89q.worldedit.bukkit.BukkitAdapter.adapt(new Location(actor.getWorld(), pos.getX(), pos.getY(), pos.getZ()));
            var query = com.sk89q.worldguard.WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery();
            var flags = chest ? com.sk89q.worldguard.protection.flags.Flags.CHEST_ACCESS : com.sk89q.worldguard.protection.flags.Flags.USE;
            allowed = chest ? query.testBuild(at, owner, flags)
                : query.testBuild(at, owner, flags, com.sk89q.worldguard.protection.flags.Flags.INTERACT);
        } catch (RuntimeException | LinkageError unavailable) {
            allowed = false;
        }
        if (!allowed) throw new CompatibilityException("workshop_access_denied", "该区域的容器或交互权限不允许本次工作。请在本人可用的工位登记箱子与工作台。");
    }

    void cancelFor(EntityMaid maid, String action) {
        if (!INTERRUPTING.contains(action)) return;
        Job job = jobs.get(maid.getUUID());
        if (job != null) cancel(job, "workshop_cancelled", "已按新的陪伴安排停止工单。");
    }

    private void tick() {
        for (Job job : new ArrayList<>(jobs.values())) {
            try {
                advance(job);
            } catch (CompatibilityException failure) {
                cancel(job, failure.code(), failure.getMessage());
            } catch (Exception failure) {
                release(job);
                plugin.getLogger().warning("Workshop request needs its original receipt: " + job.request + " " + failure);
                send(job, "工单结果需要核对。请查询原请求，先保留当前物品。");
            }
        }
    }

    private void advance(Job job) throws Exception {
        EntityMaid maid = job.maid;
        Player owner = job.owner;
        if (System.nanoTime() > job.deadline) throw new CompatibilityException("workshop_timeout", "工单超时。请检查去箱子和工作台的通路。");
        if (!owner.isOnline() || owner.isDead() || owner.isInvisible() || owner.getGameMode() == GameMode.SPECTATOR
                || !owner.getUniqueId().equals(maid.getOwnerUUID()) || !maid.isAlive() || maid.isRemoved()
                || !job.site.world.equals(owner.getWorld().getUID()) || maid.level() != job.level
                || MaidCompanionActions.revision(maid) != job.revision) {
            throw new CompatibilityException("workshop_context_changed", "伙伴、女仆或维度已变化，工单停止。");
        }
        if (!maid.getPersistentData().getString("qiandengji_auto_defence_task").isEmpty()
                || maid.getTarget() != null && maid.getTarget().isAlive()) {
            job.defending = true;
            releaseWalk(job);
            return;
        }
        job.defending = false;
        if (!ready(maid) || !MaidCompanionActions.IDLE.equals(maid.getTask().getUid().toString())
                || owner.getLocation().distanceSquared(maid.getBukkitEntity().getLocation()) > 32 * 32) {
            throw new CompatibilityException("workshop_context_changed", "她已经离开工作状态或超出伙伴随行范围。请回到工位再下单。");
        }
        table(job.level, job.site.table);
        if (job.order.backpack) {
            if (maid.getAvailableBackpackInv().getSlots() != job.inventory.slots) throw changed();
        } else if (chest(job.level, job.site.chest) != job.inventory.chest) {
            throw changed();
        }
        BlockPos target = job.phase == Phase.TABLE ? job.site.table : job.site.chest;
        if (!arrived(job, target)) return;
        releaseWalk(job);
        access(owner, target, job.phase != Phase.TABLE);
        JsonObject visit = new JsonObject();
        visit.addProperty("phase", job.phase.name().toLowerCase(Locale.ROOT));
        visit.addProperty("distance", Math.sqrt(maid.distanceToSqr(Vec3.atCenterOf(target))));
        visit.addProperty("at", java.time.Instant.now().toString());
        job.visits.add(visit);
        switch (job.phase) {
            case SUPPLIES -> {
                if (!job.inventory.matches(job.before)) throw changed();
                maid.swing(InteractionHand.MAIN_HAND);
                job.phase = Phase.TABLE;
            }
            case TABLE -> {
                if (!job.inventory.matches(job.before)) throw changed();
                job.plan = plan(job);
                maid.swing(InteractionHand.MAIN_HAND);
                if (job.order.backpack) commit(job); else job.phase = Phase.DELIVERY;
            }
            case DELIVERY -> commit(job);
        }
        job.nextPath = 0;
        job.pathFailedSince = 0;
    }

    private static CompatibilityException changed() {
        return new CompatibilityException("workshop_stock_changed", "工单途中库存或容器已变化，未扣材料。请核对库存后用新请求下单。");
    }

    private static boolean arrived(Job job, BlockPos target) {
        EntityMaid maid = job.maid;
        Vec3 center = Vec3.atCenterOf(target);
        Vec3 eye = maid.getEyePosition();
        if (maid.distanceToSqr(center) <= 2.6 * 2.6) {
            BlockHitResult hit = job.level.clip(new ClipContext(eye, center, ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, maid));
            if (hit.getType() == HitResult.Type.BLOCK && hit.getBlockPos().equals(target)) return true;
        }
        long now = System.nanoTime();
        if (now < job.nextPath) return false;
        job.nextPath = now + 1_000_000_000L;
        Set<BlockPos> adjacent = Direction.Plane.HORIZONTAL.stream().map(target::relative)
            .filter(job.level::hasChunkAt).collect(Collectors.toSet());
        var path = adjacent.isEmpty() ? null : maid.getNavigation().createPath(adjacent, 0);
        if (path == null || !path.canReach()) {
            if (job.pathFailedSince == 0) job.pathFailedSince = now;
            if (now - job.pathFailedSince > 6_000_000_000L)
                throw new CompatibilityException("workshop_unreachable", "她找不到去当前目标的路。请在箱子和工作台周围留出通道。");
            return false;
        }
        job.pathFailedSince = 0;
        job.walk = new WalkTarget(path.getTarget(), 0.85F, 0);
        maid.getBrain().setMemory(MemoryModuleType.WALK_TARGET, job.walk);
        return false;
    }

    private void commit(Job job) throws Exception {
        access(job.owner, job.site.table, false);
        if (!job.inventory.matches(job.before)) throw changed();
        UUID maid = job.maid.getUUID();
        JsonObject details = observation(job);
        // Make the restart boundary durable before touching any slot. No saved job resumes after restart.
        journal.finish(maid, job.request, "committing", details);
        try {
            job.inventory.write(job.plan.slots());
        } catch (RuntimeException failedWrite) {
            try {
                job.inventory.write(job.before);
            } catch (RuntimeException rollbackFailed) {
                failedWrite.addSuppressed(rollbackFailed);
                throw failedWrite;
            }
            cancel(job, "workshop_write_failed", "写入失败，已核对恢复到操作前的库存。");
            return;
        }
        ItemStack product = job.plan.product();
        details.addProperty("itemId", BuiltInRegistries.ITEM.getKey(product.getItem()).toString());
        details.addProperty("count", product.getCount());
        details.addProperty("effectsApplied", true);
        details.addProperty("verified", true);
        journal.finish(maid, job.request, "completed", details);
        release(job);
        send(job, Component.text("做好了，" + product.getCount() + " 件")
            .append(Component.translatable(product.getDescriptionId()))
            .append(Component.text("放在" + (job.order.backpack ? "我的背包" : "工位 " + job.site.id + " 的补给箱") + "。")));
    }

    private JsonObject observation(Job job) {
        JsonObject out = new JsonObject();
        out.addProperty("operationId", job.request);
        out.addProperty("workshopId", job.site.id);
        out.addProperty("recipeId", job.order.recipe.toString());
        out.addProperty("batches", job.batches);
        out.addProperty("quantity", job.expectedQuantity);
        out.addProperty("inventory", job.order.backpack ? "backpack" : "chest");
        out.addProperty("phase", job.defending ? "defending" : job.phase.name().toLowerCase(Locale.ROOT));
        if (!job.visits.isEmpty()) out.add("visits", job.visits.deepCopy());
        return out;
    }

    JsonObject reconcile(JsonObject receipt) throws IOException {
        UUID id = UUID.fromString(receipt.get("maidId").getAsString());
        String request = receipt.get("operationId").getAsString();
        String status = receipt.get("status").getAsString();
        Job job = jobs.get(id);
        if (status.equals("pending")) {
            if (job != null && job.request.equals(request)) receipt.add("observation", observation(job));
            else receipt = journal.finish(id, request, "cancelled", reason(
                new CompatibilityException("workshop_interrupted", "工作在提交物品前中断，库存未由此工单改变。"), false));
        } else if (status.equals("committing")) {
            receipt = journal.finish(id, request, "unknown", reason(
                new CompatibilityException("workshop_result_unknown", "提交结果不确定，请先查看原箱或背包，不要换新请求重做。"), null));
        } else if (status.equals("completed")) {
            receipt.addProperty("goalCompleted", true);
        }
        return receipt;
    }

    private static JsonObject reason(CompatibilityException error, Boolean effects) {
        JsonObject out = new JsonObject();
        out.addProperty("error", error.code());
        out.addProperty("message", error.getMessage());
        out.addProperty("retryAllowed", false);
        if (effects != null) out.addProperty("effectsApplied", effects);
        return out;
    }

    private void cancel(Job job, String error, String message) {
        release(job);
        try {
            JsonObject details = observation(job);
            reason(new CompatibilityException(error, message), false).entrySet()
                .forEach(field -> details.add(field.getKey(), field.getValue()));
            if (job.maid.isAlive() && !job.maid.isRemoved()) details.addProperty("position", job.maid.blockPosition().toShortString());
            journal.finish(job.maid.getUUID(), job.request, "cancelled", details);
        } catch (IOException failure) {
            plugin.getLogger().warning("Workshop cancellation receipt unavailable: " + job.request + " " + failure);
        }
        send(job, message);
    }

    private static void send(Job job, String message) {
        send(job, Component.text(message));
    }

    private static void send(Job job, Component message) {
        if (job.owner.isOnline()) {
            job.owner.sendMessage(Component.text("[" + job.maid.getName().getString() + "] ")
                .append(message).append(Component.text(" [工单 " + job.request + "]")
                    .clickEvent(ClickEvent.runCommand("/qdmaid receipt " + job.maid.getUUID() + " " + job.request))));
        }
    }

    private void release(Job job) {
        jobs.remove(job.maid.getUUID(), job);
        releaseWalk(job);
    }

    private static void releaseWalk(Job job) {
        if (job.walk != null && job.maid.getBrain().getMemory(MemoryModuleType.WALK_TARGET).orElse(null) == job.walk) {
            job.maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);
            job.maid.getNavigation().stop();
        }
        job.walk = null;
    }

    void close() {
        for (Job job : new ArrayList<>(jobs.values())) cancel(job, "workshop_interrupted", "工单在提交物品前暂停。");
    }
}
