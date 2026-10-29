package org.qiandengji.usabilityqa;
import java.nio.file.*;import org.bukkit.*;import org.bukkit.entity.*;import org.bukkit.command.*;import org.bukkit.inventory.*;import org.bukkit.plugin.java.JavaPlugin;import io.vortexcore.VortexCorePlugin;
/** Console-only bounded setup and independent observations, marked QA port only. */
public final class UsabilityQA extends JavaPlugin implements org.bukkit.event.Listener {
    private VortexCorePlugin vortex;
    private net.milkbowl.vault.economy.Economy injectedEconomy;
    private record DamageRead(long count,double damage,boolean cancelled){}
    private final java.util.Map<java.util.UUID,DamageRead> observed=new java.util.HashMap<>();
    private final java.util.Map<java.util.UUID,Integer> pickups=new java.util.HashMap<>();
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR)
    public void pickup(org.bukkit.event.player.PlayerAttemptPickupItemEvent event){if(event.getPlayer().getName().matches("ag_RU[a-zA-Z0-9]{1,10}")){int n=pickups.merge(event.getPlayer().getUniqueId(),1,Integer::sum);if(n<=3)getLogger().info("QA_PICKUP name="+event.getPlayer().getName()+" remaining="+event.getRemaining()+" cancelled="+event.isCancelled()+" canPickup="+event.getPlayer().getCanPickupItems());}}
    @Override public void onEnable(){try{if(getServer().getPort()!=25928||!getServer().getIp().equals("127.0.0.1")||!Files.readString(Path.of(".qa-only")).equals("VORTEX_TAKEOVER_QA_ONLY"))throw new IllegalStateException("not marked QA");}catch(Exception e){throw new IllegalStateException(e);}vortex=(VortexCorePlugin)getServer().getPluginManager().getPlugin("VortexRPG");Bukkit.getPluginManager().registerEvents(this,this);}
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR)
    public void damage(org.bukkit.event.entity.EntityDamageEvent event){if(event.getEntity() instanceof Player p&&p.getName().matches("ag_RU[a-zA-Z0-9]{1,10}")){var old=observed.get(p.getUniqueId());observed.put(p.getUniqueId(),new DamageRead(old==null?1:old.count()+1,event.getFinalDamage(),event.isCancelled()));}}
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(sender instanceof Player)throw new IllegalArgumentException("console fixture only");if(args.length<2)throw new IllegalArgumentException("action and QA actor required");
        Player p=Bukkit.getPlayerExact(args[1]);if(p==null||!p.getName().matches("ag_RU[a-zA-Z0-9]{1,10}"))throw new IllegalArgumentException("new QA identities only");
        var state=vortex.playerProfileService().profile(p);
        switch(args[0]){
            case "depositfail","withdrawfail"->{
                Bukkit.getServicesManager().unregisterAll(this);injectedEconomy=null;
                if(args[2].equals("on")){
                    var original=Bukkit.getServicesManager().getRegistration(net.milkbowl.vault.economy.Economy.class).getProvider();
                    java.util.UUID target=p.getUniqueId();String name=p.getName(),failedMethod=args[0].equals("depositfail")?"depositPlayer":"withdrawPlayer";
                    injectedEconomy=(net.milkbowl.vault.economy.Economy)java.lang.reflect.Proxy.newProxyInstance(net.milkbowl.vault.economy.Economy.class.getClassLoader(),new Class<?>[]{net.milkbowl.vault.economy.Economy.class},(proxy,method,values)->{
                        if(method.getName().equals("getName"))return "QA-native-deposit-failure";
                        if(method.getName().equals(failedMethod)&&values!=null&&values.length>=2&&
                           (values[0] instanceof org.bukkit.OfflinePlayer off&&off.getUniqueId().equals(target)||name.equals(values[0])))
                            return new net.milkbowl.vault.economy.EconomyResponse(0,original.getBalance(p),net.milkbowl.vault.economy.EconomyResponse.ResponseType.FAILURE,"QA injected failure");
                        try{return method.invoke(original,values);}catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
                    });
                    Bukkit.getServicesManager().register(net.milkbowl.vault.economy.Economy.class,injectedEconomy,this,org.bukkit.plugin.ServicePriority.Highest);
                }
                vortex.qiandengjiVault().refreshHook();
            }
            case "corelevels"->{
                try{
                    var af=Bukkit.getPluginManager().getPlugin("AgentFriend");var mining=af.getClass().getDeclaredMethod("miningLevel",Player.class);mining.setAccessible(true);
                    var skills=Class.forName("dev.aurelium.auraskills.api.skill.Skills",true,af.getClass().getClassLoader());var fighting=skills.getField("FIGHTING").get(null);
                    var aura=af.getClass().getDeclaredMethod("auraLevel",Player.class,skills);aura.setAccessible(true);
                    sender.sendMessage("QA nativeLevel="+state.level()+" miningLevel="+mining.invoke(af,p)+" combatLevel="+aura.invoke(af,p,fighting));
                }catch(Exception error){throw new IllegalStateException(error);}
            }
            case "legacytome"->{
                ItemStack book=new ItemStack(Material.WRITTEN_BOOK);var meta=(org.bukkit.inventory.meta.BookMeta)book.getItemMeta();meta.setTitle("旧研习书");meta.setAuthor("QA");meta.setPages("旧存档兼容验证");
                meta.getPersistentDataContainer().set(NamespacedKey.fromString("agentfriend:skill_tome_spell"),org.bukkit.persistence.PersistentDataType.STRING,"starbolt");
                meta.getPersistentDataContainer().set(NamespacedKey.fromString("agentfriend:skill_tome_practice"),org.bukkit.persistence.PersistentDataType.INTEGER,8);book.setItemMeta(meta);p.getInventory().setItem(0,book);
            }
            case "masteryproof","newtome"->{
                try{
                    var af=Bukkit.getPluginManager().getPlugin("AgentFriend");
                    if(args[0].equals("newtome")){
                        Class<?> type=Class.forName("org.afuhome.agentfriend.SkillTome",true,af.getClass().getClassLoader());var create=type.getDeclaredMethod("create",String.class,int.class);create.setAccessible(true);
                        ItemStack created=(ItemStack)create.invoke(null,"starbolt",8);sender.sendMessage("QA newTomeReplacement="+created.getType()+" amount="+created.getAmount());
                    }else{
                        var get=af.getClass().getDeclaredMethod("mastery");get.setAccessible(true);Object mastery=get.invoke(af);var grant=mastery.getClass().getDeclaredMethod("grantTraining",Player.class,String.class,int.class);grant.setAccessible(true);
                        var rank=mastery.getClass().getDeclaredMethod("rank",Player.class,String.class);rank.setAccessible(true);
                        sender.sendMessage("QA oldMasteryGranted="+grant.invoke(mastery,p,"starbolt",24)+" rank="+rank.invoke(mastery,p,"starbolt"));
                    }
                }catch(Exception error){throw new IllegalStateException(error);}
            }
            case "coins"->{double n=Double.parseDouble(args[2]);if(!Double.isFinite(n)||n<1||n>1000)throw new IllegalArgumentException("bounded gold");var bank=Bukkit.getServicesManager().getRegistration(net.milkbowl.vault.economy.Economy.class).getProvider();if(!bank.depositPlayer(p,n).transactionSuccess())throw new IllegalStateException("QA deposit failed");}
            case "trialcredit"->{
                int n=Integer.parseInt(args[2]);if(n<1||n>20)throw new IllegalArgumentException("bounded trial reward");
                var af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
                Object before=af.getConfig().get("dungeon-active-run");
                try{
                    af.getConfig().set("dungeon-active-run.id","qa-"+p.getUniqueId());af.getConfig().set("dungeon-active-run.floor",2);
                    var dungeonMethod=af.getClass().getDeclaredMethod("dungeon");dungeonMethod.setAccessible(true);Object dungeon=dungeonMethod.invoke(af);
                    var economyField=dungeon.getClass().getDeclaredField("economy");economyField.setAccessible(true);Object economy=economyField.get(dungeon);
                    var credit=economy.getClass().getDeclaredMethod("creditDifficulty",java.util.UUID.class,int.class);credit.setAccessible(true);
                    sender.sendMessage("QA trialCredit="+credit.invoke(economy,p.getUniqueId(),n));
                }catch(Exception error){throw new IllegalStateException(error);}
                finally{af.getConfig().set("dungeon-active-run",before);}
            }
            case "mana"->{double n=Double.parseDouble(args[2]);if(!Double.isFinite(n)||n<0||n>500)throw new IllegalArgumentException("bounded mana");vortex.qiandengjiMana().setMana(p.getUniqueId(),n);}
            case "xp"->{long n=Long.parseLong(args[2]);if(n<0||n>10000)throw new IllegalArgumentException("bounded xp");vortex.playerProfileService().grantExperience(p,n,"isolated-usability-fixture");}
            case "points"->{int n=Integer.parseInt(args[2]);if(n<0||n>20)throw new IllegalArgumentException("bounded points");state.putMetadata("rpg.skill_points",Integer.toString(n));}
            case "kitpreview"->{int n=Integer.parseInt(args[2]);if(n<1||n>3)throw new IllegalArgumentException("bounded preview");vortex.getConfig().set("class-selection.rewards.classes.knight.items.knight_iron_resolve",n);}
            case "armor"->{p.getInventory().setArmorContents(new ItemStack[]{new ItemStack(Material.IRON_BOOTS),new ItemStack(Material.IRON_LEGGINGS),new ItemStack(Material.IRON_CHESTPLATE),new ItemStack(Material.IRON_HELMET)});}
            case "integrity"->{
                int x=2400,y=81,z=2400;
                var block=p.getWorld().getBlockAt(x+2,y,z);block.setType(Material.STONE);
                var breaking=new org.bukkit.event.block.BlockBreakEvent(block,p);Bukkit.getPluginManager().callEvent(breaking);
                var change=new org.bukkit.event.entity.EntityChangeBlockEvent(p,block,Material.AIR.createBlockData());Bukkit.getPluginManager().callEvent(change);
                var list=new java.util.ArrayList<org.bukkit.block.Block>();list.add(block);var outside=p.getWorld().getBlockAt(x+80,y,z);list.add(outside);
                var blast=new org.bukkit.event.entity.EntityExplodeEvent(p,block.getLocation(),list,1,org.bukkit.ExplosionResult.DESTROY);Bukkit.getPluginManager().callEvent(blast);
                var from=p.getWorld().getBlockAt(x-25,y,z);from.setType(Material.PISTON);var to=from.getRelative(org.bukkit.block.BlockFace.EAST);
                var piston=new org.bukkit.event.block.BlockPistonExtendEvent(from,java.util.List.of(from),org.bukkit.block.BlockFace.EAST);Bukkit.getPluginManager().callEvent(piston);
                var fluid=new org.bukkit.event.block.BlockFromToEvent(from,to);Bukkit.getPluginManager().callEvent(fluid);
                sender.sendMessage("QA_INTEGRITY break="+breaking.isCancelled()+" entityChange="+change.isCancelled()+" explosionProtectedRemoved="+!blast.blockList().contains(block)+" explosionOutsideRetained="+blast.blockList().contains(outside)+" piston="+piston.isCancelled()+" fluid="+fluid.isCancelled());
            }
            case "freezehostiles"->{for(var entity:p.getNearbyEntities(24,24,24))if(entity instanceof Mob mob)mob.setAI(false);}
            case "hud"->{try{var af=Bukkit.getPluginManager().getPlugin("AgentFriend");sender.sendMessage("QA_HUD "+af.getClass().getMethod("nativeViewerState",Player.class).invoke(af,p));}catch(Exception error){throw new IllegalStateException(error);}}
            case "heal"->{p.setHealth(p.getMaxHealth());p.setNoDamageTicks(0);}
            case "hunger"->{int n=Integer.parseInt(args[2]);if(n<0||n>20)throw new IllegalArgumentException("bounded hunger");p.setFoodLevel(n);p.setSaturation(0);}
            case "fullbag"->{for(int i=0;i<36;i++)p.getInventory().setItem(i,new ItemStack(Material.STONE,64));}
            case "pickup"->{var item=p.getWorld().dropItem(p.getLocation(),new ItemStack(Material.COBBLESTONE,3));item.setPickupDelay(0);item.setVelocity(new org.bukkit.util.Vector());sender.sendMessage("QA_PICKUP at="+p.getLocation().getX()+","+p.getLocation().getY()+","+p.getLocation().getZ()+" canPickup="+p.getCanPickupItems()+" attempts="+pickups.getOrDefault(p.getUniqueId(),0));}
            case "emptybag"->{for(int i=0;i<36;i++)p.getInventory().setItem(i,null);}
            case "clearhostiles"->{for(var entity:p.getNearbyEntities(24,24,24))if(entity instanceof Monster)entity.remove();}
            case "inspect"->{}
            default->throw new IllegalArgumentException("unknown fixture action");
        }
        var resistance=p.getPotionEffect(org.bukkit.potion.PotionEffectType.RESISTANCE);var damage=observed.get(p.getUniqueId());
        var ray=p.getWorld().rayTraceBlocks(p.getEyeLocation(),p.getEyeLocation().getDirection(),25);
        String party=vortex.expeditionPartyManager().partyOf(p.getUniqueId()).map(s->s.name()+"/"+s.members().size()).orElse("none");sender.sendMessage("QA mana="+vortex.qiandengjiMana().getMana(p.getUniqueId())+" health="+p.getHealth()+" maxHealth="+p.getMaxHealth()+" level="+state.level()+" xp="+state.experience()+" points="+vortex.classSkillService().unspentSkillPoints(state)+" balance="+vortex.qiandengjiVault().balance(p)+" party="+party+" resistance="+(resistance==null?-1:resistance.getAmplifier())+" resistanceTicks="+(resistance==null?0:resistance.getDuration())+" damageEvents="+(damage==null?0:damage.count())+" cancelled="+(damage!=null&&damage.cancelled()?1:0)+" finalDamage="+(damage==null?-1:damage.damage())+" yaw="+p.getYaw()+" pitch="+p.getPitch()+" ray="+(ray==null?"none":ray.getHitBlock().getLocation().toVector()));return true;
    }
}
