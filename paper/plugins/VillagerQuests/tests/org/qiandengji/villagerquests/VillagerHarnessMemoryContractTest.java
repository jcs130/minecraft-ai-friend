package org.qiandengji.villagerquests;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public final class VillagerHarnessMemoryContractTest {
    public static void main(String[] args) throws Exception {
        exchange(false);
        exchange(true);
        System.out.println("villager memory wire passed");
    }

    private static void exchange(boolean supportsMemory) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger probes = new AtomicInteger();
        AtomicReference<JsonObject> received = new AtomicReference<>();
        server.createContext("/v1/villager/health", exchange -> {
            try (exchange) {
                probes.incrementAndGet();
                assert exchange.getRequestMethod().equals("GET");
                if (supportsMemory) exchange.getResponseHeaders().add("X-QD-Villager-Memory", "commissions-v1");
                exchange.sendResponseHeaders(200, -1);
            }
        });
        server.createContext("/v1/villager/decide", exchange -> {
            try (exchange) {
                received.set(JsonParser.parseString(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject());
                byte[] body = """
                        {"schemaVersion":1,"eventId":"original-event","decision":{"kind":"continue"}}
                        """.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
            }
        });
        server.start();
        try {
            VillagerHarnessClient client = new VillagerHarnessClient(
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/v1/villager/decide", "fixture_test_key");
            JsonObject observation = JsonParser.parseString(
                    "{\"eventId\":\"original-event\",\"completedCommissions\":[\"vq_test\"]}").getAsJsonObject();
            assert client.decide(observation).isEmpty();
            assert received.get().has("completedCommissions") == supportsMemory;
            assert observation.has("completedCommissions");
            assert probes.get() == 1;
        } finally {
            server.stop(0);
        }
    }
}
