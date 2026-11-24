package org.qiandengji.villagerquests;

import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.bukkit.Bukkit;

/** Small loopback-only transport. It never evaluates game state on an HTTP worker. */
final class VillagerBodyHttp implements HttpHandler {
    private static final int MAX_BODY = 65_536;
    private final VillagerQuestsPlugin plugin;
    private final VillagerBodyPort port;
    private final byte[] token;

    VillagerBodyHttp(VillagerBodyPort port, String token) {
        this.plugin = port.plugin();
        this.port = port;
        this.token = token.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try {
            if (exchange.getRemoteAddress().getAddress() == null || !exchange.getRemoteAddress().getAddress().isLoopbackAddress()) {
                respond(exchange, 403, error("loopback_required", "Only loopback clients may use this port"));
                return;
            }
            if (!"POST".equals(exchange.getRequestMethod()) || !"/villager-body".equals(exchange.getRequestURI().getPath())) {
                respond(exchange, 405, error("method_not_allowed", "POST /villager-body is required"));
                return;
            }
            String authorization = exchange.getRequestHeaders().getFirst("Authorization");
            String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
            if (authorization == null || !authorization.startsWith("Bearer ")
                    || !MessageDigest.isEqual(token, authorization.substring(7).getBytes(StandardCharsets.UTF_8))) {
                respond(exchange, 401, error("unauthorized", "Valid bearer token required"));
                return;
            }
            if (contentType == null || !contentType.toLowerCase(java.util.Locale.ROOT).startsWith("application/json")) {
                respond(exchange, 415, error("json_required", "Content-Type must be application/json"));
                return;
            }
            long length = exchange.getRequestHeaders().getFirst("Content-Length") == null ? -1
                    : Long.parseLong(exchange.getRequestHeaders().getFirst("Content-Length"));
            if (length > MAX_BODY) {
                respond(exchange, 413, error("request_too_large", "Request exceeds 65536 bytes"));
                return;
            }
            byte[] body = exchange.getRequestBody().readNBytes(MAX_BODY + 1);
            if (body.length > MAX_BODY || length >= 0 && body.length != length) {
                respond(exchange, 400, error("bad_request_length", "Request body length is invalid"));
                return;
            }
            JsonObject request;
            try { request = com.google.gson.JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject(); }
            catch (RuntimeException invalid) {
                respond(exchange, 400, error("bad_json", "Request must be a JSON object"));
                return;
            }
            CompletableFuture<VillagerBodyPort.Reply> future = new CompletableFuture<>();
            try {
                Bukkit.getScheduler().runTask(plugin, () -> future.complete(port.dispatch(request, token)));
            } catch (RuntimeException disabled) {
                respond(exchange, 503, error("port_disabled", "Body port is not active"));
                return;
            }
            VillagerBodyPort.Reply reply;
            try { reply = future.get(30, TimeUnit.SECONDS); }
            catch (TimeoutException timeout) {
                respond(exchange, 504, error("observation_unknown", "Main-thread observation timed out; query the original request receipt and do not replay blindly"));
                return;
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                respond(exchange, 503, error("observation_unknown", "Observation interrupted; query the original request receipt"));
                return;
            } catch (java.util.concurrent.ExecutionException failure) {
                respond(exchange, 500, error("internal_error", "Body request failed"));
                return;
            }
            respond(exchange, reply.status(), reply.json());
        } catch (RuntimeException invalid) {
            respond(exchange, 400, error("bad_request", "Malformed body-port request"));
        } finally {
            exchange.close();
        }
    }

    private static JsonObject error(String code, String message) {
        JsonObject result = new JsonObject();
        result.addProperty("protocol", VillagerBodyPort.PROTOCOL);
        JsonObject error = new JsonObject();
        error.addProperty("code", code);
        error.addProperty("message", message);
        result.add("error", error);
        return result;
    }

    private static void respond(HttpExchange exchange, int status, JsonObject body) throws IOException {
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }
}
