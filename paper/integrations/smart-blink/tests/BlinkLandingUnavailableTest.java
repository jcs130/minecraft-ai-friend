package org.qiandengji.magic.tests;

import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.qiandengji.magic.BlinkLanding;

/** Missing terrain must stay missing: fail any attempt to read or generate a column. */
public final class BlinkLandingUnavailableTest {
    public static void main(String[] args) {
        AtomicInteger queries = new AtomicInteger();
        World world = (World)Proxy.newProxyInstance(World.class.getClassLoader(), new Class<?>[]{World.class}, (p, m, a) -> switch (m.getName()) {
            case "getMinHeight" -> -64;
            case "getMaxHeight" -> 320;
            case "isChunkLoaded" -> { queries.incrementAndGet(); yield false; }
            case "equals" -> p == a[0];
            case "hashCode" -> 1;
            default -> throw new AssertionError("Unloaded-world access: " + m.getName());
        });
        Player player = (Player)Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[]{Player.class}, (p, m, a) -> switch (m.getName()) {
            case "getWorld" -> world;
            case "getLocation" -> new Location(world, .5, 64, .5, -90, 0);
            case "getEyeLocation" -> new Location(world, .5, 65.62, .5, -90, 0);
            case "getWidth" -> .6;
            case "getHeight" -> 1.8;
            default -> throw new AssertionError("Unexpected actor access: " + m.getName());
        });
        BlinkLanding search = new BlinkLanding(player, 25);
        var selected = search.select();
        if (selected.found() || !selected.reason().equals("unloaded_path") || selected.blockReads() != 0) throw new AssertionError(selected);
        if (queries.get() > 4) throw new AssertionError("Unbounded empty-world scan");
        if (search.accepts(null) || search.accepts(new Location(world, 100, 64, .5))) throw new AssertionError("Invalid explicit location accepted");
        System.out.println("checks=4 passed=true unloadedBlockReads=0");
    }
}
