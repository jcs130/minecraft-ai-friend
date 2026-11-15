package org.agentmc.platform;

import com.google.gson.GsonBuilder;
import com.google.gson.JsonParser;
import com.elfmcys.yesstevemodel.YesSteveModel;
import com.elfmcys.yesstevemodel.oo0o0Oooo0OOO00OOo0OO000;
import io.netty.util.AttributeKey;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.fml.loading.FMLPaths;
import java.nio.file.Files;
import java.time.Instant;
import java.util.LinkedHashMap;

/** Read-only evidence for original YSM 2.6.5. Never sends a handshake, changes
 * channel attributes, loads local models or substitutes a server selection. */
final class YsmNativeDiagnostics {
 private static final ResourceLocation CHANNEL=ResourceLocation.fromNamespaceAndPath("yes_steve_model","2_6_0");
 private static final AttributeKey<String> VERSION=AttributeKey.valueOf("yes_steve_model_channel_version");
 private static boolean enabled,failed;private static int ticks;
 static void initialize(){
  try {var file=FMLPaths.CONFIGDIR.get().resolve("agentmc-client-appearances.json");
   if(Files.isRegularFile(file)){var config=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
    enabled=config.has("writeDiagnostics")&&config.get("writeDiagnostics").getAsBoolean();}}
  catch(Exception ignored){enabled=false;}
 }
 static void tick(Minecraft client){
  if(!enabled||++ticks%100!=0)return;
  try {
   var listener=client.getConnection();var connection=listener==null?null:listener.getConnection();
   var channel=connection==null?null:connection.channel();
   var output=new LinkedHashMap<String,Object>();
   output.put("schema","agent-mc-ysm-native/v1");output.put("recordedAt",Instant.now().toString());
   output.put("clientVersion","2.6.5-neoforge+mc1.21.1");output.put("expectedProtocol","2.6.0");
   output.put("connected",connection!=null&&connection.isConnected());
   output.put("nativeAvailable",YesSteveModel.isAvailable());
   output.put("channelAdvertised",listener==null?null:listener.hasChannel(CHANNEL));
   output.put("negotiatedProtocol",channel!=null&&channel.hasAttr(VERSION)?channel.attr(VERSION).get():null);
   var catalogue=oo0o0Oooo0OOO00OOo0OO000.oOoo00O0o0oO0o0oO00OO0O0();
   output.put("catalogueSize",catalogue.size());output.put("catalogueIds",catalogue.keySet().stream().sorted().limit(64).toList());
   var file=FMLPaths.GAMEDIR.get().resolve("diagnostics/agentmc-ysm-native.json");Files.createDirectories(file.getParent());
   Files.writeString(file,new GsonBuilder().serializeNulls().create().toJson(output));
  }catch(Exception e){if(!failed)System.out.println("[AgentMC] Native YSM diagnostics unavailable: "+e.getClass().getSimpleName());failed=true;}
 }
}
