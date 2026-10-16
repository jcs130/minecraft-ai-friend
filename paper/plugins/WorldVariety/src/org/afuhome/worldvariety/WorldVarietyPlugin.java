package org.afuhome.worldvariety;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.olencounters.OlEncountersPlugin;
import com.olencounters.api.event.MeteorPreStartEvent;
import com.olencounters.event.ActiveMeteorEvent;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldguard.WorldGuard;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;
import net.citizensnpcs.api.CitizensAPI;
import net.citizensnpcs.api.npc.NPC;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.mcmonkey.sentinel.SentinelTrait;

/** Content-only integration: original AgentFriend binary and client stay intact. */
public final class WorldVarietyPlugin extends JavaPlugin implements Listener {
    private CommandExecutor previous, wrapper;
    private PluginCommand mycli;
    private YamlConfiguration state;
    private File stateFile;
    private long nextAttempt;

    @Override public void onEnable() {
        saveDefaultConfig();
        stateFile = new File(getDataFolder(), "state.yml");
        state = YamlConfiguration.loadConfiguration(stateFile);
        nextAttempt = Math.max(System.currentTimeMillis()+60_000,
                              state.getLong("next-attempt", System.currentTimeMillis()+interval()));
        Bukkit.getPluginManager().registerEvents(this, this);
        mycli = Bukkit.getPluginCommand("mycli");
        if (mycli != null) {
            previous = mycli.getExecutor();
            wrapper = (sender, command, label, args) -> {
                if(sender instanceof Player player && args.length==2 && args[0].equalsIgnoreCase("world") && args[1].equalsIgnoreCase("npcs")) {
                    boolean result=previous.onCommand(sender,command,label,args);residents(player);return result;
                }
                if (sender instanceof Player player && args.length >= 2
                        && args[0].equalsIgnoreCase("world") && args[1].equalsIgnoreCase("events")) {
                    String action = args.length == 2 ? "status" : args[2].toLowerCase(Locale.ROOT);
                    if (action.equals("join") || action.equals("leave")) {
                        if (player.getGameMode() == GameMode.SPECTATOR) {
                            player.sendMessage("§c观战账号只能查看，请让本体角色到现场参加。");
                        } else {
                            boolean ok = action.equals("join")
                                    ? ol().getEncounterService().join(player) : ol().getEncounterService().leave(player);
                            player.sendMessage(ok ? "§a"+(action.equals("join") ? "已登记参加附近的野外遭遇。" : "已退出野外遭遇。")
                                    : "§e附近没有可参加的遭遇，或你尚未参战；先查询状态并走到现场。");
                            if(player.getName().toLowerCase(Locale.ROOT).startsWith("ag_")) {
                                JsonObject receipt=new JsonObject();receipt.addProperty("type","encounter_result");
                                receipt.addProperty("action",action);receipt.addProperty("status",ok?"success":"denied");
                                receipt.addProperty("nextCommand","/mycli world events status");player.sendMessage("MC_WORLD "+receipt);
                            }
                        }
                        return true;
                    }
                    if (Set.of("status", "list", "--help").contains(action)) {
                        // Keep the existing village festival output and its original permission path.
                        boolean result = previous.onCommand(sender, command, label, new String[]{"world", "events"});
                        status(player); return result;
                    }
                }
                return previous.onCommand(sender, command, label, args);
            };
            mycli.setExecutor(wrapper);
        }
        Bukkit.getScheduler().runTaskLater(this, () -> {
            Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "villagerlife recalculate");
            if (getConfig().getBoolean("guards.enabled")) ensureGuards();
        }, 200L);
        Bukkit.getScheduler().runTaskTimer(this, this::automatic, 1200L, 1200L);
    }

    private void residents(Player player) {
        JsonObject output=new JsonObject();output.addProperty("type","residents");output.addProperty("readOnly",true);
        JsonArray rows=new JsonArray();
        player.getWorld().getNearbyEntities(player.getLocation(),24,12,24).stream()
                .filter(e->e instanceof Villager v && v.hasAI() && !v.isInsideVehicle() && !v.hasMetadata("NPC") && !v.hasMetadata("shopkeeper"))
                .sorted(Comparator.comparingDouble(e->e.getLocation().distanceSquared(player.getLocation())))
                .limit(3).forEach(entity->{
                    Location at=entity.getLocation();JsonObject row=new JsonObject();row.addProperty("uuid",entity.getUniqueId().toString());row.addProperty("entityId",entity.getEntityId());
                    String name=entity.getCustomName()==null?"居民":entity.getCustomName();row.addProperty("name",name);row.addProperty("x",at.getX());row.addProperty("y",at.getY());row.addProperty("z",at.getZ());rows.add(row);
                    player.sendMessage("§a附近居民："+name+" §7("+at.getBlockX()+", "+at.getBlockY()+", "+at.getBlockZ()+")");
                });
        output.add("residents",rows);output.addProperty("interaction","空手潜行右键居民；收到问候后聊天输入。说再见结束。普通右键交易。");
        player.sendMessage("§e普通居民：空手普通右键交易；空手潜行右键聊天，可问近况、消息或方向，说再见结束。");
        if(player.getName().toLowerCase(Locale.ROOT).startsWith("ag_"))player.sendMessage("MC_WORLD "+output);
    }

    private OlEncountersPlugin ol() { return OlEncountersPlugin.getInstance(); }
    private long interval() { return Math.max(30, getConfig().getLong("automatic-encounters.interval-minutes", 50))*60_000L; }
    private void persist() throws Exception {
        getDataFolder().mkdirs();
        File tmp = new File(getDataFolder(), "state.yml.tmp"); state.save(tmp);
        Files.move(tmp.toPath(), stateFile.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private void automatic() {
        if (!getConfig().getBoolean("automatic-encounters.enabled") || System.currentTimeMillis() < nextAttempt) return;
        String worldName=getConfig().getString("automatic-encounters.world","world");
        if (Bukkit.getOnlinePlayers().stream().noneMatch(p -> p.getGameMode() == GameMode.SURVIVAL && p.getWorld().getName().equals(worldName))) return;
        if (Bukkit.getTPS()[0] < getConfig().getDouble("automatic-encounters.minimum-tps", 18)
                || !ol().getMeteorEventManager().getActiveEvents().isEmpty()) return;
        List<String> profiles = getConfig().getStringList("automatic-encounters.profiles");
        if (profiles.isEmpty()) return;
        nextAttempt = System.currentTimeMillis()+interval(); state.set("next-attempt", nextAttempt);
        try { persist(); } catch (Exception error) { getLogger().warning("Encounter scheduling retained: cannot persist cooldown"); return; }
        // The upstream finder only uses already generated chunks, claim buffers
        // and a TPS budget. No retries, player teleport or client actions here.
        String profile = profiles.get(ThreadLocalRandom.current().nextInt(profiles.size()));
        ol().getEncounterService().start(profile, getConfig().getString("automatic-encounters.world", "world"), Bukkit.getConsoleSender())
                .whenComplete((result, error) -> getLogger().info("Encounter search " + profile + ": " + (error == null ? result : "failed")));
    }

    private void status(Player player) {
        JsonObject output = new JsonObject(); output.addProperty("type", "encounters");
        output.addProperty("activityType","world_encounter");output.addProperty("activityLabel","野外遭遇");
        output.addProperty("status", "listed");output.addProperty("readOnly",true); JsonArray events = new JsonArray();
        for (ActiveMeteorEvent event : ol().getMeteorEventManager().getActiveEvents().values()) {
            Location c = event.center(); JsonObject item = new JsonObject();
            item.addProperty("id", event.eventId()); item.addProperty("world", c.getWorld().getName());
            item.addProperty("x", c.getBlockX()); item.addProperty("y", c.getBlockY()); item.addProperty("z", c.getBlockZ());
            item.addProperty("phase", event.phase().name()); events.add(item);
            player.sendMessage("§6野外遭遇 " + event.eventId() + " §f"+c.getWorld().getName()+" ("+c.getBlockX()+", "+c.getBlockY()+", "+c.getBlockZ()+") §7"+phase(event.phase().name()));
            if (events.size() == 4) break;
        }
        output.add("encounters", events); output.addProperty("nextCommand", events.isEmpty()?"/mycli tasks list":"/mycli world events join");
        if (events.isEmpty()) player.sendMessage("§7当前没有野外遭遇。城堡和遗迹在新探索区域自然生成，与试炼塔、固定地下城各自独立。");
        else player.sendMessage("§e步行到现场后 /mycli world events join 参加；/mycli world events leave 退出。参战不会自动传送。");
        if (player.getName().toLowerCase(Locale.ROOT).startsWith("ag_")) player.sendMessage("MC_WORLD "+output);
    }

    @EventHandler(priority=EventPriority.MONITOR)
    public void worldMenu(InventoryClickEvent event) {
        // AgentFriend's world-menu button calls its handler directly, bypassing
        // Bukkit's command executor. Append the same read-only event view once.
        var holder=event.getView().getTopInventory().getHolder();
        if((event.getRawSlot()==11||event.getRawSlot()==12) && holder!=null
                && holder.getClass().getName().equals("org.afuhome.agentfriend.WorldLifeManager$MenuHolder")
                && event.getWhoClicked() instanceof Player player)
            Bukkit.getScheduler().runTask(this,()->{if(event.getRawSlot()==12)status(player);else residents(player);});
    }

    private static String phase(String name) {
        return switch (name) { case "PRE_IMPACT" -> "正在出现"; case "ACTIVE", "WAVES", "BOSS" -> "正在挑战";
            case "ROLLBACK", "FINISHING", "RESTORING" -> "正在收尾"; default -> "进行中"; };
    }

    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void preStart(MeteorPreStartEvent event) {
        Location c = event.getLocation();
        var manager = WorldGuard.getInstance().getPlatform().getRegionContainer().get(BukkitAdapter.adapt(c.getWorld()));
        if (manager == null) { event.setCancelled(true); return; }
        for (var region : manager.getRegions().values()) {
            if (region.getId().equals("__global__")) continue;
            var min=region.getMinimumPoint(); var max=region.getMaximumPoint();
            if (c.getX()>=min.x()-48 && c.getX()<=max.x()+48 && c.getZ()>=min.z()-48 && c.getZ()<=max.z()+48) {
                event.setCancelled(true); return;
            }
        }
    }

    private void ensureGuards() {
        for (Map<?, ?> entry : getConfig().getMapList("guards.locations")) {
            String id=String.valueOf(entry.get("id"));
            String saved=state.getString("guards."+id);
            if (saved != null) {
                if (CitizensAPI.getNPCRegistry().getByUniqueId(UUID.fromString(saved)) == null)
                    getLogger().warning("Saved guard missing, not duplicated: "+id);
                continue;
            }
            World world=Bukkit.getWorld(String.valueOf(entry.get("world"))); if(world==null) continue;
            Location at=new Location(world, ((Number)entry.get("x")).doubleValue(), ((Number)entry.get("y")).doubleValue(), ((Number)entry.get("z")).doubleValue());
            if (!at.clone().subtract(0,1,0).getBlock().getType().isSolid()
                    || !at.getBlock().isPassable() || !at.clone().add(0,1,0).getBlock().isPassable()
                    || !at.clone().add(0,2,0).getBlock().isPassable()) {
                getLogger().warning("Guard location obstructed, skipped: "+id); continue;
            }
            NPC npc=CitizensAPI.getNPCRegistry().createNPC(EntityType.IRON_GOLEM, String.valueOf(entry.get("name")));
            boolean committed=false;
            try {
            npc.data().setPersistent("world-variety-owner",id);
            SentinelTrait trait=npc.getOrAddTrait(SentinelTrait.class);
            trait.health=100; trait.damage=8; trait.range=16; trait.chaseRange=24;
            trait.fightback=false; trait.invincible=false; trait.protectFromIgnores=true; trait.respawnTime=12000;
            trait.allTargets.targets.add("MONSTERS"); trait.allIgnores.targets.add("PLAYERS"); trait.allIgnores.targets.add("NPCS");
            trait.allTargets.recalculateTargetsCache(); trait.allIgnores.recalculateTargetsCache();
            if (!npc.spawn(at)) continue;
            state.set("guards."+id, npc.getUniqueId().toString());
            persist(); committed=true;
            } catch (Exception | LinkageError error) {
                getLogger().warning("Guard installation stopped for "+id+": "+error.getClass().getSimpleName());
            } finally {
                if(!committed){npc.destroy();state.set("guards."+id,null);}
            }
        }
        Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "citizens save");
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if(args.length==1 && args[0].equalsIgnoreCase("reload")){reloadConfig();int profiles=ol().getEncounterRegistry().reload();sender.sendMessage("§a世界内容配置已重新读取（"+profiles+"个遭遇方案）；已进行的遭遇沿用本场规则。");}
        var guards=state.getConfigurationSection("guards");
        sender.sendMessage("世界内容：遭遇="+ol().getMeteorEventManager().getActiveEvents().size()+"，守卫登记="+(guards==null ? 0 : guards.getKeys(false).size()));
        return true;
    }
    @Override public void onDisable() {
        if (mycli != null && mycli.getExecutor() == wrapper) mycli.setExecutor(previous);
    }
}
