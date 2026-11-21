package local.hosting;

import java.lang.reflect.InvocationTargetException;
import java.util.Objects;
import java.util.UUID;
import net.minecraft.world.entity.Entity;
import local.hosting.NativeShellCustody.Binding;
import local.hosting.NativeShellCustody.Operation;

/** Connects the physical participant to the existing TLM lease and registered VillagerQuests resident. */
public final class NativeResidentDriver implements NativeShellCustody.Driver {
    /** Trusted character controller; requests from a client must first go through the role coordinator. */
    public interface Slot {
        boolean permits(Binding body, Operation transition, boolean acquiring);
        UUID nativeController(Binding body);
        String sourceMaidGeneration(Binding body);
        String villagerIssuer(Binding body);
        void released(Binding body, Operation transition) throws Exception;
        void acquired(Binding body, Operation transition, String successorMaidGeneration) throws Exception;
    }

    private final Slot slot;
    public NativeResidentDriver(Slot slot) { this.slot = Objects.requireNonNull(slot); }

    @Override public boolean quiescent(Binding b, Operation transition, Entity original) throws Exception {
        if (!slot.permits(b,transition,false)) return false;
        if (b.nativeOwner()==null) return villagerAvailable(b,true);
        return (boolean) maid("checkCustodySource",b,true);
    }
    @Override public void release(Binding b, Operation transition, Entity original) throws Exception {
        if (!slot.permits(b,transition,false)) throw new IllegalStateException("Original slot changed");
        if (b.nativeOwner()!=null) maid("releaseCustodySource",b,true);
        else if (!villagerAvailable(b,false)) throw new IllegalStateException("Villager is busy");
        slot.released(b,transition);
    }
    @Override public boolean reserved(Binding b, Operation transition) throws Exception {
        return slot.permits(b,transition,true) && (b.nativeOwner()!=null || villagerAvailable(b,false));
    }
    @Override public void activate(Binding b, Operation transition, Entity original) throws Exception {
        if (!slot.permits(b,transition,true)) throw new IllegalStateException("Successor slot changed");
        String lease=null;
        if (b.nativeOwner()!=null) lease=(String)maid("acquireCustodyTarget",b,false);
        else if (!villagerAvailable(b,true)) throw new IllegalStateException("Registered villager not ready");
        slot.acquired(b,transition,lease);
    }

    private Object maid(String operation, Binding b, boolean releasing) throws Exception {
        Object plugin=enabledPlugin("QiandengjiMaidBridge");
        Class<?> u=UUID.class;
        if (releasing) return call(plugin,operation,new Class<?>[]{u,u,u,String.class},
                b.nativeOwner(),b.entityUuid(),slot.nativeController(b),slot.sourceMaidGeneration(b));
        return call(plugin,operation,new Class<?>[]{u,u,u},b.nativeOwner(),b.entityUuid(),slot.nativeController(b));
    }
    private boolean villagerAvailable(Binding b,boolean requireLiving) throws Exception {
        return (boolean) call(enabledPlugin("qiandeng-villager-quests"),"nativeBodyAvailable",
                new Class<?>[]{String.class,UUID.class,boolean.class},slot.villagerIssuer(b),b.entityUuid(),requireLiving);
    }
    static String currentMaidGeneration(Binding b, UUID controller) throws Exception {
        return (String) call(enabledPlugin("QiandengjiMaidBridge"),"custodySourceGeneration",
                new Class<?>[]{UUID.class,UUID.class,UUID.class},b.nativeOwner(),b.entityUuid(),controller);
    }
    private static Object enabledPlugin(String name) throws Exception {
        Class<?> api=Class.forName("org.bukkit.Bukkit");
        Object manager=api.getMethod("getPluginManager").invoke(null);
        Object plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(manager,name);
        if (plugin==null || !Boolean.TRUE.equals(Class.forName("org.bukkit.plugin.Plugin").getMethod("isEnabled").invoke(plugin)))
            throw new IllegalStateException("A native body plugin is unavailable");
        return plugin;
    }
    private static Object call(Object plugin,String method,Class<?>[] parameters,Object... args) throws Exception {
        try { return plugin.getClass().getMethod(method,parameters).invoke(plugin,args); }
        catch(InvocationTargetException failure) {
            if (failure.getCause() instanceof Exception cause) throw cause;
            throw failure;
        }
    }
}
