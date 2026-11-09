package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import javax.sound.sampled.*;

/** Immutable, verified original Chinese recordings, used by the configured companion only. */
final class MaidVoiceClips {
    record Clip(String text,short[] samples,String sourceSha256){}
    private final Map<String,List<Clip>> events=new HashMap<>();
    private final Map<String,Integer> offsets=new HashMap<>();
    private final String pack;
    MaidVoiceClips(JsonObject config)throws Exception{
        Path root=Path.of(config.get("directory").getAsString());if(!root.isAbsolute())throw new IOException("Absolute original voice directory required");root=root.toRealPath();
        if(Files.size(root.resolve("catalog.json"))>512*1024)throw new IOException("Original voice catalog too large");
        byte[] bytes=Files.readAllBytes(root.resolve("catalog.json"));if(bytes.length>512*1024||!hash(bytes).equals(config.get("sha256").getAsString()))throw new IOException("Original voice catalog changed");
        JsonObject catalog=JsonParser.parseString(new String(bytes,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
        if(catalog.get("schemaVersion").getAsInt()!=1||!catalog.get("format").getAsString().equals("maid-original-chinese-voice-clips"))throw new IOException("Original voice catalog schema");
        pack=catalog.get("packId").getAsString();if(!pack.matches("[a-z0-9_.-]{1,64}"))throw new IOException("Original voice pack identity");
        long total=0;int count=0;
        for(var entry:catalog.getAsJsonObject("events").entrySet()){
            if(!entry.getKey().matches("touhou_little_maid:maid\\.[a-z_]+\\.[a-z_]+")||MaidSpeechLines.forSound(entry.getKey())==null||events.size()>=64)throw new IOException("Original native event unsupported");
            List<Clip> clips=new ArrayList<>();
            for(JsonElement element:entry.getValue().getAsJsonArray()){
                JsonObject row=element.getAsJsonObject();String text=row.get("text").getAsString();
                if(text.isBlank()||text.length()>200||text.codePoints().anyMatch(Character::isISOControl)||++count>128)throw new IOException("Original caption invalid");
                String file=row.get("file").getAsString();if(!file.matches("pcm/[a-z0-9_]+\\.wav"))throw new IOException("Original audio path invalid");
                Path path=root.resolve(file).toRealPath();if(!path.startsWith(root)||Files.isSymbolicLink(path))throw new IOException("Original audio path escaped");
                if(Files.size(path)>2_900_000)throw new IOException("Original audio exceeds bound");
                byte[] wav;try(var input=Files.newInputStream(path)){wav=input.readNBytes(2_900_001);}
                total+=wav.length;if(wav.length>2_900_000||total>32*1024*1024||!hash(wav).equals(row.get("sha256").getAsString())||!row.get("originalSha256").getAsString().matches("[a-f0-9]{64}"))throw new IOException("Original audio changed or exceeds bound");
                try(var audio=AudioSystem.getAudioInputStream(new ByteArrayInputStream(wav))){
                    AudioFormat f=audio.getFormat();if(f.getChannels()!=1||f.getSampleRate()!=48000||f.getSampleSizeInBits()!=16||f.isBigEndian()||!f.getEncoding().equals(AudioFormat.Encoding.PCM_SIGNED))throw new IOException("Original PCM normalization required");
                    byte[] pcm=audio.readNBytes(2_880_001);if(pcm.length<19200||pcm.length>2_880_000||pcm.length%2!=0)throw new IOException("Original PCM duration invalid");
                    short[] samples=new short[pcm.length/2];ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples);
                    clips.add(new Clip(text,samples,row.get("originalSha256").getAsString()));
                }
            }
            if(clips.isEmpty())throw new IOException("Original audio event empty");events.put(entry.getKey(),List.copyOf(clips));
        }
        if(events.isEmpty())throw new IOException("Original voice pack empty");
    }
    private static String hash(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    String pack(){return pack;}
    Clip next(String event){List<Clip> rows=events.get(event);if(rows==null)return null;int at=offsets.getOrDefault(event,0);offsets.put(event,(at+1)%rows.size());return rows.get(at);}
}
