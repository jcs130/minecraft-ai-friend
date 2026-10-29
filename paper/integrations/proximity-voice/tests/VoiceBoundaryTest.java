package dev.god.godvoice;

import java.util.*;
import java.security.MessageDigest;

public final class VoiceBoundaryTest {
    static int checks;
    static void check(boolean value){if(!value)throw new AssertionError("check "+checks);checks++;}
    static void reject(Runnable action){try{action.run();}catch(IllegalArgumentException correct){checks++;return;}throw new AssertionError("accepted invalid operation");}
    static VoiceAudience.Actor actor(UUID id,UUID session,UUID world,double x){return new VoiceAudience.Actor(id,session,world,x,0,0,"actor",true);}
    public static void main(String[] args)throws Exception {
        UUID speaker=UUID.randomUUID(),near=UUID.randomUUID(),late=UUID.randomUUID(),world=UUID.randomUUID(),session=UUID.randomUUID();
        var source=actor(speaker,session,world,0);var listener=actor(near,session,world,10);var lateListener=actor(late,session,world,12);
        var window=new VoiceAudience.Window();
        window.observe(new VoiceAudience.Snapshot(1000,Map.of(speaker,source,near,listener)),speaker,24,1000);
        window.observe(new VoiceAudience.Snapshot(1020,Map.of(speaker,source,near,listener,late,lateListener)),speaker,24,1020);
        check(window.finish().keySet().equals(Set.of(near)));
        check(VoiceAudience.deliverable(window.finish(),world,new VoiceAudience.Snapshot(1100,Map.of(near,listener,late,lateListener))).equals(Set.of(near)));
        check(VoiceAudience.deliverable(window.finish(),world,new VoiceAudience.Snapshot(1100,Map.of(near,actor(near,UUID.randomUUID(),world,10)))).isEmpty());
        check(VoiceAudience.deliverable(window.finish(),world,new VoiceAudience.Snapshot(1100,Map.of(near,actor(near,session,UUID.randomUUID(),10)))).isEmpty());
        var stale=new VoiceAudience.Window();stale.observe(new VoiceAudience.Snapshot(100,Map.of(speaker,source,near,listener)),speaker,48,1000);check(stale.finish().isEmpty());
        var whisper=new VoiceAudience.Window();whisper.observe(new VoiceAudience.Snapshot(1000,Map.of(speaker,source,near,listener)),speaker,5,1000);check(whisper.finish().isEmpty());
        var leaving=new VoiceAudience.Window();leaving.observe(new VoiceAudience.Snapshot(1000,Map.of(speaker,source,near,listener)),speaker,24,1000);leaving.observe(new VoiceAudience.Snapshot(1020,Map.of(speaker,source)),speaker,24,1020);check(leaving.finish().isEmpty());
        var changedWorld=new VoiceAudience.Window();changedWorld.observe(new VoiceAudience.Snapshot(1000,Map.of(speaker,source,near,listener)),speaker,24,1000);changedWorld.observe(new VoiceAudience.Snapshot(1020,Map.of(speaker,actor(speaker,session,UUID.randomUUID(),0),near,listener)),speaker,24,1020);check(changedWorld.finish().isEmpty());
        var uploads=new VoiceUploads();var key=new VoiceUploads.Key(speaker,UUID.randomUUID());byte[] data={1,2,3};String sha=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        check(uploads.begin(key,session,3,sha,"wav",1000).equals("uploading"));
        check(uploads.begin(key,session,3,sha,"wav",1001).equals("uploading"));
        reject(()->uploads.chunk(key,session,1,data,1002));
        check(uploads.chunk(key,session,0,data,1003)==3);check(Arrays.equals(uploads.finish(key,session,1004).bytes(),data));
        reject(()->uploads.finish(key,session,1005));
        uploads.begin(key,session,3,sha,"wav",2000);reject(()->uploads.chunk(key,UUID.randomUUID(),0,data,2001));
        uploads.begin(key,session,3,sha,"wav",3000);reject(()->uploads.chunk(key,session,0,data,64_000));
        uploads.begin(key,session,3,sha,"wav",70_000);uploads.disconnect(speaker);reject(()->uploads.chunk(key,session,0,data,70_001));
        reject(()->uploads.begin(key,session,VoiceUploads.MAX_BYTES+1,sha,"wav",80_000));
        reject(()->uploads.begin(key,session,3,sha,"webm",80_000));
        System.out.println("Voice boundaries: "+checks+" checks passed");
    }
}
