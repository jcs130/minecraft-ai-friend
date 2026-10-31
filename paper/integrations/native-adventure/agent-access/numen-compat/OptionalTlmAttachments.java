package dev.qiandeng.maw.numencompat;

import com.dwinovo.numen.network.payload.ClientCallPayload;
import net.minecraft.network.ConnectionProtocol;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import net.neoforged.neoforge.attachment.AttachmentType;
import net.neoforged.neoforge.registries.NeoForgeRegistries;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/** The cosmetic outfit is optional; actual maid gameplay and other attachments are unchanged. */
public final class OptionalTlmAttachments {
    public static final ResourceLocation REGISTRY=ResourceLocation.parse("neoforge:synced_attachment_types");
    public static final ResourceLocation OUTFIT=ResourceLocation.parse("numen_tlm:tlm_model");
    private OptionalTlmAttachments() {}
    public static boolean capable(ServerCommonPacketListenerImpl listener) {
        return listener!=null&&net.neoforged.neoforge.network.registration.NetworkRegistry.hasChannel(
            listener.getConnection(),ConnectionProtocol.PLAY,ClientCallPayload.TYPE.id());
    }
    public static boolean outfit(AttachmentType<?> type) { return OUTFIT.equals(NeoForgeRegistries.ATTACHMENT_TYPES.getKey(type)); }
    public static Set<Map.Entry<AttachmentType<?>,Object>> initialEntries(Map<AttachmentType<?>,Object> entries,boolean omit) {
        if(!omit)return entries.entrySet();
        Set<Map.Entry<AttachmentType<?>,Object>> kept=new LinkedHashSet<>();
        for(var entry:entries.entrySet())if(!outfit(entry.getKey()))kept.add(entry);
        return kept;
    }
}
