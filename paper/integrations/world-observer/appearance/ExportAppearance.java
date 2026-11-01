package org.afuhome.appearance;

import java.nio.file.*;

/** Read-only export using the exact same converter as the live appearance bridge.
 * stdout contains the original compressed bundle, never private configuration. */
public final class ExportAppearance {
    public static void main(String[] args) throws Exception {
        if((args.length!=3&&args.length!=4) || !ModelCatalog.validId(args[1]) || !args[2].matches("[0-9a-f]{64}"))throw new IllegalArgumentException("YSM_EXPORT_ARGUMENTS");
        var asset=ModelCatalog.exportSource(Path.of(args[0]),args[1],args.length==4?args[3]:"2.4.1");
        if(!asset.sha256().equals(args[2]))throw new IllegalArgumentException("YSM_EXPORT_STATE_HASH_MISMATCH");
        System.out.write(asset.gzip());
    }
}
