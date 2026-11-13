package local.tlmcompat.hybrid;

/** Boost one companion before Opus encoding while leaving headroom for loud peaks. */
final class MaidSpeechVolume {
    private static final double KNEE = .65 * Short.MAX_VALUE;
    private static final double HEADROOM = .97 * Short.MAX_VALUE - KNEE;
    private final double gain;

    MaidSpeechVolume(double decibels) {
        if (!Double.isFinite(decibels) || decibels < 0 || decibels > 12)
            throw new IllegalArgumentException("Companion voice gain must be between 0 and 12 dB");
        gain = Math.pow(10, decibels / 20);
    }

    void copy(short[] pcm, int offset, short[] frame, int count) {
        if (gain == 1) {
            System.arraycopy(pcm, offset, frame, 0, count);
            return;
        }
        for (int i = 0; i < count; i++) {
            double sample = pcm[offset + i] * gain;
            double level = Math.abs(sample);
            if (level > KNEE) level = KNEE - HEADROOM * Math.expm1((KNEE - level) / HEADROOM);
            frame[i] = (short) Math.round(Math.copySign(level, sample));
        }
    }
}
