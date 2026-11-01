package org.afuhome.auth;
import com.velocitypowered.api.network.ProtocolVersion;
import com.velocitypowered.proxy.protocol.ProtocolUtils;
import com.velocitypowered.proxy.protocol.packet.ClientSettingsPacket;
import io.netty.buffer.Unpooled;
public final class ConfigurationSettingsTest {
 public static void main(String[] args){
  int checks=0;
  for(int number:new int[]{766,767,769,774}){
   var version=ProtocolVersion.getProtocolVersion(number);var valid=Unpooled.buffer();
   try{
    valid.writeByte(0);new ClientSettingsPacket("zh_cn",(byte)8,0,true,(short)127,1,false,true,0).encode(valid,ProtocolUtils.Direction.SERVERBOUND,version);
    int before=valid.readerIndex();if(ConfigurationSettings.discard(valid,version)||valid.readerIndex()!=before||valid.refCnt()!=1)throw new AssertionError("Valid settings must be preserved");checks++;
    valid.writeByte(0);if(!ConfigurationSettings.discard(valid,version))throw new AssertionError("Reject trailing movement bytes");checks++;
   }finally{valid.release();}
   for(byte[] malformed:new byte[][]{{0},{0,5,122}}){var frame=Unpooled.wrappedBuffer(malformed);try{if(!ConfigurationSettings.discard(frame,version)||frame.readerIndex()!=0||frame.refCnt()!=1)throw new AssertionError("Malformed CONFIG settings");checks++;}finally{frame.release();}}
   var movement=Unpooled.buffer();try{movement.writeByte(0).writeDouble(.5).writeDouble(64).writeDouble(-.5).writeByte(3);if(!ConfigurationSettings.discard(movement,version))throw new AssertionError("Movement encoded as CONFIG settings");checks++;}finally{movement.release();}
   var other=Unpooled.wrappedBuffer(new byte[]{2});try{if(ConfigurationSettings.discard(other,version))throw new AssertionError("Other packet IDs unchanged");checks++;}finally{other.release();}
  }
  var old=Unpooled.wrappedBuffer(new byte[]{0});try{if(ConfigurationSettings.discard(old,ProtocolVersion.getProtocolVersion(763)))throw new AssertionError("Legacy PLAY protocol unchanged");checks++;}finally{old.release();}
  System.out.println("Configuration settings checks: "+checks);
 }
}
