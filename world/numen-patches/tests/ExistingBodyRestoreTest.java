import com.dwinovo.numen.core.entity.ExistingBodyRestore;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.DoubleTag;
import java.util.UUID;

/** Validate the actual compiled save gate without spawning bodies or loading a world. */
public final class ExistingBodyRestoreTest {
    static int count;
    static void check(boolean value) { if (!value) throw new AssertionError("check " + count); count++; }
    public static void main(String[] args) {
        UUID body = UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
        UUID owner = UUID.fromString("e5005711-be9f-44b7-aaad-6993c0ba5df4");
        CompoundTag data = new CompoundTag();
        data.putUUID("UUID", body); data.putUUID("NumenOwner", owner);
        data.put("Inventory", new ListTag());
        ListTag position = new ListTag();
        position.add(DoubleTag.valueOf(100.5)); position.add(DoubleTag.valueOf(64.0)); position.add(DoubleTag.valueOf(-99.0));
        data.put("Pos", position); data.putFloat("Health", 17); data.putInt("playerGameType", 0);
        data.putString("Dimension", "minecraft:overworld");
        check(ExistingBodyRestore.savedDataError(data, body, owner, "minecraft:overworld") == null);
        check(ExistingBodyRestore.canonicalUuid(body.toString()).equals(body));
        try { ExistingBodyRestore.canonicalUuid("1-1-1-1-1"); throw new AssertionError(); }
        catch (IllegalArgumentException expected) { count++; }
        check(ExistingBodyRestore.savedDataError(data, owner, body, "minecraft:overworld").equals("playerdata_identity_mismatch"));
        CompoundTag copy = data.copy(); copy.remove("NumenOwner");
        check(ExistingBodyRestore.savedDataError(copy, body, owner, "minecraft:overworld").equals("playerdata_identity_mismatch"));
        copy = data.copy(); copy.remove("Inventory");
        check(ExistingBodyRestore.savedDataError(copy, body, owner, "minecraft:overworld").equals("playerdata_invalid"));
        copy = data.copy(); copy.put("Inventory", position.copy());
        check(ExistingBodyRestore.savedDataError(copy, body, owner, "minecraft:overworld").equals("playerdata_invalid"));
        copy = data.copy(); copy.putFloat("Health", 0);
        check(ExistingBodyRestore.savedDataError(copy, body, owner, "minecraft:overworld").equals("body_dead"));
        copy = data.copy(); copy.putFloat("Health", Float.NaN);
        check(ExistingBodyRestore.savedDataError(copy, body, owner, "minecraft:overworld").equals("body_dead"));
        copy = data.copy(); copy.putInt("playerGameType", 1);
        check(ExistingBodyRestore.savedDataError(copy, body, owner, "minecraft:overworld").equals("not_in_survival"));
        check(ExistingBodyRestore.savedDataError(data, body, owner, "minecraft:the_nether").equals("playerdata_dimension_mismatch"));
        copy = data.copy(); copy.getList("Pos", 6).set(1, DoubleTag.valueOf(Double.POSITIVE_INFINITY));
        check(ExistingBodyRestore.savedDataError(copy, body, owner, "minecraft:overworld").equals("playerdata_invalid"));
        for (int slot : new int[]{0, 8, 9, 35, 100, 103, 150}) check(ExistingBodyRestore.vanillaInventorySlot(slot));
        for (int slot : new int[]{-106, -1, 36, 99, 104, 151, 256}) check(!ExistingBodyRestore.vanillaInventorySlot(slot));
        System.out.println("{\"ok\":true,\"assertions\":"+count+",\"scope\":\"compiled saved identity/data gate; no world or body created\"}");
    }
}
