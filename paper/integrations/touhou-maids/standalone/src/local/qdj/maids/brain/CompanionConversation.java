package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.response.ResponseChat;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMClient;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.response.Message;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.net.http.HttpRequest;
import java.util.List;
import java.util.function.BiConsumer;

/** Deliberation through the NPC's selected native/Qwen Code/Hub route, without administrator tools. */
final class CompanionConversation extends LLMCallback {
    private final BiConsumer<String, String> finish;
    CompanionConversation(EntityMaid maid, String context, String message, BiConsumer<String, String> finish) {
        super(maid.getAiChatManager(), List.of(LLMMessage.systemChat(maid, context), LLMMessage.userChat(maid, message)));
        this.finish = finish;
        needAddTools = false;
    }
    @Override public void onSuccess(ResponseChat response) { finish.accept(response.getChatText(), null); }
    @Override public void onFailure(HttpRequest request, Throwable error, int status) { finish.accept(null, "model_unavailable"); }
    @Override public void onFunctionCall(Message message, LLMClient client) { finish.accept(null, "unexpected_tool_call"); }
}
