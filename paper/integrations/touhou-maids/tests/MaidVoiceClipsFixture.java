package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.nio.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.function.Consumer;

public final class MaidVoiceClipsFixture {
    static int checks;static Path root;static JsonObject original;
    static String sha(byte[] b)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));}
    static JsonObject config(JsonObject value)throws Exception{byte[] b=value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);Files.write(root.resolve("catalog.json"),b);JsonObject c=new JsonObject();c.addProperty("directory",root.toString());c.addProperty("sha256",sha(b));return c;}
    static void check(boolean ok,String label){checks++;if(!ok)throw new AssertionError(label);}
    static JsonObject row(JsonObject c){return c.getAsJsonObject("events").getAsJsonArray("touhou_little_maid:maid.mode.idle").get(0).getAsJsonObject();}
    static void rejected(String label,Consumer<JsonObject> change)throws Exception{JsonObject c=original.deepCopy();change.accept(c);boolean rejected=false;try{new MaidVoiceClips(config(c));}catch(Exception e){rejected=true;}check(rejected,label);}
    public static void main(String[] args)throws Exception{
        root=Files.createTempDirectory("maid-voice-test-").toRealPath();Files.createDirectory(root.resolve("pcm"));
        ByteBuffer wave=ByteBuffer.allocate(44+96000).order(ByteOrder.LITTLE_ENDIAN);wave.put("RIFF".getBytes()).putInt(36+96000).put("WAVEfmt ".getBytes()).putInt(16).putShort((short)1).putShort((short)1).putInt(48000).putInt(96000).putShort((short)2).putShort((short)16).put("data".getBytes()).putInt(96000);
        Files.write(root.resolve("pcm/first.wav"),wave.array());String digest=sha(wave.array());
        original=JsonParser.parseString("{\"schemaVersion\":1,\"format\":\"maid-original-chinese-voice-clips\",\"packId\":\"synthetic_qa\",\"events\":{\"touhou_little_maid:maid.mode.idle\":[{\"text\":\"first\",\"file\":\"pcm/first.wav\",\"sha256\":\""+digest+"\",\"originalSha256\":\""+digest+"\"},{\"text\":\"second\",\"file\":\"pcm/first.wav\",\"sha256\":\""+digest+"\",\"originalSha256\":\""+digest+"\"}]}}").getAsJsonObject();
        var c=new MaidVoiceClips(config(original));check(c.next("touhou_little_maid:maid.mode.idle").text().equals("first"),"first original clip selected");check(c.next("touhou_little_maid:maid.mode.idle").text().equals("second"),"next event rotates original clip");check(c.next("touhou_little_maid:maid.mode.idle").samples().length==48000,"PCM samples decoded");check(c.next("minecraft:entity.villager.ambient")==null,"no arbitrary foreign event");
        rejected("hash mismatch rejects modified audio",j->row(j).addProperty("sha256","0".repeat(64)));
        rejected("path escape rejected before access",j->row(j).addProperty("file","../outside.wav"));
        rejected("control characters not published",j->row(j).addProperty("text","bad\ncaption"));
        rejected("empty original event rejected",j->j.getAsJsonObject("events").add("touhou_little_maid:maid.mode.idle",new JsonArray()));
        rejected("death is not a new speech trigger",j->{var e=j.getAsJsonObject("events");e.add("touhou_little_maid:maid.ai.death",e.remove("touhou_little_maid:maid.mode.idle"));});
        rejected("original source digest is explicit",j->row(j).addProperty("originalSha256","unverified"));
        JsonObject bad=config(original);bad.addProperty("sha256","0".repeat(64));boolean denied=false;try{new MaidVoiceClips(bad);}catch(Exception e){denied=true;}check(denied,"catalog preimage must match");
        // Only our exact temporary tree; never follow or delete outside it.
        if(!root.getParent().equals(Path.of(System.getProperty("java.io.tmpdir")).toRealPath())||!root.getFileName().toString().startsWith("maid-voice-test-"))throw new AssertionError("Unexpected fixture root");
        try(var paths=Files.walk(root)){for(Path p:paths.sorted(Comparator.reverseOrder()).toList()){if(!p.startsWith(root))throw new AssertionError("Fixture escape");Files.delete(p);}}
        System.out.println("Original voice clip checks passed: "+checks);
    }
}
