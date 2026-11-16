package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAIClient;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.WeakHashMap;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

final class MaidAgentsServer implements AutoCloseable {
    private record Turn(MaidAgent agent, String site, String model, long revision) {}

    private final MinecraftServer server;
    private final Map<UUID, MaidAgent> agents = new LinkedHashMap<>();
    private final Map<LLMCallback, Turn> turns = Collections.synchronizedMap(new WeakHashMap<>());
    private final List<MaidBrainControl.Registration> registrations = new ArrayList<>();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private volatile boolean closed;
    private MaidCompanions companions;

    MaidAgentsServer(MinecraftServer server, MaidAgentsConfig config) {
        this.server = server;
        try {
            for (var binding : config.maids()) {
                var agent = new MaidAgent(binding);
                for (var choice : binding.choices().values()) {
                    if (!(AvailableSites.getLLMSite(choice.site()) instanceof LLMOpenAISite site)
                            || !site.enabled() || !choice.site().equals(site.id()))
                        throw new IllegalArgumentException("Missing enabled OpenAI-compatible site with the matching ID");
                }
                agents.put(binding.maidId(), agent);
            }
            for (MaidAgent agent : agents.values()) {
                var sites = agent.binding().choices().values().stream().map(MaidAgentsConfig.Choice::site)
                        .collect(java.util.stream.Collectors.toUnmodifiableSet());
                registrations.add(MaidBrainControl.bind(agent.binding().maidId(), sites,
                        site -> new BoundClient(site, agent), this::current, this::carry));
            }
        } catch (RuntimeException failure) {
            close();
            throw failure;
        }
    }

    int size() { return agents.size(); }
    MaidAgent agent(UUID id) { return agents.get(id); }
    List<MaidAgent> agents() { return List.copyOf(agents.values()); }
    MaidCompanions companions() { return companions; }
    void companions(MaidCompanions value) { companions = value; }
    boolean reserved(UUID id) { return companions != null && companions.reserved(id); }

    EntityMaid loaded(MaidAgent agent) {
        for (var level : server.getAllLevels()) {
            if (level.getEntity(agent.binding().maidId()) instanceof EntityMaid maid && agent.matches(maid)) return maid;
        }
        return null;
    }

    private boolean current(LLMCallback callback) {
        Turn turn = turns.get(callback);
        return !closed && !publicConversation(callback) && selectionIsCurrent(callback, turn);
    }

    private boolean selectionIsCurrent(LLMCallback callback, Turn turn) {
        return turn != null && turn.agent.matches(callback.getMaid())
                && (publicConversation(callback) || !reserved(turn.agent.binding().maidId()))
                && turn.revision == turn.agent.revision() && selected(callback.getMaid(), turn.site, turn.model);
    }

    private static boolean publicConversation(LLMCallback callback) {
        return callback instanceof MaidVisitorDialogue || callback instanceof CompanionConversation;
    }

    void visit(MaidAgent agent, EntityMaid maid, ServerPlayer player, String text) {
        if (closed || !MaidVisitorDialogue.inReach(player, maid)) {
            throw new IllegalArgumentException("Stand within 8 blocks and look for a clear path to the maid.");
        }
        agent.visit(maid, player, text);
    }

    private static boolean selected(EntityMaid maid, String site, String model) {
        var chat = maid.getAiChatManager();
        return chat.getLLMSite() != null && site.equals(chat.getLLMSite().id()) && model.equals(chat.getLLMModel());
    }

    private void carry(LLMCallback prior, LLMCallback next) {
        Turn turn = turns.get(prior);
        if (turn != null && next != null) turns.put(next, turn);
    }

    private final class BoundClient extends LLMOpenAIClient {
        private final MaidAgent agent;
        private EntityMaid buildingRequest;
        private boolean includePhysicalState;

        BoundClient(LLMOpenAISite site, MaidAgent agent) {
            super(http, site);
            this.agent = agent;
        }

        @Override public void chat(LLMCallback callback) {
            if (closed) return;
            if (!server.isSameThread()) {
                server.execute(() -> chat(callback));
                return;
            }
            EntityMaid maid = callback.getMaid();
            String pickedModel = maid.getAiChatManager().getLLMModel();
            boolean configured = agent.binding().choices().values().stream()
                    .anyMatch(choice -> choice.site().equals(site.id()) && choice.model().equals(pickedModel));
            if (!agent.matches(maid) || !configured || !selected(maid, site.id(), pickedModel)) {
                callback.onFailure(null, new IllegalStateException("MAID_AGENT_SITE_NOT_AUTHORIZED"), 403);
                return;
            }
            turns.putIfAbsent(callback, new Turn(agent, site.id(), pickedModel, agent.revision()));
            if (!selectionIsCurrent(callback, turns.get(callback))) {
                callback.onFailure(null, new IllegalStateException("MAID_AGENT_SELECTION_CHANGED"), 409);
                return;
            }
            buildingRequest = maid;
            includePhysicalState = !publicConversation(callback);
            try {
                super.chat(callback);
            } finally {
                buildingRequest = null;
                includePhysicalState = false;
            }
        }

        @Override protected ChatCompletion extraArgs(ChatCompletion request) {
            request = super.extraArgs(request);
            if (buildingRequest != null && includePhysicalState) request.systemChat(
                    "Current physical state: " + agent.observation(buildingRequest) +
                    ". A mode selection only changes the mode. Use native tool receipts for actual effects.");
            return request;
        }

        @Override protected void handle(LLMCallback callback, HttpResponse<String> response, Throwable failure,
                                        HttpRequest request) {
            if (closed) return;
            server.execute(() -> {
                if (!selectionIsCurrent(callback, turns.get(callback))) {
                    callback.onFailure(request, new IllegalStateException("MAID_AGENT_SELECTION_CHANGED"), 409);
                    return;
                }
                super.handle(callback, response, failure, request);
            });
        }
    }

    @Override public void close() {
        closed = true;
        registrations.forEach(MaidBrainControl.Registration::close);
        turns.clear();
        http.shutdownNow();
    }
}
