package local.qdj.maids.brain;

import com.google.gson.Gson;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Write-ahead per-action records. A missing result after a restart remains unknown, never replayed. */
final class ResidentReceipts {
    private final Path directory;
    ResidentReceipts(Path directory) throws IOException { this.directory=directory; Files.createDirectories(directory); }
    Map<String,Object> read(UUID maid,UUID id) throws IOException {
        var file=directory.resolve(maid.toString()).resolve(id+".json");
        if(!Files.exists(file)) return null;
        if(Files.size(file)>65536)throw new IOException("oversized_resident_receipt");
        var json=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        if(!maid.toString().equals(json.get("maidId").getAsString())||!id.toString().equals(json.get("requestId").getAsString()))
            throw new IOException("receipt_identity_mismatch");
        @SuppressWarnings("unchecked") Map<String,Object> row=new Gson().fromJson(json,Map.class);
        return new LinkedHashMap<>(row);
    }
    void write(UUID maid,UUID id,Map<String,Object> row) throws IOException {
        if(!maid.toString().equals(row.get("maidId"))||!id.toString().equals(row.get("requestId")))throw new IOException("receipt_identity_mismatch");
        replace(directory.resolve(maid.toString()).resolve(id+".json"),row);
    }
    static void replace(Path target,Object row) throws IOException {
        var dir=target.getParent();Files.createDirectories(dir);var tmp=Files.createTempFile(dir,"receipt-",".tmp");
        try {
            byte[] bytes=new Gson().toJson(row).getBytes(java.nio.charset.StandardCharsets.UTF_8);
            if(bytes.length>65536)throw new IOException("oversized_resident_record");
            try(var ch=java.nio.channels.FileChannel.open(tmp,java.nio.file.StandardOpenOption.WRITE)) {
                var b=java.nio.ByteBuffer.wrap(bytes); while(b.hasRemaining()) ch.write(b); ch.force(true);
            }
            Files.move(tmp,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(tmp); }
    }
}
