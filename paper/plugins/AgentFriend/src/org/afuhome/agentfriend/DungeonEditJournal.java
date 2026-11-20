package org.afuhome.agentfriend;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.block.Container;
import org.bukkit.block.TileState;
import org.bukkit.block.structure.Mirror;
import org.bukkit.block.structure.StructureRotation;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.structure.Structure;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.BlockVector;
import org.bukkit.util.BoundingBox;

import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.zip.CRC32;

/** Original states are written before an edit. A saved run keeps its journal until the run actually ends. */
final class DungeonEditJournal {
    private static final int LIMIT = 8192, MAX_BYTES = 2 << 20, PER_TICK = 32;
    private final JavaPlugin plugin;
    private final Path root;
    private final Map<String, Domain> domains = new HashMap<>();
    private final BlockVector unit = new BlockVector(1, 1, 1);
    private final Random random = new Random();
    private long nextFlush;
    private int captureTick = -1, writesThisTick, nextDomain;

    private record Cell(UUID world, int x, int y, int z) {
        String file() { return world + "_" + x + "_" + y + "_" + z + ".block"; }
        static Cell parse(String name) throws IOException {
            String[] parts = name.replaceFirst("\\.block$", "").split("_");
            if (parts.length != 4) throw new IOException("Invalid coordinate filename");
            Cell cell = new Cell(UUID.fromString(parts[0]), Integer.parseInt(parts[1]),
                    Integer.parseInt(parts[2]), Integer.parseInt(parts[3]));
            if (!cell.file().equals(name)) throw new IOException("Noncanonical coordinate filename");
            return cell;
        }
    }

    private static final class Domain {
        final Path dir;
        final Set<Cell> recorded = new LinkedHashSet<>();
        final Set<World> changed = new HashSet<>();
        Deque<Cell> pending;
        BooleanSupplier safe;
        boolean failed;
        Domain(Path dir) { this.dir = dir; }
    }

    DungeonEditJournal(JavaPlugin plugin) {
        this.plugin = plugin;
        root = plugin.getDataFolder().toPath().resolve("dungeon-edit-journal-v1");
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> cleanRetired());
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 2, 2);
    }

    private Domain domain(String id) {
        if (!id.matches("(?:tower|(?:site|wild)-[a-z0-9_-]{1,90})"))
            throw new IllegalArgumentException("Invalid dungeon journal domain");
        return domains.computeIfAbsent(id, key -> {
            Domain d = new Domain(root.resolve(key));
            try (DirectoryStream<Path> files = Files.newDirectoryStream(d.dir)) {
                for (Path f : files) {
                    String name = f.getFileName().toString();
                    if (name.equals(".writing")) continue; // interrupted before authorizing an edit
                    Cell cell = Cell.parse(name);
                    read(f, cell);
                    d.recorded.add(cell);
                }
            } catch (NoSuchFileException missing) {
                // No changes have been authorized for this domain yet.
                if (Files.isDirectory(d.dir)) fail(d, missing);
            } catch (Exception failure) {
                fail(d, failure);
            }
            return d;
        });
    }

    boolean ready(String id) {
        Domain d = domain(id);
        return !d.failed && d.pending == null;
    }

    boolean dirty(String id) {
        Domain d = domain(id);
        return d.failed || !d.recorded.isEmpty();
    }

    boolean failed(String id) { return domain(id).failed; }

    List<Location> editedLocations(String id) {
        return domain(id).recorded.stream()
            .map(c -> new Location(Bukkit.getWorld(c.world), c.x, c.y, c.z)).toList();
    }

    boolean capture(String id, BlockState state) {
        Domain d = domain(id);
        if (!ready(id) || !state.isPlaced()) return false;
        Cell cell = new Cell(state.getWorld().getUID(), state.getX(), state.getY(), state.getZ());
        if (d.recorded.contains(cell)) return true;
        if (d.recorded.size() >= LIMIT) return false;
        int now = Bukkit.getCurrentTick();
        if (captureTick != now) { captureTick = now; writesThisTick = 0; }
        if (++writesThisTick > PER_TICK) return false;
        try {
            byte[] nbt = new byte[0];
            if (state instanceof TileState) {
                // Break/open still see the original tile. A placement replacing a tile must be denied by the caller.
                if (!state.getBlockData().equals(state.getBlock().getBlockData())) return false;
                Structure snapshot = Bukkit.getStructureManager().createStructure();
                snapshot.fill(state.getLocation(), unit, false);
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                Bukkit.getStructureManager().saveStructure(bytes, snapshot);
                nbt = bytes.toByteArray();
            }
            byte[] record = encode(cell.file(), state.getBlockData().getAsString(), nbt);
            Files.createDirectories(d.dir);
            Path temp = d.dir.resolve(".writing");
            Files.write(temp, record);
            try (FileChannel channel = FileChannel.open(temp, StandardOpenOption.WRITE)) { channel.force(true); }
            Files.move(temp, d.dir.resolve(cell.file()), StandardCopyOption.ATOMIC_MOVE);
            d.recorded.add(cell);
            return true;
        } catch (Exception failure) {
            fail(d, failure);
            return false;
        }
    }

    static byte[] encode(String key, String data, byte[] nbt) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeUTF(key);
        out.writeUTF(data);
        out.writeInt(nbt.length);
        out.write(nbt);
        if (bytes.size() > MAX_BYTES - 8) throw new IOException("Block snapshot too large");
        CRC32 crc = new CRC32();
        crc.update(bytes.toByteArray());
        out.writeLong(crc.getValue());
        return bytes.toByteArray();
    }

    record Original(String data, byte[] nbt) {}
    static Original decode(String key, byte[] record) throws IOException {
        if (record.length < 12 || record.length > MAX_BYTES) throw new IOException("Invalid record size");
        CRC32 crc = new CRC32();
        crc.update(record, 0, record.length - 8);
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(record));
        if (!in.readUTF().equals(key)) throw new IOException("Coordinate mismatch");
        String data = in.readUTF();
        int len = in.readInt();
        if (len < 0 || len != in.available() - 8) throw new IOException("Invalid block entity length");
        byte[] nbt = in.readNBytes(len);
        if (crc.getValue() != in.readLong()) throw new IOException("Block snapshot checksum mismatch");
        return new Original(data, nbt);
    }

    private static Original read(Path file, Cell cell) throws IOException {
        if (Files.size(file) > MAX_BYTES) throw new IOException("Oversized dungeon record");
        return decode(cell.file(), Files.readAllBytes(file));
    }

    boolean restore(String id) { return restore(id, () -> true); }

    boolean restore(String id, BooleanSupplier safe) {
        Domain d = domain(id);
        if (d.failed) return false;
        if (d.recorded.isEmpty()) return true;
        if (d.pending == null) {
            d.pending = new ArrayDeque<>(d.recorded);
            d.safe = safe;
        }
        return false;
    }

    private void tick() {
        long until = System.nanoTime() + 3_000_000L;
        int budget = PER_TICK;
        List<Domain> active = domains.values().stream().filter(d -> d.pending != null && !d.failed).toList();
        if (active.isEmpty()) return;
        int first = Math.floorMod(nextDomain, active.size());
        for (int i = 0; i < active.size(); i++) {
            Domain d = active.get((first + i) % active.size());
            nextDomain = (first + i + 1) % active.size();
            if (d.pending == null || d.failed) continue;
            try {
                if (!d.safe.getAsBoolean()) continue;
                int slice = Math.min(8, d.pending.size());
                while (slice-- > 0 && budget > 0 && System.nanoTime() < until) {
                    Cell cell = d.pending.removeFirst();
                    if (!restoreCell(d, cell)) d.pending.addLast(cell);
                    budget--;
                }
            } catch (Exception failure) {
                fail(d, failure);
            }
            if (budget == 0 || System.nanoTime() >= until) break;
        }
        checkpoint();
    }

    private boolean restoreCell(Domain d, Cell cell) throws IOException {
        World world = Bukkit.getWorld(cell.world);
        if (world == null) return false;
        BoundingBox occupied = new BoundingBox(cell.x, cell.y, cell.z, cell.x + 1, cell.y + 1.05, cell.z + 1);
        if (world.getPlayers().stream().anyMatch(p -> p.getBoundingBox().overlaps(occupied))) return false;
        if (!world.isChunkLoaded(cell.x >> 4, cell.z >> 4)) {
            world.getChunkAtAsync(cell.x >> 4, cell.z >> 4, false);
            return false;
        }
        Block block = world.getBlockAt(cell.x, cell.y, cell.z);
        Original state = read(d.dir.resolve(cell.file()), cell);
        var data = Bukkit.createBlockData(state.data());
        Structure structure = null;
        if (state.nbt().length > 0) {
            structure = Bukkit.getStructureManager().loadStructure(new ByteArrayInputStream(state.nbt()));
            if (!structure.getSize().equals(unit) || structure.getEntityCount() != 0 || structure.getPaletteCount() != 1)
                throw new IOException("Invalid tile snapshot");
        }
        if (block.getState() instanceof Container container) {
            if (!container.getInventory().getViewers().isEmpty()) return false;
            // Clear only this half of a double chest. Structure placement itself can otherwise drop the current inventory.
            if (container instanceof org.bukkit.block.Chest chest) chest.getBlockInventory().clear();
            else container.getInventory().clear();
        }
        if (structure == null) block.setBlockData(data, false);
        else structure.place(block.getLocation(), false, StructureRotation.NONE, Mirror.NONE, 0, 1f, random);
        if (!data.matches(block.getBlockData())) throw new IOException("Block restoration mismatch " + cell.file());
        d.changed.add(world);
        return true;
    }

    private void checkpoint() {
        long now = System.nanoTime();
        if (now < nextFlush) return;
        List<Domain> completed = domains.values().stream().filter(d -> !d.failed && d.pending != null && d.pending.isEmpty()).toList();
        if (completed.isEmpty()) return;
        nextFlush = now + 30_000_000_000L;
        // CraftWorld.save() uses flush=false on this server. Flush restored chunks
        // on the touched dimension before releasing its journal to the next run.
        Set<World> worlds = new HashSet<>();
        completed.forEach(d -> worlds.addAll(d.changed));
        try {
            for (World world : worlds) ((CraftWorld) world).getHandle().getChunkSource().save(true);
        } catch (RuntimeException | LinkageError failure) {
            completed.forEach(d -> fail(d, new IOException("Chunk checkpoint failed", failure)));
            return;
        }
        for (Domain d : completed) try { finish(d); } catch (IOException failure) { fail(d, failure); }
    }

    private void finish(Domain d) throws IOException {
        Path retired = root.resolve(".retired-" + UUID.randomUUID());
        Files.move(d.dir, retired, StandardCopyOption.ATOMIC_MOVE);
        d.recorded.clear();
        d.changed.clear();
        d.pending = null;
        d.safe = null;
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> cleanRetired(retired));
    }

    private void cleanRetired() {
        if (!Files.isDirectory(root)) return;
        try (DirectoryStream<Path> files = Files.newDirectoryStream(root, ".retired-*")) {
            for (Path dir : files) cleanRetired(dir);
        } catch (IOException failure) {
            plugin.getLogger().warning("Could not enumerate saved dungeon journals: " + failure);
        }
    }

    private void cleanRetired(Path dir) {
        try {
            String name = dir.getFileName().toString();
            if (!dir.getParent().equals(root) || !name.equals(".retired-" + UUID.fromString(name.substring(9)))
                || !Files.isDirectory(dir, LinkOption.NOFOLLOW_LINKS)) return;
            try (DirectoryStream<Path> files = Files.newDirectoryStream(dir)) {
                for (Path file : files) {
                    String leaf = file.getFileName().toString();
                    if (!leaf.equals(".writing")) Cell.parse(leaf);
                    if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Unexpected journal entry");
                    Files.deleteIfExists(file);
                }
            }
            Files.deleteIfExists(dir);
        } catch (NoSuchFileException done) {
            // Cleanup after a durable save is idempotent.
        } catch (Exception failure) {
            plugin.getLogger().warning("Could not retire saved dungeon journal: " + failure);
        }
    }

    private void fail(Domain domain, Exception failure) {
        domain.failed = true;
        plugin.getLogger().severe("Dungeon edits locked for " + domain.dir.getFileName() + ": " + failure);
    }
}
