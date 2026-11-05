package org.qiandeng.camera;

import java.util.Locale;

/** Fail closed when a dedicated camera starts on an unexpected adapter. */
final class CameraGpuPolicy {
    static void verify(String expected, String renderer, String vendor) {
        String actual=String.valueOf(renderer).toLowerCase(Locale.ROOT);
        boolean matches=switch(expected) {
            case "intel" -> actual.contains("intel");
            case "rtx3080ti" -> "NVIDIA Corporation".equals(vendor)
                && actual.matches("nvidia geforce rtx 3080 ti(?:/.*)?");
            default -> throw new IllegalArgumentException("CAMERA_GPU_PROFILE_UNKNOWN: "+expected);
        };
        if(!matches)throw new IllegalStateException("CAMERA_GPU_MISMATCH: expected="+expected+", actual="+renderer);
    }
}
