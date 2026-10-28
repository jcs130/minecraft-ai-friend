/* SPDX-License-Identifier: AGPL-3.0-only */
import java.lang.reflect.*;import java.util.*;import java.util.concurrent.atomic.*;import java.util.logging.Logger;
import org.bukkit.*;import org.bukkit.entity.Player;import org.bukkit.event.block.*;import org.bukkit.event.entity.*;import org.bukkit.event.player.*;
import me.vekster.multiversion.V1_20;import me.vekster.lightanticheat.qiandengji.AttributeSnapshots;
public final class AttributeSnapshotsTest {
 static final AtomicBoolean main=new AtomicBoolean();static final AtomicInteger reads=new AtomicInteger();static final Map<String,Double> live=new HashMap<>(Map.of("MOVE_SPEED",.2));
 public static final class Reader extends V1_20 {
  public Reader(){super(null);}
  @Override public Map<String,Double> qiandengjiLiveAttributes(Player p){if(!main.get())throw new AssertionError("live attribute access off main");reads.incrementAndGet();return live;}
  public void onBlockPlace(BlockPlaceEvent e){}public void onBlockBreak(BlockBreakEvent e){}public void onMovement(PlayerMoveEvent e){}public void onEntityDamage(EntityDamageByEntityEvent e){}
 }
 static Object empty(Class<?> t){if(!t.isPrimitive())return null;if(t==boolean.class)return false;if(t==int.class)return 0;if(t==long.class)return 0L;if(t==double.class)return 0d;return null;}
 public static void main(String[] args)throws Exception{
  net.minecraft.SharedConstants.tryDetectVersion();
  Server server=(Server)Proxy.newProxyInstance(Server.class.getClassLoader(),new Class<?>[]{Server.class},(p,m,a)->switch(m.getName()){case "isPrimaryThread"->main.get();case "getLogger"->Logger.getAnonymousLogger();case "getName","getVersion","getBukkitVersion"->"isolated-test";default->empty(m.getReturnType());});Bukkit.setServer(server);
  UUID id=UUID.randomUUID();Player player=(Player)Proxy.newProxyInstance(Player.class.getClassLoader(),new Class<?>[]{Player.class},(p,m,a)->m.getName().equals("getUniqueId")?id:empty(m.getReturnType()));
  Class<?> unsafeType=Class.forName("sun.misc.Unsafe");Field unsafeField=unsafeType.getDeclaredField("theUnsafe");unsafeField.setAccessible(true);Object unsafe=unsafeField.get(null);Reader reader=(Reader)unsafeType.getMethod("allocateInstance",Class.class).invoke(unsafe,Reader.class);
  Class<?> bookType=Class.forName("me.vekster.lightanticheat.qiandengji.AttributeSnapshots$Book");Constructor<?> ctor=bookType.getDeclaredConstructors()[0];ctor.setAccessible(true);Object book=ctor.newInstance(null,reader);
  Field booksField=AttributeSnapshots.class.getDeclaredField("BOOKS");booksField.setAccessible(true);((Map<Object,Object>)booksField.get(null)).put(reader,book);
  if(!reader.getAttributes(player).isEmpty()||reads.get()!=0)throw new AssertionError("async missing cache touched native state");
  main.set(true);Method capture=bookType.getDeclaredMethod("capture",Player.class);capture.setAccessible(true);capture.invoke(book,player);if(reads.get()!=1)throw new AssertionError("capture");live.put("MOVE_SPEED",.9);
  main.set(false);if(reader.getAttributes(player).get("MOVE_SPEED")!=.2||reads.get()!=1)throw new AssertionError("snapshot not independent");
  try{reader.getAttributes(player).put("bad",1d);throw new AssertionError("mutable snapshot");}catch(UnsupportedOperationException expected){}
  main.set(true);if(reader.getAttributes(player).get("MOVE_SPEED")!=.9||reads.get()!=2)throw new AssertionError("main-thread live read changed");
  main.set(false);Method quit=bookType.getDeclaredMethod("quit",PlayerQuitEvent.class);quit.setAccessible(true);quit.invoke(book,new PlayerQuitEvent(player,"quit"));if(!reader.getAttributes(player).isEmpty())throw new AssertionError("disconnected cache leaked");
  System.out.println("PASS 6 thread-boundary, immutable snapshot and cleanup checks");
 }
}
