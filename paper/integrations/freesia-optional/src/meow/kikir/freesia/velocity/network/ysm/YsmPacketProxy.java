/* SPDX-License-Identifier: MPL-2.0
 * Original: YesSteveModel/Freesia v2.5.1+2.4.1 (5ca1e0e).
 * Local change: forward native YSM only into the current ready PLAY session.
 */
package meow.kikir.freesia.velocity.network.ysm;

import com.github.retrooper.packetevents.protocol.nbt.NBTCompound;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import meow.kikir.freesia.velocity.Freesia;
import io.netty.buffer.ByteBuf;
import net.kyori.adventure.key.Key;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;


public interface YsmPacketProxy {
    default void setParentHandler(MapperSessionProcessor processor){
        // No-op by default
    }

    ProxyComputeResult processS2C(Key channelKey, ByteBuf copiedPacketData);

    ProxyComputeResult processC2S(Key channelKey, ByteBuf copiedPacketData);

    @Nullable
    Player getOwner();

    void sendEntityStateTo(@NotNull Player target);

    void setEntityDataRaw(NBTCompound data);

    void notifyFullTrackerUpdates();

    NBTCompound getCurrentEntityState();

    void setPlayerWorkerEntityId(int id);

    void setPlayerEntityId(int id);

    int getPlayerEntityId();

    int getPlayerWorkerEntityId();

    default void executeMolang(String expression) {}

    default void executeMolang(int[] entityIds, String expression) {}

    default void sendPluginMessageToOwner(@NotNull MinecraftChannelIdentifier channel, byte[] data){
        final Player owner = this.getOwner();

        if (owner == null) {
            throw new UnsupportedOperationException();
        }

        this.sendPluginMessageTo(this.getOwner(), channel, data);
    }

    default void sendPluginMessageToOwner(@NotNull MinecraftChannelIdentifier channel, @NotNull ByteBuf data) {
        final byte[] dataArray = new byte[data.readableBytes()];
        data.readBytes(dataArray);

        this.sendPluginMessageToOwner(channel, dataArray);
    }

    default void sendPluginMessageTo(@NotNull Player target, @NotNull MinecraftChannelIdentifier channel, @NotNull ByteBuf data) {
        final byte[] dataArray = new byte[data.readableBytes()];
        data.readBytes(dataArray);

        this.sendPluginMessageTo(target, channel, dataArray);
    }

    default void sendPluginMessageTo(@NotNull Player target, @NotNull MinecraftChannelIdentifier channel, byte[] data) {
        Freesia.mapperManager.sendWhenReady(target, this, channel, data);
    }
}
