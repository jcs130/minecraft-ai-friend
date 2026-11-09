package org.afuhome.agentfriend;

import java.lang.reflect.Method;
import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

/** Optional public Floodgate/Cumulus API. No custom packets or mandatory client mod. */
final class BedrockMenuForms {
    private final Object api;
    private final Method isPlayer,send;
    private final Class<?> simple,builder,base,response;
    BedrockMenuForms(ClassLoader loader) throws ReflectiveOperationException {
        Class<?> apiClass=Class.forName("org.geysermc.floodgate.api.FloodgateApi",true,loader);
        api=apiClass.getMethod("getInstance").invoke(null);
        isPlayer=apiClass.getMethod("isFloodgatePlayer",UUID.class);
        Class<?> form=Class.forName("org.geysermc.cumulus.form.Form",true,loader);
        send=apiClass.getMethod("sendForm",UUID.class,form);
        simple=Class.forName("org.geysermc.cumulus.form.SimpleForm",true,loader);
        builder=Class.forName("org.geysermc.cumulus.form.SimpleForm$Builder",true,loader);
        base=Class.forName("org.geysermc.cumulus.form.util.FormBuilder",true,loader);
        response=Class.forName("org.geysermc.cumulus.response.SimpleFormResponse",true,loader);
    }
    static BedrockMenuForms available(){
        Plugin plugin=Bukkit.getPluginManager().getPlugin("floodgate");
        if(plugin==null||!plugin.isEnabled())return null;
        try{return new BedrockMenuForms(plugin.getClass().getClassLoader());}
        catch(ReflectiveOperationException|LinkageError unavailable){return null;}
    }
    boolean isPlayer(UUID id){
        try{return Boolean.TRUE.equals(isPlayer.invoke(api,id));}
        catch(ReflectiveOperationException|RuntimeException unavailable){return false;}
    }
    Object create(AdventureMenuModel.View view,Consumer<Integer> selected,Runnable closed) throws ReflectiveOperationException {
        Object b=simple.getMethod("builder").invoke(null);
        base.getMethod("title",String.class).invoke(b,view.title());
        builder.getMethod("content",String.class).invoke(b,view.content());
        for(var button:view.actions()){
            String caption=button.title();
            if(!button.lore().isEmpty())caption+="\n§8"+String.join("",AdventureMenuModel.lines(button.lore().getFirst(),34,1));
            builder.getMethod("button",String.class).invoke(b,caption);
        }
        Consumer<Object> valid=value->{
            try{
                int index=(Integer)response.getMethod("clickedButtonId").invoke(value);
                if(index<0||index>=view.actions().size())closed.run();else selected.accept(index);
            }
            catch(ReflectiveOperationException|RuntimeException invalid){closed.run();}
        };
        base.getMethod("validResultHandler",Consumer.class).invoke(b,valid);
        // The installed Cumulus build omits its combined Runnable in the invalid branch.
        // The public Consumer overload consistently handles both closed and invalid results.
        Consumer<Object> ended=ignored->closed.run();
        base.getMethod("closedOrInvalidResultHandler",Consumer.class).invoke(b,ended);
        return base.getMethod("build").invoke(b);
    }
    boolean show(UUID id,AdventureMenuModel.View view,Consumer<Integer> selected,Runnable closed){
        try{return Boolean.TRUE.equals(send.invoke(api,id,create(view,selected,closed)));}
        catch(ReflectiveOperationException|RuntimeException|LinkageError unavailable){return false;}
    }
}
