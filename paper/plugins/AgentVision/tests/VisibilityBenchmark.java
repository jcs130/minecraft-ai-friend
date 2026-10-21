package org.afuhome.agentvision.tests;

import com.dwinovo.numen.scan.NearbyEntities;
import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Pig;
import org.bukkit.plugin.java.JavaPlugin;

/** Test-only, real-server benchmark. Never install on a public or production port. */
public final class VisibilityBenchmark extends JavaPlugin {
    @Override public void onEnable() {
        if (getServer().getPort() == 25565 || !getServer().getIp().equals("127.0.0.1"))
            throw new IllegalStateException("VisibilityBenchmark requires an isolated loopback server");
        getServer().getCommandMap().register("visiontest", new Command("agentvisionbench") {
            @Override public boolean execute(CommandSender sender, String label, String[] args) {
                if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return false;
                runBenchmark(sender);
                return true;
            }
        });
    }

    private void runBenchmark(CommandSender sender) {
        var viewers = Bukkit.getOnlinePlayers().stream().filter(p -> p.getName().startsWith("ag_VLoad"))
                .map(p -> ((CraftPlayer) p).getHandle()).toList();
        var targets = Bukkit.getWorlds().getFirst().getEntitiesByClass(Pig.class).stream()
                .filter(p -> p.getScoreboardTags().contains("vision_qa"))
                .map(p -> ((CraftEntity) p).getHandle()).toList();
        if (viewers.size() != 16 || targets.size() != 32)
            throw new IllegalStateException("Expected 16 test viewers and 32 tagged pigs");
        var bean = (com.sun.management.ThreadMXBean) ManagementFactory.getThreadMXBean();
        if (!bean.isThreadAllocatedMemorySupported()) throw new IllegalStateException("Allocation counters unavailable");
        bean.setThreadAllocatedMemoryEnabled(true);
        long thread = Thread.currentThread().threadId();
        int pairs = viewers.size() * targets.size();
        for (int round = 0; round < 128; round++)
            for (var viewer : viewers) for (var target : targets) NearbyEntities.visibleTo(viewer, target);
        var before = NearbyEntities.work();
        List<Double> nanos = new ArrayList<>(), allocated = new ArrayList<>();
        int visiblePairs = 0;
        for (int trial = 0; trial < 9; trial++) {
            long bytes = bean.getThreadAllocatedBytes(thread), start = System.nanoTime();
            int visible = 0;
            for (int round = 0; round < 32; round++)
                for (var viewer : viewers) for (var target : targets)
                    if (NearbyEntities.visibleTo(viewer, target)) visible++;
            long elapsed = System.nanoTime() - start;
            allocated.add((bean.getThreadAllocatedBytes(thread) - bytes) / (double) (pairs * 32));
            nanos.add(elapsed / (double) (pairs * 32));
            if (trial > 0 && visible != visiblePairs * 32)
                throw new IllegalStateException("Visibility changed during read-only benchmark");
            visiblePairs = visible / 32;
        }
        var after = NearbyEntities.work();
        sender.sendMessage("MC_VISION_BENCH {\"pairs\":" + pairs + ",\"visiblePairs\":" + visiblePairs
                + ",\"nsPerQuery\":" + nanos + ",\"bytesPerQuery\":" + allocated
                + ",\"worldRays\":" + (after.worldRays() - before.worldRays())
                + ",\"shapeSkips\":" + (after.shapeSkips() - before.shapeSkips()) + "}");
    }
}
