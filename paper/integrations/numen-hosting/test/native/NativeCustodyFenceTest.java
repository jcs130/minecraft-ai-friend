package local.hosting;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.UUID;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtIo;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

class NativeCustodyFenceTest {
    @TempDir Path root;
    private void checkpoint(UUID fileId, UUID entityId, String kind) throws IOException {
        var tag = new CompoundTag();
        tag.putUUID("UUID", entityId);
        tag.putString("id", kind);
        NbtIo.writeCompressed(tag, root.resolve(fileId + ".nbt"));
    }

    @Test void emptyWorldOffersNoHeldIds() throws IOException {
        assertEquals(Set.of(), NativeCustodyFence.readCheckpoints(root.resolve("absent")));
        assertEquals(Set.of(), NativeCustodyFence.readCheckpoints(root));
    }

    @Test void onlyExplicitArchivesOfNativeBodiesAreHeld() throws IOException {
        UUID maid = UUID.randomUUID();
        UUID villager = UUID.randomUUID();
        checkpoint(maid, maid, "touhou_little_maid:maid");
        checkpoint(villager, villager, "minecraft:villager");
        Files.writeString(root.resolve("not-yet-committed.tmp"), "partial");
        assertEquals(Set.of(maid, villager), NativeCustodyFence.readCheckpoints(root));
    }

    @Test void wrongUuidStopsAdmissionBeforeWorldLoad() throws IOException {
        checkpoint(UUID.randomUUID(), UUID.randomUUID(), "minecraft:villager");
        assertThrows(IOException.class, () -> NativeCustodyFence.readCheckpoints(root));
    }

    @Test void playerOrBrokenPayloadIsNeverAcceptedAsAnOriginalBody() throws IOException {
        UUID id = UUID.randomUUID();
        checkpoint(id, id, "minecraft:player");
        assertThrows(IOException.class, () -> NativeCustodyFence.readCheckpoints(root));
        Files.write(root.resolve(id + ".nbt"), new byte[]{0, 1});
        assertThrows(IOException.class, () -> NativeCustodyFence.readCheckpoints(root));
    }
}
