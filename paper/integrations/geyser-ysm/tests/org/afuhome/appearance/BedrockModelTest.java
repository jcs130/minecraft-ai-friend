package org.afuhome.appearance;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import java.io.*;
import javax.imageio.ImageIO;
import org.cloudburstmc.protocol.bedrock.codec.v975.Bedrock_v975;
import org.cloudburstmc.protocol.bedrock.data.skin.*;
import org.cloudburstmc.protocol.bedrock.packet.PlayerSkinPacket;
import io.netty.buffer.Unpooled;

/** Real upstream CC0 source and pinned Cloudburst wire codec, no simulated device rendering. */
public final class BedrockModelTest {
    static int checks;
    static void check(boolean value,String message) {if(!value)throw new AssertionError(message);checks++;System.out.println("PASS "+message);}
    static void reject(Throwing call,String reason) throws Exception {try {call.run();throw new AssertionError("accepted "+reason);}catch(IOException e) {check(reason.equals(e.getMessage()),reason);}}
    interface Throwing {void run() throws Exception;}
    static String sha256(byte[] bytes) throws Exception {return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));}
    public static void main(String[] args) throws Exception {
        Path source=Path.of(args[0]),out=Path.of(args[1]);Files.createDirectory(out);
        Map<String,byte[]> files=new TreeMap<>();try(var paths=Files.walk(source)) {for(Path p:paths.toList())if(Files.isRegularFile(p))files.put(source.relativize(p).toString().replace('\\','/'),Files.readAllBytes(p));}
        var asset=ModelCatalog.convert("default_boy",files);var blue=BedrockModel.convert(asset,"blue");var red=BedrockModel.convert(asset,"red");
        var original=JsonParser.parseString(new String(files.get("models/main.json"),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
        var converted=JsonParser.parseString(blue.geometry().geometryData()).getAsJsonObject();
        check(original.getAsJsonArray("minecraft:geometry").get(0).getAsJsonObject().get("bones").equals(converted.getAsJsonArray("minecraft:geometry").get(0).getAsJsonObject().get("bones")),"every original bone/cube/pivot/rotation/UV survives conversion");
        var image=ImageIO.read(new ByteArrayInputStream(files.get("textures/blue.png")));byte[] rgba=blue.skin().skinData();boolean exact=true;int n=0;
        for(int y=0;y<image.getHeight();y++)for(int x=0;x<image.getWidth();x++) {int pixel=image.getRGB(x,y);exact&=(rgba[n++]&255)==((pixel>>>16)&255);exact&=(rgba[n++]&255)==((pixel>>>8)&255);exact&=(rgba[n++]&255)==(pixel&255);exact&=(rgba[n++]&255)==((pixel>>>24)&255);}
        check(exact && rgba.length==128*128*4,"PNG RGBA including transparency is pixel exact at 128x128");
        check(!blue.key().equals(red.key())&&!Arrays.equals(rgba,red.skin().skinData()),"blue/red select actual original textures and distinct cache IDs");
        String identifier=converted.getAsJsonArray("minecraft:geometry").get(0).getAsJsonObject().getAsJsonObject("description").get("identifier").getAsString();
        check(identifier.equals(JsonParser.parseString(blue.geometry().geometryName()).getAsJsonObject().getAsJsonObject("geometry").get("default").getAsString()),"Bedrock resource patch selects the actual converted geometry");
        Files.writeString(out.resolve("expected-skins.json"),new Gson().toJson(Map.of("blue",Map.of("id",blue.skin().textureUrl(),"patch",blue.geometry().geometryName(),"geometry",blue.geometry().geometryData(),"rgbaSha256",sha256(rgba)),"red",Map.of("id",red.skin().textureUrl(),"patch",red.geometry().geometryName(),"geometry",red.geometry().geometryData(),"rgbaSha256",sha256(red.skin().skinData())))));
        UUID uuid=UUID.randomUUID();
        var serialized=SerializedSkin.builder().skinId(blue.skin().textureUrl()).skinResourcePatch(blue.geometry().geometryName()).skinData(ImageData.of(rgba)).capeData(ImageData.EMPTY).geometryData(blue.geometry().geometryData()).geometryDataEngineVersion("1.26.50").premium(true).trusted(true).overridingPlayerAppearance(true).build();
        PlayerSkinPacket packet=new PlayerSkinPacket();packet.setUuid(uuid);packet.setSkin(serialized);packet.setNewSkinName(blue.skin().textureUrl());packet.setOldSkinName("");packet.setTrustedSkin(true);
        var codec=Bedrock_v975.CODEC;var buffer=Unpooled.buffer();
        try {codec.tryEncode(codec.createHelper(),buffer,packet);var decoded=(PlayerSkinPacket)codec.tryDecode(codec.createHelper(),buffer,codec.getPacketDefinition(PlayerSkinPacket.class).getId());
            check(decoded.getUuid().equals(uuid)&&decoded.getSkin().getGeometryData().equals(blue.geometry().geometryData())&&Arrays.equals(decoded.getSkin().getSkinData().getImage(),rgba),"pinned Bedrock 975 wire encode/decode retains UUID/original geometry/pixels");
        } finally {buffer.release();}
        var state=new BedrockState.Entry(uuid,777,UUID.randomUUID().toString(),asset.id(),"blue",asset.sha256());
        var ready=new BedrockAppearance.Ready(state,blue);
        check(BedrockAppearance.select(ready,uuid,777)==ready && BedrockAppearance.select(ready,uuid,778)==null && BedrockAppearance.select(ready,UUID.randomUUID(),777)==null,"other UUID and reused native entity ID cannot receive this model");
        Map<String,Object> row=new HashMap<>();row.putAll(Map.of("available",true,"webAvailable",true,"epoch",state.epoch(),"jarSha256",BedrockState.YSM_SHA,"ysmVersion","2.4.1","protocolVersion","2.4.0","playerUuid",uuid.toString(),"entityId",777,"modelId",asset.id(),"texture","blue"));row.put("assetSha256",asset.sha256());
        Path config=out.resolve("projection.json"),snapshot=out.resolve("state.json");Files.writeString(config,new Gson().toJson(Map.of("bedrockStateFile",snapshot.toString())));
        new BedrockProjection(config).write(state.epoch(),List.of(row));
        check(BedrockState.read(snapshot,System.currentTimeMillis()).get(uuid).entityId()==777,"atomic proxy projection is accepted with confirmed worker profile");
        reject(()->BedrockState.read(snapshot,System.currentTimeMillis()+20000),"YSM_BEDROCK_STATE_EXPIRED");
        var data=JsonParser.parseString(Files.readString(snapshot)).getAsJsonObject();data.getAsJsonArray("players").get(0).getAsJsonObject().addProperty("jarSha256","0".repeat(64));Files.writeString(snapshot,data.toString());
        reject(()->BedrockState.read(snapshot,System.currentTimeMillis()),"YSM_BEDROCK_PROFILE_MISMATCH");
        var broken=new TreeMap<>(files);var geometry=original.deepCopy();var bones=geometry.getAsJsonArray("minecraft:geometry").get(0).getAsJsonObject().getAsJsonArray("bones");bones.get(0).getAsJsonObject().addProperty("parent",bones.get(1).getAsJsonObject().get("name").getAsString());broken.put("models/main.json",geometry.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        reject(()->BedrockModel.convert(ModelCatalog.convert("cycle",broken),"blue"),"YSM_BEDROCK_BONE_HIERARCHY_INVALID");
        reject(()->BedrockModel.convert(asset,"missing"),"YSM_BEDROCK_SOURCE_UNAVAILABLE");
        System.out.println("Checks: "+checks+"; real phone/Xbox visuals not verified");
    }
}
