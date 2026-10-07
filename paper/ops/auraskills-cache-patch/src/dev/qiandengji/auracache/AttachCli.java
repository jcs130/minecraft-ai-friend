package dev.qiandengji.auracache;

import com.sun.tools.attach.VirtualMachine;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/** Run under the same Windows identity/session token as the target JVM. */
public final class AttachCli {
    public static void main(String[] args) throws Exception {
        Map<String, String> options = new HashMap<>();
        for (int i = 0; i < args.length; i += 2) {
            if (i + 1 == args.length || !args[i].startsWith("--")
                    || options.put(args[i].substring(2), args[i + 1]) != null)
                throw new IllegalArgumentException("Use --pid PID --agent JAR --mode fix|rollback --result ABSOLUTE_JSON");
        }
        if (!options.keySet().equals(java.util.Set.of("pid", "agent", "mode", "result")))
            throw new IllegalArgumentException("Expected exactly --pid --agent --mode --result");
        String mode = options.get("mode");
        if (!mode.equals("fix") && !mode.equals("rollback"))
            throw new IllegalArgumentException("Invalid mode");
        if (!options.get("pid").matches("[1-9][0-9]*"))
            throw new IllegalArgumentException("Invalid PID");
        Path agent = Path.of(options.get("agent")).toAbsolutePath().normalize();
        Path result = Path.of(options.get("result"));
        if (!result.isAbsolute() || result.toString().contains(";") || !Files.isRegularFile(agent))
            throw new IllegalArgumentException("Agent must exist; result must be an absolute local path without semicolon");
        Files.createDirectories(result.getParent());
        // Never mistake an old receipt for this operation's result.
        if (Files.exists(result)) throw new IllegalArgumentException("Result already exists; use a fresh path");
        VirtualMachine vm = null;
        try {
            vm = VirtualMachine.attach(options.get("pid"));
            vm.loadAgent(agent.toString(), "mode=" + mode + ";result=" + result);
        } catch (Throwable failure) {
            if (!Files.exists(result)) {
                String json = "{\"success\":false,\"mode\":" + CachePatchAgent.quote(mode)
                        + ",\"phase\":\"attach\",\"timestamp\":" + CachePatchAgent.quote(Instant.now().toString())
                        + ",\"error\":" + CachePatchAgent.quote(failure.toString()) + "}\n";
                Files.writeString(result, json);
                Files.writeString(Path.of(result + ".txt"), failure.toString() + "\n");
            }
            throw failure;
        } finally {
            if (vm != null) vm.detach();
        }
        String receipt = Files.readString(result);
        System.out.print(receipt);
        if (!receipt.contains("\"success\":true")) System.exit(2);
    }
}
