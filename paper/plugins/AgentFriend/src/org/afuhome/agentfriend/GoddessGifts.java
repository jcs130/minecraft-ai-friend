package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.server.RemoteServerCommandEvent;
import org.bukkit.event.server.ServerCommandEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.EnchantmentStorageMeta;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.PotionMeta;
import org.bukkit.potion.PotionType;

/** One validated item factory and durable receipt for every Goddess grant. */
final class GoddessGifts implements Listener {
    private static final UUID GODDESS = UUID.fromString("b2f9ceb0-8271-3470-b99f-e1c3ffe4edbd");
    private static final Set<Material> FORBIDDEN = Set.of(Material.BEDROCK, Material.BARRIER,
            Material.COMMAND_BLOCK, Material.CHAIN_COMMAND_BLOCK, Material.REPEATING_COMMAND_BLOCK,
            Material.COMMAND_BLOCK_MINECART, Material.STRUCTURE_BLOCK, Material.STRUCTURE_VOID,
            Material.JIGSAW, Material.DEBUG_STICK, Material.LIGHT, Material.SPAWNER, Material.END_PORTAL_FRAME);
    private static final Set<Material> NEEDS_RECIPE = Set.of(Material.ENCHANTED_BOOK, Material.POTION,
            Material.SPLASH_POTION, Material.LINGERING_POTION, Material.TIPPED_ARROW,
            Material.WRITTEN_BOOK, Material.FILLED_MAP, Material.KNOWLEDGE_BOOK,
            Material.FIREWORK_ROCKET, Material.FIREWORK_STAR, Material.PLAYER_HEAD);
    private static final Set<Material> POTIONS = Set.of(Material.POTION, Material.SPLASH_POTION,
            Material.LINGERING_POTION, Material.TIPPED_ARROW);
    private final AgentFriendPlugin plugin;
    private final Path catalogFile, ledgerFile;
    private final Map<String, JsonObject> receipts = new HashMap<>();
    private Map<String, Recipe> recipes = Map.of();
    private long catalogStamp = Long.MIN_VALUE;
    private String catalogError = "not-loaded", ledgerError;
    private record Recipe(String id, String title, ItemStack item, int limit, String hash, JsonObject view) {}

    GoddessGifts(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        catalogFile = plugin.getDataFolder().toPath().resolve("goddess-gifts.yml");
        ledgerFile = plugin.getDataFolder().toPath().resolve("goddess-gifts.jsonl");
        if (!Files.exists(catalogFile)) plugin.saveResource("goddess-gifts.yml", false);
        loadLedger();
        refresh(true);
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    private boolean trusted(CommandSender sender) {
        return sender instanceof ConsoleCommandSender || sender instanceof RemoteConsoleCommandSender
                || sender instanceof Player p && p.isOp() && p.getUniqueId().equals(GODDESS)
                && p.getName().equals("Goddess");
    }
    private static Material material(String id) {
        if (id == null || !id.matches("minecraft:[a-z0-9_]+")) throw new IllegalArgumentException("item");
        Material type = Material.getMaterial(id.substring(10).toUpperCase(Locale.ROOT));
        if (type == null || type.isAir() || !type.isItem() || FORBIDDEN.contains(type)
                || type.name().endsWith("_SPAWN_EGG")) throw new IllegalArgumentException("item");
        return type;
    }
    private static void keys(ConfigurationSection section, Set<String> allowed) {
        if (section == null || !allowed.containsAll(section.getKeys(false)))
            throw new IllegalArgumentException("unknown-field");
    }
    private static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
    private Recipe buildRecipe(String id, ConfigurationSection config) {
        if (!id.matches("[a-z0-9_]{1,48}")) throw new IllegalArgumentException("gift-id");
        keys(config, Set.of("item", "title", "max-amount", "enchantments", "potion"));
        String title = config.getString("title", "");
        if (title.isBlank() || title.length() > 60 || title.matches("(?s).*[\\p{Cntrl}§].*"))
            throw new IllegalArgumentException("title");
        if (!config.isInt("max-amount")) throw new IllegalArgumentException("amount");
        int limit = config.getInt("max-amount");
        if (limit < 1 || limit > 16) throw new IllegalArgumentException("amount");
        Material type = material(config.getString("item"));
        ItemStack item = new ItemStack(type);
        ItemMeta meta = item.getItemMeta();
        Map<String, Integer> enchantments = new TreeMap<>();
        ConfigurationSection enchantConfig = config.getConfigurationSection("enchantments");
        if (config.contains("enchantments") && enchantConfig == null) throw new IllegalArgumentException("enchantments");
        if (enchantConfig != null) {
            if (enchantConfig.getKeys(false).isEmpty() || enchantConfig.getKeys(false).size() > 8)
                throw new IllegalArgumentException("enchantments");
            for (String key : enchantConfig.getKeys(false)) {
                if (!key.matches("minecraft:[a-z0-9_]+") || !enchantConfig.isInt(key))
                    throw new IllegalArgumentException("enchantment");
                Enchantment enchantment = Registry.ENCHANTMENT.get(NamespacedKey.fromString(key));
                int level = enchantConfig.getInt(key);
                if (enchantment == null || level < enchantment.getStartLevel() || level > enchantment.getMaxLevel())
                    throw new IllegalArgumentException("enchantment-level");
                if (meta instanceof EnchantmentStorageMeta book) {
                    if (book.hasConflictingStoredEnchant(enchantment) || !book.addStoredEnchant(enchantment, level, false))
                        throw new IllegalArgumentException("enchantment-conflict");
                } else {
                    if (!enchantment.canEnchantItem(item) || meta.hasConflictingEnchant(enchantment)
                            || !meta.addEnchant(enchantment, level, false)) throw new IllegalArgumentException("enchantment-item");
                }
                enchantments.put(key, level);
            }
        }
        String potion = "";
        if (POTIONS.contains(type)) {
            potion = config.getString("potion", "");
            if (!potion.matches("minecraft:[a-z0-9_]+") || !(meta instanceof PotionMeta potionMeta))
                throw new IllegalArgumentException("potion");
            String potionId = potion;
            PotionType potionType = Arrays.stream(PotionType.values()).filter(p -> p.getKey().toString().equals(potionId)).findFirst().orElse(null);
            if (potionType == null || !enchantments.isEmpty()) throw new IllegalArgumentException("potion");
            potionMeta.setBasePotionType(potionType);
            if (potionMeta.getBasePotionType() != potionType) throw new IllegalArgumentException("potion-verify");
        } else if (config.contains("potion")) throw new IllegalArgumentException("potion-item");
        if (type == Material.ENCHANTED_BOOK && enchantments.isEmpty()) throw new IllegalArgumentException("empty-book");
        if (NEEDS_RECIPE.contains(type) && type != Material.ENCHANTED_BOOK && !POTIONS.contains(type))
            throw new IllegalArgumentException("unsupported-stateful-item");
        if (!item.setItemMeta(meta)) throw new IllegalArgumentException("item-meta");
        // Compare the native serialized form that PlayerInventory actually stores.
        // In particular PotionMeta may normalize default fields during this conversion.
        item = ItemStack.deserializeBytes(item.serializeAsBytes());
        if (type == Material.ENCHANTED_BOOK && (!(item.getItemMeta() instanceof EnchantmentStorageMeta book)
                || !book.hasStoredEnchants() || book.hasEnchants())) throw new IllegalArgumentException("book-verify");
        Map<String, Integer> nativeEnchants = new TreeMap<>();
        ItemMeta nativeMeta = item.getItemMeta();
        (nativeMeta instanceof EnchantmentStorageMeta book ? book.getStoredEnchants() : nativeMeta.getEnchants())
                .forEach((enchantment, level) -> nativeEnchants.put(enchantment.getKey().toString(), level));
        if (!nativeEnchants.equals(enchantments)) throw new IllegalArgumentException("enchantment-verify");
        if (POTIONS.contains(type) && (!(item.getItemMeta() instanceof PotionMeta actualPotion)
                || actualPotion.getBasePotionType() == null || !actualPotion.getBasePotionType().getKey().toString().equals(potion)))
            throw new IllegalArgumentException("potion-verify");
        String recipeHash = hash(type.getKey() + "|" + enchantments + "|" + potion + "|" + limit + "|" + title);
        JsonObject view = new JsonObject();
        view.addProperty("gift", id); view.addProperty("title", title); view.addProperty("item", type.getKey().toString());
        view.addProperty("maxAmount", limit); view.addProperty("hash", recipeHash);
        JsonObject enchants = new JsonObject(); enchantments.forEach(enchants::addProperty); view.add("enchantments", enchants);
        if (!potion.isEmpty()) view.addProperty("potion", potion);
        return new Recipe(id, title, item, limit, recipeHash, view);
    }
    private boolean refresh(boolean force) {
        try {
            long stamp = Files.getLastModifiedTime(catalogFile).toMillis();
            if (!force && stamp == catalogStamp) return catalogError == null;
            if (Files.size(catalogFile) > 131072) throw new IllegalArgumentException("catalog-size");
            YamlConfiguration config = new YamlConfiguration(); config.load(catalogFile.toFile());
            keys(config, Set.of("schema-version", "gifts"));
            if (!config.isInt("schema-version") || config.getInt("schema-version") != 1)
                throw new IllegalArgumentException("catalog-version");
            ConfigurationSection entries = config.getConfigurationSection("gifts");
            if (entries == null || entries.getKeys(false).isEmpty() || entries.getKeys(false).size() > 128)
                throw new IllegalArgumentException("catalog-gifts");
            Map<String, Recipe> loaded = new LinkedHashMap<>();
            for (String id : entries.getKeys(false)) loaded.put(id, buildRecipe(id, entries.getConfigurationSection(id)));
            recipes = Map.copyOf(loaded); catalogStamp = stamp; catalogError = null; return true;
        } catch (Exception error) {
            catalogError = "catalog";
            plugin.getLogger().warning("Goddess gift catalog rejected: " + error.getMessage());
            return false;
        }
    }
    private void loadLedger() {
        if (!Files.exists(ledgerFile)) return;
        try {
            for (String line : Files.readAllLines(ledgerFile, StandardCharsets.UTF_8)) {
                if (line.isBlank()) continue;
                JsonObject receipt = JsonParser.parseString(line).getAsJsonObject();
                String nonce = receipt.get("request").getAsString();
                String phase = receipt.get("phase").getAsString();
                if (!nonce.matches("[a-f0-9]{16}") || !Set.of("prepared", "verified", "failed").contains(phase))
                    throw new IOException("invalid receipt");
                if (!receipt.get("fingerprint").getAsString().matches("[a-f0-9]{64}")
                        || !receipt.get("recipeHash").getAsString().matches("[a-f0-9]{64}")
                        || receipt.get("amount").getAsInt() < 1 || receipt.get("amount").getAsInt() > 16)
                    throw new IOException("invalid receipt fields");
                UUID.fromString(receipt.get("uuid").getAsString());
                receipts.put(nonce, receipt);
            }
        } catch (Exception error) {
            ledgerError = "ledger";
            plugin.getLogger().severe("Goddess gifts disabled: receipt ledger could not be read safely");
        }
    }
    private void append(JsonObject record) throws IOException {
        ByteBuffer bytes = StandardCharsets.UTF_8.encode(record + "\n");
        try (FileChannel file = FileChannel.open(ledgerFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.APPEND)) {
            while (bytes.hasRemaining()) file.write(bytes);
            file.force(true);
        }
        receipts.put(record.get("request").getAsString(), record.deepCopy());
    }
    void catalog(CommandSender sender, String[] args) {
        if (!trusted(sender)) { sender.sendMessage("仅限女神与维护控制台查看礼物目录。"); return; }
        boolean reload = args.length == 3 && args[2].equals("reload");
        boolean ready = refresh(reload);
        JsonObject result = new JsonObject(); result.addProperty("schema", 1);
        result.addProperty("ready", ready && ledgerError == null);
        JsonObject gifts = new JsonObject(); recipes.forEach((id, recipe) -> gifts.add(id, recipe.view().deepCopy()));
        result.add("gifts", gifts); sender.sendMessage("MC_GIFT_CATALOG " + result);
    }
    void status(CommandSender sender, String[] args) {
        if (!trusted(sender) || args.length != 3 || !args[2].matches("[a-f0-9]{16}")) {
            sender.sendMessage("MC_GIFT_RESULT {\"ok\":false,\"reason\":\"argument\"}"); return;
        }
        JsonObject result = receipts.containsKey(args[2]) ? receipts.get(args[2]).deepCopy() : new JsonObject();
        result.addProperty("request", args[2]);
        if (!result.has("phase")) result.addProperty("phase", ledgerError == null ? "missing" : "unknown");
        result.addProperty("ok", result.get("phase").getAsString().equals("verified"));
        sender.sendMessage("MC_GIFT_RESULT " + result);
    }
    private void fail(CommandSender sender, String nonce, String reason) {
        JsonObject result = new JsonObject(); result.addProperty("request", nonce);
        result.addProperty("ok", false); result.addProperty("reason", reason);
        sender.sendMessage("QDJ-GIFT " + nonce + " FAIL " + reason);
        sender.sendMessage("MC_GIFT_RESULT " + result);
        plugin.getLogger().info("Goddess gift rejected request=" + nonce + " reason=" + reason);
    }
    private static ItemStack[] copy(ItemStack[] input) {
        return Arrays.stream(input).map(i -> i == null ? null : i.clone()).toArray(ItemStack[]::new);
    }
    private static int count(ItemStack[] input, ItemStack prototype) {
        return Arrays.stream(input).filter(i -> i != null && i.isSimilar(prototype)).mapToInt(ItemStack::getAmount).sum();
    }
    private static boolean same(ItemStack[] a, ItemStack[] b) {
        if (a.length != b.length) return false;
        for (int i = 0; i < a.length; i++) {
            boolean emptyA = a[i] == null || a[i].getType().isAir(), emptyB = b[i] == null || b[i].getType().isAir();
            if (emptyA != emptyB || !emptyA && !a[i].equals(b[i])) return false;
        }
        return true;
    }
    void give(CommandSender sender, String[] args) {
        String nonce = args.length > 2 && args[2].matches("[a-f0-9]{16}") ? args[2] : "INVALID";
        if (!trusted(sender)) { fail(sender, nonce, "permission"); return; }
        if ((args.length != 6 && args.length != 7) || nonce.equals("INVALID")
                || !args[3].matches("[A-Za-z0-9_.-]{1,32}") || !args[5].matches("[0-9]{1,2}")) { fail(sender, nonce, "argument"); return; }
        if (ledgerError != null || !refresh(false)) { fail(sender, nonce, ledgerError == null ? "catalog" : ledgerError); return; }
        Player target = Bukkit.getPlayerExact(args[3]);
        if (target == null || target.getGameMode() == GameMode.SPECTATOR) { fail(sender, nonce, "offline"); return; }
        Recipe recipe;
        int amount;
        try {
            amount = Integer.parseInt(args[5]);
            if (args[4].startsWith("gift:")) {
                recipe = recipes.get(args[4].substring(5));
                if (recipe == null) throw new IllegalArgumentException("gift");
                if (args.length != 7 || !args[6].equals(recipe.hash())) throw new IllegalArgumentException("recipe-changed");
            } else {
                Material type = material(args[4]);
                if (NEEDS_RECIPE.contains(type) || args.length != 6) throw new IllegalArgumentException("recipe-required");
                recipe = new Recipe(args[4], type.getKey().toString(), new ItemStack(type), 16,
                        hash(args[4] + "|plain"), new JsonObject());
            }
            if (amount < 1 || amount > recipe.limit()) throw new IllegalArgumentException("amount");
        } catch (Exception error) { fail(sender, nonce, error.getMessage() == null ? "argument" : error.getMessage()); return; }
        String fingerprint = hash(target.getUniqueId() + "|" + args[4] + "|" + recipe.hash() + "|" + amount);
        JsonObject previous = receipts.get(nonce);
        if (previous != null) {
            if (!previous.get("fingerprint").getAsString().equals(fingerprint)) { fail(sender, nonce, "duplicate-mismatch"); return; }
            if (!previous.get("phase").getAsString().equals("verified")) { fail(sender, nonce, "uncertain"); return; }
            JsonObject result = previous.deepCopy(); result.addProperty("ok", true); result.addProperty("duplicate", true);
            sender.sendMessage("QDJ-GIFT " + nonce + " OK duplicate"); sender.sendMessage("MC_GIFT_RESULT " + result); return;
        }
        ItemStack[] before = copy(target.getInventory().getStorageContents()), planned = copy(before);
        ItemStack prototype = recipe.item();
        int remaining = amount, maximum = Math.min(prototype.getMaxStackSize(), target.getInventory().getMaxStackSize());
        for (ItemStack existing : planned) {
            if (existing == null || !existing.isSimilar(prototype)) continue;
            int add = Math.min(remaining, Math.max(0, maximum - existing.getAmount()));
            existing.setAmount(existing.getAmount() + add); remaining -= add;
        }
        for (int slot = 0; slot < planned.length && remaining > 0; slot++) {
            if (planned[slot] != null && !planned[slot].getType().isAir()) continue;
            planned[slot] = prototype.clone(); int add = Math.min(remaining, maximum);
            planned[slot].setAmount(add); remaining -= add;
        }
        if (remaining != 0) { fail(sender, nonce, "inventory"); return; }
        int beforeCount = count(before, prototype);
        JsonObject record = new JsonObject(); record.addProperty("request", nonce); record.addProperty("fingerprint", fingerprint);
        record.addProperty("player", target.getName()); record.addProperty("uuid", target.getUniqueId().toString());
        record.addProperty("selection", args[4]); record.addProperty("recipeHash", recipe.hash());
        record.addProperty("title", recipe.title()); record.addProperty("item", prototype.getType().getKey().toString());
        record.addProperty("amount", amount); record.addProperty("before", beforeCount);
        record.add("properties", recipe.view().deepCopy()); record.addProperty("time", System.currentTimeMillis());
        record.addProperty("phase", "prepared");
        try { append(record); }
        catch (IOException error) { ledgerError = "ledger"; fail(sender, nonce, "ledger"); return; }
        try {
            target.getInventory().setStorageContents(planned);
            ItemStack[] observed = target.getInventory().getStorageContents();
            int afterCount = count(observed, prototype);
            if (!same(planned, observed) || afterCount - beforeCount != amount) {
                record.addProperty("observedCount", afterCount);
                record.addProperty("expectedMeta", prototype.getItemMeta().getAsComponentString());
                for (int slot = 0; slot < observed.length; slot++) if (observed[slot] != null && observed[slot].getType() == prototype.getType())
                    record.addProperty("observedMetaSlot" + slot, observed[slot].getItemMeta().getAsComponentString());
                target.getInventory().setStorageContents(before); target.saveData();
                record.addProperty("phase", "failed"); record.addProperty("reason", "verify"); append(record);
                fail(sender, nonce, "verify"); return;
            }
            target.saveData();
            record.addProperty("after", afterCount); record.addProperty("phase", "verified"); append(record);
            JsonObject result = record.deepCopy(); result.addProperty("ok", true); result.addProperty("duplicate", false);
            target.sendMessage(ChatColor.LIGHT_PURPLE + "女神的礼物已确认：" + recipe.title() + " ×" + amount + "，已放进背包。");
            sender.sendMessage("QDJ-GIFT " + nonce + " OK"); sender.sendMessage("MC_GIFT_RESULT " + result);
            plugin.getLogger().info("Goddess gift verified request=" + nonce + " item=" + prototype.getType() + " amount=" + amount + " player=" + target.getUniqueId());
        } catch (Exception error) {
            // Prepared is deliberately retained: after any uncertain write, do not issue again.
            ledgerError = "ledger"; fail(sender, nonce, "uncertain");
            plugin.getLogger().severe("Goddess gift outcome uncertain request=" + nonce + "; reconcile the receipt before retrying");
        }
    }
    private static boolean rawMagicGive(String command) {
        return command.toLowerCase(Locale.ROOT).matches("(?s).*(?:^|\\s)(?:[a-z0-9_.-]+:)?give\\s+.*")
                && command.toLowerCase(Locale.ROOT).matches("(?s).*(?:minecraft:)?(?:enchanted_book|potion|splash_potion|lingering_potion|tipped_arrow)(?:\\[|\\s|$).*");
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void playerCommand(PlayerCommandPreprocessEvent event) {
        if (!event.getPlayer().getUniqueId().equals(GODDESS)) return;
        String command = event.getMessage().substring(1).toLowerCase(Locale.ROOT);
        if (command.matches("(?s).*(?:^|\\s)(?:[a-z0-9_.-]+:)?(?:give|i|item|enchant)\\s+.*")) {
            event.setCancelled(true); event.getPlayer().sendMessage("女神礼物请使用受校验的 mycli admin gift 入口。");
        }
    }
    private void serverCommandGuard(ServerCommandEvent event) {
        if (rawMagicGive(event.getCommand())) {
            event.setCancelled(true); event.getSender().sendMessage("带属性的附魔书或药水请使用受校验的 mycli admin gift 入口。");
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void serverCommand(ServerCommandEvent event) { serverCommandGuard(event); }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void remoteCommand(RemoteServerCommandEvent event) { serverCommandGuard(event); }
}
