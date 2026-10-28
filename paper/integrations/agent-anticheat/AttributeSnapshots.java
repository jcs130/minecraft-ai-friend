/* SPDX-License-Identifier: AGPL-3.0-only */
package me.vekster.lightanticheat.qiandengji;
import java.util.*;import java.util.concurrent.*;
import me.vekster.multiversion.V1_20;
import org.bukkit.Bukkit;import org.bukkit.entity.Player;import org.bukkit.event.*;import org.bukkit.event.player.*;import org.bukkit.event.server.PluginDisableEvent;import org.bukkit.plugin.java.JavaPlugin;

/** LAC's async movement checks must never lazily create native attribute instances. */
public final class AttributeSnapshots {
 private static final Map<V1_20,Book> BOOKS=new ConcurrentHashMap<>();
 private AttributeSnapshots(){}
 public static void attach(JavaPlugin plugin,V1_20 reader){
  if(!Bukkit.isPrimaryThread())throw new IllegalStateException("attribute sampler must attach on main thread");
  Book book=new Book(plugin,reader);if(BOOKS.putIfAbsent(reader,book)!=null)return;
  Bukkit.getPluginManager().registerEvents(book,plugin);
  Bukkit.getScheduler().runTaskTimer(plugin,book::tick,1,1);
 }
 public static Map<String,Double> read(V1_20 reader,Player player){
  if(Bukkit.isPrimaryThread())return reader.qiandengjiLiveAttributes(player);
  Book book=BOOKS.get(reader);return book==null?Map.of():book.values.getOrDefault(player.getUniqueId(),Map.of());
 }
 private static final class Book implements Listener {
  final JavaPlugin plugin;final V1_20 reader;final Map<UUID,Map<String,Double>> values=new ConcurrentHashMap<>();
  Book(JavaPlugin plugin,V1_20 reader){this.plugin=plugin;this.reader=reader;}
  void capture(Player p){if(!Bukkit.isPrimaryThread())throw new IllegalStateException("off-thread attribute capture");values.put(p.getUniqueId(),Map.copyOf(reader.qiandengjiLiveAttributes(p)));}
  void tick(){for(Player p:Bukkit.getOnlinePlayers())capture(p);}
  @EventHandler(priority=EventPriority.MONITOR)public void join(PlayerJoinEvent e){capture(e.getPlayer());}
  @EventHandler public void quit(PlayerQuitEvent e){values.remove(e.getPlayer().getUniqueId());}
  @EventHandler public void disabled(PluginDisableEvent e){if(e.getPlugin()==plugin){values.clear();BOOKS.remove(reader,this);}}
 }
}
