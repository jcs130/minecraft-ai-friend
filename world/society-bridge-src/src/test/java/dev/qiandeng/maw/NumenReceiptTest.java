package dev.qiandeng.maw;

import com.google.gson.JsonObject;
import java.lang.reflect.InvocationTargetException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/** Exercise the real durable store; a previous process's unfinished intent stays unknown. */
public final class NumenReceiptTest {
    private static int checks;
    private static void check(boolean value) { if (!value) throw new AssertionError("check " + checks); checks++; }
    public static void main(String[] args) throws Exception {
        Class<?> bridge = Class.forName("dev.qiandeng.maw.NumenBodyBridge");
        var write = bridge.getDeclaredMethod("write", Path.class, JsonObject.class, boolean.class); write.setAccessible(true);
        var read = bridge.getDeclaredMethod("read", Path.class); read.setAccessible(true);
        Path dir = Files.createTempDirectory("numen-durable-receipt-");
        Path record = dir.resolve("action.json");
        try {
            JsonObject intent = new JsonObject();
            intent.addProperty("session", "previous-server-process"); intent.addProperty("phase", "accepted");
            intent.addProperty("ok", true); intent.addProperty("finalKnown", false);
            intent.addProperty("programSha256", "hash-before-dispatch"); intent.addProperty("name", "测试同伴");
            write.invoke(null, record, intent, true);
            byte[] original = Files.readAllBytes(record);
            JsonObject unknown = (JsonObject) read.invoke(null, record);
            check(unknown.get("phase").getAsString().equals("unknown"));
            check(!unknown.get("ok").getAsBoolean()); check(!unknown.get("finalKnown").getAsBoolean());
            check(unknown.get("code").getAsString().equals("interrupted_result_unknown_do_not_replay"));
            check(unknown.get("name").getAsString().equals("测试同伴"));
            check(Arrays.equals(original, Files.readAllBytes(record)));
            try { write.invoke(null, record, new JsonObject(), true); throw new AssertionError("duplicate overwrote intent"); }
            catch (InvocationTargetException expected) { check(expected.getCause() instanceof java.nio.file.FileAlreadyExistsException); }
            check(Arrays.equals(original, Files.readAllBytes(record)));
            JsonObject terminal = intent.deepCopy(); terminal.addProperty("phase", "terminal"); terminal.addProperty("finalKnown", true);
            write.invoke(null, record, terminal, false);
            JsonObject restored = (JsonObject) read.invoke(null, record);
            check(restored.get("phase").getAsString().equals("terminal")); check(restored.get("finalKnown").getAsBoolean());
            check(restored.get("programSha256").getAsString().equals("hash-before-dispatch"));
            check(Files.list(dir).count() == 1);
            System.out.println("NumenReceipt " + checks + " checks passed");
        } finally {
            try (var entries = Files.list(dir)) { for (Path p : entries.toList()) Files.delete(p); }
            Files.delete(dir);
        }
    }
}
