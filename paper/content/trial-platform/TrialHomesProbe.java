package org.qiandengji.villagerquests;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.TileState;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.type.Door;
import org.bukkit.block.sign.Side;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

/** Applies the candidate only in a marked disposable world with a loopback listener. */
public final class TrialHomesProbe extends JavaPlugin {
    private record Position(int x, int y, int z) {
        static Position read(JsonObject row) {
            var p = row.getAsJsonArray("at");
            return read(p);
        }
        static Position read(JsonArray p) {
            return new Position(p.get(0).getAsInt(), p.get(1).getAsInt(), p.get(2).getAsInt());
        }
        Block block(World world) {
            return world.getBlockAt(x, y, z);
        }
        String command() { return x + " " + y + " " + z; }
    }
    private record SignContents(boolean waxed, List<String> front, List<String> back,
                                boolean frontGlowing, boolean backGlowing, String frontColor, String backColor) {}

    @Override public void onEnable() {
        Bukkit.getScheduler().runTask(this, () -> {
            try {
                probe();
                getLogger().info("TRIAL_PLATFORM_HOMES_PASS");
            } catch (Exception error) {
                getLogger().log(java.util.logging.Level.SEVERE, "TRIAL_PLATFORM_HOMES_FAIL", error);
                Bukkit.shutdown();
            }
        });
    }

    private void probe() throws Exception {
        Path root = Path.of("").toAbsolutePath();
        require("127.0.0.1".equals(Bukkit.getIp()), "fixture listener");
        require("ISOLATED_TRIAL_PLATFORM_HOMES".equals(Files.readString(root.resolve(".trial-platform-qa")).strip()),
                "fixture marker");
        Path proofPath = root.resolve("trial-platform-geometry-proof.json");
        require(!Files.exists(proofPath), "probe already applied");
        var plan = JsonParser.parseString(Files.readString(root.resolve("blocks.json"))).getAsJsonObject();
        require(plan.get("schema").getAsInt() == 1 && "world".equals(plan.get("world").getAsString()), "plan schema");
        World world = Bukkit.getWorld("world");
        require(world != null, "world");
        var cfg = YamlConfiguration.loadConfiguration(root.resolve("trial-households.yml").toFile());
        var homes = NativeVillageHomes.load(cfg.getConfigurationSection("households"));
        require(homes.size() == 1, "household count");
        var changes = plan.getAsJsonArray("changes");
        var checks = plan.getAsJsonArray("checks");
        Map<Position, BlockData> before = new LinkedHashMap<>();
        for (var element : changes) {
            var row = element.getAsJsonObject();
            Position position = Position.read(row);
            require(position.x >= -578 && position.x <= -570 && position.y >= 75 &&
                    position.y <= 101 && position.z >= -309 && position.z <= -302, "placement bounds");
            Block block = position.block(world);
            require(!(block.getState() instanceof TileState), "block entity at " + position);
            require(before.putIfAbsent(position, block.getBlockData()) == null, "duplicate position " + position);
            match(block, row.get("before").getAsString());
            Bukkit.createBlockData(row.get("after").getAsString());
        }
        checkPreserved(world, checks);
        for (var home : homes.values()) require(!NativeVillageHomes.ready(home), "house already active");
        var edited = new JsonArray();
        boolean verified = false;
        try {
            for (var element : changes) {
                var row = element.getAsJsonObject();
                Position.read(row).block(world).setBlockData(Bukkit.createBlockData(row.get("after").getAsString()), false);
            }
            checkPreserved(world, checks);
            for (var home : homes.values()) {
                require(NativeVillageHomes.ready(home), "unusable registered home " + home.address());
                require(reachable(world, new Position(-579, 91, -303),
                        new Position(home.spawn().getBlockX(), 91, home.spawn().getBlockZ())),
                        "walk interrupted to " + home.address());
            }
            for (var element : changes) {
                var row = element.getAsJsonObject().deepCopy();
                Block block = Position.read(row).block(world);
                match(block, row.get("after").getAsString());
                row.addProperty("after", block.getBlockData().getAsString());
                edited.add(row);
            }
            var proof = new JsonObject();
            proof.addProperty("verifiedHomes", homes.size());
            proof.addProperty("unchangedAnchors", checks.size());
            proof.add("validatedBlockChanges", edited);
            Path entrance = root.resolve("entrance.json");
            if (Files.exists(entrance)) {
                var entrancePlan = JsonParser.parseString(Files.readString(entrance)).getAsJsonObject();
                proof.add("entrance", probeEntrance(world, entrancePlan));
            }
            Files.writeString(proofPath, proof.toString());
            verified = true;
        } finally {
            if (!verified) before.forEach((position, blockData) -> position.block(world).setBlockData(blockData, false));
        }
    }

    private JsonObject probeEntrance(World world, JsonObject plan) {
        require(plan.get("schema").getAsInt() == 1 && "world".equals(plan.get("world").getAsString()), "entrance plan");
        var checks = plan.getAsJsonArray("checks");
        checkPreserved(world, checks);
        var changes = plan.getAsJsonArray("changes");
        var signs = plan.getAsJsonArray("signMoves");
        var originalSigns = new LinkedHashMap<Position, SignContents>();
        require(changes.size() == 7 && signs.size() == 2, "entrance footprint");
        for (var element : changes) {
            var row = element.getAsJsonObject();
            var at = Position.read(row);
            require(at.x >= -591 && at.x <= -589 && at.y >= 91 && at.y <= 93 && at.z == -317, "gate bounds");
            require("minecraft:air".equals(row.get("after").getAsString()), "gate removes blocks");
            match(at.block(world), row.get("before").getAsString());
        }
        for (var element : signs) {
            var row = element.getAsJsonObject();
            var from = Position.read(row.getAsJsonArray("source"));
            var to = Position.read(row.getAsJsonArray("destination"));
            require(from.y == 92 && to.y == 92 && from.z == to.z &&
                    ((from.x == -591 && to.x == -592 && to.z == -318) ||
                     (from.x == -589 && to.x == -588 && to.z == -316)), "sign move bounds");
            match(from.block(world), row.get("state").getAsString());
            match(to.block(world), "minecraft:air");
            var expected = row.getAsJsonArray("front");
            var contents = signContents(from.block(world));
            require(contents.waxed == row.get("waxed").getAsBoolean() && expected.size() == 4, "sign metadata");
            for (int index = 0; index < expected.size(); index++) {
                require(expected.get(index).getAsString().equals(ChatColor.stripColor(contents.front.get(index))),
                        "sign text at " + from);
            }
            originalSigns.put(from, contents);
        }
        for (var element : signs) {
            var row = element.getAsJsonObject();
            var from = Position.read(row.getAsJsonArray("source"));
            var to = Position.read(row.getAsJsonArray("destination"));
            require(Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "minecraft:execute in minecraft:overworld run clone " +
                    from.command() + " " + from.command() + " " + to.command() + " replace move"), "clone command");
            match(to.block(world), row.get("state").getAsString());
            match(from.block(world), "minecraft:air");
            require(signContents(to.block(world)).equals(originalSigns.get(from)), "relocated sign contents");
        }
        for (var element : changes) Position.read(element.getAsJsonObject()).block(world).setType(Material.AIR, false);
        checkPreserved(world, checks);
        for (int x = -591; x <= -589; x++) for (int y = 91; y <= 93; y++) {
            match(world.getBlockAt(x, y, -317), "minecraft:air");
        }
        var landing = new Position(-590, 91, -314);
        require(reachable(world, new Position(-590, 91, -319), landing, -596, -588, -321, -306), "walk in from bridge");
        for (int z : List.of(-313, -310, -307)) {
            require(world.getBlockAt(-596, 92, z).getType() == Material.STONE_BUTTON, "missing difficulty control");
            require(reachable(world, landing, new Position(-595, 91, z), -596, -588, -321, -306),
                    "walk to difficulty control");
        }
        var evidence = new JsonObject();
        evidence.addProperty("clearWidth", 3);
        evidence.addProperty("clearHeight", 3);
        evidence.addProperty("preservedSigns", signs.size());
        evidence.addProperty("reachableButtons", 3);
        return evidence;
    }

    private static SignContents signContents(Block block) {
        require(block.getState() instanceof Sign, "missing sign at " + block.getLocation());
        var sign = (Sign) block.getState();
        var front = sign.getSide(Side.FRONT);
        var back = sign.getSide(Side.BACK);
        return new SignContents(sign.isWaxed(), Arrays.asList(front.getLines()), Arrays.asList(back.getLines()),
                front.isGlowingText(), back.isGlowingText(), front.getColor().name(), back.getColor().name());
    }

    private static boolean reachable(World world, Position start, Position end) {
        return reachable(world, start, end, -579, -570, -309, -302);
    }
    private static boolean reachable(World world, Position start, Position end, int minX, int maxX, int minZ, int maxZ) {
        var queue = new ArrayDeque<Position>();
        var seen = new HashSet<Position>();
        queue.add(start);
        while (!queue.isEmpty()) {
            Position p = queue.removeFirst();
            if (!seen.add(p) || p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ) continue;
            Block feet = p.block(world);
            Block head = world.getBlockAt(p.x, p.y + 1, p.z);
            if (!world.getBlockAt(p.x, p.y - 1, p.z).getType().isOccluding() ||
                    !walkable(feet) || !walkable(head)) continue;
            if (p.equals(end)) return true;
            queue.addAll(List.of(new Position(p.x - 1, p.y, p.z), new Position(p.x + 1, p.y, p.z),
                    new Position(p.x, p.y, p.z - 1), new Position(p.x, p.y, p.z + 1)));
        }
        return false;
    }

    private static boolean walkable(Block block) {
        return block.getType() == Material.AIR || block.getType() == Material.CAVE_AIR || block.getBlockData() instanceof Door;
    }

    private static void checkPreserved(World world, JsonArray checks) {
        for (var element : checks) {
            var row = element.getAsJsonObject();
            match(Position.read(row).block(world), row.get("state").getAsString());
        }
    }

    private static void match(Block block, String state) {
        require(block.getBlockData().matches(Bukkit.createBlockData(state)),
                "unexpected block " + block.getX() + "," + block.getY() + "," + block.getZ() +
                        " expected " + state + " got " + block.getBlockData().getAsString());
    }

    private static void require(boolean condition, String reason) {
        if (!condition) throw new IllegalStateException(reason);
    }
}
