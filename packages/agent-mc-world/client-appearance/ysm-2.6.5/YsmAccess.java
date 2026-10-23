package org.agentmc.appearance;

import com.elfmcys.yesstevemodel.oo0OO0OOO0o0OOOO0o0o0O0o;

/** Verified YSM 2.6.5 Fabric client render capability; never sends a server selection. */
final class YsmAccess {
    static int catalogueSize() {
        return com.elfmcys.yesstevemodel.O0o00oo000oo0OO0OoO0oo0o.Ooo0OOOOO00O0Oo0oo0OOOo0().size();
    }
    static boolean hasModel(String model) {
        return com.elfmcys.yesstevemodel.O0o00oo000oo0OO0OoO0oo0o.Ooo0OOOOO00O0Oo0oo0OOOo0().containsKey(model);
    }
    static ClientAppearances.DisplaySelection selection(Object entity) {
        if (!(entity instanceof oo0OO0OOO0o0OOOO0o0o0O0o ysm)) return null;
        var data = ysm.ooOo0o0o0oOoOoOOOo0o0o00().orElse(null);
        return data == null ? null : new ClientAppearances.DisplaySelection(data.Oo0oOOO000O0OOOO00OOoooo(), data.o00oo00oo0o0OOOO0OoO0OO0());
    }
    static String enforce(Object entity, String model, String texture) {
        if (!(entity instanceof oo0OO0OOO0o0OOOO0o0o0O0o ysm)
                || !hasModel(model)) return null;
        var data = ysm.ooOo0o0o0oOoOoOOOo0o0o00().orElse(null);
        if (data == null) return null;
        String beforeModel = data.Oo0oOOO000O0OOOO00OOoooo(), beforeTexture = data.o00oo00oo0o0OOOO0OoO0OO0();
        if (model.equals(beforeModel) && texture.equals(beforeTexture)) return null;
        data.OO0ooo0OooOoO0OoO0ooOO0o(model, texture);
        return beforeModel + "/" + beforeTexture + " -> "
                + data.Oo0oOOO000O0OOOO00OOoooo() + "/" + data.o00oo00oo0o0OOOO0OoO0OO0();
    }
}
