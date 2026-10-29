package dev.qiandeng.maw.saoforge;

import java.lang.reflect.*;
import java.util.*;

/** Checked calls to installed server APIs; no copied gameplay implementation. */
final class SaoReflection {
    static Class<?> type(String name){try{return Class.forName(name);}catch(ClassNotFoundException e){throw new IllegalStateException("native_api_missing:"+name,e);}}
    static Object call(Object target,String name,Object...args){
        Class<?> owner=target instanceof Class<?> c?c:target.getClass();
        Method chosen=null;int best=-1;
        for(var m:owner.getMethods())if(m.getName().equals(name)&&m.getParameterCount()==args.length){
            int score=0;boolean ok=true;var types=m.getParameterTypes();
            for(int i=0;i<args.length;i++){
                Class<?> wanted=box(types[i]);
                if(args[i]==null){if(types[i].isPrimitive())ok=false;}
                else if(!wanted.isInstance(args[i]))ok=false;
                else score+=wanted==args[i].getClass()?2:1;
            }
            if(ok&&score>best){chosen=m;best=score;}
            else if(ok&&score==best&&chosen!=null&&!Arrays.equals(m.getParameterTypes(),chosen.getParameterTypes()))throw new IllegalArgumentException("ambiguous_native_method:"+name);
        }
        if(chosen==null)throw new IllegalStateException("native_method_unavailable:"+owner.getName()+"."+name);
        try{return chosen.invoke(target instanceof Class<?>?null:target,args);}
        catch(InvocationTargetException e){throw new IllegalStateException("native_call_failed:"+name,e.getCause());}
        catch(ReflectiveOperationException e){throw new IllegalStateException("native_call_inaccessible:"+name,e);}
    }
    static Object field(Object target,String name){try{return(target instanceof Class<?>c?c:target.getClass()).getField(name).get(target instanceof Class<?>?null:target);}catch(ReflectiveOperationException e){throw new IllegalStateException("native_field_unavailable:"+name,e);}}
    static Class<?> box(Class<?> type){if(type==int.class)return Integer.class;if(type==long.class)return Long.class;if(type==boolean.class)return Boolean.class;if(type==double.class)return Double.class;if(type==float.class)return Float.class;return type;}
    static boolean yes(Object value){return Boolean.TRUE.equals(value);}
    static int number(Object value){return((Number)value).intValue();}
    static List<?> list(Object value){if(value instanceof List<?> l)return l;if(value instanceof Collection<?>c)return new ArrayList<>(c);throw new IllegalStateException("native_collection_unavailable");}
}
