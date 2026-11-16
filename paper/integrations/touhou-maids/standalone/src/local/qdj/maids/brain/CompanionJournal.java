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
    /** A dialogue and its native action can share a request ID, but never an immutable evidence file. */
    void action(UUID maid, UUID request, Map<String,Object> outcome) throws IOException {
        UUID evidence = UUID.nameUUIDFromBytes(("resident-action:" + maid + ":" + request).getBytes(StandardCharsets.UTF_8));
        var row = new java.util.LinkedHashMap<String,Object>();
        row.put("schemaVersion",1); row.put("id",evidence.toString()); row.put("maidId",maid.toString());
        row.put("speakerId",maid.toString()); row.put("channel","internal"); row.put("at",System.currentTimeMillis());
        row.put("kind","resident_action"); row.put("sourceRequestId",request.toString());
        row.put("message","自己刚才实际执行的动作与结果"); row.put("reply",JSON.toJson(outcome)); row.put("status","recorded");
        append(maid,evidence,"result",row);
    }
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
        return recall(maid,speaker,true);
    }
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> recall(UUID maid, UUID speaker, boolean includePrivate) throws IOException {
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
                    .filter(row -> includePrivate || !"private".equals(row.get("channel")))
                    .limit(6).map(CompanionJournal::context).toList();
        }
    }
    private static Map<String,Object> context(Map<String,Object> row) {
        var shortRow = new java.util.LinkedHashMap<String,Object>();
        for (String key : List.of("id", "at", "speakerId", "message", "reply", "decision", "status", "reason", "channel", "kind", "sourceRequestId"))
            if (row.containsKey(key)) shortRow.put(key, row.get(key));
        if (row.get("receipt") instanceof Map<?,?> receipt) {
            var action = new java.util.LinkedHashMap<String,Object>();
            for (String key : List.of("action", "status", "reason", "completed"))
                if (receipt.containsKey(key)) action.put(key, receipt.get(key));
            shortRow.put("receipt", action);
        }
        return shortRow;
    }
    /** Read-only chatter must not immediately evict the NPC's verified work from planning context. */
    @SuppressWarnings("unchecked")
    List<Map<String,Object>> actionRecall(UUID maid)throws IOException {
        Path dir=root.resolve(maid.toString());if(!Files.isDirectory(dir))return List.of();
        var recent=new java.util.ArrayList<Map<String,Object>>();var effects=new java.util.ArrayList<Map<String,Object>>();
        try(var files=Files.list(dir)){
            for(Path file:files.filter(p->p.getFileName().toString().endsWith("-result.json"))
                    .sorted(Comparator.comparingLong(CompanionJournal::modified).reversed()).limit(64).toList()){
                if(Files.size(file)>32768)throw new IOException("oversized_memory");
                var row=(Map<String,Object>)JSON.fromJson(Files.readString(file,StandardCharsets.UTF_8),Map.class);
                if(!maid.toString().equals(row.get("maidId"))||!maid.toString().equals(row.get("speakerId"))
                    ||!"resident_action".equals(row.get("kind"))||"private".equals(row.get("channel")))continue;
                Map<String,Object> fact=context(row);
                if(recent.size()<4)recent.add(fact);
                try{var outcome=JSON.fromJson(String.valueOf(row.get("reply")),com.google.gson.JsonObject.class);
                    if(outcome.has("queryOnly")&&!outcome.get("queryOnly").getAsBoolean()
                        &&outcome.has("completed")&&outcome.get("completed").getAsBoolean()&&effects.size()<4)effects.add(fact);
                }catch(RuntimeException oldFormat){/* Old raw journals are retained, not upgraded by guessing. */}
                if(recent.size()==4&&effects.size()==4)break;
            }
        }
        var result=new java.util.LinkedHashMap<Object,Map<String,Object>>();
        for(var row:recent)result.put(row.get("id"),row);for(var row:effects)result.putIfAbsent(row.get("id"),row);
        return List.copyOf(result.values());
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
