// Isolated diagnostic: run with Java 21, the pinned Geyser JAR and its server library classpath.
// This checks Cloudburst's real wire ID, not bedrock-protocol's potentially stale string labels.
import java.lang.reflect.*;
import org.cloudburstmc.protocol.common.util.TypeMap;
import org.cloudburstmc.protocol.bedrock.data.ParticleType;
class BedrockParticleMapProbe {
 public static void main(String[] a) throws Exception {
  for(Class<?> c=Class.forName("org.cloudburstmc.protocol.bedrock.codec.v2193.Bedrock_v2193");c!=null;c=c.getSuperclass()) {
   for(Field f:c.getDeclaredFields()) if(f.getName().equals("LEVEL_EVENTS")) {
    f.setAccessible(true);TypeMap map=(TypeMap)f.get(null);
    System.out.println(c.getName()+" END_ROD="+map.getId(ParticleType.END_ROD)+" at16432="+map.getTypeUnsafe(16432));return;
   }
  }
  throw new Error("No LEVEL_EVENTS map");
 }
}
