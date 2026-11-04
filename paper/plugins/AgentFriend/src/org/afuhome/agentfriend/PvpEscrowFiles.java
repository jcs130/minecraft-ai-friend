package org.afuhome.agentfriend;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.zip.GZIPInputStream;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.YamlConfiguration;

final class PvpEscrowFiles {
    private PvpEscrowFiles() {}

    static YamlConfiguration read(Path path) throws IOException {
        var data = new YamlConfiguration();
        try {
            data.loadFromString(Files.readString(path, StandardCharsets.UTF_8));
        } catch (NoSuchFileException missing) {
            return data;
        } catch (InvalidConfigurationException invalid) {
            throw new IOException("Unreadable PvP escrow", invalid);
        }
        // loadConfiguration silently returns an empty store on invalid YAML.
        // An on-disk file must have the players map, even after its last removal.
        if (!data.getKeys(false).equals(java.util.Set.of("players")) || !data.isConfigurationSection("players"))
            throw new IOException("Invalid PvP escrow root");
        return data;
    }

    static void replace(Path path, YamlConfiguration data) throws IOException {
        Files.createDirectories(path.getParent());
        if (!data.isConfigurationSection("players")) data.createSection("players");
        Path temp = path.resolveSibling("pvp-escrow.yml.tmp");
        Files.writeString(temp, data.saveToString(), StandardCharsets.UTF_8);
        force(temp);
        // Never fall back to a non-atomic replace of the only inventory copy.
        Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    static void confirmPlayerSave(Path file, String key, String nonce) throws IOException {
        // CraftPlayer.saveData() is void; the server can log and swallow I/O
        // failures. A fresh, unpredictable string tag can only be present in
        // this player's newly serialized image, after applying the snapshot.
        var tag = new ByteArrayOutputStream();
        try (var nbt = new DataOutputStream(tag)) {
            nbt.writeByte(8); // TAG_String
            nbt.writeUTF(key);
            nbt.writeUTF(nonce);
        }
        // Decode through EOF so a partial gzip file cannot prove completion.
        final int limit = 32 * 1024 * 1024;
        byte[] image;
        try (InputStream in = new GZIPInputStream(Files.newInputStream(file))) {
            image = in.readNBytes(limit + 1);
        }
        if (image.length > limit || new String(image, StandardCharsets.ISO_8859_1)
                .indexOf(tag.toString(StandardCharsets.ISO_8859_1)) < 0)
            throw new IOException("Restored player image was not saved");
        force(file);
    }

    private static void force(Path file) throws IOException {
        try (FileChannel channel = FileChannel.open(file, StandardOpenOption.WRITE)) {
            channel.force(true);
        }
    }
}
