package org.qiandengji.villagerquests;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Villager;
import org.bukkit.entity.memory.MemoryKey;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MerchantRecipe;
import org.bukkit.persistence.PersistentDataType;

/** A missing, unloaded or parked villager is never death evidence. */
final class VillagerLives {
    private static final Gson GSON = new Gson();
    private static final long RESPAWN_DELAY_MS = 60_000;
    private static final int MAX_RECORD_BYTES = 1_048_576;

    private record Offer(String result, List<String> ingredients, int uses, int maxUses,
                         boolean rewardExperience, int villagerExperience, float multiplier,
                         int demand, int specialPrice, boolean ignoreDiscounts) {
        static Offer capture(MerchantRecipe recipe) {
            return new Offer(item(recipe.getResult()), recipe.getIngredients().stream().map(Offer::item).toList(),
                    recipe.getUses(), recipe.getMaxUses(), recipe.hasExperienceReward(), recipe.getVillagerExperience(),
                    recipe.getPriceMultiplier(), recipe.getDemand(), recipe.getSpecialPrice(), recipe.shouldIgnoreDiscounts());
        }

        MerchantRecipe restore() {
            MerchantRecipe recipe = new MerchantRecipe(stack(result), uses, maxUses, rewardExperience,
                    villagerExperience, multiplier, demand, specialPrice, ignoreDiscounts);
            recipe.setIngredients(ingredients.stream().map(Offer::stack).toList());
            return recipe;
        }

        private static String item(ItemStack value) { return Base64.getEncoder().encodeToString(value.serializeAsBytes()); }
        private static ItemStack stack(String value) { return ItemStack.deserializeBytes(Base64.getDecoder().decode(value)); }
    }

    private record Record(UUID characterId, UUID entityId, UUID deathId, long returnAt, boolean admitted,
                          String type, String profession, int level, int experience, int restocks, List<Offer> recipes) {
        static Record death(NativeVillageHomes.Home home, Villager body, long now) {
            return new Record(home.characterId(), body.getUniqueId(), UUID.randomUUID(), now + RESPAWN_DELAY_MS, false,
                    body.getVillagerType().name(), body.getProfession().name(), body.getVillagerLevel(),
                    body.getVillagerExperience(), body.getRestocksToday(), body.getRecipes().stream().map(Offer::capture).toList());
        }

        Record admit() {
            return new Record(characterId, entityId, deathId, returnAt, true, type, profession, level, experience, restocks, recipes);
        }

        boolean matches(NativeVillageHomes.Home home, Villagers.Spot spot) {
            return characterId.equals(home.characterId()) && entityId.equals(spot.entityUuid());
        }
    }

    private final VillagerQuestsPlugin plugin;
    private final Path directory;
    private final NamespacedKey stamp;
    private final NamespacedKey life;
    private final NativeVillagerWalk walk;
    private final Map<UUID, Record> records = new HashMap<>();
    private final Set<UUID> held = new HashSet<>();
    private final Map<String, Long> nextShopWalk = new HashMap<>();
    private Map<String, NativeVillageHomes.Home> homes = Map.of();

    VillagerLives(VillagerQuestsPlugin plugin) {
        this.plugin = plugin;
        this.directory = plugin.getDataFolder().toPath().resolve("resident-life");
        this.stamp = new NamespacedKey(plugin, "resident_life_return");
        this.life = new NamespacedKey(plugin, "resident_life_id");
        this.walk = new NativeVillagerWalk(plugin.getLogger());
    }

    void configure(Map<String, NativeVillageHomes.Home> homes) {
        this.homes = Map.copyOf(homes);
        nextShopWalk.keySet().retainAll(homes.keySet());
        for (NativeVillageHomes.Home home : homes.values()) {
            UUID character = home.characterId();
            if (records.containsKey(character) || held.contains(character)) continue;
            Path path = file(character);
            if (Files.notExists(path)) continue;
            try {
                if (!Files.isRegularFile(path, java.nio.file.LinkOption.NOFOLLOW_LINKS)
                        || Files.size(path) > MAX_RECORD_BYTES) throw new IOException("Invalid life receipt");
                Record row = GSON.fromJson(Files.readString(path, StandardCharsets.UTF_8), Record.class);
                if (row == null || !character.equals(row.characterId()) || row.entityId() == null || row.deathId() == null
                        || row.returnAt() <= 0 || row.level() < 1 || row.level() > 5 || row.experience() < 0
                        || row.recipes() == null) throw new IOException("Invalid life receipt");
                records.put(character, row);
            } catch (IOException | RuntimeException e) {
                hold(character, "life receipt cannot be read");
            }
        }
    }

    void recordDeath(Villager body) {
        Villagers.Spot spot = plugin.villagers.nativeSpot(body.getUniqueId());
        if (spot == null || body.hasMetadata("NPC")) return;
        NativeVillageHomes.Home home = homes.get(spot.id());
        if (home == null || held.contains(home.characterId())) return;
        Record previous = records.get(home.characterId());
        if (previous != null && (!previous.admitted() || !previous.matches(home, spot)
                || !previous.deathId().toString().equals(body.getPersistentDataContainer().get(life, PersistentDataType.STRING)))) return;
        try {
            persist(Record.death(home, body, System.currentTimeMillis()));
        } catch (IOException | RuntimeException failure) {
            hold(home.characterId(), "death could not be recorded");
        }
    }

    boolean blocksHandoff(String id) {
        NativeVillageHomes.Home home = homes.get(id);
        if (home == null) return false;
        Record row = records.get(home.characterId());
        return held.contains(home.characterId()) || row != null && !row.admitted();
    }

    void tick(long now) {
        for (NativeVillageHomes.Home home : homes.values()) {
            if (held.contains(home.characterId())) continue;
            Villagers.Spot spot = plugin.villagers.spot(home.id());
            Record row = records.get(home.characterId());
            if (spot == null || row != null && !row.matches(home, spot)) continue;
            Entity original = Bukkit.getEntity(spot.entityUuid());
            if (original instanceof Villager v && v.isValid() && !v.isDead()) {
                bindLive(home, spot, row, v, now);
                continue;
            }
            if (original != null || row == null || row.admitted() || row.returnAt() > now || !NativeVillageHomes.ready(home)) continue;
            returnHome(home, spot, row);
        }
    }

    private void bindLive(NativeVillageHomes.Home home, Villagers.Spot spot, Record row, Villager villager, long now) {
        if (villager.hasMetadata("NPC") || plugin.bodyPort() != null && plugin.bodyPort().controls(villager.getUniqueId())) return;
        boolean service = Villagers.trialMerchant(spot.serviceCounter());
        Location post = service ? plugin.villagers.trialServicePost(spot) : null;
        if (service && post == null) return;
        if (row != null && row.deathId().toString().equals(villager.getPersistentDataContainer().get(stamp, PersistentDataType.STRING))) {
            try {
                if (!row.admitted()) persist(row.admit());
                villager.getPersistentDataContainer().remove(stamp);
                villager.setInvulnerable(service);
                villager.setAI(true);
            } catch (IOException | RuntimeException failure) {
                hold(home.characterId(), "returned body could not be admitted");
                return;
            }
        }
        if (service) {
            attendShop(home, villager, post, now);
            return;
        }
        boolean missingHome = villager.getMemory(MemoryKey.HOME) == null;
        boolean missingWork = villager.getMemory(MemoryKey.JOB_SITE) == null && villager.getProfession() == home.profession();
        if (!villager.hasAI() || (!missingHome && !missingWork) || !NativeVillageHomes.ready(home)
                || !villager.getWorld().equals(home.bed().getWorld())) return;
        if (missingHome) villager.setMemory(MemoryKey.HOME, home.bed());
        if (missingWork) villager.setMemory(MemoryKey.JOB_SITE, home.work());
    }

    private void attendShop(NativeVillageHomes.Home home, Villager villager, Location post, long now) {
        if (villager.getTrader() != null || now < nextShopWalk.getOrDefault(home.id(), 0L)) return;
        nextShopWalk.put(home.id(), now + 6_000L);
        if (!villager.getWorld().equals(post.getWorld()) || !villager.getWorld().equals(home.bed().getWorld())
                || !NativeVillageHomes.ready(home)) return;
        if (!villager.hasAI()) villager.setAI(true);
        if (!home.bed().equals(villager.getMemory(MemoryKey.HOME))) villager.setMemory(MemoryKey.HOME, home.bed());
        boolean daytime = villager.getWorld().getTime() < 12_000;
        Location destination = daytime ? post : home.spawn();
        if (villager.isSleeping() || !destination.isChunkLoaded()
                || villager.getLocation().distanceSquared(destination) <= 2.25) return;
        walk.move(villager, destination);
    }

    private void returnHome(NativeVillageHomes.Home home, Villagers.Spot spot, Record row) {
        try {
            Villager body = home.spawn().getWorld().createEntity(home.spawn(), Villager.class);
            // Mojang-mapped CraftBukkit must assign the existing native UUID before admission.
            Object handle = body.getClass().getMethod("getHandle").invoke(body);
            handle.getClass().getMethod("setUUID", UUID.class).invoke(handle, row.entityId());
            if (!row.entityId().equals(body.getUniqueId())) throw new IllegalStateException("Native UUID did not bind");
            body.setAdult();
            body.setPersistent(true);
            body.setRemoveWhenFarAway(false);
            body.setCustomName(spot.name());
            body.setCustomNameVisible(true);
            body.setVillagerType(Villager.Type.valueOf(row.type()));
            body.setProfession(Villager.Profession.valueOf(row.profession()));
            body.setVillagerLevel(row.level());
            body.setVillagerExperience(row.experience());
            body.setRestocksToday(row.restocks());
            List<MerchantRecipe> offers = new ArrayList<>();
            for (Offer offer : row.recipes()) offers.add(offer.restore());
            body.setRecipes(offers);
            body.setMemory(MemoryKey.HOME, home.bed());
            if (body.getProfession() == home.profession()) body.setMemory(MemoryKey.JOB_SITE, home.work());
            body.getPersistentDataContainer().set(stamp, PersistentDataType.STRING, row.deathId().toString());
            body.getPersistentDataContainer().set(life, PersistentDataType.STRING, row.deathId().toString());
            body.setAI(false);
            body.setInvulnerable(true);
            if (Villagers.trialMerchant(spot.serviceCounter()) && !plugin.villagers.restoreTrialService(spot, body)) {
                hold(home.characterId(), "original service role could not be restored");
                return;
            }
            // No copy of the former body's inventory or equipment. Vanilla death still owns drops.
            home.spawn().getWorld().addEntity(body);
            if (!body.isValid() || Bukkit.getEntity(row.entityId()) != body) {
                hold(home.characterId(), "game did not confirm the original UUID at home");
                return;
            }
            bindLive(home, spot, row, body, System.currentTimeMillis());
        } catch (ReflectiveOperationException | RuntimeException failure) {
            hold(home.characterId(), "game did not confirm a safe return");
        }
    }

    private Path file(UUID character) { return directory.resolve(character + ".json"); }

    private void persist(Record row) throws IOException {
        byte[] bytes = GSON.toJson(row).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_RECORD_BYTES) throw new IOException("Life receipt too large");
        Files.createDirectories(directory);
        Path temporary = Files.createTempFile(directory, "life-", ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temporary, file(row.characterId()), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
        records.put(row.characterId(), row);
    }

    private void hold(UUID character, String reason) {
        if (held.add(character)) plugin.getLogger().warning("Resident life " + character + " held: " + reason);
    }
}
