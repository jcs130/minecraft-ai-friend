package dev.qiandeng.maw.numencompat.mixin;
import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import dev.qiandeng.maw.numencompat.OptionalTlmAttachments;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.attachment.*;
import net.neoforged.neoforge.network.payload.SyncAttachmentsPayload;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(value=AttachmentSync.class,remap=false)
public abstract class OptionalTlmSyncMixin {
    @Unique private static final ThreadLocal<Boolean> maw$omitOutfit=ThreadLocal.withInitial(()->false);
    @WrapMethod(method="syncInitialAttachments")
    private static SyncAttachmentsPayload maw$scopedInitial(AttachmentHolder holder,ServerPlayer to,Operation<SyncAttachmentsPayload> original) {
        boolean previous=maw$omitOutfit.get();maw$omitOutfit.set(!OptionalTlmAttachments.capable(to.connection));
        try{return original.call(holder,to);}finally{maw$omitOutfit.set(previous);}
    }
    // Pinned NeoForge 21.1.252 lambda. The enclosing scope above is restored on
    // every exit. Filtering the iteration changes neither holder nor saved data.
    @Redirect(method="lambda$syncInitialAttachments$3",at=@At(value="INVOKE",target="Ljava/util/Map;entrySet()Ljava/util/Set;"),require=1)
    private static Set<Map.Entry<AttachmentType<?>,Object>> maw$initialEntries(Map<AttachmentType<?>,Object> entries) {
        return OptionalTlmAttachments.initialEntries(entries,maw$omitOutfit.get());
    }
    @WrapOperation(method="syncUpdate",at=@At(value="INVOKE",target="Lnet/neoforged/neoforge/attachment/AttachmentSyncHandler;sendToPlayer(Lnet/neoforged/neoforge/attachment/IAttachmentHolder;Lnet/minecraft/server/level/ServerPlayer;)Z"),require=2)
    private static boolean maw$onlyCapableUpdate(AttachmentSyncHandler<?> handler,IAttachmentHolder exposed,ServerPlayer to,Operation<Boolean> original,
                                                AttachmentHolder holder,AttachmentType<?> type,List<ServerPlayer> players) {
        return (!OptionalTlmAttachments.outfit(type)||OptionalTlmAttachments.capable(to.connection))&&original.call(handler,exposed,to);
    }
}
