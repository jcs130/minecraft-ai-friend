package dev.god.godvoice;

import java.security.MessageDigest;
import java.util.*;

/** Reproduce failed uploads without connecting a player, TTS or a live server. */
public final class VoiceUploadFailureTest {
    static int checks;
    static void check(boolean value){if(!value)throw new AssertionError("check "+checks);checks++;}
    static void reject(String expected,Runnable action){try{action.run();}catch(IllegalArgumentException failure){check(expected.equals(failure.getMessage()));return;}throw new AssertionError("accepted invalid upload");}
    static String digest(byte[] data)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));}
    public static void main(String[] args)throws Exception {
        UUID actor=UUID.randomUUID(),session=UUID.randomUUID(),other=UUID.randomUUID();
        byte[] data={1,2,3};String sha=digest(data);var uploads=new VoiceUploads();
        var first=new VoiceUploads.Key(actor,UUID.randomUUID());
        uploads.begin(first,session,3,sha,"wav",1000);uploads.chunk(first,session,0,new byte[]{1},1001);
        reject("UPLOAD_INCOMPLETE",()->uploads.finish(first,session,1002));
        var second=new VoiceUploads.Key(actor,UUID.randomUUID());
        check(uploads.begin(second,session,3,sha,"wav",1003).equals("uploading"));
        uploads.chunk(second,session,0,data,1004);check(Arrays.equals(uploads.finish(second,session,1005).bytes(),data));
        reject("UPLOAD_EXPIRED_OR_SESSION_CHANGED",()->uploads.finish(first,session,1006));

        uploads.begin(first,session,3,sha,"wav",2000);uploads.chunk(first,session,0,new byte[]{3,2,1},2001);
        reject("UPLOAD_DIGEST_MISMATCH",()->uploads.finish(first,session,2002));
        check(uploads.begin(second,session,3,sha,"wav",2003).equals("uploading"));
        // A delayed old connection must not discard the current connection's upload.
        uploads.discard(second,other);
        reject("UPLOAD_EXPIRED_OR_SESSION_CHANGED",()->uploads.chunk(second,other,0,data,2004));
        uploads.chunk(second,session,0,data,2005);check(Arrays.equals(uploads.finish(second,session,2006).bytes(),data));

        uploads.begin(first,session,3,sha,"wav",3000);
        reject("UPLOAD_CHUNK_INVALID",()->uploads.chunk(first,session,1,data,3001));
        // The plugin calls this after publishing a correlated terminal rejection.
        uploads.discard(first,session);
        check(uploads.begin(second,session,3,sha,"wav",3002).equals("uploading"));
        uploads.chunk(second,session,0,data,3003);check(Arrays.equals(uploads.finish(second,session,3004).bytes(),data));
        System.out.println("Voice upload failure recovery: "+checks+" checks passed");
    }
}
