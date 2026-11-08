/* Derived from Android Audio Shim, Copyright (c) 2026 Hhhrty2, MIT.
 * Qiandengji: use the launcher's private native directory and verify bytes.
 * The native microphone/speaker implementation remains the upstream binary.
 */
package de.maxhenkel.shim;

import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

public class NativeAudio {
    private static final String SHA256 = "@NATIVE_SHA256@";
    private static boolean loaded;
    private static String loadError;

    static {
        String arch = System.getProperty("os.arch", "");
        if (!arch.equals("aarch64") && !arch.equals("arm64")) {
            loadError = "This audio bridge requires Android arm64";
        } else {
            Set<String> directories = new LinkedHashSet<String>();
            directories.add(System.getenv("MOD_ANDROID_RUNTIME"));
            directories.add(System.getProperty("java.io.tmpdir"));
            for (String directory : directories) {
                if (directory == null || directory.isEmpty()) continue;
                try {
                    Path parent = Paths.get(directory);
                    if (!parent.isAbsolute()) continue;
                    Files.createDirectories(parent);
                    Path target = parent.resolve("libaudioshim-" + SHA256 + ".so");
                    if (!Files.exists(target)) {
                        Path temporary = Files.createTempFile(parent, "qd-audio-", ".partial");
                        try (InputStream in = NativeAudio.class.getResourceAsStream("/natives/libaudioshim.so")) {
                            if (in == null) throw new IOException("Bundled Android audio library missing");
                            Files.copy(in, temporary, StandardCopyOption.REPLACE_EXISTING);
                            verify(temporary);
                            try { Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE); }
                            catch (AtomicMoveNotSupportedException e) { Files.move(temporary, target); }
                            catch (FileAlreadyExistsException e) { /* Verify the other complete copy below. */ }
                        } finally { Files.deleteIfExists(temporary); }
                    }
                    verify(target);
                    System.load(target.toString());
                    loaded = true;
                    loadError = null;
                    break;
                } catch (Throwable error) {
                    loadError = error.getClass().getSimpleName() + ": " + error.getMessage();
                }
            }
            if (!loaded && loadError == null) loadError = "No private Android runtime directory available";
        }
    }

    private static void verify(Path file) throws Exception {
        if (Files.isSymbolicLink(file) || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS))
            throw new IOException("Audio library must be a regular file");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = Files.newInputStream(file)) {
            byte[] buffer = new byte[8192];
            for (int n; (n = in.read(buffer)) != -1;) digest.update(buffer, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte value : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", value & 255));
        if (!SHA256.equals(hex.toString())) throw new IOException("Android audio library checksum mismatch");
    }

    public static boolean isAvailable() { return loaded; }
    public static String getLoadError() { return loadError; }
    public static native int open(int sampleRate, int framesPerBuffer);
    public static native int start();
    public static native int stop();
    public static native int close();
    public static native int read(byte[] buf, int offset, int length);
}
