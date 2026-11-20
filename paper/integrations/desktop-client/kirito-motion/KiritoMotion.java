package qd.kirito;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.common.NeoForge;
import com.elfmcys.yesstevemodel.oo0o0Oooo0OOO00OOo0OO000;
import com.elfmcys.yesstevemodel.o0o0o00oo0OO0o000OOo0oo0;
import com.mojang.logging.LogUtils;
import java.lang.ref.WeakReference;

@Mod(value="qd_kirito_motion", dist=Dist.CLIENT)
public final class KiritoMotion {
    private WeakReference<o0o0o00oo0OO0o000OOo0oo0> active=new WeakReference<>(null);
    public KiritoMotion() { NeoForge.EVENT_BUS.addListener(this::resources); }

    private void resources(ClientTickEvent.Pre event) {
        var model=oo0o0Oooo0OOO00OOo0OO000.oOo0OO0O0o000OO0O000oo0o("qd_hub_kirito.ysm").orElse(null);
        if(model==null || model==active.get()) return;
        var thirdPerson=model.oOo0OO0O0o000OO0O000oo0o();
        var animations=thirdPerson.OO000o0ooOooooOOOOO0Ooo0();
        if(animations.isEmpty()) return;
        var base=oo0o0Oooo0OOO00OOo0OO000.OOo0o0000Ooo0o00OO0oOOoO();
        if(base==null || thirdPerson==base.oOo0OO0O0o000OO0O000oo0o() ||
           animations==base.oOo0OO0O0o000OO0O000oo0o().OO000o0ooOooooOOOOO0Ooo0()) return;
        active=new WeakReference<>(model);
        if(!Motion.fits(thirdPerson.oOo0OO0O0o000OO0O000oo0o())) return;
        // Only replace existing values. The original first-person and other models' maps stay separate.
        int installed=0;
        for(String key:Motion.keys()){
            var original=animations.get(key);
            if(original==null)continue;
            animations.put(key,Motion.attach(key,original));
            installed++;
        }
        LogUtils.getLogger().info("Registered {} third-person motion clips for Kirito",installed);
    }
}
