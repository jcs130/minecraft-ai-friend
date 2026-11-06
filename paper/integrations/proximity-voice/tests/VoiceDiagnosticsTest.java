package dev.god.godvoice;

import java.net.ConnectException;
import java.net.http.HttpTimeoutException;
import java.nio.file.*;
import java.util.*;

public final class VoiceDiagnosticsTest {
    private static int checks;
    private static void check(boolean value){if(!value)throw new AssertionError("diagnostic check "+checks);checks++;}
    public static void main(String[] args)throws Exception{
        check(VoiceDiagnostics.preparationFailure("prepare",new ConnectException("private address")).equals("VOICE_MEDIA_UNREACHABLE"));
        check(VoiceDiagnostics.preparationFailure("prepare",new HttpTimeoutException("private URL")).equals("VOICE_MEDIA_TIMEOUT"));
        check(VoiceDiagnostics.preparationFailure("prepare",new InterruptedException()).equals("VOICE_PREPARATION_INTERRUPTED"));
        check(VoiceDiagnostics.preparationFailure("decode",new java.io.IOException("raw response")).equals("VOICE_NORMALIZED_AUDIO_INVALID"));
        check(VoiceDiagnostics.preparationFailure("prepare",new VoiceDiagnostics.BackendFailure("VOICE_MEDIA_AUTH_REJECTED")).equals("VOICE_MEDIA_AUTH_REJECTED"));
        check(VoiceDiagnostics.preparationFailure("prepare",new IllegalStateException("secret")).equals("VOICE_AUDIO_PREPARATION_FAILED"));
        check(VoiceDiagnostics.connection(false,false,false,false,false,false).equals("VOICE_SERVER_STARTING"));
        check(VoiceDiagnostics.connection(true,false,false,false,true,false).equals("VOICE_CLIENT_NOT_INSTALLED"));
        check(VoiceDiagnostics.connection(true,true,false,false,true,false).equals("VOICE_CLIENT_NOT_CONNECTED"));
        check(VoiceDiagnostics.connection(true,true,true,true,true,false).equals("VOICE_CLIENT_DISABLED"));
        check(VoiceDiagnostics.connection(true,true,true,false,false,false).equals("VOICE_LISTEN_PERMISSION_MISSING"));
        check(VoiceDiagnostics.connection(true,true,true,false,true,true).equals("VOICE_ISOLATED_GROUP"));
        check(VoiceDiagnostics.connection(true,true,true,false,true,false).equals("VOICE_RECEIVER_READY"));
        check(VoiceDiagnostics.hint("VOICE_CLIENT_DISABLED").contains("首次设置"));
        check(VoiceDiagnostics.hint("VOICE_CLIENT_DISABLED").contains("麦克风可以保持静音"));
        var delivery=new VoiceDelivery();
        check(VoiceDelivery.completionReason(delivery.summary()).equals("VOICE_NO_RECEIVER_CHECK_STATUS"));
        UUID listener=UUID.randomUUID();delivery.offered(listener);delivery.offered(listener);delivery.offered(null);
        check(delivery.summary().packetOffers()==2&&delivery.summary().listenerCount()==1);
        check(VoiceDelivery.completionReason(delivery.summary()).equals("VOICE_SENT_HEARING_UNVERIFIED"));
        for(int i=0;i<256;i++)delivery.offered(UUID.randomUUID());
        check(delivery.summary().listenerCount()==128&&delivery.summary().listenersTruncated());
        Path root=Files.createTempDirectory("voice-delivery-test-");
        try{
            UUID actor=UUID.randomUUID(),id=UUID.randomUUID();var ledger=new VoiceLedger(root);
            ledger.reserve(actor,id,"synthetic");ledger.transition(actor,id,"synthetic","sent","VOICE_SENT_HEARING_UNVERIFIED",delivery.summary());
            var restored=new VoiceLedger(root);check(restored.get(actor,id).delivery().equals(delivery.summary()));
            check(!restored.reserve(actor,id,"synthetic"));check(restored.get(UUID.randomUUID(),id)==null);
            String line=Files.readString(root.resolve(actor+".jsonl"));check(!line.contains(listener.toString())&&line.length()<2048);
            UUID old=UUID.randomUUID();restored.reserve(actor,old,"old");restored.transition(actor,old,"old","failed","VOICE_AUDIO_UNAVAILABLE_QUERY_STATUS");
            byte[] before=Files.readAllBytes(root.resolve(actor+".jsonl"));var legacy=new VoiceLedger(root);
            check(legacy.get(actor,old).delivery()==null);check(Arrays.equals(before,Files.readAllBytes(root.resolve(actor+".jsonl"))));
            check(!legacy.reserve(actor,old,"old"));
        }finally{try(var files=Files.list(root)){for(Path file:files.toList())Files.delete(file);}Files.delete(root);}
        System.out.println("Voice delivery/diagnostics: "+checks+" checks passed");
    }
}
