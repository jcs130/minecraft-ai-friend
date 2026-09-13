package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.response.ResponseChat;
import com.github.tartaricacid.touhoulittlemaid.ai.service.ErrorCode;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMClient;
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
        if (!ACTIVE.add(maidUuid)) { fail(callback, "maid_request_busy"); return; }
        if (!CAPACITY.tryAcquire()) { ACTIVE.remove(maidUuid); fail(callback, "bridge_busy"); return; }
        final byte[] body;
        final String requestId = UUID.randomUUID().toString();
        final String issuedAt = Long.toString(System.currentTimeMillis());
        try {
            JsonObject payload = new JsonObject();
            payload.add("qd_identity", MaidBridge.identity(maid));
            payload.addProperty("model", "qd-maid-dialogue");
            payload.addProperty("stream", false);
            JsonArray messages = new JsonArray();
            var nativeMessages = callback.getMessages();
            if (nativeMessages == null || nativeMessages.isEmpty() || nativeMessages.size() > 48)
                throw new BridgeProtocol.Failure("context_limit");
            int characters = 0;
            for (var message : nativeMessages) {
                if (message.message() == null || (characters += message.message().length()) > 12000)
                    throw new BridgeProtocol.Failure("context_limit");
                JsonObject row = new JsonObject();
                row.addProperty("role", message.role().getId()); row.addProperty("content", message.message());
                messages.add(row);
            }
            payload.add("messages", messages);
            // Tools are intentionally absent. Qwen owns the only tool/reasoning loop.
            body = payload.toString().getBytes(StandardCharsets.UTF_8);
            if (body.length > 65536) throw new BridgeProtocol.Failure("context_limit");
        } catch (RuntimeException error) {
            release(maidUuid); fail(callback, "context_unavailable"); return;
        }
        // Only immutable text/identity snapshots cross the thread boundary.
        CompletableFuture.supplyAsync(() -> request(requestId, issuedAt, body))
            .thenCompose(request -> HTTP.sendAsync(request, info -> new BoundedResponse(16384)))
            .whenComplete((response, failure) -> {
                // A server shutdown must not strand a permit forever in its abandoned task queue.
                if (server.isStopped()) { release(maidUuid); return; }
                server.execute(() -> {
                release(maidUuid);
                // An old response must never enter a new owner's history or a replacement entity.
                try {
                    var current = MaidBridge.find(server, maidUuid);
                    BridgeProtocol.requireOwner(ownerUuid, current.getOwnerUUID());
                    if (current != maid || !(current.getOwner() instanceof ServerPlayer)) return;
                } catch (RuntimeException unavailable) { return; }
                if (failure != null || response == null || response.statusCode() != 200) {
                    fail(callback, "qwen_request_unavailable_no_retry"); return;
                }
                try {
                    String text = BridgeProtocol.replyText(response.body());
                    callback.onSuccess(new ResponseChat(text));
                } catch (RuntimeException invalid) { fail(callback, "qwen_reply_invalid"); }
                });
            });
    }
    private static HttpRequest request(String requestId, String issuedAt, byte[] body) {
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
                .timeout(Duration.ofSeconds(60)).POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
        } catch (Exception error) { throw new BridgeProtocol.Failure("identity_request_unavailable"); }
        finally { if (key != null) Arrays.fill(key, (byte) 0); }
    }
    private static void release(UUID maid) { ACTIVE.remove(maid); CAPACITY.release(); }
    private static void fail(LLMCallback callback, String code) {
        // Never forward a request/header/raw exception through TLM's logging callback.
        callback.onFailure(null, new IllegalStateException(code), ErrorCode.REQUEST_RECEIVED_ERROR);
    }
}
