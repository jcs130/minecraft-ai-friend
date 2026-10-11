package qa;

import java.lang.reflect.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.*;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only fixtures for the named loopback laboratory. Never deploy to production. */
public final class DungeonParticipationQA extends JavaPlugin implements org.bukkit.event.Listener {
    private JavaPlugin friend;
    private boolean rejectTestPickups;
    @Override public void onEnable() {
        if(!Bukkit.getMotd().equals("Dungeon participation isolated check")
                ||!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=25567) {
            Bukkit.getPluginManager().disablePlugin(this);return;
        }
        friend=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
        Bukkit.getPluginManager().registerEvents(this,this);
        getCommand("dungeonqa").setExecutor(this::command);
    }
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR)
    public void damage(org.bukkit.event.entity.EntityDamageByEntityEvent event) {
        if(event.getEntity().getScoreboardTags().contains("afu_site_dungeon")&&event.getDamager() instanceof Arrow arrow)
            getLogger().info("QA_ARROW_DAMAGE cancelled="+event.isCancelled()+" final="+event.getFinalDamage()+" shooter="+arrow.getShooter());
    }
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.HIGHEST)
    public void pickup(org.bukkit.event.entity.EntityPickupItemEvent event) {
        if(rejectTestPickups&&event.getEntity() instanceof Player player&&player.getName().equals("RoomQA"))event.setCancelled(true);
    }
    private static Object field(Object obj,String name)throws Exception {
        Field field=obj.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(obj);
    }
    private static void set(Object obj,String name,Object value)throws Exception {
        Field field=obj.getClass().getDeclaredField(name);field.setAccessible(true);field.set(obj,value);
    }
    private static Object invoke(Object obj,String name,Class<?>[] types,Object... args)throws Exception {
        Method method=obj.getClass().getDeclaredMethod(name,types);method.setAccessible(true);return method.invoke(obj,args);
    }
    @SuppressWarnings("unchecked")
    private boolean command(CommandSender sender,Command command,String alias,String[] args) {
        if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return true;
        try {
            Object manager=field(friend,"siteDungeons");
            Map<String,Object> runs=(Map<String,Object>)field(manager,"runs");
            Object run=runs.get("audit_rooms");
            switch(args[0]) {
                case "reject_pickup" -> rejectTestPickups=Boolean.parseBoolean(args[1]);
                case "shortcut" -> {
                    Object tower=field(friend,"dungeon");
                    Class<?> migration=Class.forName("org.afuhome.agentfriend.BackpackShortcutMigration",true,friend.getClass().getClassLoader());
                    Method method=migration.getDeclaredMethod("restoreMissing",Player.class,tower.getClass());method.setAccessible(true);
                    method.invoke(null,Objects.requireNonNull(Bukkit.getPlayerExact(args[1])),tower);
                }
                case "tower_status" -> invoke(field(friend,"dungeon"),"command",new Class<?>[]{Player.class,String[].class},
                        Objects.requireNonNull(Bukkit.getPlayerExact("RoomQA")),new String[]{"arena","status"});
                case "health" -> {
                    Player player=Objects.requireNonNull(Bukkit.getPlayerExact(args[1]));
                    player.setHealth(Math.clamp(Double.parseDouble(args[2]),1,player.getMaxHealth()));
                }
                case "tower_notice" -> {
                    Object tower=field(friend,"dungeon");
                    Set<UUID> members=(Set<UUID>)field(tower,"participants");
                    members.clear();members.add(Objects.requireNonNull(Bukkit.getPlayerExact("RoomQA")).getUniqueId());
                    invoke(tower,"announce",new Class<?>[]{String.class},"隔离消息归属检查");
                    members.clear();
                }
                case "full_inventory" -> {
                    Player player=Objects.requireNonNull(Bukkit.getPlayerExact("RoomQA"));
                    for(int slot=0;slot<36;slot++)player.getInventory().setItem(slot,new ItemStack(Material.COBBLESTONE,64));
                    player.getInventory().setItem(0,new ItemStack(Material.BREAD,63));
                    player.updateInventory();
                }
                case "fixtures" -> {
                    World world=Bukkit.getWorld("world");
                    for(int x=88;x<=180;x++)for(int z=90;z<=110;z++) {
                        world.getBlockAt(x,100,z).setType(Material.STONE,false);
                        for(int y=101;y<=104;y++)world.getBlockAt(x,y,z).setType(Material.AIR,false);
                    }
                    world.setTime(18000);world.setGameRule(GameRule.DO_MOB_SPAWNING,false);
                    world.setGameRule(GameRule.KEEP_INVENTORY,true);
                    world.getBlockAt(170,101,100).setType(Material.CHEST,false);
                    Villager villager=world.spawn(new Location(world,174.5,101,100.5),Villager.class);
                    villager.setAI(false);villager.setInvulnerable(true);villager.setPersistent(true);
                    villager.setProfession(Villager.Profession.FARMER);villager.addScoreboardTag("dungeon_qa_merchant");
                    MerchantRecipe recipe=new MerchantRecipe(new ItemStack(Material.EMERALD),100);
                    recipe.addIngredient(new ItemStack(Material.WHEAT));villager.setRecipes(List.of(recipe));
                }
                case "freeze" -> {
                    for(World world:Bukkit.getWorlds())for(Entity entity:world.getEntities())
                        if(entity instanceof Mob mob&&entity.getScoreboardTags().contains("afu_site_dungeon")){mob.setAI(false);mob.setFireTicks(0);}
                }
                case "muster" -> set(Objects.requireNonNull(run),"readyAt",System.currentTimeMillis()-1);
                case "expire" -> {
                    if(args[1].equals("grace"))set(Objects.requireNonNull(run),"pausedAt",System.currentTimeMillis()-301_000);
                    else set(Objects.requireNonNull(run),"started",System.currentTimeMillis()-1_801_000);
                }
                case "cooldown" -> {friend.getConfig().set("site-dungeons.cooldowns.audit_rooms",0);friend.saveConfig();}
                case "heal" -> {
                    Player caster=Bukkit.getPlayerExact(args[1]),target=Bukkit.getPlayerExact(args[2]);
                    target.setHealth(Math.max(1,target.getHealth()-2));target.setHealth(Math.min(target.getMaxHealth(),target.getHealth()+2));
                    invoke(field(friend,"professions"),"observedHealing",new Class<?>[]{Player.class,Player.class,double.class},caster,target,2.0);
                }
                case "arrowhit" -> {
                    Player caster=Bukkit.getPlayerExact(args[1]);LivingEntity target=(LivingEntity)Bukkit.getEntity(UUID.fromString(args[2]));
                    Arrow arrow=caster.launchProjectile(Arrow.class,target.getEyeLocation().toVector().subtract(caster.getEyeLocation().toVector()).normalize().multiply(2));
                    arrow.setGravity(false);arrow.setDamage(1);
                }
                case "remove" -> Objects.requireNonNull(Bukkit.getEntity(UUID.fromString(args[1]))).remove();
                case "rewardfull", "rewardreset" -> {
                    Player player=Bukkit.getPlayerExact(args[1]);Object dungeon=field(friend,"dungeon");
                    String path=(String)invoke(dungeon,"rewardPath",new Class<?>[]{UUID.class,Material.class},player.getUniqueId(),Material.EMERALD);
                    friend.getConfig().set(path,args[0].equals("rewardfull")?Integer.MAX_VALUE:0);friend.saveConfig();
                }
                case "permit" -> {
                    Player player=Bukkit.getPlayerExact(args[1]);
                    player.addAttachment(this,"backpack.use",true);player.addAttachment(this,"backpack.size.6",true);
                }
                default -> throw new IllegalArgumentException("unknown_fixture");
            }
            sender.sendMessage("DUNGEON_QA_OK "+args[0]);
        } catch(Exception error) {
            sender.sendMessage("DUNGEON_QA_FAIL "+error);getLogger().warning(error.toString());
        }
        return true;
    }
}
