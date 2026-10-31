package local.tlmcompat.numen.mixin;

import com.github.tartaricacid.touhoulittlemaid.entity.chatbubble.ChatBubbleManager;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import local.tlmcompat.numen.MaidTextTransport;
import org.spongepowered.asm.mixin.*;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Only successful visible text bubbles; private thinking/LLM methods are intentionally absent. */
@Mixin(value=ChatBubbleManager.class,remap=false)
public abstract class MaidTextProjection {
    @Shadow @Final private EntityMaid maid;
    @Inject(method="addTextChatBubble",at=@At("RETURN"),remap=false)
    private void qiandengji$text(String text,CallbackInfoReturnable<Long> result){MaidTextTransport.visible(maid,text);}
}
