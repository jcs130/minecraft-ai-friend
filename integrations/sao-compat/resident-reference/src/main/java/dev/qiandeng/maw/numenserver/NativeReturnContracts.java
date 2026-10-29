package dev.qiandeng.maw.numenserver;

import com.dwinovo.numen.core.tools.Clicks;
import com.dwinovo.numen.sdk.Codec;
import com.dwinovo.numen.sdk.LuaCodecs;
import com.dwinovo.numen.agent.script.ScriptType;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.List;

/** Contract corrections for the pinned, unmodified Numen 0.1.4.1 binary. */
public final class NativeReturnContracts {
    private NativeReturnContracts() {}

    @SuppressWarnings("unchecked")
    public static Codec<Object> correct(String namespace,String group,String name,Codec<Object> declared) {
        // An item right-click can open a server menu. InteractAtCompanionTask
        // then returns GuiOps.Window, which implements Pressed, not Clicked.
        // Use the same declared union as use.block so both genuine outcomes
        // are encoded, including their original slots and component values.
        if(namespace.equals("numen")&&group.equals("use")&&name.equals("item"))
            return (Codec<Object>)(Codec<?>)LuaCodecs.of(Clicks.Pressed.class,"Pressed");
        return declared;
    }

    /** Resolve named/union return fields from Numen's own type registry. */
    public static List<ScriptType.Class> types(Codec<?> codec) {
        var found=new LinkedHashMap<String,ScriptType.Class>();
        var pending=new ArrayDeque<ScriptType>();pending.add(codec.type());
        for(var type:codec.classes())pending.add(type.type());
        for(int visited=0;!pending.isEmpty()&&visited<256;visited++) {
            var type=pending.removeFirst();
            if(type instanceof ScriptType.Named named) {
                var definition=LuaCodecs.classNamed(named.name());
                if(definition==null||found.putIfAbsent(named.name(),definition)!=null)continue;
                if(definition.parent()!=null)pending.add(new ScriptType.Named(definition.parent()));
                for(var field:definition.fields())pending.add(field.type());
                if(definition.items()!=null)pending.add(definition.items());
            }else if(type instanceof ScriptType.Union union)pending.addAll(union.options());
            else if(type instanceof ScriptType.ListOf list)pending.add(list.item());
            else if(type instanceof ScriptType.MapOf map)pending.add(map.value());
            else if(type instanceof ScriptType.Table table)for(var field:table.fields())pending.add(field.type());
        }
        return List.copyOf(found.values());
    }
}
