package dev.maw.client;

import com.google.gson.Gson;
import java.nio.file.Path;

/** Local offline CLI, intentionally absent from the HTTP RPC and Agent catalog. */
public final class ActionStoreAudit {
    public static void main(String[] args)throws Exception {
        if(args.length!=6||!args[5].equals("--release-new-actions-keep-unknown"))
            throw new IllegalArgumentException("root bodyId server actionId evidence --release-new-actions-keep-unknown required");
        System.out.println(new Gson().toJson(ActionStore.auditReleaseOffline(Path.of(args[0]),args[1],args[2],args[3],Path.of(args[4]))));
    }
}
