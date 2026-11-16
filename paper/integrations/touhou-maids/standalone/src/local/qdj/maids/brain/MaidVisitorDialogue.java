package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.response.ResponseChat;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMClient;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.response.Message;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.net.http.HttpRequest;
import java.util.List;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

final class MaidVisitorDialogue extends LLMCallback {
    private final ServerPlayer player;
    private final Runnable release;

    MaidVisitorDialogue(EntityMaid maid, ServerPlayer player, String persona, String text, Runnable release) {
        super(maid.getAiChatManager(), List.of(
                LLMMessage.systemChat(maid, "You are a public Minecraft NPC. " + persona +
                        " Reply to the nearby visitor with one short in-character sentence in their language. " +
                        "Use ordinary dialogue. Never promise to affect equipment, tasks, or the world."),
                LLMMessage.userChat(maid, text)));
        this.player = player;
        this.release = release;
        needAddTools = false;
    }

    static boolean inReach(ServerPlayer player, EntityMaid maid) {
        return player.isAlive() && maid.isAlive() && !maid.isRemoved() && player.level() == maid.level()
                && player.distanceToSqr(maid) <= 64 && player.hasLineOfSight(maid);
    }

    @Override public void onSuccess(ResponseChat response) {
        release.run();
        if (!inReach(player, maid)) {
            maid.getChatBubbleManager().removeChatBubble(getWaitingChatBubbleId());
            return;
        }
        String caption = shortText(response.getChatText());
        String audio = shortText(response.getTtsText());
        if (caption.isEmpty()) {
            unavailable();
            return;
        }
        var voice = chatManager.getTTSSite();
        if (voice != null && voice.enabled() && !audio.isEmpty()) {
            chatManager.tts(voice, caption, audio, getWaitingChatBubbleId());
        } else {
            maid.getChatBubbleManager().addLLMChatText(caption, getWaitingChatBubbleId());
        }
    }

    @Override public void onFailure(HttpRequest request, Throwable error, int status) {
        release.run();
        unavailable();
    }

    @Override public void onFunctionCall(Message message, LLMClient client) {
        release.run();
        unavailable();
    }

    private void unavailable() {
        maid.getChatBubbleManager().removeChatBubble(getWaitingChatBubbleId());
        if (inReach(player, maid)) player.sendSystemMessage(Component.literal("This maid could not reply. Try a new conversation later."));
    }

    private static String shortText(String value) {
        if (value == null) return "";
        String clean = value.replaceAll("[\\p{Cntrl}]+", " ").strip();
        return clean.codePointCount(0, clean.length()) <= 140 ? clean : clean.substring(0, clean.offsetByCodePoints(0, 139)) + "…";
    }
}
