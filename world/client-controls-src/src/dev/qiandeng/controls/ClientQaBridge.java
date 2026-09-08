package dev.qiandeng.controls;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.components.AbstractWidget;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.Set;

/** Explicit QA opt-in, fixed development instance and three harmless framebuffer/UI actions. */
final class ClientQaBridge {
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    private final Set<String> consumed = new HashSet<>();
    private int ticks;
    private boolean loaded;

    void tick(Minecraft mc) {
        if (++ticks % 10 != 0 || !QaPolicy.enabled(Boolean.getBoolean("qiandeng.controls.qa"),
                mc.getUser().getName(), mc.gameDirectory.toPath())) return;
        Path request = QaPolicy.CLIENT.resolve("qa-controls.json");
        Path result = QaPolicy.CLIENT.resolve("qa-controls-result.json");
        try {
            if (!loaded) {
                loaded = true;
                if (Files.isRegularFile(result)) {
                    JsonObject prior = JsonParser.parseString(Files.readString(result)).getAsJsonObject();
                    if (prior.has("id")) consumed.add(prior.get("id").getAsString());
                }
            }
            if (!Files.isRegularFile(request) || Files.size(request) > 4096) return;
            JsonObject input = JsonParser.parseString(Files.readString(request, StandardCharsets.UTF_8)).getAsJsonObject();
            String id = input.has("id") ? input.get("id").getAsString() : "";
            String action = input.has("action") ? input.get("action").getAsString() : "";
            if (!QaPolicy.valid(id, action) || !consumed.add(id)) return;
            JsonObject output = new JsonObject();
            output.addProperty("id", id);
            output.addProperty("action", action);
            output.addProperty("username", "QiandengTest");
            output.addProperty("physical_controller_verified", false);
            if (action.equals("open_guide")) mc.setScreen(new FieldGuideScreen());
            else if (action.equals("close")) mc.setScreen(null);
            output.addProperty("screen_class", mc.screen == null ? "" : mc.screen.getClass().getName());
            output.addProperty("screen_title", mc.screen == null ? "" : mc.screen.getTitle().getString());
            if (mc.screen != null) {
                var labels = new com.google.gson.JsonArray();
                for (var child : mc.screen.children()) if (child instanceof AbstractWidget widget) labels.add(widget.getMessage().getString());
                output.add("widget_labels", labels);
            }
            if (action.equals("screenshot")) {
                String filename = "qd-controls-" + id + ".png";
                Screenshot.grab(mc.gameDirectory, filename, mc.getMainRenderTarget(), message -> {
                    output.addProperty("screenshot", "screenshots/" + filename);
                    output.addProperty("result", message.getString());
                    output.addProperty("ok", Files.isRegularFile(QaPolicy.CLIENT.resolve("screenshots").resolve(filename)));
                    write(result, output);
                });
            } else {
                output.addProperty("ok", true);
                write(result, output);
            }
        } catch (Exception failure) {
            QiandengControls.LOG.warn("[qiandeng-controls] QA request rejected: {}", failure.getClass().getSimpleName());
        }
    }

    private static synchronized void write(Path path, JsonObject output) {
        try {
            Path temp = path.resolveSibling("qa-controls-result.tmp");
            Files.writeString(temp, JSON.toJson(output) + "\n", StandardCharsets.UTF_8);
            Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception error) {
            QiandengControls.LOG.warn("[qiandeng-controls] QA result unavailable: {}", error.getClass().getSimpleName());
        }
    }
}
