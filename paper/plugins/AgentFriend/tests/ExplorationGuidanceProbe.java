package org.afuhome.agentfriend.qa;

import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only fixture and assertions, separately built for loopback QA only.
 * This JAR is never included in AgentFriend or a production deployment. */
public final class ExplorationGuidanceProbe extends JavaPlugin {
    public void onEnable() {
        if (Bukkit.getPort() != 25830 || !Bukkit.getIp().equals("127.0.0.1")
                || !Bukkit.getMotd().equals("TASK_GUIDANCE_ISOLATED_20261017")) throw new IllegalStateException("QA only");
    }
    private static Object call(Object object, String method, Class<?>[] types, Object... args) throws Exception {
        var m = object.getClass().getDeclaredMethod(method, types); m.setAccessible(true); return m.invoke(object, args);
    }
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof org.bukkit.command.ConsoleCommandSender)
                && !(sender instanceof org.bukkit.command.RemoteConsoleCommandSender) || args.length != 1) return false;
        try {
            Player p = Bukkit.getPlayerExact("ag_ExamQA16"); if (p == null) throw new IllegalStateException("QA not online");
            JavaPlugin af = (JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
            Object market = call(af,"taskMarket",new Class<?>[0]);
            String path = "guild-players." + p.getUniqueId() + ".active";
            String frozen = af.getConfig().getString(path+".market.definition");
            if (java.util.Set.of("home","nether","temple").contains(args[0])) {
                boolean nether=args[0].equals("nether"),temple=args[0].equals("temple");
                p.setFlying(false);p.setAllowFlight(false);
                // Fixture relocation bypasses gameplay travel costs only in this
                // separately packaged, console-only, loopback QA plugin.
                boolean moved=p.teleport(new org.bukkit.Location(Bukkit.getWorld(nether?"world_nether":"world"),
                        nether?0.5:temple?1602.5:-549.5,nether?170:temple?88:67,nether?0.5:temple?2356.5:-449.5),
                        org.bukkit.event.player.PlayerTeleportEvent.TeleportCause.UNKNOWN);
                if(!moved)throw new IllegalStateException("fixture relocation rejected");
                sender.sendMessage("QA_GUIDANCE_POSITION "+args[0]);
            } else if (args[0].equals("readonly")) {
                String before = af.getConfig().saveToString();
                int chunks = p.getWorld().getLoadedChunks().length;
                Object survey = call(market,"progressState",new Class<?>[]{Player.class},p);
                for (String q : new String[]{"mycli tasks status --json","mycli tasks info tm_jungle_temple_puzzle --json","mycli progress guild 1 --json","mycli guild status"}) Bukkit.dispatchCommand(p,q);
                Object after = call(market,"progressState",new Class<?>[]{Player.class},p);
                if (!before.equals(af.getConfig().saveToString()) || chunks != p.getWorld().getLoadedChunks().length)
                    throw new IllegalStateException("query mutated player data or loaded chunks");
                sender.sendMessage("QA_GUIDANCE_READONLY " + survey.toString());
            } else if (args[0].equals("partial") || args[0].equals("ready")) {
                boolean ready = args[0].equals("ready"); JsonObject s = new JsonObject();
                s.addProperty("token",af.getConfig().getString(path+".market.run")+":0");
                s.addProperty("instance",Bukkit.getWorld("world").getUID()+":minecraft:jungle_pyramid:"+(((long)147<<32)|100));
                s.addProperty("structure","minecraft:jungle_pyramid");s.addProperty("bounds","1600,86,2352:1614,95,2363");
                s.addProperty("distance",ready?40:28);s.addProperty("movingMs",ready?25000:18000);s.addProperty("ready",ready);
                var pos=new JsonObject();pos.addProperty("world","world");pos.addProperty("worldUuid",Bukkit.getWorld("world").getUID().toString());
                pos.addProperty("x",1602);pos.addProperty("y",88);pos.addProperty("z",2356);pos.addProperty("observedAt",System.currentTimeMillis());s.add("position",pos);
                s.addProperty("minY",88);s.addProperty("maxY",ready?94:90);
                for(String key:new String[]{"zones","parts","biomes","trail"}) {
                    var rows=new com.google.gson.JsonArray();
                    if(key.equals("zones"))for(int i=0;i<(ready?6:4);i++)rows.add("qa-"+i);
                    else if(key.equals("parts"))rows.add("0");else if(key.equals("biomes"))rows.add("minecraft:jungle");
                    s.add(key,rows);
                }
                af.getConfig().set(path+".market.exploration",s.toString());af.getConfig().set(path+".progress",ready?6:4);
                var field=market.getClass().getDeclaredField("exploration");field.setAccessible(true);
                call(field.get(market),"forget",new Class<?>[]{Player.class},p);
                if(!frozen.equals(af.getConfig().getString(path+".market.definition")))throw new IllegalStateException("frozen definition changed");
                sender.sendMessage("QA_GUIDANCE_FIXTURE "+args[0]);
            } else throw new IllegalArgumentException("home/nether/temple/readonly/partial/ready");
        } catch(Exception e) { sender.sendMessage("QA_GUIDANCE_ERROR "+e);getLogger().log(java.util.logging.Level.SEVERE,"QA failed",e); }
        return true;
    }
}
