package dev.god.godvoice;

import java.nio.ByteBuffer;
import java.security.*;
import java.util.*;

/** Rejection metadata only: bounded rate/CPU, no audio, text, credentials or IPs. */
final class VoiceUploadTrace {
    private long window;private int emitted,suppressed;
    synchronized Map<String,Object> rejection(UUID actor,UUID session,UUID request,byte[] frame,
            VoiceUploads.Snapshot before,String code,boolean registered,boolean currentPlayer,long now) {
        if(now-window>=60_000||now<window){window=now;emitted=0;}
        if(emitted>=16){suppressed=Math.min(1_000_000,suppressed+1);return null;}emitted++;
        var row=new LinkedHashMap<String,Object>();
        row.put("schema",1);row.put("event","upload_chunk_rejected");row.put("at",now);
        row.put("actor",actor);row.put("session",session);row.put("requestId",request);
        row.put("channel","mcagent:voice");row.put("frameBytes",frame.length);
        row.put("sequence",frame.length>=21?ByteBuffer.wrap(frame,17,4).getInt():null);
        row.put("chunkBytes",Math.max(0,frame.length-21));row.put("before",before);
        row.put("registered",registered);row.put("currentPlayer",currentPlayer);
        row.put("code",code!=null&&code.matches("[A-Z0-9_]{1,80}")?code:"VOICE_PROTOCOL_INVALID");
        // Bound hashing even for malformed envelopes. Never log raw content.
        if(frame.length<=65_536)try{row.put("frameSha256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(frame)));}catch(NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
        row.put("suppressedSincePrevious",suppressed);suppressed=0;
        return row;
    }
}
