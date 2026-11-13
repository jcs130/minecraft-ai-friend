import io.vortexcore.VortexCorePlugin;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockFadeEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.entity.LivingEntity;
import org.bukkit.potion.PotionEffectType;

/** Fixture commands are available only on the marked, loopback-only QA server. */
public final class DailyGameplayQa extends JavaPlugin implements Listener {
    private VortexCorePlugin vortex;

    @Override public void onEnable() {
        try {
            if (!Files.readString(Path.of(".daily-shop-qa")).equals("ISOLATED_DAILY_SHOP_FROST_ONLY")
                    || !Bukkit.getIp().equals("127.0.0.1") || !java.util.Set.of(25928,26324,26326).contains(Bukkit.getPort()))
                throw new IllegalStateException("Isolated stage required");
            vortex = (VortexCorePlugin) Bukkit.getPluginManager().getPlugin("VortexRPG");
            Bukkit.getPluginManager().registerEvents(this, this);
        } catch (Exception invalid) {
            throw new IllegalStateException(invalid);
        }
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player || args.length < 2) return false;
        Player player = Bukkit.getPlayerExact(args[1]);
        try {
            switch (args[0]) {
                case "clock" -> {
                    var agent = Bukkit.getPluginManager().getPlugin("AgentFriend");
                    Object dungeon = field(agent, "dungeon");
                    Object stock = field(field(dungeon, "economy"), "dailyShop");
                    var clock = stock.getClass().getDeclaredField("clock");
                    clock.setAccessible(true);
                    clock.set(stock, Clock.fixed(Instant.parse(args[1]), ZoneOffset.UTC));
                    sender.sendMessage("clock=" + args[1]);
                }
                case "health" -> {
                    if (args.length > 2) player.setHealth(Math.min(player.getMaxHealth(), Double.parseDouble(args[2])));
                    sender.sendMessage("health=" + player.getHealth());
                }
                case "clear-state" -> {
                    if (!player.getName().matches("MaidBrainQA|ag_RUReady[AB]"))
                        throw new IllegalArgumentException("Synthetic dungeon actor required");
                    var effects=vortex.effectService();
                    if (args.length==3&&args[2].equals("arm")) {
                        player.setHealth(5);
                        vortex.qiandengjiMana().setMana(player.getUniqueId(),0);
                        player.setFireTicks(120);
                        player.addPotionEffect(new org.bukkit.potion.PotionEffect(PotionEffectType.POISON,200,0));
                        player.addPotionEffect(new org.bukkit.potion.PotionEffect(PotionEffectType.SPEED,400,0));
                        effects.applyEffectToEntity(player,"bleed",1,400,1,true);
                        effects.applyEffectToEntity(player,"arcane_ward",1,400,1,true);
                    }
                    var all=(java.util.Map<?,?>)field(effects,"activeEffects");
                    var active=all.get(player.getUniqueId()) instanceof java.util.Map<?,?> current ? current : java.util.Map.of();
                    var mana=vortex.qiandengjiMana();
                    sender.sendMessage("health="+player.getHealth()+"/"+player.getMaxHealth()
                        +" mana="+mana.getMana(player.getUniqueId())+"/"+mana.getMaxMana(player)
                        +" fire="+player.getFireTicks()+" poison="+player.hasPotionEffect(PotionEffectType.POISON)
                        +" speed="+player.hasPotionEffect(PotionEffectType.SPEED)+" bleed="+active.containsKey("bleed")
                        +" ward="+active.containsKey("arcane_ward"));
                }
                case "readiness-ground" -> {
                    if (!player.getName().matches("MaidBrainQA|ag_RUReady[AB]"))
                        throw new IllegalArgumentException("Synthetic dungeon actor required");
                    var world=Bukkit.getWorld("world");
                    player.setInvulnerable(true);
                    boolean tower=player.getName().equals("MaidBrainQA");
                    int fromX=tower?-601:2994, toX=tower?-579:3020;
                    int fromZ=tower?-316:2394, toZ=tower?-294:2406;
                    for(int x=fromX>>4;x<=toX>>4;x++)for(int z=fromZ>>4;z<=toZ>>4;z++)
                        world.getChunkAt(x,z).addPluginChunkTicket(this);
                    for(int floorY:tower?new int[]{56,68}:new int[]{80})
                        for(int x=fromX;x<=toX;x++)for(int z=fromZ;z<=toZ;z++) {
                            world.getBlockAt(x,floorY,z).setType(Material.STONE,false);
                            for(int y=floorY+1;y<=floorY+3;y++)world.getBlockAt(x,y,z).setType(Material.AIR,false);
                        }
                    sender.sendMessage("ground=ready");
                }
                case "readiness-enemies" -> {
                    if (!player.getName().matches("MaidBrainQA|ag_RUReady[AB]")||args.length<3)
                        throw new IllegalArgumentException("Synthetic dungeon actor and mode required");
                    String tag=player.getName().equals("MaidBrainQA")?"afu_dungeon_mob":"afu_site_qa_readiness";
                    var mobs=player.getNearbyEntities(24,7,24).stream()
                        .filter(entity->entity instanceof LivingEntity living&&!living.isDead()&&entity.getScoreboardTags().contains(tag)).toList();
                    if (args[2].equals("clear")) for(var mob:mobs) ((LivingEntity)mob).damage(1000,player);
                    else if (!args[2].equals("read")) throw new IllegalArgumentException("read or clear");
                    sender.sendMessage("mobs="+mobs.size());
                }
                case "entity-health" -> {
                    var entities = Bukkit.selectEntities(sender, args[1]);
                    if (entities.isEmpty()) sender.sendMessage("health=0.0");
                    else if (entities.size() == 1 && entities.getFirst() instanceof LivingEntity living)
                        sender.sendMessage("health=" + living.getHealth());
                    else throw new IllegalStateException("expected at most one fixture target");
                }
                case "fire" -> {
                    if (args.length > 2) player.setFireTicks(Integer.parseInt(args[2]));
                    sender.sendMessage("fire=" + player.getFireTicks());
                }
                case "effects" -> {
                    var entities = Bukkit.selectEntities(sender, args[1]);
                    if (entities.size() != 1 || !(entities.getFirst() instanceof LivingEntity living))
                        throw new IllegalStateException("expected one fixture target");
                    var slow = living.getPotionEffect(PotionEffectType.SLOWNESS);
                    var weak = living.getPotionEffect(PotionEffectType.WEAKNESS);
                    var guard = living.getPotionEffect(PotionEffectType.RESISTANCE);
                    sender.sendMessage("slow=" + (slow == null ? -1 : slow.getAmplifier())
                            + " weak=" + (weak == null ? -1 : weak.getAmplifier())
                            + " guard=" + (guard == null ? -1 : guard.getAmplifier()));
                }
                case "block" -> {
                    var block = Bukkit.getWorld("world").getBlockAt(Integer.parseInt(args[1]),
                            Integer.parseInt(args[2]), Integer.parseInt(args[3]));
                    if (args.length > 4) block.setType(Material.valueOf(args[4]), false);
                    sender.sendMessage("block=" + block.getType().name());
                }
                case "party" -> {
                    var party = vortex.expeditionPartyManager();
                    if (party.partyOf(player.getUniqueId()).isEmpty()) party.createParty(player.getUniqueId());
                    for (int i = 2; i < args.length; i++) {
                        var ally = Bukkit.getPlayerExact(args[i]).getUniqueId();
                        party.invite(player.getUniqueId(), ally);
                        party.acceptInvite(ally);
                    }
                    sender.sendMessage("party=" + party.membersOf(player.getUniqueId()).size());
                }
                case "trial-team" -> {
                    var agent = Bukkit.getPluginManager().getPlugin("AgentFriend");
                    Object dungeon = field(agent, "dungeon");
                    set(dungeon, "floor", 13);
                    set(dungeon, "active", args.length > 2);
                    if (args.length > 2) {
                        set(dungeon, "pausedAt", 0L);
                        set(dungeon, "runStartedAt", System.currentTimeMillis());
                        set(dungeon, "floorStartedAt", System.currentTimeMillis());
                    }
                    trialGroup(dungeon, args);
                    sender.sendMessage("trial=" + (args.length > 2));
                }
                case "assist" -> {
                    var agent = Bukkit.getPluginManager().getPlugin("AgentFriend");
                    var access = Class.forName("org.afuhome.agentfriend.GroupSpellAccess", false, agent.getClass().getClassLoader());
                    var canAssist = access.getMethod("canAssist", Player.class, Player.class, boolean.class);
                    sender.sendMessage("assist=" + canAssist.invoke(null, player, Bukkit.getPlayerExact(args[2]), false));
                }
                case "level" -> {
                    var profiles = vortex.playerProfileService();
                    long xp = profiles.experienceCurve().totalExperienceToReach(Integer.parseInt(args[2]));
                    profiles.setExperience(player, xp, "synthetic-qagameplay");
                    sender.sendMessage("level=" + vortex.playerProfileService().profile(player).level());
                }
                default -> { return false; }
            }
        } catch (Exception failure) {
            sender.sendMessage("fixture_error=" + failure);
        }
        return true;
    }

    private static Object field(Object object, String name) throws ReflectiveOperationException {
        var field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(object);
    }

    private static void set(Object object, String name, Object value) throws ReflectiveOperationException {
        var field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(object, value);
    }

    @SuppressWarnings("unchecked")
    private static void trialGroup(Object dungeon, String[] args) throws ReflectiveOperationException {
        var group = (java.util.Set<java.util.UUID>) field(dungeon, "participants");
        group.clear();
        if (args.length > 2) {
            for (int i = 1; i < args.length; i++) group.add(Bukkit.getPlayerExact(args[i]).getUniqueId());
        }
    }

    @EventHandler public void protectedFire(BlockFadeEvent event) {
        if (event.getBlock().getX() == 179 && event.getBlock().getY() == 90 && event.getBlock().getZ() == 180)
            event.setCancelled(true);
    }
}
