package dev.qiandeng.rconqa;

import com.google.gson.Gson;
import java.io.DataInputStream;
import java.io.ByteArrayOutputStream;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** Socket driver inside the disposable QA container; no published game ports. */
public final class RconConcurrentClient {
    private static final Gson JSON = new Gson();
    private record Reply(int id, int kind, String text) {}

    public static void main(String[] args) throws Exception {
        if (!"isolated-rcon-transaction".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("isolated_fixture_required");
        Properties properties = new Properties();
        try (var input = Files.newInputStream(Path.of("/data/server.properties"))) { properties.load(input); }
        String password = properties.getProperty("rcon.password");
        if (args[0].equals("single")) {
            System.out.println(JSON.toJson(Map.of("raw", command(password, args[1]))));
            return;
        }
        if (args[0].equals("auth")) {
            try (Socket socket = connect()) {
                socket.getOutputStream().write(frame(71, 3, "intentionally-wrong"));
                Reply denied = receive(socket);
                socket.getOutputStream().write(frame(72, 2, "qdrconqa echo unauthorized"));
                Reply deniedCommand = receive(socket);
                System.out.println(JSON.toJson(Map.of("authDenied", denied.equals(new Reply(-1, 2, "")),
                        "commandDenied", deniedCommand.equals(new Reply(-1, 2, "")))));
            }
            return;
        }
        if (!args[0].equals("concurrent")) throw new IllegalArgumentException("mode");
        CyclicBarrier start = new CyclicBarrier(12);
        List<Map<String, Object>> rows = new ArrayList<>();
        try (var clients = Executors.newFixedThreadPool(12)) {
            List<Future<List<Map<String, Object>>>> work = new ArrayList<>();
            for (int client = 0; client < 12; client++) {
                final int id = client;
                work.add(clients.submit(() -> {
                    start.await(15, TimeUnit.SECONDS);
                    List<Map<String, Object>> results = new ArrayList<>();
                    for (int turn = 0; turn < 8; turn++) {
                        String token = args[1] + "-c" + id + "-t" + turn;
                        String raw = command(password, "qdrconqa echo " + token);
                        results.add(Map.of("token", token, "raw", raw,
                                "exact", raw.equals("QD_RCON_REPLY " + token + "\n")));
                    }
                    return results;
                }));
            }
            for (var item : work) rows.addAll(item.get(30, TimeUnit.SECONDS));
        }
        System.out.println(JSON.toJson(Map.of("rows", rows)));
    }

    private static Socket connect() throws Exception {
        Socket socket = new Socket("127.0.0.1", 25575);
        socket.setSoTimeout(15000);
        return socket;
    }

    private static byte[] frame(int id, int kind, String text) {
        byte[] value = text.getBytes(StandardCharsets.UTF_8);
        return ByteBuffer.allocate(value.length + 14).order(ByteOrder.LITTLE_ENDIAN)
                .putInt(value.length + 10).putInt(id).putInt(kind).put(value).put((byte) 0).put((byte) 0).array();
    }

    private static Reply receive(Socket socket) throws Exception {
        var input = new DataInputStream(socket.getInputStream());
        int size = Integer.reverseBytes(input.readInt());
        if (size < 10 || size > 1048576) throw new IllegalStateException("frame_size");
        byte[] body = input.readNBytes(size);
        if (body.length != size || body[size - 1] != 0 || body[size - 2] != 0)
            throw new IllegalStateException("frame_incomplete");
        var bytes = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN);
        int id = bytes.getInt(), kind = bytes.getInt();
        return new Reply(id, kind, new String(body, 8, size - 10, StandardCharsets.UTF_8));
    }

    private static String command(String password, String command) throws Exception {
        try (Socket socket = connect()) {
            socket.getOutputStream().write(frame(1, 3, password));
            if (!receive(socket).equals(new Reply(1, 2, ""))) throw new IllegalStateException("auth_failed");
            socket.getOutputStream().write(frame(2, 2, command));
            StringBuilder reply = new StringBuilder();
            boolean endRequested = false;
            for (int i = 0; i < 256; i++) {
                Reply part = receive(socket);
                if (part.id == 2 && part.kind == 0) {
                    reply.append(part.text);
                    if (!endRequested) {
                        socket.getOutputStream().write(frame(3, 0, ""));
                        endRequested = true;
                    }
                } else if (endRequested && part.equals(new Reply(3, 0, "Unknown request 0"))) {
                    return reply.toString();
                } else throw new IllegalStateException("response_id_or_end");
            }
            throw new IllegalStateException("unbounded_response");
        }
    }
}
