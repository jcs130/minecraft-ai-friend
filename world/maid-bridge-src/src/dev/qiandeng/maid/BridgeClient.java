package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.response.ResponseChat;
import com.github.tartaricacid.touhoulittlemaid.ai.service.ErrorCode;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMClient;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.Role;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;

/** One signed text request. Entity work is always on MC's thread; I/O never is. */
public final class BridgeClient implements LLMClient {
    private static final Path KEY = Path.of("config/qiandeng_maid_bridge/identity.key");
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER).build();
    private static final Semaphore CAPACITY = new Semaphore(4);
    // Receipt-only requests never occupy the model-response lane or another
    // receipt for the same body. This is a bounded HTTP lane, not an LLM worker.
    private static final Semaphore INPUT_CAPACITY = new Semaphore(8);
    private static final java.util.Set<UUID> ACTIVE = ConcurrentHashMap.newKeySet();
    private final BridgeSite site;
    public BridgeClient(BridgeSite site) { this.site = site; }

    @Override public void chat(LLMCallback callback) {
        // TLM sometimes dispatches callbacks off-thread. Do not inspect even the owner there.
        if (!callback.isOnServerThread()) { callback.runOnServerThread(() -> chat(callback)); return; }
        var maid = callback.getMaid();
        var server = maid.getServer();
        UUID maidUuid = maid.getUUID(), ownerUuid = maid.getOwnerUUID();
        if (!site.enabled() || !maid.isAlive() || maid.isRemoved() || ownerUuid == null
            || !(maid.getOwner() instanceof ServerPlayer owner) || !maid.isOwnedBy(owner)) {
            fail(callback, "maid_or_owner_unavailable"); return;
        }
        final boolean perceptionQueue = usesPerceptionQueue(callback.getClass(), maidUuid, ownerUuid,
            owner.getClass().getName()) && owner.isAlive() && !owner.hasDisconnected();
        if (perceptionQueue) {
            if (!INPUT_CAPACITY.tryAcquire()) { fail(callback, "bridge_input_busy"); return; }
        } else {
            if (!ACTIVE.add(maidUuid)) { fail(callback, "maid_request_busy"); return; }
            if (!CAPACITY.tryAcquire()) { ACTIVE.remove(maidUuid); fail(callback, "bridge_busy"); return; }
        }
        final byte[] body;
        final String requestId = UUID.randomUUID().toString();
        final String issuedAt = Long.toString(System.currentTimeMillis());
        try {
            JsonObject payload = new JsonObject();
            payload.add("qd_identity", MaidBridge.identity(maid));
            payload.addProperty("model", "qd-maid-dialogue");
            payload.addProperty("stream", false);
            if (perceptionQueue) payload.addProperty("qd_delivery", "perception_queue_v1");
            payload.add("messages", messagesForDelivery(callback.getMessages(), perceptionQueue));
            // Tools are intentionally absent. Qwen owns the only tool/reasoning loop.
            body = payload.toString().getBytes(StandardCharsets.UTF_8);
            if (body.length > 65536) throw new BridgeProtocol.Failure("context_limit");
        } catch (RuntimeException error) {
            release(maidUuid, perceptionQueue); fail(callback, "context_unavailable"); return;
        }
        // Only immutable text/identity snapshots cross the thread boundary.
        CompletableFuture.supplyAsync(() -> request(requestId, issuedAt, body, perceptionQueue))
            .thenCompose(request -> HTTP.sendAsync(request, info -> new BoundedResponse(16384)))
            .whenComplete((response, failure) -> {
                // A server shutdown must not strand a permit forever in its abandoned task queue.
                if (server.isStopped()) { release(maidUuid, perceptionQueue); return; }
                server.execute(() -> {
                release(maidUuid, perceptionQueue);
                // An old response must never enter a new owner's history or a replacement entity.
                try {
                    var current = MaidBridge.find(server, maidUuid);
                    BridgeProtocol.requireOwner(ownerUuid, current.getOwnerUUID());
                    if (current != maid || !(current.getOwner() instanceof ServerPlayer currentOwner)) return;
                    if (perceptionQueue && (!currentOwner.isAlive() || currentOwner.hasDisconnected()
                            || !usesPerceptionQueue(callback.getClass(), current.getUUID(), current.getOwnerUUID(),
                                currentOwner.getClass().getName()))) return;
                } catch (RuntimeException unavailable) { return; }
                if (failure != null || response == null
                        || response.statusCode() != (perceptionQueue ? 202 : 200)) {
                    fail(callback, "qwen_request_unavailable_no_retry"); return;
                }
                try {
                    if (perceptionQueue) {
                        BridgeProtocol.requireQueuedReceipt(response.body(), requestId);
                        // TLM already recorded the user input before invoking this
                        // client. Acceptance is not an assistant answer, nor proof
                        // of who spoke; no history, speech or model callback here.
                        maid.getChatBubbleManager().removeChatBubble(callback.getWaitingChatBubbleId());
                        return;
                    }
                    String text = BridgeProtocol.replyText(response.body());
                    callback.onSuccess(new ResponseChat(text));
                } catch (RuntimeException invalid) { fail(callback, "qwen_reply_invalid"); }
                });
            });
    }
    static boolean usesPerceptionQueue(Class<?> callbackType, UUID maidUuid, UUID ownerUuid, String ownerType) {
        // Other owners/characters and setting/summary callbacks still need a
        // synchronous response. Ownership does not establish the input's speaker.
        return callbackType == LLMCallback.class && YuiRescue.YUI.equals(maidUuid)
            && YuiRescue.KIRITO.equals(ownerUuid)
            && "com.dwinovo.numen.entity.NumenPlayer".equals(ownerType);
    }
    static JsonArray messagesForDelivery(List<LLMMessage> nativeMessages, boolean perceptionQueue) {
        List<LLMMessage> selected = nativeMessages;
        if (perceptionQueue) {
            LLMMessage latest = null;
            if (nativeMessages != null) {
                for (int i = nativeMessages.size() - 1; i >= 0; i--) {
                    var candidate = nativeMessages.get(i);
                    if (candidate != null && candidate.role() == Role.USER) { latest = candidate; break; }
                }
            }
            if (latest == null) throw new BridgeProtocol.Failure("perception_user_input_required");
            if (latest.message() == null || latest.message().isBlank() || latest.message().length() > 8000
                    || latest.message().indexOf('\0') >= 0)
                throw new BridgeProtocol.Failure("perception_input_size_limit");
            // The persistent Qwen session already owns the history. Receipt
            // admission must not replay it or fail as the mod's history grows.
            selected = List.of(latest);
        } else if (nativeMessages == null || nativeMessages.isEmpty() || nativeMessages.size() > 48) {
            throw new BridgeProtocol.Failure("context_limit");
        }
        JsonArray messages = new JsonArray();
        int characters = 0;
        for (var message : selected) {
            if (message == null || message.role() == null || message.message() == null
                    || (characters += message.message().length()) > (perceptionQueue ? 8000 : 12000))
                throw new BridgeProtocol.Failure("context_limit");
            JsonObject row = new JsonObject();
            row.addProperty("role", message.role().getId()); row.addProperty("content", message.message());
            messages.add(row);
        }
        return messages;
    }
    private static HttpRequest request(String requestId, String issuedAt, byte[] body, boolean perceptionQueue) {
        byte[] key = null;
        try {
            if (Files.isSymbolicLink(KEY) || Files.isSymbolicLink(KEY.getParent())
                || !Files.isRegularFile(KEY) || Files.size(KEY) > 258) throw new BridgeProtocol.Failure("identity_key_unavailable");
            key = Files.readString(KEY, StandardCharsets.US_ASCII).strip().getBytes(StandardCharsets.US_ASCII);
            String signature = BridgeProtocol.signature(key, requestId, issuedAt, body);
            return HttpRequest.newBuilder(URI.create(BridgeProtocol.ENDPOINT))
                .header("Content-Type", "application/json")
                .header("X-QD-Request-Id", requestId).header("X-QD-Issued-At", issuedAt)
                .header("X-QD-Signature", signature)
                .timeout(Duration.ofSeconds(perceptionQueue ? 15 : 60))
                .POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
        } catch (Exception error) { throw new BridgeProtocol.Failure("identity_request_unavailable"); }
        finally { if (key != null) Arrays.fill(key, (byte) 0); }
    }
    private static void release(UUID maid, boolean perceptionQueue) {
        if (perceptionQueue) INPUT_CAPACITY.release();
        else { ACTIVE.remove(maid); CAPACITY.release(); }
    }
    private static void fail(LLMCallback callback, String code) {
        // Never forward a request/header/raw exception through TLM's logging callback.
        callback.onFailure(null, new IllegalStateException(code), ErrorCode.REQUEST_RECEIVED_ERROR);
    }
}
