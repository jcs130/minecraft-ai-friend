package dev.qiandeng.accounts;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;

/** Read the existing guard's identity policy and share its password lock ledger. */
final class NativePolicy {
    static final Set<String> SYSTEM=Set.of("corti","corticam","player","goddess","live");
    final Object guard;
    final Method reserved,locked;
    final Field ops,eyes,names,attempts,attemptsFile,ready;
    NativePolicy(Object guard) throws Exception {
        this.guard=guard;Class<?> c=guard.getClass();
        reserved=method(c,"portalReserved",String.class);locked=method(c,"locked",String.class);
        ops=field(c,"opsFile");eyes=field(c,"eyes");names=field(c,"reserved");attempts=field(c,"attempts");attemptsFile=field(c,"attemptsFile");ready=field(c,"ready");
    }
    private static Field field(Class<?> c,String name) throws Exception {Field f=c.getDeclaredField(name);f.setAccessible(true);return f;}
    private static Method method(Class<?> c,String name,Class<?>...args) throws Exception {Method m=c.getDeclaredMethod(name,args);m.setAccessible(true);return m;}
    boolean system(String name) throws Exception {
        String lower=name.toLowerCase(Locale.ROOT);
        if(SYSTEM.contains(lower)||lower.endsWith("eye"))return true;
        Object policy=eyes.get(guard);
        return policy!=null&&method(policy.getClass(),"body",String.class,Set.class).invoke(policy,name,names.get(guard))!=null;
    }
    String identity(String name,UUID uuid,String bodyName,UUID bodyUuid) throws Exception {
        if(system(name)||system(bodyName))throw new Rejected("RESERVED_ACCOUNT");
        boolean protectedName=(boolean)reserved.invoke(guard,name),protectedBody=(boolean)reserved.invoke(guard,bodyName);
        if(!protectedName&&!protectedBody)return "player";
        Path file=(Path)ops.get(guard);
        if(!Files.isRegularFile(file)||Files.size(file)>2*1024*1024)throw new Rejected("AUTHORITY_UNAVAILABLE");
        boolean exactOperator=false;
        for(JsonElement element:JsonParser.parseString(Files.readString(file)).getAsJsonArray()){
            JsonObject row=element.getAsJsonObject();
            if(name.equals(BridgeFiles.text(row,"name"))&&uuid.toString().equals(BridgeFiles.text(row,"uuid"))){exactOperator=true;break;}
        }
        if(!exactOperator||!name.equals(bodyName)||!uuid.equals(bodyUuid))throw new Rejected("PRIVILEGED_IDENTITY_MISMATCH");
        return "administrator";
    }
    long retryAfter(String name) throws Exception {return Math.max(0,(long)locked.invoke(guard,name)-System.currentTimeMillis());}
    void wrong(String name) throws Exception {
        // Use the same monitor, format, 3/5min window and 10min lock as LoginGuard.
        synchronized(guard){
            Properties live=(Properties)attempts.get(guard),next=new Properties();next.putAll(live);
            String key=name.toLowerCase(Locale.ROOT);String[] old=next.getProperty(key,"0,0,0").split(",");
            if(old.length!=3)throw new Rejected("AUTHORITY_UNAVAILABLE");
            long now=System.currentTimeMillis(),start=Long.parseLong(old[1]),previous=Long.parseLong(old[2]);
            int count=now-start>300000?0:Integer.parseInt(old[0]);if(count==0)start=now;count++;
            long until=count>=3?Math.max(previous,now+600000):previous;
            next.setProperty(key,count+","+start+","+until);
            Path target=(Path)attemptsFile.get(guard),temp=target.resolveSibling(target.getFileName()+"."+UUID.randomUUID()+".tmp");
            try{
                Files.createDirectories(target.getParent());
                try(var out=Files.newOutputStream(temp,StandardOpenOption.CREATE_NEW)){next.store(out,"Login failures; no credentials");}
                try(var channel=java.nio.channels.FileChannel.open(temp,StandardOpenOption.WRITE)){channel.force(true);}
                for(int i=0;;i++)try{Files.move(temp,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);break;}
                catch(FileSystemException busy){if(i>=9)throw busy;Thread.sleep(50);}
                live.clear();live.putAll(next);
            }catch(Exception unavailable){ready.setBoolean(guard,false);throw unavailable;}
            finally{Files.deleteIfExists(temp);}
        }
    }
    static final class Rejected extends Exception {final String reason;Rejected(String reason){this.reason=reason;}}
}
