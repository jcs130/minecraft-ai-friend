package org.afuhome.agentfriend;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
public final class DurableConfigFilesTest {
    private static int checks;
    private static void check(boolean value,String text){if(!value)throw new AssertionError(text);checks++;}
    private static byte[] image(int revision){return ("revision: "+revision+"\nreward: one\n").getBytes(StandardCharsets.UTF_8);}
    private static long markers(Path root)throws IOException{try(var stream=Files.list(root)){return stream.filter(p->p.getFileName().toString().startsWith("commit-")).count();}}
    private static String hash(byte[] bytes)throws Exception{return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));}
    private static Path record(Path directory,String label,int revision,byte[] bytes,byte[] base)throws Exception {
        String name="config.yml.site-dungeon-"+label+".state";Files.write(directory.resolve(name),bytes);
        String sha=hash(bytes),baseSha=hash(base),canonical="1\n"+revision+"\n"+name+"\n"+bytes.length+"\n"+sha+"\n0\n"+baseSha+"\n";
        Path marker=directory.resolve("commit-"+label+".json");
        Files.writeString(marker,"{\"format\":1,\"revision\":"+revision+",\"image\":\""+name+"\",\"bytes\":"+bytes.length+",\"sha256\":\""+sha+"\",\"baseRevision\":0,\"baseSha256\":\""+baseSha+"\",\"recordSha256\":\""+hash(canonical.getBytes(StandardCharsets.US_ASCII))+"\"}\n");return marker;
    }
    private static void invalidRecords(Path root)throws Exception {
        for(String mode:List.of("image","record","base","missing","ambiguous","complete","incomplete")){
            Path folder=root.resolve(mode);Files.createDirectory(folder);Path target=folder.resolve("config.yml");Files.write(target,image(0));
            try(var store=new DurableConfigFiles(target)){
                Path marker=record(store.directory(),"first",1,image(1),image(0));
                switch(mode){
                    case "image"->Files.writeString(store.directory().resolve("config.yml.site-dungeon-first.state"),new String(image(1),StandardCharsets.UTF_8).replace("one","two"));
                    case "record"->Files.writeString(marker,Files.readString(marker).replace("\"revision\":1","\"revision\":9"));
                    case "base"->Files.writeString(target,new String(image(0),StandardCharsets.UTF_8).replace("one","two"));
                    case "missing"->Files.delete(store.directory().resolve("config.yml.site-dungeon-first.state"));
                    case "ambiguous"->record(store.directory(),"second",1,"revision: 1\nreward: two\n".getBytes(StandardCharsets.UTF_8),image(0));
                    case "incomplete"->Files.writeString(store.directory().resolve("commit-future.json"),"{\"format\":1");
                }
                byte[] before=Files.readAllBytes(target);
                if(mode.equals("complete")||mode.equals("incomplete"))check(Arrays.equals(store.initialize(before,0),image(1)),"newest complete commit recovers; incomplete future never fabricates state");
                else{try{store.initialize(before,0);throw new AssertionError("unsafe recovery accepted "+mode);}catch(IOException expected){checks++;}}
                check(Arrays.equals(Files.readAllBytes(target),before)&&Files.exists(marker),"recovery preserves original projection and evidence "+mode);
            }
        }
    }
    public static void main(String[] args)throws Exception {
        Path root=Files.createTempDirectory("af-state-store-").toRealPath(),target=root.resolve("config.yml");Files.write(target,image(0));
        boolean windows=args.length==1&&args[0].endsWith(".exe");
        try {
            try(var store=new DurableConfigFiles(target)){
                check(Arrays.equals(store.initialize(image(0),0),image(0)),"original complete state retained");
                try(var duplicate=new DurableConfigFiles(target)){throw new AssertionError("second writer accepted");}catch(IOException expected){checks++;}
                store.commit(image(1),1);check(!store.pending()&&store.revision()==1,"normal atomic publication is durable");
                check(Arrays.equals(Files.readAllBytes(target),image(1)),"published bytes match accepted image");
                check(markers(store.directory())==0,"normal publication creates no backlog");
                try{store.commit(image(1),1);throw new AssertionError("duplicate sequence accepted");}catch(IOException expected){checks++;}
                try{store.commit(new byte[DurableConfigFiles.MAX_IMAGE+1],2);throw new AssertionError("oversize accepted");}catch(IOException expected){checks++;}
            }
            try(var reopened=new DurableConfigFiles(target)){check(Arrays.equals(reopened.initialize(Files.readAllBytes(target),1),image(1)),"published restart does not replay a write");}
            invalidRecords(root);
            if(windows){
                Process reader=new ProcessBuilder(args[0],target.toString()).redirectErrorStream(true).start();
                var input=new PrintWriter(reader.getOutputStream(),true);var output=new BufferedReader(new InputStreamReader(reader.getInputStream()));
                try {
                    input.println("hold");check("held".equals(output.readLine()),"real Windows reader acquired");
                    try(var store=new DurableConfigFiles(target)){
                        store.initialize(Files.readAllBytes(target),1);store.commit(image(2),2);
                        check(store.pending()&&store.revision()==2,"rename denial does not reject a durable business commit");
                        check(Arrays.equals(Files.readAllBytes(target),image(1)),"reader still sees the old publication");
                        store.commit(image(3),3);check(Arrays.equals(store.accepted(),image(3)),"second operation observes and preserves first committed state");
                        check(markers(store.directory())==1,"old acknowledged records are bounded and retired");
                        check(!store.flush(),"publication remains pending while the real reader holds it");
                    }
                    Path java=Path.of(System.getProperty("java.home"),"bin","java.exe"),argfile=root.resolve("crash.args");
                    Files.writeString(argfile,"-cp\n\""+System.getProperty("java.class.path").replace('\\','/')+"\"\norg.afuhome.agentfriend.DurableConfigCrashChild\n\""+target.toString().replace('\\','/')+"\"\n");
                    Process child=new ProcessBuilder(java.toString(),"@"+argfile).redirectErrorStream(true).start();
                    String proof=new String(child.getInputStream().readAllBytes(),StandardCharsets.UTF_8);
                    check(child.waitFor()==0&&proof.contains("DURABLE_BEFORE_ABRUPT_EXIT revision=4"),"separate JVM durably commits then halts without cleanup");
                    try(var restarted=new DurableConfigFiles(target)){
                        check(Arrays.equals(restarted.initialize(Files.readAllBytes(target),1),image(4)),"crash recovery reads the newest complete commit before game use");
                        check(restarted.pending()&&restarted.revision()==4,"pending state remains durable across process death");
                        input.println("release");check("released".equals(output.readLine()),"actual reader released");
                        check(restarted.flush(),"publication automatically catches up without a game operation");
                        check(Arrays.equals(Files.readAllBytes(target),image(4))&&markers(restarted.directory())==0,"published content exact and obsolete commits retired");
                    }
                    try(var finalRestart=new DurableConfigFiles(target)){
                        check(Arrays.equals(finalRestart.initialize(Files.readAllBytes(target),4),image(4)),"subsequent restart keeps the same single reward");
                        finalRestart.adoptPublished(image(4),4);
                    }
                }finally{input.println("quit");if(!reader.waitFor(5,java.util.concurrent.TimeUnit.SECONDS)){reader.destroyForcibly();throw new AssertionError("owned reader did not close");}}
            }
            System.out.println("DURABLE_CONFIG_TESTS_OK checks="+checks+" nativeWindows="+windows);
        }finally{
            if(!root.getParent().equals(Path.of(System.getProperty("java.io.tmpdir")).toRealPath())||!root.getFileName().toString().startsWith("af-state-store-"))throw new AssertionError("cleanup outside owned test root");
            try(var stream=Files.walk(root)){for(Path file:stream.sorted(Comparator.reverseOrder()).toList()){if(!file.normalize().startsWith(root))throw new AssertionError("unexpected cleanup target");Files.delete(file);}}
        }
    }
}
