package org.qiandeng.camera;

/** Bound idle rendering on the GPU shared with speech and System 1. */
public final class CameraFramePolicy {
    public static int limit(boolean enabled, String gpu, boolean capture, int original) {
        if (!enabled || !"rtx3080ti".equals(gpu)) return original;
        return Math.min(original, capture ? 30 : 5);
    }
}
