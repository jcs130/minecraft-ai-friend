package org.qiandengji.vortex.tests;

import com.google.gson.Gson;
import java.util.*;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scoreboard.*;

/** Read-only inspection of a marked, isolated client; never install on production. */
public final class CompactSidebarFixture extends JavaPlugin {
    @Override public void onEnable() {
        if (!getServer().getIp().equals("127.0.0.1") || getServer().getPort() != 25984)
            throw new IllegalStateException("Isolated compatibility fixture only");
        Objects.requireNonNull(getCommand("compactqa")).setExecutor((sender, command, label, args) -> {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return false;
            Player player = Bukkit.getPlayerExact("ag_SidebarQA");
            if (player == null) { sender.sendMessage("COMPACT_QA offline"); return true; }
            Objective objective = player.getScoreboard().getObjective("vortexrpg");
            if (objective == null) { sender.sendMessage("COMPACT_QA waiting"); return true; }
            var plain = PlainTextComponentSerializer.plainText();
            var lines = new TreeMap<Integer, String>(Comparator.reverseOrder());
            for (String entry : player.getScoreboard().getEntries()) {
                Score score = objective.getScore(entry);
                if (!score.isScoreSet()) continue;
                Team team = player.getScoreboard().getEntryTeam(entry);
                lines.put(score.getScore(), team == null ? entry : plain.serialize(team.prefix()) + plain.serialize(team.suffix()));
            }
            var result = new LinkedHashMap<String, Object>();
            result.put("title", plain.serialize(objective.displayName()));
            result.put("numberFormat", objective.numberFormat() == null ? null : objective.numberFormat().getClass().getSimpleName());
            result.put("lines", lines.values());
            result.put("health", player.getHealth());
            sender.sendMessage("COMPACT_QA " + new Gson().toJson(result));
            return true;
        });
    }
}
