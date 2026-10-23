package org.afuhome.appearance;

import java.nio.file.*;
import java.util.*;

/** Read-only export using the exact same converter as the live appearance bridge.
 * stdout contains the original compressed bundle, never private configuration. */
public final class ExportAppearance {
    public static void main(String[] args) throws Exception {
        if(args.length!=3 || !ModelCatalog.validId(args[1]))throw new IllegalArgumentException("YSM_EXPORT_ARGUMENTS");
        Path base=Path.of(args[0]).toRealPath(),root=base.resolve(args[1]).normalize();
        if(!root.startsWith(base) || !root.toRealPath().equals(root))throw new IllegalArgumentException("YSM_EXPORT_PATH");
        Map<String,byte[]> files=new TreeMap<>();long size=0;
        try(var walk=Files.walk(root,8)){
            for(Path p:walk.limit(257).toList()){
                if(Files.isSymbolicLink(p))throw new IllegalArgumentException("YSM_SYMLINK_REJECTED");
                if(!Files.isRegularFile(p))continue;
                if(files.size()>=256 || (size+=Files.size(p))>ModelCatalog.RAW_LIMIT)throw new IllegalArgumentException("YSM_EXPORT_BUDGET");
                files.put(root.relativize(p).toString().replace('\\','/'),Files.readAllBytes(p));
            }
        }
        var asset=ModelCatalog.convert(args[1],files);
        if(!asset.sha256().equals(args[2]))throw new IllegalArgumentException("YSM_EXPORT_STATE_HASH_MISMATCH");
        System.out.write(asset.gzip());
    }
}
