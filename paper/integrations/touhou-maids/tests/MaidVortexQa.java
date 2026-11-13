package qa;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import io.vortexcore.VortexCorePlugin;
import local.tlmcompat.hybrid.HybridMaidPlugin;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.NamespacedKey;
import org.bukkit.attribute.Attribute;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/** Isolated fixture only. No test commands are included in the release. */
public final class MaidVortexQa extends JavaPlugin implements Listener {
    private UUID maidId;
    private String damage = "none";

    @Override public void onEnable() {
        if (!Files.isRegularFile(Path.of(".maid-vortex-qa")) || !getServer().getIp().equals("127.0.0.1")) {
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        getServer().getPluginManager().registerEvents(this, this);
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void cancelFixtureDamage(EntityDamageByEntityEvent event) {
        if (event.getDamager().getUniqueId().equals(maidId) && event.getEntity().getScoreboardTags().contains("MaidMagicCancelQA")) {
            event.setCancelled(true);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void hit(EntityDamageByEntityEvent event) {
        if (event.getDamager().getUniqueId().equals(maidId) && event.getEntity().getScoreboardTags().contains("MaidMagicTargetQA")) {
            damage = event.getEntity().getUniqueId() + " base=" + event.getDamage();
        }
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player || args.length < 2 || !(Bukkit.getEntity(UUID.fromString(args[1])) instanceof LivingEntity maid)
                || !(Bukkit.getPluginManager().getPlugin("VortexRPG") instanceof VortexCorePlugin vortex)) return false;
        maidId = maid.getUniqueId();
        switch (args[0]) {
            case "equip" -> {
                var items = vortex.qiandengjiItems();
                var staff = items.create("mage_apprentice_staff", 1);
                maid.getEquipment().setItemInMainHand(staff);
                sender.sendMessage("item=" + items.resolveId(maid.getEquipment().getItemInMainHand()));
            }
            case "damage" -> sender.sendMessage(damage);
            case "player-staff" -> {
                var player = Bukkit.getPlayerExact(args[2]);
                var stats = vortex.playerProfileService().profile(player);
                vortex.classSkillService().chooseClass(player, stats, "mage").thenRun(() -> {
                    var staff = vortex.qiandengjiItems().create("mage_apprentice_staff", 1);
                    player.getInventory().setItemInMainHand(staff);
                    vortex.qiandengjiMana().refillFull(player.getUniqueId());
                });
                sender.sendMessage("queued");
            }
            case "freeze-maid" -> {
                maid.getAttribute(Attribute.GENERIC_MOVEMENT_SPEED).setBaseValue(0);
                sender.sendMessage("frozen");
            }
            case "target" -> {
                for (var entity : maid.getWorld().getEntities()) {
                    if (entity instanceof LivingEntity target && target.getScoreboardTags().contains("MaidMagicTargetQA")) {
                        target.getAttribute(Attribute.GENERIC_MAX_HEALTH).setBaseValue(80);
                        target.getAttribute(Attribute.GENERIC_MOVEMENT_SPEED).setBaseValue(0);
                        target.getAttribute(Attribute.GENERIC_KNOCKBACK_RESISTANCE).setBaseValue(1);
                        target.setHealth(80);
                    }
                }
                sender.sendMessage("configured");
            }
            case "owner" -> {
                var owner = Bukkit.getPlayerExact(args[2]);
                owner.setGameMode(GameMode.SURVIVAL);
                vortex.qiandengjiMana().refillFull(owner.getUniqueId());
                sender.sendMessage("ownerMana=" + vortex.qiandengjiMana().getMana(owner.getUniqueId()));
            }
            case "mana" -> {
                var player = Bukkit.getPlayerExact(args[2]);
                sender.sendMessage("ownerMana=" + vortex.qiandengjiMana().getMana(player.getUniqueId()));
            }
            case "model" -> {
                EntityMaid nativeMaid = HybridMaidPlugin.nativeMaid(maid);
                nativeMaid.setModelId("touhou_little_maid:hakurei_reimu_type_b");
                try {
                    var model = EntityMaid.class.getDeclaredMethod("setYsmModelId", String.class);
                    var texture = EntityMaid.class.getDeclaredMethod("setYsmModelTexture", String.class);
                    model.setAccessible(true);
                    texture.setAccessible(true);
                    model.invoke(nativeMaid, "qd_dafeiyu");
                    texture.invoke(nativeMaid, "pearl");
                } catch (ReflectiveOperationException error) {
                    throw new IllegalStateException(error);
                }
                nativeMaid.setIsYsmModel(true);
                sender.sendMessage(modelState(nativeMaid));
            }
            case "read-model" -> sender.sendMessage(modelState(HybridMaidPlugin.nativeMaid(maid)));
            case "vortex-encounter" -> {
                for (var entity : maid.getWorld().getEntities()) {
                    if (entity.getScoreboardTags().contains("MaidMagicTargetQA")) {
                        entity.getPersistentDataContainer().set(new NamespacedKey(vortex, "dungeon_instance_id"),
                            PersistentDataType.STRING, UUID.randomUUID().toString());
                    }
                }
                sender.sendMessage("marked");
            }
            default -> { return false; }
        }
        return true;
    }

    private static String modelState(EntityMaid maid) {
        var visual = local.tlmcompat.numen.MaidVisualRegistry.get(maid.getUUID());
        return "model=" + maid.getYsmModelId() + " texture=" + maid.getYsmModelTexture()
                + " ysm=" + maid.isYsmModel() + " visual=" + (visual == null ? "missing" : visual.modelId());
    }
}
