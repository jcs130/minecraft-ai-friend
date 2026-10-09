package dev.qiandeng.maw.numencompat;

import net.neoforged.fml.common.Mod;
import org.slf4j.LoggerFactory;

/** Dedicated-server compatibility; the official Numen artifact remains intact. */
@Mod("maw_numen_compat")
public final class NumenCompat {
    public NumenCompat() {
        LoggerFactory.getLogger("maw-numen-compat").info(
                "Numen 0.1.4.1 client channels are optional; native codecs and owner permissions retained.");
    }
}
