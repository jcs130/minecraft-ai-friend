package dev.qiandeng.bedrock;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;
import org.cloudburstmc.math.vector.Vector3f;
import org.cloudburstmc.protocol.bedrock.packet.PlaySoundPacket;
import org.geysermc.geyser.session.GeyserSession;

/** Decode the installed TLM 1.5.3 native packets, on this recipient only.
 * Original server events decide the audience and cancel muted accessories.
 * The original metadata supplies each maid's silence/frequency/voice selection.
 */
final class MaidVoicePresentation {
    record Cue(String event, String pack, Integer entityId, Vector3f position, float volume, float pitch) {}
    private record Config(UUID uuid, double frequency, boolean silent) {}
    private final GeyserSession session;
    private final Map<String, Map<String, String>> packs;
    private final Map<Integer, Config> entities = new HashMap<>();

    MaidVoicePresentation(GeyserSession session, Map<String, Map<String, String>> packs) {
        this.session = session; this.packs = packs;
    }

    void configure(Map<String, Object> data) {
        if (!Long.valueOf(1).equals(data.get("schemaVersion"))) return;
        int id = ((Number)data.get("entityId")).intValue();
        UUID uuid = UUID.fromString((String)data.get("uuid"));
        double frequency = ((Number)data.get("frequency")).doubleValue();
        if (!Double.isFinite(frequency) || frequency < 0 || frequency > 1
                || id < 0 || entities.size() >= 4096 && !entities.containsKey(id))
            throw new IllegalArgumentException("Invalid maid voice metadata");
        entities.put(id, new Config(uuid, frequency, Boolean.TRUE.equals(data.get("silent"))));
    }

    static int varint(ByteBuffer input) {
        int value = 0;
        for (int n = 0; n < 5; n++) {
            int b = Byte.toUnsignedInt(input.get());
            if (n == 4 && (b & 0xf0) != 0) throw new IllegalArgumentException("Oversized maid varint");
            value |= (b & 127) << (n*7);
            if ((b & 128) == 0) return value;
        }
        throw new IllegalArgumentException("Oversized maid varint");
    }
    private static String string(ByteBuffer input) throws Exception {
        int size = varint(input);
        if (size < 1 || size > 256 || size > input.remaining()) throw new IllegalArgumentException("Invalid maid UTF8 length");
        ByteBuffer slice = input.slice(); slice.limit(size); input.position(input.position()+size);
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(slice).toString();
    }
    static Cue decode(String channel, byte[] raw) throws Exception {
        if (raw.length > 1024) throw new IllegalArgumentException("Oversized maid voice payload");
        ByteBuffer data = ByteBuffer.wrap(raw);
        String event = string(data), pack = string(data);
        if (!event.matches("touhou_little_maid:maid\\.[a-z0-9_.]+"))
            throw new IllegalArgumentException("Invalid maid voice event");
        Cue cue;
        if (channel.equals("touhou_little_maid:play_maid_sound")) {
            int id = varint(data);
            if (id < 0) throw new IllegalArgumentException("Negative maid entity ID");
            cue = new Cue(event, pack, id, null, 1, 1);
        } else if (channel.equals("touhou_little_maid:play_maid_sound_at_pos")) {
            double x = data.getDouble(), y = data.getDouble(), z = data.getDouble();
            float volume = data.getFloat(), pitch = data.getFloat();
            if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                    || Math.abs(x) > 30_000_000 || Math.abs(z) > 30_000_000 || Math.abs(y) > 4096
                    || !Float.isFinite(volume) || volume < 0 || volume > 16
                    || !Float.isFinite(pitch) || pitch <= 0 || pitch > 4)
                throw new IllegalArgumentException("Invalid maid sound position/gain");
            cue = new Cue(event, pack, null, Vector3f.from(x, y, z), volume, pitch);
        } else throw new IllegalArgumentException("Unknown maid sound channel");
        if (data.hasRemaining()) throw new IllegalArgumentException("Trailing maid voice bytes");
        return cue;
    }

    void play(Cue cue) {
        Map<String, String> events = packs.get(cue.pack());
        String sound = events == null ? null : events.get(cue.event());
        if (sound == null || session.isClosed()) return; // Unknown packs never borrow the wrong maid's voice.
        Vector3f position = cue.position();
        if (cue.entityId() != null) {
            // TLM chooses a random initial voice; its default may be omitted
            // from spawn metadata. The actual packet's pack ID is authoritative.
            Config config = entities.get(cue.entityId());
            var entity = session.getEntityCache().getEntityByJavaId(cue.entityId());
            if (config == null || entity == null || !config.uuid().equals(entity.uuid())
                    || config.silent() || config.frequency() == 0
                    || ThreadLocalRandom.current().nextDouble() > config.frequency()) return;
            position = entity.getPosition();
        }
        if (position == null) return;
        var packet = new PlaySoundPacket();
        packet.setSound(sound); packet.setPosition(position);
        packet.setVolume(cue.volume()); packet.setPitch(cue.pitch());
        session.sendUpstreamPacket(packet);
    }
    void remove(int id) { entities.remove(id); }
    void clear() { entities.clear(); }
}
