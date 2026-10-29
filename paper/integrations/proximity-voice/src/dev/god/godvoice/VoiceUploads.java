package dev.god.godvoice;

import java.io.ByteArrayOutputStream;
import java.security.MessageDigest;
import java.util.*;

/** Authenticated Minecraft connection owns each upload; no UUID is accepted from its body. */
final class VoiceUploads {
    static final int MAX_BYTES=4*1024*1024, MAX_TOTAL=16*1024*1024, CHUNK=16*1024;
    record Key(UUID actor,UUID request) { }
    private static final class Upload {
        final UUID session;final int bytes;final String digest,format;final long expires;
        final ByteArrayOutputStream buffer=new ByteArrayOutputStream();int sequence;
        Upload(UUID s,int b,String d,String f,long t){session=s;bytes=b;digest=d;format=f;expires=t+60_000;}
    }
    private final Map<Key,Upload> pending=new HashMap<>();
    synchronized String begin(Key key,UUID session,int bytes,String digest,String format,long now) {
        expire(now);
        if(bytes<=0||bytes>MAX_BYTES||digest==null||!digest.matches("[0-9a-f]{64}")||!"wav".equals(format))throw new IllegalArgumentException("AUDIO_FORMAT_OR_SIZE_INVALID");
        Upload old=pending.get(key);
        if(old!=null){if(!old.session.equals(session)||old.bytes!=bytes||!old.digest.equals(digest)||!old.format.equals(format))throw new IllegalArgumentException("REQUEST_ID_REUSED");return "uploading";}
        if(pending.size()>=8||pending.values().stream().mapToInt(x->x.bytes).sum()+bytes>MAX_TOTAL||pending.keySet().stream().anyMatch(k->k.actor.equals(key.actor)))throw new IllegalArgumentException("UPLOAD_QUEUE_FULL");
        pending.put(key,new Upload(session,bytes,digest,format,now));return "uploading";
    }
    synchronized int chunk(Key key,UUID session,int sequence,byte[] data,long now) {
        Upload upload=get(key,session,now);
        if(sequence!=upload.sequence||data.length==0||data.length>CHUNK||upload.buffer.size()+data.length>upload.bytes)throw new IllegalArgumentException("UPLOAD_CHUNK_INVALID");
        upload.buffer.writeBytes(data);upload.sequence++;return upload.buffer.size();
    }
    record Audio(byte[] bytes,String format) { }
    synchronized Audio finish(Key key,UUID session,long now) {
        Upload upload=get(key,session,now);
        if(upload.buffer.size()!=upload.bytes)throw new IllegalArgumentException("UPLOAD_INCOMPLETE");
        byte[] data=upload.buffer.toByteArray();
        try {
            if(!HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)).equals(upload.digest))throw new IllegalArgumentException("UPLOAD_DIGEST_MISMATCH");
        }catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
        pending.remove(key);return new Audio(data,upload.format);
    }
    synchronized void disconnect(UUID actor){pending.keySet().removeIf(k->k.actor.equals(actor));}
    synchronized void expire(long now){pending.values().removeIf(v->now>v.expires);}
    private Upload get(Key key,UUID session,long now){Upload upload=pending.get(key);if(upload==null||!upload.session.equals(session)||now>upload.expires){pending.remove(key);throw new IllegalArgumentException("UPLOAD_EXPIRED_OR_SESSION_CHANGED");}return upload;}
}
