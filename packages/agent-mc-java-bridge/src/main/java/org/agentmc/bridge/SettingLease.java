package org.agentmc.bridge;

import java.lang.reflect.Field;
import java.util.*;

/** Restore each temporarily edited public setting without overwriting later user edits. */
final class SettingLease {
    private record Change(Field field,Object setting,Object before,Object applied) {}
    private final List<Change> changes=new ArrayList<>();
    void set(Object settings,String name,Object value) throws ReflectiveOperationException {
        Object setting=settings.getClass().getField(name).get(settings);Field field=setting.getClass().getField("value");
        changes.add(new Change(field,setting,field.get(setting),value));field.set(setting,value);
    }
    void restore() throws ReflectiveOperationException {
        for(var change:changes){
            Object current=change.field().get(change.setting());
            if(current==change.applied()||!(current instanceof Collection<?>)&&Objects.equals(current,change.applied()))change.field().set(change.setting(),change.before());
        }
        changes.clear();
    }
}
