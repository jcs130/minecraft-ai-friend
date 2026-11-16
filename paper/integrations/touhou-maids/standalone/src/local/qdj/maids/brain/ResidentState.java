package local.qdj.maids.brain;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** The controller's durable locator and in-flight fence are separate from asynchronous world saves. */
final class ResidentState {
    record Row(UUID maidId,String dimension,int chunkX,int chunkZ,UUID pending){}
    private final Path root;
    private final Map<UUID,Row> rows=new HashMap<>();
    ResidentState(Path root){this.root=root;}
    Row load(UUID id)throws IOException{
        if(rows.containsKey(id))return rows.get(id);
        var file=root.resolve(id+".json");if(!Files.exists(file))return null;
        if(Files.size(file)>4096)throw new IOException("oversized_resident_state");
        var row=new Gson().fromJson(Files.readString(file),Row.class);
        if(row==null||!id.equals(row.maidId)||row.dimension==null||!row.dimension.matches("[a-z0-9_.-]+:[a-z0-9_./-]+"))throw new IOException("resident_state_identity_mismatch");
        rows.put(id,row);return row;
    }
    void locate(UUID id,String dimension,int x,int z)throws IOException{
        var old=load(id);put(new Row(id,dimension,x,z,old==null?null:old.pending));
    }
    void begin(UUID id,UUID request)throws IOException{
        var old=load(id);if(old==null)throw new IOException("resident_location_not_recorded");
        if(old.pending!=null)throw new IllegalArgumentException("unknown_previous_request:"+old.pending);
        put(new Row(id,old.dimension,old.chunkX,old.chunkZ,request));
    }
    void finish(UUID id,UUID request)throws IOException{
        var old=load(id);if(old==null||!request.equals(old.pending))throw new IOException("resident_pending_identity_mismatch");
        put(new Row(id,old.dimension,old.chunkX,old.chunkZ,null));
    }
    private void put(Row row)throws IOException{
        if(Objects.equals(rows.get(row.maidId),row))return;
        ResidentReceipts.replace(root.resolve(row.maidId+".json"),row);rows.put(row.maidId,row);
    }
}
