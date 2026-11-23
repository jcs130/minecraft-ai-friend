package org.afuhome.agentfriend;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.NamespacedKey;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Villager;
import org.bukkit.persistence.PersistentDataType;

/** The entrance merchants already exist. An opted-in role always resolves its original body. */
final class TrialPlatformMerchants {
    private static final String SUPPLY = "trial-supply-merchant";
    private static final String RECYCLE = "trial-recycle-merchant";
    private static final String MANAGER = "trial-platform-manager";
    private static final String CONFIG = "trial-platform-residents";
    private static final byte SUPPLY_KIND = 3;
    static final byte RETIRED_KIND = 4;

    private final NamespacedKey key;
    private final NamespacedKey parked;
    private final boolean optedIn;
    private final Map<Byte, UUID> identities;

    TrialPlatformMerchants(AgentFriendPlugin plugin, NamespacedKey key) {
        this.key = key;
        this.parked = new NamespacedKey(plugin, "trial_merchant_parked");
        ConfigurationSection section = plugin.getConfig().getConfigurationSection(CONFIG);
        optedIn = section == null ? plugin.getConfig().contains(CONFIG) : !section.getKeys(false).isEmpty();
        Map<Byte, UUID> verified = Map.of();
        if (optedIn) {
            try {
                if (section == null || !section.getKeys(false).equals(Set.of(SUPPLY, RECYCLE)))
                    throw new IllegalArgumentException("expected both entrance merchant roles");
                Map<Byte, UUID> parsed = new LinkedHashMap<>();
                for (String service : section.getKeys(false)) {
                    String raw = section.getString(service, "");
                    UUID uuid = UUID.fromString(raw);
                    if (!uuid.toString().equals(raw) || uuid.equals(new UUID(0, 0)) || parsed.containsValue(uuid))
                        throw new IllegalArgumentException("expected distinct, canonical body UUIDs");
                    parsed.put(kind(service), uuid);
                }
                verified = Map.copyOf(parsed);
            } catch (IllegalArgumentException failure) {
                plugin.getLogger().warning("Trial entrance resident binding held: " + failure.getMessage());
            }
        }
        identities = verified;
    }

    static byte kind(String service) {
        if (SUPPLY.equals(service) || MANAGER.equals(service)) return SUPPLY_KIND;
        if (RECYCLE.equals(service)) return RETIRED_KIND;
        return 0;
    }

    static boolean managerRole(String service) { return MANAGER.equals(service); }

    boolean configured(byte kind) { return optedIn && (kind == 3 || kind == 4); }

    Villager manager() { return body(SUPPLY_KIND); }

    void updateManagerName(Villager body) {
        String title = ChatColor.GOLD + "试炼管理员";
        if (!title.equals(body.getCustomName())) body.setCustomName(title);
        if (!body.isCustomNameVisible()) body.setCustomNameVisible(true);
    }

    void parkRecycler() {
        Villager recycler = body(RETIRED_KIND);
        if (recycler != null) parkRecycler(recycler);
    }

    void parkRecycler(Villager recycler) {
        if (!original(RETIRED_KIND, recycler)) return;
        if (!recycler.getPersistentDataContainer().has(parked, PersistentDataType.BYTE)) {
            byte flags = (byte) ((recycler.isVisibleByDefault() ? 1 : 0) | (recycler.isCollidable() ? 2 : 0));
            recycler.getPersistentDataContainer().set(parked, PersistentDataType.BYTE, flags);
        }
        if (recycler.isVisibleByDefault()) recycler.setVisibleByDefault(false);
        if (recycler.isCollidable()) recycler.setCollidable(false);
    }

    void restoreLegacyVisibility(Villager recycler) {
        Byte flags = recycler.getPersistentDataContainer().get(parked, PersistentDataType.BYTE);
        if (flags == null) return;
        recycler.setVisibleByDefault((flags & 1) != 0);
        recycler.setCollidable((flags & 2) != 0);
        recycler.getPersistentDataContainer().remove(parked);
    }

    Villager body(byte kind) {
        UUID actor = identities.get(kind);
        return actor != null && Bukkit.getEntity(actor) instanceof Villager villager && villager.isValid()
                && !villager.isDead() && original(kind, villager) ? villager : null;
    }

    private boolean original(byte kind, Villager villager) {
        return villager.getUniqueId().equals(identities.get(kind)) && !villager.hasMetadata("NPC")
                && "world".equals(villager.getWorld().getName())
                && Byte.valueOf(kind).equals(villager.getPersistentDataContainer().get(key, PersistentDataType.BYTE));
    }

    boolean matches(byte kind, UUID actor) {
        return actor != null && actor.equals(identities.get(kind)) && body(kind) != null;
    }

    boolean restore(byte kind, Villager body) {
        if (kind != SUPPLY_KIND || body == null || !body.getUniqueId().equals(identities.get(kind)) || Bukkit.getEntity(body.getUniqueId()) != null
                || body.isInWorld() || body.hasMetadata("NPC") || !"world".equals(body.getWorld().getName())) return false;
        body.getPersistentDataContainer().set(key, PersistentDataType.BYTE, kind);
        return true;
    }
}
