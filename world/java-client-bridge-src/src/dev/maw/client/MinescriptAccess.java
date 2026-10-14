package dev.maw.client;

import com.google.gson.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;
import net.neoforged.fml.ModList;
import static dev.maw.client.ClientState.object;

/** Optional, version-pinned adapter. The original Minescript JAR stays separate. */
final class MinescriptAccess {
    private static final Gson JSON=new GsonBuilder().serializeNulls().create();
    private final Path root;
    private final String instance;
    private Class<?> api;
    private Field jobsField;
    private Method getMap,chat,jobId,jobState,boundCommand,command,kill;
    private boolean resolved;
    private String version,unavailable="minescript_not_installed";
    private Run owned;
    private long hiddenOwnStatus;
    private static final class Run {
        String actionId,nonce,name;
        Path output;
        Object job;
        int id;
        long missingSince;
    }
    MinescriptAccess(Path root,String instance){this.root=root;this.instance=instance;}
    boolean hideOwnStatus(String text){
        // Only local, expected status lines for this instance's generated runner.
        String runner="maw_client_"+instance.replace("-","");
        if(text.matches("\\[\\d+\\] (?:Done|Exited with error code -5): "+Pattern.quote(runner)+"(?: .*?)?")){
            hiddenOwnStatus++;return true;
        }
        return false;
    }
    private synchronized void resolve(){
        if(resolved)return;resolved=true;
        try{
            var container=ModList.get().getModContainerById("minescript");
            if(container.isEmpty())return;
            version=container.get().getModInfo().getVersion().toString();
            if(!version.equals("4.0")){unavailable="minescript_version_not_supported";return;}
            ClassLoader loader=getClass().getClassLoader();
            Class<?> found=Class.forName("net.minescript.common.Minescript",false,loader);
            Field field=found.getDeclaredField("jobs");field.setAccessible(true);
            Method map=field.getType().getDeclaredMethod("getMap");map.setAccessible(true);
            Class<?> job=Class.forName("net.minescript.common.Job",false,loader);
            jobId=job.getMethod("jobId");jobState=job.getMethod("state");
            boundCommand=job.getMethod("boundCommand");command=boundCommand.getReturnType().getMethod("command");
            kill=job.getMethod("kill");chat=found.getMethod("onClientChat",String.class);
            jobsField=field;getMap=map;api=found;unavailable=null;
        }catch(Exception error){unavailable="minescript_api_not_supported";}
    }
    boolean available(){resolve();return api!=null;}
    @SuppressWarnings("unchecked")
    private Map<Integer,Object> jobs()throws Exception {
        if(!available())return Map.of();
        return (Map<Integer,Object>)getMap.invoke(jobsField.get(null));
    }
    private boolean live(Object job)throws Exception {
        // Minescript can still drain queued work for a DONE job. Wait for removal.
        return !((Enum<?>)jobState.invoke(job)).name().equals("KILLED");
    }
    private String name(Object job)throws Exception {
        String[] args=(String[])command.invoke(boundCommand.invoke(job));
        return args.length==0?"":args[0];
    }
    boolean busyElsewhere()throws Exception {
        for(Object job:jobs().values())if((owned==null||owned.job!=job)&&live(job))return true;
        return false;
    }
    JsonObject state(){
        JsonObject out=object("available",available(),"version",version,"owned",owned!=null,
            "unavailableReason",unavailable,"arbitraryPython",true,"modelRequests",0,"ownStatusMessagesHidden",hiddenOwnStatus);
        JsonArray list=new JsonArray();
        if(available())try{
            for(Object job:jobs().values()){
                String title=name(job);if(title.length()>160)title=title.substring(0,160);
                list.add(object("jobId",jobId.invoke(job),"name",title,"state",((Enum<?>)jobState.invoke(job)).name(),"owned",owned!=null&&owned.job==job));
                if(list.size()>=24)break;
            }
            out.addProperty("busyElsewhere",busyElsewhere());
        }catch(Exception error){out.addProperty("observationError","minescript_job_state_unavailable");}
        out.add("jobs",list);return out;
    }
    void start(String actionId,JsonObject args)throws Exception {
        if(!available())throw new IllegalStateException(unavailable);
        if(owned!=null||busyElsewhere())throw new IllegalStateException("minescript_already_controlled");
        String code=args.get("code").getAsString();
        if(code.isBlank()||code.length()>16384||code.getBytes(StandardCharsets.UTF_8).length>32768)throw new IllegalArgumentException("minescript_code_over_budget");
        JsonElement input=args.has("input")?args.get("input"):new JsonObject();
        if(!input.isJsonObject()||JSON.toJson(input).getBytes(StandardCharsets.UTF_8).length>32768)throw new IllegalArgumentException("minescript_input_over_budget");
        Path scriptDir=Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize().resolve("minescript");
        if(!Files.isDirectory(scriptDir))throw new IllegalStateException("minescript_script_directory_unavailable");
        Path workspace=root.resolve("scripts");Files.createDirectories(workspace);
        Run run=new Run();run.actionId=actionId;run.nonce=UUID.randomUUID().toString();
        run.name="maw_client_"+instance.replace("-","");
        String suffix=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(actionId.getBytes(StandardCharsets.UTF_8))).substring(0,24);
        Path request=workspace.resolve(instance+"-"+suffix+".request.json");
        run.output=workspace.resolve(instance+"-"+suffix+".result.json");
        byte[] runner;
        try(var in=getClass().getResourceAsStream("/minescript-runner.py")){runner=Objects.requireNonNull(in).readAllBytes();}
        Path script=scriptDir.resolve(run.name+".py");
        if(Files.exists(script)){
            if(!Arrays.equals(Files.readAllBytes(script),runner))throw new IllegalStateException("minescript_runner_file_changed");
        }else Files.write(script,runner,StandardOpenOption.CREATE_NEW);
        if(Files.exists(request)||Files.exists(run.output))throw new IllegalStateException("minescript_original_request_exists");
        Files.writeString(request,JSON.toJson(object("schemaVersion",1,"actionId",actionId,"nonce",run.nonce,"code",code,
            "input",input,"output",run.output.toString(),"timeoutMs",args.has("timeoutMs")?args.get("timeoutMs").getAsInt():30000)),StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW);
        owned=run;
        if(!Boolean.TRUE.equals(chat.invoke(null,"\\"+run.name+" \""+request.toString().replace('\\','/')+"\"")))
            throw new IllegalStateException("minescript_command_not_consumed");
        for(Object job:jobs().values())if(name(job).equals(run.name)){run.job=job;run.id=(Integer)jobId.invoke(job);break;}
        if(run.job==null)throw new IllegalStateException("minescript_job_not_started");
    }
    /** Read one finite script result. Late files never complete a different action. */
    JsonObject poll()throws Exception {
        Run run=owned;if(run==null)throw new IllegalStateException("minescript_owned_job_missing");
        if(Files.isRegularFile(run.output)){
            if(Files.size(run.output)>65536)throw new IllegalStateException("minescript_result_over_budget");
            JsonObject value=JsonParser.parseString(Files.readString(run.output,StandardCharsets.UTF_8)).getAsJsonObject();
            if(value.get("schemaVersion").getAsInt()!=1||!run.actionId.equals(value.get("actionId").getAsString())
                ||!run.nonce.equals(value.get("nonce").getAsString())||value.get("jobId").getAsInt()!=run.id)
                throw new IllegalStateException("minescript_result_binding_mismatch");
            value.remove("nonce");value.addProperty("backend","minescript");value.addProperty("goalCompleted",false);
            return value;
        }
        if(run.job!=null&&!jobs().containsValue(run.job)){
            if(run.missingSince==0)run.missingSince=System.currentTimeMillis();
            if(System.currentTimeMillis()-run.missingSince>1500)throw new IllegalStateException("minescript_job_exited_without_result");
        }
        return null;
    }
    /** Kill only the retained Job object; numeric IDs may be reused by Minescript. */
    void stopOwned()throws Exception {
        Run run=owned;
        if(run!=null){if(run.job!=null)kill.invoke(run.job);owned=null;}
    }
    void close(){try{stopOwned();}catch(Exception ignored){}}
}
