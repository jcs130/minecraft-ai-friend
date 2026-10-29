package org.qiandengji.mcbot;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Requests are never re-executed when a response was lost or evicted. */
public final class Receipts {
    public enum State { NEW, RUNNING, COMPLETE, UNKNOWN, CONFLICT, FULL }
    public record Key(long task,int seq) {}
    public record Entry(String fingerprint,State state,byte[] response) {}
    private final Map<Key,Entry> entries=new LinkedHashMap<>();
    private final int maxEntries,maxBytes;
    private int bytes;
    public Receipts(int maxEntries,int maxBytes){this.maxEntries=maxEntries;this.maxBytes=maxBytes;}
    public State begin(Key key,String content){
        String hash=hash(content);Entry previous=entries.get(key);
        if(previous!=null)return previous.fingerprint().equals(hash)?previous.state():State.CONFLICT;
        if(entries.size()>=maxEntries)return State.FULL;
        entries.put(key,new Entry(hash,State.RUNNING,null));return State.NEW;
    }
    public void finish(Key key,byte[] response){
        Entry old=Objects.requireNonNull(entries.get(key));
        if(old.state()!=State.RUNNING)return;
        if(response.length+bytes<=maxBytes){entries.put(key,new Entry(old.fingerprint(),State.COMPLETE,response.clone()));bytes+=response.length;}
        else entries.put(key,new Entry(old.fingerprint(),State.UNKNOWN,null));
    }
    public byte[] response(Key key){Entry e=entries.get(key);return e!=null&&e.response()!=null?e.response().clone():null;}
    public void interrupt(long task){
        entries.replaceAll((k,v)->k.task()==task&&v.state()==State.RUNNING?new Entry(v.fingerprint(),State.UNKNOWN,null):v);
    }
    public int size(){return entries.size();}
    private static String hash(String s){
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));}
        catch(NoSuchAlgorithmException impossible){throw new AssertionError(impossible);}
    }
}
