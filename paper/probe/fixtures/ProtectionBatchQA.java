import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.plugin.java.JavaPlugin;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.protection.flags.*;
import com.sk89q.worldguard.protection.regions.*;

/** Real temporary WorldGuard regions in the guarded loopback copy only. */
public final class ProtectionBatchQA extends JavaPlugin implements CommandExecutor {
    private com.sk89q.worldguard.protection.managers.RegionManager regions;
    public void onEnable() {
        if (getServer().getPort()!=25678 || !getServer().getIp().equals("127.0.0.1") || !getServer().getMotd().equals("Life challenges isolated check"))
            throw new IllegalStateException("Isolated test fixture only");
        regions=WorldGuard.getInstance().getPlatform().getRegionContainer().get(BukkitAdapter.adapt(Bukkit.getWorld("world")));
        getCommand("protectionqa").setExecutor(this);
    }
    public void onDisable() { clear(); }
    private void clear() { if(regions!=null){for(String id:new String[]{"qa_protection_a","qa_protection_b"})regions.removeRegion(id);for(int i=0;i<64;i++)regions.removeRegion("qa_protection_many_"+i);} }
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof ConsoleCommandSender || sender instanceof RemoteConsoleCommandSender)) return true;
        if(args.length!=1){sender.sendMessage("PROTECTION_QA_INVALID");return true;}
        switch(args[0]) {
            case "setup" -> {
                clear(); World world=Bukkit.getWorld("world");
                for(int x=1998;x<=2010;x++)for(int z=1998;z<=2010;z++){
                    world.getBlockAt(x,100,z).setType(Material.STONE,false);
                    for(int y=101;y<=104;y++)world.getBlockAt(x,y,z).setType(Material.AIR,false);
                }
                for(int i=0;i<2;i++) {
                    var region=new ProtectedCuboidRegion("qa_protection_"+(i==0?"a":"b"),BlockVector3.at(2000+i*4,100,2000),BlockVector3.at(2003+i*4,102,2003));
                    region.setFlag(Flags.BUILD,StateFlag.State.ALLOW); region.setFlag(Flags.BLOCK_BREAK,StateFlag.State.DENY);
                    regions.addRegion(region);
                }
            }
            case "allow-b" -> regions.getRegion("qa_protection_b").setFlag(Flags.BLOCK_BREAK,StateFlag.State.ALLOW);
            case "deny-b" -> regions.getRegion("qa_protection_b").setFlag(Flags.BLOCK_BREAK,StateFlag.State.DENY);
            case "many" -> {
                clear();for(int i=0;i<64;i++){
                    var at=BlockVector3.at(2000+i%8,100,2000+i/8);
                    var region=new ProtectedCuboidRegion("qa_protection_many_"+i,at,at);
                    region.setFlag(Flags.BUILD,StateFlag.State.ALLOW);region.setFlag(Flags.BLOCK_BREAK,StateFlag.State.DENY);regions.addRegion(region);
                }
            }
            case "blocks" -> {
                World world=Bukkit.getWorld("world");var blocks=new com.google.gson.JsonObject();
                for(int x=2002;x<=2003;x++)for(int z=2002;z<=2003;z++)blocks.addProperty(x+",100,"+z,world.getBlockAt(x,100,z).getType().name());
                sender.sendMessage("PROTECTION_QA_BLOCKS "+blocks);return true;
            }
            case "clear" -> clear();
            default -> { sender.sendMessage("PROTECTION_QA_INVALID");return true; }
        }
        sender.sendMessage("PROTECTION_QA_OK"); return true;
    }
}
