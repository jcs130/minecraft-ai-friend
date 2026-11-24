package org.qiandengji.villagerquests;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;

/** Durable, append-never receipts. An original request can never become a second execution. */
final class BodyReceiptLedger {
    enum Status { ACCEPTED, COMPLETED, FAILED, REJECTED, UNKNOWN }

    record Entry(String residentId, String bodyId, String controllerId, String generation, String operationId,
                 String action, Status status, boolean terminal, long observedAt, JsonElement data,
                 String fingerprint) {
        JsonObject toJson() {
            JsonObject row = new JsonObject();
            row.addProperty("schemaVersion", 1);
            row.addProperty("residentId", residentId);
            row.addProperty("bodyId", bodyId);
            row.addProperty("controllerId", controllerId);
            row.addProperty("generation", generation);
            row.addProperty("operationId", operationId);
            row.addProperty("action", action);
            row.addProperty("status", status.name().toLowerCase());
            row.addProperty("terminal", terminal);
            row.addProperty("observedAt", observedAt);
            row.addProperty("retryAllowed", false);
            row.addProperty("fingerprint", fingerprint);
            row.add("data", data == null ? new JsonObject() : data.deepCopy());
            return row;
        }

        Entry recoverAfterRestart() {
            if (terminal) return this;
            JsonObject recovered = new JsonObject();
            recovered.addProperty("interrupted", true);
            recovered.addProperty("reason", "server_restarted_before_terminal_observation");
            if (this.data != null && this.data.isJsonObject())
                this.data.getAsJsonObject().entrySet().forEach(entry -> recovered.add(entry.getKey(), entry.getValue()));
            return new Entry(residentId, bodyId, controllerId, generation, operationId, action, Status.UNKNOWN,
                    true, observedAt, recovered, fingerprint);
        }
    }

    private static final Gson GSON = new Gson();
    private static final int MAX_FILE_BYTES = 1_048_576;
    private final Path directory;
    private final Map<String, Entry> entries = new HashMap<>();

    BodyReceiptLedger(Path directory) {
        this.directory = directory;
    }

    synchronized void load() throws IOException {
        entries.clear();
        if (Files.notExists(directory)) return;
        try (var files = Files.list(directory)) {
            for (Path file : files.filter(path -> path.getFileName().toString().endsWith(".json")).toList()) {
                if (!Files.isRegularFile(file) || Files.size(file) > MAX_FILE_BYTES) continue;
                try {
                    Entry entry = parse(Files.readString(file, StandardCharsets.UTF_8));
                    if (entry == null) throw new IllegalArgumentException("receipt schema is not supported");
                    entries.put(entry.operationId(), entry.recoverAfterRestart());
                } catch (RuntimeException damaged) {
                    // Fail closed: without the original receipt, replaying this operation is unsafe.
                    throw new IOException("Damaged body receipt: " + file.getFileName(), damaged);
                }
            }
        }
    }

    synchronized Entry get(String operationId) {
        return entries.get(operationId);
    }

    /** Returns false if durable acknowledgement was not possible; callers must then report unknown and do nothing. */
    synchronized boolean put(Entry entry) throws IOException {
        Entry prior = entries.get(entry.operationId());
        if (prior != null) {
            boolean sameOrigin = prior.residentId().equals(entry.residentId()) && prior.bodyId().equals(entry.bodyId())
                    && prior.controllerId().equals(entry.controllerId()) && prior.generation().equals(entry.generation())
                    && prior.action().equals(entry.action()) && prior.fingerprint().equals(entry.fingerprint());
            if (!sameOrigin) throw new IOException("Original receipt identity/fingerprint cannot change");
            if (prior.terminal()) {
                if (prior.equals(entry)) return true;
                throw new IOException("Terminal receipt is immutable");
            }
        }
        byte[] bytes = GSON.toJson(entry.toJson()).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_FILE_BYTES) throw new IOException("Receipt exceeds size limit");
        Files.createDirectories(directory);
        Path temporary = Files.createTempFile(directory, "receipt-", ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temporary, file(entry.operationId()), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
        entries.put(entry.operationId(), entry);
        return true;
    }

    private Path file(String operationId) {
        try {
            return directory.resolve(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(operationId.getBytes(StandardCharsets.UTF_8))) + ".json");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static Entry parse(String json) {
        JsonObject row = JsonParser.parseString(json).getAsJsonObject();
        if (row.get("schemaVersion").getAsInt() != 1) return null;
        String id = row.get("operationId").getAsString();
        if (id.isBlank() || id.length() > 200) return null;
        Entry entry = new Entry(row.get("residentId").getAsString(), row.get("bodyId").getAsString(),
                row.get("controllerId").getAsString(), row.get("generation").getAsString(), id,
                row.get("action").getAsString(), Status.valueOf(row.get("status").getAsString().toUpperCase()),
                row.get("terminal").getAsBoolean(), row.get("observedAt").getAsLong(), row.get("data"),
                row.get("fingerprint").getAsString());
        if (row.get("retryAllowed").getAsBoolean()) throw new IllegalArgumentException("retryable receipt");
        return entry;
    }
}
