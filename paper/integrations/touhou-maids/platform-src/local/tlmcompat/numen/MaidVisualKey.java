package local.tlmcompat.numen;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** Public render selection only. Never an account key, controller or entity identity. */
public final class MaidVisualKey {
    private MaidVisualKey() {}
    public static String ysm(String model,String texture) {
        if(model==null||texture==null||model.length()>256||texture.length()>128)return "";
        var encoder=Base64.getUrlEncoder().withoutPadding();
        return "ysm:"+encoder.encodeToString(model.getBytes(StandardCharsets.UTF_8))+":"+encoder.encodeToString(texture.getBytes(StandardCharsets.UTF_8));
    }
}
