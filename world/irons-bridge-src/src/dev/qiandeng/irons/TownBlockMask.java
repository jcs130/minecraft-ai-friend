package dev.qiandeng.irons;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Set;

/** Immutable reviewed voxels. Newly placed player blocks are never enrolled. */
public final class TownBlockMask {
    private final Set<Long> blocks;
    public final boolean ready;
    public final String sha256;
    private TownBlockMask(Set<Long> blocks, boolean ready, String sha256) {
        this.blocks = Set.copyOf(blocks); this.ready = ready; this.sha256 = sha256;
    }
    public static TownBlockMask load() {
        try (InputStream in = TownBlockMask.class.getResourceAsStream("/qiandeng-town-blocks.json")) {
            if (in == null) throw new IllegalArgumentException("missing mask");
            byte[] raw = in.readNBytes(8_000_001);
            if (raw.length > 8_000_000) throw new IllegalArgumentException("large mask");
            return parse(raw);
        } catch (Exception error) { return new TownBlockMask(Set.of(), false, "unavailable"); }
    }
    public static TownBlockMask parse(byte[] raw) throws Exception {
        JsonObject doc = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
        if (integer(doc.get("schema")) != 1 || !TownProtectionPolicy.DIMENSION.equals(doc.get("dimension").getAsString()))
            throw new IllegalArgumentException("invalid schema");
        var runs = doc.getAsJsonArray("runs");
        if (runs.isEmpty() || runs.size() > 200_000) throw new IllegalArgumentException("invalid runs");
        Set<Long> cells = new HashSet<>();
        for (var value : runs) {
            var row = value.getAsJsonArray();
            if (row.size() != 4) throw new IllegalArgumentException("invalid run");
            int lo = integer(row.get(0)), hi = integer(row.get(1)), y = integer(row.get(2)), z = integer(row.get(3));
            if (lo > hi || y < -64 || y > 319 || !TownProtectionPolicy.contains(TownProtectionPolicy.DIMENSION, lo, z)
                    || !TownProtectionPolicy.contains(TownProtectionPolicy.DIMENSION, hi, z)) throw new IllegalArgumentException("out of bounds");
            for (int x = lo; x <= hi; x++) if (!cells.add(key(x,y,z))) throw new IllegalArgumentException("duplicate block");
            if (cells.size() > 1_000_000) throw new IllegalArgumentException("too many blocks");
        }
        if (integer(doc.get("blocks")) != cells.size()) throw new IllegalArgumentException("incomplete mask");
        return new TownBlockMask(cells, true, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw)));
    }
    private static int integer(com.google.gson.JsonElement value) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException("not integer");
        return value.getAsBigDecimal().intValueExact();
    }
    private static long key(int x,int y,int z) { return ((long)x & 0x3ffffffL) << 38 | ((long)z & 0x3ffffffL) << 12 | (y & 0xfffL); }
    public int size() { return blocks.size(); }
    public boolean protects(String dimension, int x, int y, int z) {
        return TownProtectionPolicy.contains(dimension,x,z) && (!ready || blocks.contains(key(x,y,z)));
    }
}
