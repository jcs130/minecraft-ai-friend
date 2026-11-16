package local.qdj.maids.brain;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Immutable, per-NPC conversation evidence; independent of inference process and model choice. */
final class CompanionJournal {
    private static final Gson JSON = new Gson();
    private final Path root;
    CompanionJournal(Path root) { this.root = root; }
    void append(UUID maid, UUID conversation, String phase, Map<String, Object> row) throws IOException {
        Path dir = root.resolve(maid.toString()); Files.createDirectories(dir);
        byte[] bytes = JSON.toJson(row).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 32768) throw new IOException("conversation_too_large");
        Path target = dir.resolve(conversation + "-" + phase + ".json");
        if (Files.exists(target)) throw new IOException("conversation_already_recorded");
        Path temp = Files.createTempFile(dir, "conversation-", ".tmp");
        try {
            try (var channel = FileChannel.open(temp, StandardOpenOption.WRITE)) {
                var buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
        } finally { Files.deleteIfExists(temp); }
    }
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> recall(UUID maid, UUID speaker) throws IOException {
        Path dir = root.resolve(maid.toString());
        if (!Files.isDirectory(dir)) return List.of();
        // Keep disk reads bounded; the original files are never evicted or rewritten.
        try (var files = Files.list(dir)) {
            return files.filter(p -> p.getFileName().toString().endsWith("-result.json"))
                    .sorted(Comparator.comparingLong(CompanionJournal::modified).reversed()).limit(64)
                    .map(p -> {
                        try {
                            if (Files.size(p) > 32768) throw new IOException("oversized_memory");
                            return (Map<String,Object>)JSON.fromJson(Files.readString(p, StandardCharsets.UTF_8), Map.class);
                        } catch (IOException ex) { throw new java.io.UncheckedIOException(ex); }
                    }).filter(row -> maid.toString().equals(row.get("maidId")) && speaker.toString().equals(row.get("speakerId")))
                    .limit(6).map(CompanionJournal::context).toList();
        }
    }
    private static Map<String,Object> context(Map<String,Object> row) {
        var shortRow = new java.util.LinkedHashMap<String,Object>();
        for (String key : List.of("id", "at", "speakerId", "message", "reply", "decision", "status", "reason"))
            if (row.containsKey(key)) shortRow.put(key, row.get(key));
        if (row.get("receipt") instanceof Map<?,?> receipt) {
            var action = new java.util.LinkedHashMap<String,Object>();
            for (String key : List.of("action", "status", "reason", "completed"))
                if (receipt.containsKey(key)) action.put(key, receipt.get(key));
            shortRow.put("receipt", action);
        }
        return shortRow;
    }
    private static long modified(Path p) {
        try { return Files.getLastModifiedTime(p).toMillis(); }
        catch (IOException ex) { throw new java.io.UncheckedIOException(ex); }
    }
    @SuppressWarnings("unchecked")
    Map<String,Object> latest(UUID maid, UUID speaker) throws IOException {
        Path dir = root.resolve(maid.toString());
        if (!Files.isDirectory(dir)) return null;
        try (var files = Files.list(dir)) {
            var paths = files.filter(p -> p.getFileName().toString().matches("[a-f0-9-]{36}-(request|result)\\.json"))
                    .sorted(Comparator.comparingLong(CompanionJournal::modified).reversed()).limit(128).toList();
            for (Path file : paths) {
                if (Files.size(file) > 32768) throw new IOException("oversized_memory");
                var row = (Map<String,Object>)JSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), Map.class);
                if (!maid.toString().equals(row.get("maidId")) || !speaker.toString().equals(row.get("speakerId"))) continue;
                if (file.getFileName().toString().endsWith("-request.json")) {
                    var terminal = dir.resolve(row.get("id") + "-result.json");
                    if (Files.isRegularFile(terminal) && Files.size(terminal) <= 32768)
                        return (Map<String,Object>)JSON.fromJson(Files.readString(terminal, StandardCharsets.UTF_8), Map.class);
                    row.put("status", "unknown"); row.put("reason", "interrupted_no_automatic_replay");
                }
                return row;
            }
            return null;
        }
    }
    Object longTerm(UUID maid, UUID speaker) throws IOException {
        Path file = root.resolve(maid.toString()).resolve("recall-" + speaker + ".json");
        if (!Files.exists(file)) return List.of();
        if (Files.size(file) > 32768) return List.of();
        var data = JSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), com.google.gson.JsonObject.class);
        if (!maid.toString().equals(data.get("maidId").getAsString()) ||
                !speaker.toString().equals(data.get("speakerId").getAsString()) ||
                !data.get("historical").getAsBoolean()) throw new IOException("memory_scope_mismatch");
        return data;
    }
}
