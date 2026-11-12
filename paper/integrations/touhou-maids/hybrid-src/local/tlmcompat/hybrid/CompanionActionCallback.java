package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion;

/** Tools for one authenticated partner conversation, built by the existing selected client. */
interface CompanionActionCallback {
    void addCompanionTools(ChatCompletion request);
}
