package org.afuhome.numen;

import com.dwinovo.numen.api.library.EntryId;
import com.google.gson.JsonObject;
import java.net.URI;

/** Form validation only. Never put a key in a provider entry or exception. */
final class ModelDraft {
    final JsonObject fields;
    final String service;
    final String key;

    ModelDraft(JsonObject previous, String name, String service, String model,
               String protocol, String url, String key) {
        name = clean(name); service = clean(service); model = clean(model); url = clean(url); key = clean(key);
        if (!EntryId.segment(name) || name.length() > 64) fail("档案名需为1至64字符，不能含路径符号。");
        if (!EntryId.segment(service) || service.length() > 80) fail("服务商名称无效，请填写档案使用的服务商标识。");
        if (model.isEmpty() || model.length() > 200 || control(model)) fail("请填写有效的模型名称。");
        if (!java.util.Set.of("chat", "responses", "anthropic").contains(protocol)) fail("请选择支持的模型协议。");
        if (!url.isEmpty()) {
            try {
                URI uri = new URI(url);
                if ((!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) || uri.getHost() == null
                        || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
                    fail("模型地址应为HTTP(S)基础地址，不含密码、查询参数或片段。");
                }
            } catch (java.net.URISyntaxException e) { fail("模型地址格式不正确。"); }
        }
        if (key.length() > 4096 || key.chars().anyMatch(c -> Character.isWhitespace(c) || Character.isISOControl(c))) {
            fail("Key格式不正确，请检查空格和换行。");
        }
        this.fields = previous.deepCopy();
        // Preserve advanced settings from Java. Identity/scope are set by the
        // server bridge, never accepted from an arbitrary form response.
        fields.remove("key"); fields.remove("api_key"); fields.remove("scope");
        fields.addProperty("group", "mine"); fields.addProperty("name", name);
        fields.addProperty("provider", service); fields.addProperty("model", model);
        fields.addProperty("protocol", protocol);
        if (url.isEmpty()) fields.remove("base_url"); else fields.addProperty("base_url", url);
        this.service = service; this.key = key;
    }

    static String clean(String text) { return text == null ? "" : text.strip(); }
    private static boolean control(String text) { return text.chars().anyMatch(Character::isISOControl); }
    private static void fail(String message) { throw new IllegalArgumentException(message); }
}
