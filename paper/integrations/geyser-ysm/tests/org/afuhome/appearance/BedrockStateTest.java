package org.afuhome.appearance;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

/** Checks version transitions against the same fresh private-state parser used by Geyser. */
public final class BedrockStateTest {
    private static final long NOW=1_800_000_000_000L;
    private static final String UUID_VALUE="5c5b5da1-d251-4ba4-a1e3-38aba9afec71",EPOCH="b55aee43-8b81-4821-90da-a4d615167550";
    private static int checks;
    private static JsonObject state(boolean native265){
        String version=native265?"2.6.5":"2.4.1",source=native265?"ysm_native_backend":"freesia_worker";
        JsonObject row=new JsonObject();row.addProperty("available",true);row.addProperty("webAvailable",true);row.addProperty("source",source);
        row.addProperty("epoch",EPOCH);row.addProperty("jarSha256",native265?BedrockState.NATIVE_265_SHA:BedrockState.YSM_SHA);
        row.addProperty("ysmVersion",version);row.addProperty("protocolVersion",native265?"2.6.0":"2.4.0");
        row.addProperty("playerUuid",UUID_VALUE);row.addProperty("entityId",12);row.addProperty("modelId",native265?"public/model.zip":"model");row.addProperty("texture","default");row.addProperty("assetSha256","a".repeat(64));
        JsonArray players=new JsonArray();players.add(row);JsonObject root=new JsonObject();root.addProperty("schemaVersion",1);root.addProperty("source",source);root.addProperty("writtenAt",NOW);root.addProperty("epoch",EPOCH);root.add("players",players);return root;
    }
    private static void write(Path file,JsonObject state)throws Exception{Files.writeString(file,state.toString());}
    private static void rejects(Path file,JsonObject state,String version)throws Exception{
        write(file,state);try{BedrockState.read(file,NOW,version);}catch(Exception expected){checks++;return;}throw new AssertionError("Mixed or invalid source profile was accepted");
    }
    public static void main(String[]args)throws Exception{
        Path file=Files.createTempFile("qiandeng-ysm-source-",".json");
        try{
            write(file,state(false));if(BedrockState.read(file,NOW).size()!=1)throw new AssertionError("Old source regressed");checks++;
            write(file,state(true));if(BedrockState.read(file,NOW,"2.6.5").size()!=1)throw new AssertionError("Native source unavailable");checks++;
            rejects(file,state(true),"2.4.1");rejects(file,state(false),"2.6.5");rejects(file,state(true),"2.7.0");
            JsonObject wrong=state(true);wrong.getAsJsonArray("players").get(0).getAsJsonObject().addProperty("jarSha256",BedrockState.YSM_SHA);rejects(file,wrong,"2.6.5");
            wrong=state(true);wrong.getAsJsonArray("players").get(0).getAsJsonObject().addProperty("protocolVersion","2.4.0");rejects(file,wrong,"2.6.5");
            wrong=state(true);wrong.getAsJsonArray("players").get(0).getAsJsonObject().addProperty("source","freesia_worker");rejects(file,wrong,"2.6.5");
            wrong=state(true);wrong.addProperty("writtenAt",NOW-15001);rejects(file,wrong,"2.6.5");
            wrong=state(true);wrong.getAsJsonArray("players").add(wrong.getAsJsonArray("players").get(0).deepCopy());rejects(file,wrong,"2.6.5");
            wrong=state(true);wrong.getAsJsonArray("players").get(0).getAsJsonObject().addProperty("webAvailable",false);write(file,wrong);
            if(!BedrockState.read(file,NOW,"2.6.5").isEmpty())throw new AssertionError("Encrypted native-only model was projected");checks++;
            System.out.println("Bedrock source-profile checks: "+checks);
        }finally{Files.deleteIfExists(file);}
    }
}
