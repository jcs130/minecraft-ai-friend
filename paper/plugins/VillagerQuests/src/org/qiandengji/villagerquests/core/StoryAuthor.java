package org.qiandengji.villagerquests.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Writes the title and story of a commission. Implementations block; the plugin only calls them off the main
 * thread and always has {@link Templates#fallback} ready. Rules, numbers and rewards never go through here.
 */
public interface StoryAuthor {
    String complete(String system, String user) throws Exception;

    String name();

    /** System prompt: fixed text first so the provider's prefix cache can hit. */
    static String systemPrompt(String persona) {
        return "你是千灯纪艾恩葛朗特村庄的委托书记。只输出一个 JSON 对象，不要输出其他文字。"
                + "JSON 只能有两个字段：title（不超过 20 个汉字的委托标题）和 story（不超过 120 个汉字的委托缘由）。"
                + "不要写奖励、数量、坐标、命令、颜色代码或链接；这些由系统决定。"
                + (persona == null || persona.isBlank() ? "" : "\n村民设定：" + Text.clean(persona, 400));
    }

    static String userPrompt(Commission c, String villagerName, String reason) {
        return "村民：" + Text.clean(villagerName, 32) + "\n需求：" + Templates.ask(c) + "\n期限：" + c.deadlineMinutes() + " 分钟"
                + (reason == null || reason.isBlank() ? "" : "\n起因：" + Text.clean(reason, 120));
    }

    /** OpenAI-compatible {@code /chat/completions} (DeepSeek official, 硅基流动, LiteLLM...). */
    final class OpenAiCompatible implements StoryAuthor {
        private final URI endpoint;
        private final String apiKey, model;
        private final double temperature;
        private final int maxTokens;
        private final Duration timeout;
        private final boolean jsonMode;
        private final HttpClient http;

        public OpenAiCompatible(String endpoint, String apiKey, String model, double temperature, int maxTokens, Duration timeout, boolean jsonMode) {
            URI uri = URI.create(endpoint);
            if (!"https".equals(uri.getScheme()) && !isLoopback(uri)) throw new IllegalArgumentException("endpoint must be https (or http on loopback)");
            this.endpoint = uri;
            this.apiKey = apiKey == null ? "" : apiKey.strip();
            this.model = model;
            this.temperature = temperature;
            this.maxTokens = maxTokens;
            this.timeout = timeout;
            this.jsonMode = jsonMode;
            this.http = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build();
        }

        private static boolean isLoopback(URI uri) {
            String h = uri.getHost();
            return "http".equals(uri.getScheme()) && ("127.0.0.1".equals(h) || "localhost".equals(h) || "[::1]".equals(h));
        }

        public String name() { return "openai-compatible:" + endpoint.getHost() + "/" + model; }

        public static String requestBody(String model, String system, String user, double temperature, int maxTokens, boolean jsonMode) {
            JsonObject body = new JsonObject();
            body.addProperty("model", model);
            JsonArray messages = new JsonArray();
            JsonObject s = new JsonObject(); s.addProperty("role", "system"); s.addProperty("content", system); messages.add(s);
            JsonObject u = new JsonObject(); u.addProperty("role", "user"); u.addProperty("content", user); messages.add(u);
            body.add("messages", messages);
            body.addProperty("temperature", temperature);
            body.addProperty("max_tokens", maxTokens);
            body.addProperty("stream", false);
            if (jsonMode) { JsonObject f = new JsonObject(); f.addProperty("type", "json_object"); body.add("response_format", f); }
            return body.toString();
        }

        /** {@code choices[0].message.content}, or throws. */
        public static String parseContent(String responseBody) {
            JsonObject o = JsonParser.parseString(responseBody).getAsJsonObject();
            return o.getAsJsonArray("choices").get(0).getAsJsonObject().getAsJsonObject("message").get("content").getAsString();
        }

        @Override
        public String complete(String system, String user) throws Exception {
            if (apiKey.isEmpty()) throw new IllegalStateException("no API key configured");
            HttpRequest req = HttpRequest.newBuilder(endpoint).timeout(timeout)
                    .header("Content-Type", "application/json").header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(requestBody(model, system, user, temperature, maxTokens, jsonMode), StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            // Status only: provider error bodies can echo request headers on some proxies.
            if (res.statusCode() / 100 != 2) throw new IllegalStateException("HTTP " + res.statusCode());
            if (res.body().length() > 64 * 1024) throw new IllegalStateException("response too large");
            return parseContent(res.body());
        }
    }

    /**
     * 米饭 DeepSeek plugin 1.4.0: static {@code cn.handyplus.deep.seek.api.DeepSeekApi.chat(String role, String message)}
     * returning the reply. Found by reflection so the plugin builds and runs without it (soft-depend).
     * The role's system prompt lives in DeepSeek's own config ({@code chatSystem.<role>.role}); we also prepend ours.
     */
    final class MifanDeepSeek implements StoryAuthor {
        public static final String API_CLASS = "cn.handyplus.deep.seek.api.DeepSeekApi";
        private final Method chat;
        private final String role;

        public MifanDeepSeek(ClassLoader loader, String role) throws ReflectiveOperationException {
            this.chat = findChat(Class.forName(API_CLASS, true, loader));
            this.role = role;
        }

        static Method findChat(Class<?> api) throws NoSuchMethodException {
            for (Method m : api.getMethods()) {
                if (m.getName().equals("chat") && Modifier.isStatic(m.getModifiers()) && m.getReturnType() == String.class
                        && m.getParameterCount() == 2 && m.getParameterTypes()[0] == String.class && m.getParameterTypes()[1] == String.class)
                    return m;
            }
            throw new NoSuchMethodException(api.getName() + ".chat(String, String) -> String");
        }

        public String name() { return "mifan-deepseek:" + role; }

        @Override
        public String complete(String system, String user) throws Exception {
            Object out = chat.invoke(null, role, system + "\n\n" + user);
            if (out == null) throw new IllegalStateException("empty reply");
            return (String) out;
        }
    }
}
