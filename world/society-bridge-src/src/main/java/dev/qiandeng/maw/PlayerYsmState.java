package dev.qiandeng.maw;

import com.google.gson.JsonObject;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.attachment.AttachmentType;
import net.neoforged.neoforge.registries.NeoForgeRegistries;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;

/** Read the requesting player's existing YSM attachment, without a YSM compile dependency. */
final class PlayerYsmState {
    private static final String MOD_ID = "yes_steve_model";
    private static final String VERSION = "2.6.5-neoforge+mc1.21.1";
    private static final String JAR_SHA256 = "b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb";
    private static final long JAR_SIZE = 63_463_229;
    private static final String CLASS_NAME = "com.elfmcys.yesstevemodel.O0o0OoOOooOo0O0OOoo0Oo00";
    private static final String CLASS_RESOURCE = CLASS_NAME.replace('.', '/') + ".class";
    private static final String CLASS_SHA256 = "77bc096ba6bf15738420d2d148c037b7b4a6f213c5af35230acd849b7484578d";
    private static final int MAX_CLASS_BYTES = 1_048_576;
    private static final int MAX_VALUE_CHARACTERS = 256;
    private static final int MAX_VALUE_UTF8 = 1024;

    // Loaded mod files and attachment classes do not change during a server
    // lifecycle. Hash them once, not once per player or every menu tick.
    private static volatile Verification verification;
    private static volatile Binding binding;

    private record Verification(AttachmentType<?> type, String reason) {}
    private record Binding(Class<?> type, Method model, Method texture, Method disabled,
                           Method mandatory, String reason) {}

    static JsonObject snapshot(ServerPlayer player) {
        UUID playerUuid = player.getUUID();
        try {
            ModList mods = ModList.get();
            if (mods == null) return unavailable(playerUuid, "ysm_mod_list_unavailable");
            if (!mods.isLoaded(MOD_ID)) return absent(playerUuid);
            Verification verified = verified(mods);
            if (verified.reason != null) return unavailable(playerUuid, verified.reason);
            // getData() would create a default attachment. Observation must not
            // change this body's model or imply an uninitialized default exists.
            Object data = player.getExistingData(verified.type).orElse(null);
            if (data == null) return unavailable(playerUuid, "ysm_attachment_uninitialized");
            Binding methods = bound(data.getClass());
            if (methods.reason != null) return unavailable(playerUuid, methods.reason);
            if (data.getClass() != methods.type) return unavailable(playerUuid, "ysm_attachment_class_mismatch");
            return observed(playerUuid, (String) methods.model.invoke(data),
                    (String) methods.texture.invoke(data), (boolean) methods.disabled.invoke(data),
                    (boolean) methods.mandatory.invoke(data));
        } catch (ReflectiveOperationException | RuntimeException | LinkageError error) {
            // Never put exception text, paths, authentication, caches or Molang
            // storage on the wire. An unavailable observation is not a model.
            return unavailable(playerUuid, "ysm_attachment_read_failed");
        }
    }

    private static synchronized Verification verified(ModList mods) {
        if (verification != null) return verification;
        String reason = "ysm_artifact_unavailable";
        try {
            var info = mods.getModFileById(MOD_ID);
            var container = mods.getModContainerById(MOD_ID).orElse(null);
            if (info == null || container == null) return verification = new Verification(null, reason);
            if (!VERSION.equals(container.getModInfo().getVersion().toString())) {
                return verification = new Verification(null, "ysm_version_unsupported");
            }
            var file = info.getFile();
            Path jar = file.getFilePath(); // SecureJar.getPrimaryPath(), the actual loaded artifact.
            reason = "ysm_jar_hash_mismatch";
            if (!Files.isRegularFile(jar) || Files.size(jar) != JAR_SIZE) {
                return verification = new Verification(null, reason);
            }
            try (InputStream input = Files.newInputStream(jar)) {
                if (!JAR_SHA256.equals(hash(input, JAR_SIZE))) return verification = new Verification(null, reason);
            }
            reason = "ysm_attachment_class_hash_mismatch";
            // findResource resolves through the loaded mod's own SecureJar,
            // including its union filesystem; no guessed server/mods path.
            try (InputStream input = Files.newInputStream(file.findResource(CLASS_RESOURCE))) {
                if (!CLASS_SHA256.equals(hash(input, MAX_CLASS_BYTES))) return verification = new Verification(null, reason);
            }
            var type = NeoForgeRegistries.ATTACHMENT_TYPES.getOptional(
                    ResourceLocation.fromNamespaceAndPath(MOD_ID, "model_id")).orElse(null);
            if (type == null) return verification = new Verification(null, "ysm_attachment_type_unavailable");
            return verification = new Verification(type, null);
        } catch (IOException | RuntimeException | LinkageError error) {
            return verification = new Verification(null, reason);
        }
    }

    private static synchronized Binding bound(Class<?> type) {
        if (binding != null) return binding;
        try {
            if (!CLASS_NAME.equals(type.getName())) {
                return binding = new Binding(null, null, null, null, null, "ysm_attachment_class_mismatch");
            }
            // Also verify the resource associated with the actual runtime class,
            // rather than trusting a same-named class from another mod loader.
            try (InputStream input = type.getResourceAsStream("/" + CLASS_RESOURCE)) {
                if (input == null || !CLASS_SHA256.equals(hash(input, MAX_CLASS_BYTES))) {
                    return binding = new Binding(null, null, null, null, null, "ysm_attachment_class_hash_mismatch");
                }
            }
            return binding = new Binding(type,
                    getter(type, "oOoo00O0o0oO0o0oO00OO0O0", String.class),
                    getter(type, "OO000o0ooOooooOOOOO0Ooo0", String.class),
                    getter(type, "O0o0OoOOooOo0O0OOoo0Oo00", boolean.class),
                    getter(type, "OOo0O00Ooo00O0Ooo0OoOo0o", boolean.class), null);
        } catch (IOException | ReflectiveOperationException | RuntimeException | LinkageError error) {
            return binding = new Binding(null, null, null, null, null, "ysm_attachment_getters_unavailable");
        }
    }

    private static Method getter(Class<?> type, String name, Class<?> returns) throws ReflectiveOperationException {
        Method method = type.getDeclaredMethod(name);
        if (!Modifier.isPublic(method.getModifiers()) || Modifier.isStatic(method.getModifiers())
                || method.getParameterCount() != 0 || method.getReturnType() != returns) {
            throw new NoSuchMethodException("unsupported YSM getter signature");
        }
        return method;
    }

    private static String hash(InputStream input, long limit) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            long count = 0;
            for (int read; (read = input.read(buffer)) != -1;) {
                count += read;
                if (count > limit) throw new IOException("YSM source exceeds bound");
                digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }

    private static boolean validValue(String value) {
        if (value == null || value.isEmpty() || value.length() > MAX_VALUE_CHARACTERS
                || value.getBytes(StandardCharsets.UTF_8).length > MAX_VALUE_UTF8) return false;
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (Character.isISOControl(character)) return false;
            if (Character.isHighSurrogate(character)) {
                if (++i >= value.length() || !Character.isLowSurrogate(value.charAt(i))) return false;
            } else if (Character.isLowSurrogate(character)) return false;
        }
        return true;
    }

    static JsonObject observed(UUID playerUuid, String model, String texture, boolean disabled, boolean mandatory) {
        if (!validValue(model) || !validValue(texture)) return unavailable(playerUuid, "ysm_attachment_values_invalid");
        JsonObject value = base(playerUuid, true, true);
        value.addProperty("modelId", model);
        value.addProperty("texture", texture);
        value.addProperty("enabled", !disabled);
        value.addProperty("mandatory", mandatory);
        value.addProperty("ysmVersion", "2.6.5");
        value.addProperty("jarSha256", JAR_SHA256);
        return value;
    }

    static JsonObject absent(UUID playerUuid) {
        JsonObject value = base(playerUuid, true, false);
        value.addProperty("enabled", false);
        return value;
    }

    static JsonObject unavailable(UUID playerUuid, String reason) {
        JsonObject value = base(playerUuid, false, true);
        value.addProperty("reason", reason);
        return value;
    }

    private static JsonObject base(UUID playerUuid, boolean available, boolean installed) {
        JsonObject value = new JsonObject();
        value.addProperty("available", available);
        value.addProperty("installed", installed);
        value.addProperty("source", "same_player_native_attachment");
        value.addProperty("playerUuid", playerUuid.toString());
        return value;
    }
}
