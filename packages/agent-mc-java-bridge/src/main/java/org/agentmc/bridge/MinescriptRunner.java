package org.agentmc.bridge;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import net.fabricmc.loader.api.FabricLoader;

/** Optional, version-pinned external execution adapter. No Minescript implementation is bundled. */
final class MinescriptRunner {
    private final Path game;
    private final Class<?> api;
    private final Object manager;
    private final Method jobs;
    private Object active;
    private Path output;
    private long deadline;
    MinescriptRunner(Path game) throws Exception {
        if (!Path.of("").toAbsolutePath().normalize().equals(game.toAbsolutePath().normalize())) throw new IllegalStateException("Minescript 4.0 resolves scripts/config from the process working directory; launch with working directory equal to gameDir");
        this.game = game;
        String version = FabricLoader.getInstance().getModContainer("minescript").orElseThrow().getMetadata().getVersion().getFriendlyString();
        if (!version.equals("4.0")) throw new IllegalStateException("Minescript adapter requires pinned version 4.0");
        api = Class.forName("net.minescript.common.Minescript");
        Field field = api.getDeclaredField("jobs"); field.setAccessible(true); manager = field.get(null);
        jobs = manager.getClass().getDeclaredMethod("getMap"); jobs.setAccessible(true);
    }
    @SuppressWarnings("unchecked") private Map<Integer, Object> map() throws Exception { return (Map<Integer, Object>)jobs.invoke(manager); }
    static void validate(JsonObject input) {
        if (!input.has("code") || !input.get("code").isJsonPrimitive() || !input.getAsJsonPrimitive("code").isString()
            || input.get("code").getAsString().isBlank() || input.get("code").getAsString().length() > 32768) throw new IllegalArgumentException("Minescript code must contain 1..32768 characters");
        int timeout = input.has("timeoutMs") ? input.get("timeoutMs").getAsInt() : 10000;
        if (timeout < 100 || timeout > 30000) throw new IllegalArgumentException("Minescript timeoutMs must be 100..30000");
        if (input.has("input") && input.get("input").toString().length() > 32768) throw new IllegalArgumentException("Minescript input too large");
    }
    void start(String actionId, JsonObject input) throws Exception {
        validate(input);
        if (active != null || !map().isEmpty()) throw new IllegalStateException("Another Minescript job is running; no takeover");
        String name = "agentmc_" + ControlLedger.hash(actionId);
        Path script = game.resolve("minescript").resolve(name + ".py");
        Path directory = game.resolve("agent-mc-bridge").resolve("scripts"); Files.createDirectories(directory);
        output = directory.resolve(name + ".result.json");
        Path request = directory.resolve(name + ".input.json");
        if (Files.exists(output)) throw new IllegalStateException("Existing script evidence; reconcile original action ID");
        Files.writeString(request, input.toString());
        String source = """
import json, os, traceback, dataclasses
from pathlib import Path
import minescript
_request = Path(%s)
_output = Path(%s)
def _json_default(value):
    if dataclasses.is_dataclass(value): return dataclasses.asdict(value)
    raise TypeError('result must be JSON serializable')
try:
    _data = json.loads(_request.read_text(encoding='utf-8'))
    _scope = {'minescript': minescript, 'input_data': _data.get('input'), 'result': None, '__name__': '__agent_script__'}
    exec(compile(_data['code'], '<agent-script>', 'exec'), _scope, _scope)
    minescript.flush()
    _reply = {'ok': True, 'result': _scope.get('result'), 'programReport': True}
    _encoded = json.dumps(_reply, ensure_ascii=False, default=_json_default)
    if len(_encoded.encode('utf-8')) > 262144: raise ValueError('script result too large')
except BaseException as _error:
    _encoded = json.dumps({'ok': False, 'error': str(_error)[:1000], 'programReport': True}, ensure_ascii=False)
finally:
    for _key in ('forward','back','left','right','jump','sneak','sprint','attack','use'):
        try: minescript.press_key_bind('key.' + _key, False)
        except BaseException: pass
_tmp = _output.with_suffix('.tmp')
_tmp.write_text(_encoded, encoding='utf-8')
os.replace(_tmp, _output)
""".formatted(new Gson().toJson(request.toString()), new Gson().toJson(output.toString()));
        Files.createDirectories(script.getParent()); Files.writeString(script, source);
        api.getMethod("onClientChat", String.class).invoke(null, "\\" + name + " > null 2> log");
        for (Object job : map().values()) {
            Object command = job.getClass().getMethod("boundCommand").invoke(job);
            Path path = (Path)command.getClass().getMethod("scriptPath").invoke(command);
            if (path.toAbsolutePath().normalize().equals(script.toAbsolutePath().normalize())) { active = job; break; }
        }
        if (active == null) throw new IllegalStateException("Minescript job was not admitted; inspect private client log");
        deadline = System.currentTimeMillis() + (input.has("timeoutMs") ? input.get("timeoutMs").getAsInt() : 10000);
    }
    JsonObject poll() throws Exception {
        if (active == null) throw new IllegalStateException("No owned Minescript job");
        int id = (int)active.getClass().getMethod("jobId").invoke(active);
        if (System.currentTimeMillis() > deadline) { cancel(); throw new IllegalStateException("Minescript timed out; owned job killed and body keys released"); }
        // Wait for both the result file and removal from the real job manager. A program return alone is not job termination.
        if (map().containsKey(id)) return null;
        active = null;
        if (!Files.isRegularFile(output) || Files.size(output) > 262144) throw new IllegalStateException("Minescript job exited without bounded result; reconcile, do not replay");
        JsonObject result = JsonParser.parseString(Files.readString(output)).getAsJsonObject(); result.addProperty("jobId", id); return result;
    }
    void cancel() throws Exception {
        if (active == null) return;
        Object job = active;
        job.getClass().getMethod("kill").invoke(job);
        if (!((Enum<?>)job.getClass().getMethod("state").invoke(job)).name().equals("KILLED")) throw new IllegalStateException("Owned Minescript cancellation unconfirmed");
        active = null;
    }
}
