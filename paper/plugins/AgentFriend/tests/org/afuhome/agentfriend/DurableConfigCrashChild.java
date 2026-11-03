package org.afuhome.agentfriend;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
public final class DurableConfigCrashChild {
    public static void main(String[] args)throws Exception {
        Path target=Path.of(args[0]);
        try(var state=new DurableConfigFiles(target)){
            byte[] loaded=state.initialize(Files.readAllBytes(target),1);
            if(state.revision()!=3)throw new AssertionError("committed revision was not recovered before use");
            state.commit("revision: 4\nreward: one\n".getBytes(StandardCharsets.UTF_8),4);
            if(!state.pending())throw new AssertionError("external reader must still deny publication");
            System.out.println("DURABLE_BEFORE_ABRUPT_EXIT revision=4");System.out.flush();
            Runtime.getRuntime().halt(0);
        }
    }
}
