package org.afuhome.auth;

import com.velocitypowered.api.network.ProtocolVersion;
import com.velocitypowered.proxy.protocol.ProtocolUtils;
import com.velocitypowered.proxy.protocol.packet.ClientSettingsPacket;
import io.netty.buffer.ByteBuf;

/** Validate the CONFIG-only settings packet without consuming the original frame. */
final class ConfigurationSettings {
    private ConfigurationSettings() {}
    static boolean discard(ByteBuf frame, ProtocolVersion version) {
        if(version.getProtocol()<764 || !frame.isReadable() || frame.getUnsignedByte(frame.readerIndex())!=0)return false;
        var probe=frame.duplicate();
        probe.skipBytes(1);
        try {
            new ClientSettingsPacket().decode(probe,ProtocolUtils.Direction.SERVERBOUND,version);
            return probe.isReadable();
        } catch(RuntimeException malformed) {
            return true;
        }
    }
}
