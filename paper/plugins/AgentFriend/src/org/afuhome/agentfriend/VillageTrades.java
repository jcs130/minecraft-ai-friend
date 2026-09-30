package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.VillagerAcquireTradeEvent;
import org.bukkit.event.entity.VillagerCareerChangeEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MerchantRecipe;
import org.bukkit.persistence.PersistentDataType;

/** Keeps every adult villager tradeable through the vanilla Java/Bedrock merchant menu. */
final class VillageTrades implements Listener {
    private static final int BALANCE_VERSION = 2;
    private static final Villager.Profession[] JOBS = {
            Villager.Profession.FARMER, Villager.Profession.FISHERMAN,
            Villager.Profession.LIBRARIAN, Villager.Profession.TOOLSMITH,
            Villager.Profession.ARMORER, Villager.Profession.BUTCHER,
            Villager.Profession.CARTOGRAPHER, Villager.Profession.CLERIC,
            Villager.Profession.FLETCHER, Villager.Profession.LEATHERWORKER,
            Villager.Profession.MASON, Villager.Profession.SHEPHERD,
            Villager.Profession.WEAPONSMITH};
    private final AgentFriendPlugin plugin;
    private final NamespacedKey assignedKey;
    private final NamespacedKey assignedJobKey;
    private final NamespacedKey balancedKey;
    private final NamespacedKey balancedCountKey;
    private final NamespacedKey dungeonMerchantKey;
    private int nextJob;

    VillageTrades(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        assignedKey = new NamespacedKey(plugin, "villager_assigned_job");
        assignedJobKey = new NamespacedKey(plugin, "villager_assigned_profession");
        balancedKey = new NamespacedKey(plugin, "villager_trade_balance");
        balancedCountKey = new NamespacedKey(plugin, "villager_trade_count");
        dungeonMerchantKey = new NamespacedKey(plugin, "dungeon_merchant");
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getScheduler().runTaskLater(plugin, this::scanLoaded, 40L);
        Bukkit.getScheduler().runTaskTimer(plugin, this::scanLoaded, 6000L, 6000L);
    }

    private boolean eligible(Villager villager) {
        return villager.isValid() && villager.isAdult()
                && !villager.getPersistentDataContainer().has(dungeonMerchantKey, PersistentDataType.BYTE);
    }

    private boolean noJob(Villager villager) {
        return villager.getProfession() == Villager.Profession.NONE
                || villager.getProfession() == Villager.Profession.NITWIT;
    }

    private void scanLoaded() {
        List<Villager> villagers = new ArrayList<>();
        for (World world : Bukkit.getWorlds()) villagers.addAll(world.getEntitiesByClass(Villager.class));
        villagers.sort(Comparator.comparing(Entity::getUniqueId));
        int assigned = 0, balanced = 0, missing = 0;
        for (Villager villager : villagers) {
            if (!eligible(villager)) continue;
            if (noJob(villager)) assigned++;
            else if (!villager.getPersistentDataContainer().has(balancedKey, PersistentDataType.INTEGER)) balanced++;
            ensure(villager);
            if (noJob(villager) || villager.getRecipes().isEmpty()) missing++;
        }
        if (assigned + balanced + missing > 0)
            plugin.getLogger().info("Villager trades: loaded=" + villagers.size()
                    + ", assigned=" + assigned + ", balanced=" + balanced + ", stillMissing=" + missing);
    }

    private void ensure(Villager villager) {
        if (!eligible(villager)) return;
        if (noJob(villager)) {
            String savedJob = villager.getPersistentDataContainer().get(assignedJobKey, PersistentDataType.STRING);
            Villager.Profession profession = Arrays.stream(JOBS)
                    .filter(job -> job.name().equals(savedJob)).findFirst()
                    .orElseGet(() -> JOBS[nextJob++ % JOBS.length]);
            villager.getPersistentDataContainer().set(assignedKey, PersistentDataType.BYTE, (byte) 1);
            villager.getPersistentDataContainer().set(assignedJobKey, PersistentDataType.STRING, profession.name());
            villager.setProfession(profession);
            if (noJob(villager)) {
                villager.getPersistentDataContainer().remove(assignedKey);
                plugin.getLogger().warning("Could not assign villager profession: " + villager.getUniqueId());
                return;
            }
            villager.getPersistentDataContainer().remove(balancedKey);
            villager.getPersistentDataContainer().remove(balancedCountKey);
        }
        if (villager.getRecipes().isEmpty()) {
            villager.getPersistentDataContainer().remove(balancedKey);
            villager.getPersistentDataContainer().remove(balancedCountKey);
            villager.addTrades(2);
        }
        if (villager.getRecipes().isEmpty()) return;
        Integer version = villager.getPersistentDataContainer().get(balancedKey, PersistentDataType.INTEGER);
        Integer count = villager.getPersistentDataContainer().get(balancedCountKey, PersistentDataType.INTEGER);
        int start = version != null && version == BALANCE_VERSION && count != null ? count : 0;
        if (start >= villager.getRecipes().size()) return;
        if (balanceNative(villager, start)) {
            villager.getPersistentDataContainer().set(balancedKey, PersistentDataType.INTEGER, BALANCE_VERSION);
            villager.getPersistentDataContainer().set(balancedCountKey, PersistentDataType.INTEGER,
                    villager.getRecipes().size());
        }
    }

    private int cheaper(ItemStack input) {
        return Math.max(1, input.getType() == Material.EMERALD
                ? Math.min(16, (int) Math.ceil(input.getAmount() * 0.6))
                : Math.min(24, (int) Math.ceil(input.getAmount() * 0.75)));
    }

    private boolean balanceNative(Villager villager, int start) {
        try {
            // Bukkit setRecipes serializes all default item components into a new
            // ItemStack. Food costs then break the pinned Mineflayer 1.20.6 parser.
            // Change only the NMS ItemCost/count fields; preserve vanilla results.
            Object handle = villager.getClass().getMethod("getHandle").invoke(villager);
            List<?> nativeOffers = (List<?>) handle.getClass().getMethod("getOffers").invoke(handle);
            List<MerchantRecipe> recipes = villager.getRecipes();
            Class<?> costClass = Class.forName("net.minecraft.world.item.trading.ItemCost");
            Class<?> holderClass = Class.forName("net.minecraft.core.Holder");
            Class<?> predicateClass = Class.forName("net.minecraft.core.component.DataComponentPredicate");
            Object emptyPredicate = predicateClass.getField("EMPTY").get(null);
            var costConstructor = costClass.getConstructor(holderClass, int.class, predicateClass);
            for (int index = start; index < recipes.size(); index++) {
                MerchantRecipe recipe = recipes.get(index);
                Object offer = nativeOffers.get(index);
                var offerClass = offer.getClass();
                List<ItemStack> inputs = recipe.getIngredients();
                if (!inputs.isEmpty()) {
                    Object oldCost = offerClass.getField("baseCostA").get(offer);
                    Object item = costClass.getMethod("item").invoke(oldCost);
                    offerClass.getField("baseCostA").set(offer,
                            costConstructor.newInstance(item, cheaper(inputs.get(0)), emptyPredicate));
                }
                Optional<?> second = (Optional<?>) offerClass.getField("costB").get(offer);
                if (second.isPresent() && inputs.size() > 1) {
                    Object item = costClass.getMethod("item").invoke(second.get());
                    offerClass.getField("costB").set(offer, Optional.of(
                            costConstructor.newInstance(item, cheaper(inputs.get(1)), emptyPredicate)));
                }
                offerClass.getField("maxUses").setInt(offer,
                        Math.max(1024, offerClass.getField("maxUses").getInt(offer)));
                offerClass.getField("demand").setInt(offer, 0);
                offerClass.getField("specialPriceDiff").setInt(offer, 0);
                offerClass.getField("priceMultiplier").setFloat(offer, 0.0f);
                // CraftMerchantRecipe caches the old cost when getRecipes() is
                // read above. Make later admin reports and plugins see the new
                // native cost without rebuilding the network ItemStack.
                var bukkitHandle = offerClass.getDeclaredField("bukkitHandle");
                bukkitHandle.setAccessible(true);
                bukkitHandle.set(offer, null);
            }
            return true;
        } catch (ReflectiveOperationException | RuntimeException error) {
            plugin.getLogger().warning("Could not balance villager trades "
                    + villager.getUniqueId() + ": " + error);
            return false;
        }
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onInteract(PlayerInteractEntityEvent event) {
        if (event.getRightClicked() instanceof Villager villager) ensure(villager);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onSpawn(CreatureSpawnEvent event) {
        if (event.getEntity() instanceof Villager villager)
            Bukkit.getScheduler().runTaskLater(plugin, () -> ensure(villager), 20L);
    }

    @EventHandler public void onChunkLoad(ChunkLoadEvent event) {
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!event.getChunk().isLoaded()) return;
            for (Entity entity : event.getChunk().getEntities())
                if (entity instanceof Villager villager) ensure(villager);
        }, 2L);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onCareerChange(VillagerCareerChangeEvent event) {
        Villager villager = event.getEntity();
        if (villager.getPersistentDataContainer().has(assignedKey, PersistentDataType.BYTE)
                && (event.getProfession() == Villager.Profession.NONE
                    || event.getProfession() == Villager.Profession.NITWIT)) {
            event.setCancelled(true);
            return;
        }
        if (villager.getPersistentDataContainer().has(assignedKey, PersistentDataType.BYTE)
                && Arrays.asList(JOBS).contains(event.getProfession()))
            villager.getPersistentDataContainer().set(assignedJobKey, PersistentDataType.STRING,
                    event.getProfession().name());
        villager.getPersistentDataContainer().remove(balancedKey);
        villager.getPersistentDataContainer().remove(balancedCountKey);
        Bukkit.getScheduler().runTask(plugin, () -> ensure(villager));
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onAcquire(VillagerAcquireTradeEvent event) {
        if (!(event.getEntity() instanceof Villager villager)) return;
        Bukkit.getScheduler().runTask(plugin, () -> ensure(villager));
    }

    void report(CommandSender sender) {
        List<Villager> villagers = new ArrayList<>();
        for (World world : Bukkit.getWorlds()) villagers.addAll(world.getEntitiesByClass(Villager.class));
        int adults = 0, noJob = 0, noOffers = 0, maxEmeraldCost = 0;
        for (Villager villager : villagers) {
            if (!villager.isAdult()) continue;
            adults++;
            if (noJob(villager)) noJob++;
            if (villager.getRecipes().isEmpty()) noOffers++;
            for (MerchantRecipe recipe : villager.getRecipes())
                for (ItemStack input : recipe.getIngredients())
                    if (input.getType() == Material.EMERALD)
                        maxEmeraldCost = Math.max(maxEmeraldCost, input.getAmount());
        }
        sender.sendMessage("已加载成年村民=" + adults + "，无职业=" + noJob
                + "，无交易=" + noOffers + "，最高绿宝石价格=" + maxEmeraldCost);
        sender.sendMessage("职业：" + Arrays.stream(JOBS).map(job -> job.name().toLowerCase() + "="
                + villagers.stream().filter(v -> v.isAdult() && v.getProfession() == job).count())
                .reduce((a, b) -> a + ", " + b).orElse("无"));
    }
}
