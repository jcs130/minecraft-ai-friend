import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Villager;
import org.bukkit.inventory.*;
import org.bukkit.plugin.java.JavaPlugin;

/** Disposable integration fixture; never installed outside its own marked test server. */
public final class ClientCompatFixture extends JavaPlugin {
    private int checks;
    private void check(boolean value, String name) { checks++; if(!value) throw new AssertionError(name); }
    @Override public void onEnable() {
        try {
            if(getServer().getPort()!=25984 || !Files.readString(Path.of(".qa-only")).equals("CLIENT_COMPAT_QA_ONLY")) throw new IllegalStateException("QA server required");
        } catch(Exception error) { throw new IllegalStateException(error); }
    }
    private static Object call(Object object, String name) throws Exception {
        var m=object.getClass().getDeclaredMethod(name); m.setAccessible(true); return m.invoke(object);
    }
    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if(!(sender instanceof ConsoleCommandSender || sender instanceof RemoteConsoleCommandSender))return true;
        Villager host=null;
        try {
            org.afuhome.agentfriend.GuildHostTradesTest.main(new String[0]);
            var plugin=getServer().getPluginManager().getPlugin("AgentFriend");
            var loader=plugin.getClass().getClassLoader();
            var field=plugin.getClass().getDeclaredField("lifeBuildings");field.setAccessible(true);Object buildings=field.get(plugin);
            var type=buildings.getClass();var hallsField=type.getDeclaredField("HALLS");hallsField.setAccessible(true);
            Object harbor=null;for(Object hall:(List<?>)hallsField.get(null))if(call(hall,"id").equals("harbor"))harbor=hall;
            Object reception=call(harbor,"right");
            var world=getServer().getWorld("world");Location at=world.getSpawnLocation();
            var plotType=Class.forName(type.getName()+"$Plot",true,loader);var constructor=plotType.getDeclaredConstructor(int.class,int.class,int.class);constructor.setAccessible(true);
            Object plot=constructor.newInstance(at.getBlockX()+4,at.getBlockY()-1,at.getBlockZ());
            var ensure=type.getDeclaredMethod("ensureHost",harbor.getClass(),plotType,reception.getClass());ensure.setAccessible(true);
            long start=System.nanoTime();host=(Villager)ensure.invoke(buildings,harbor,plot,reception);
            long elapsed=(System.nanoTime()-start)/1_000_000;
            check(host.getProfession()==Villager.Profession.CARTOGRAPHER,"original profession retained");
            check(host.getVillagerLevel()==2,"original level restored");
            check(!host.getRecipes().isEmpty(),"standard merchant offers available");
            check(host.getRecipes().stream().noneMatch(r->r.getResult().getType()==Material.FILLED_MAP),"first initialization avoids exploration map searches");
            check(elapsed<2000,"bounded local initialization");
            UUID id=host.getUniqueId();
            MerchantRecipe offer=new MerchantRecipe(new ItemStack(Material.FILLED_MAP),11);offer.addIngredient(new ItemStack(Material.EMERALD,4));offer.setUses(3);offer.setDemand(2);offer.setSpecialPrice(1);
            host.setRecipes(List.of(offer));
            for(int i=0;i<4;i++)host=(Villager)ensure.invoke(buildings,harbor,plot,reception);
            check(host.getUniqueId().equals(id),"original guild body retained");
            check(host.getRecipes().size()==1,"existing offer count retained");
            var preserved=host.getRecipe(0);
            check(preserved.getResult().getType()==Material.FILLED_MAP,"existing map offer retained");
            check(preserved.getUses()==3&&preserved.getMaxUses()==11,"existing stock and uses retained");
            check(preserved.getDemand()==2&&preserved.getSpecialPrice()==1,"existing price modifiers retained");
            check(host.getVillagerLevel()==2,"repeated maintenance retains level");
            sender.sendMessage("CLIENT_COMPAT_QA {\"passed\":true,\"serverChecks\":"+checks+",\"registryFixtureChecks\":"+org.afuhome.agentfriend.GuildHostTradesTest.passedChecks()+",\"elapsedMs\":"+elapsed+"}");
        } catch(Throwable error) {
            error.printStackTrace();sender.sendMessage("CLIENT_COMPAT_QA {\"passed\":false,\"error\":\""+error.getClass().getSimpleName()+"\"}");
        } finally { if(host!=null)host.remove(); }
        return true;
    }
}
