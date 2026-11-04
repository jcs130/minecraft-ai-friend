package org.afuhome.agentfriend;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.locks.LockSupport;

public final class AtomicConfigFileTest {
    private static int checks;
    private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);checks++;}
    private static byte[] bytes(String text){return text.getBytes(StandardCharsets.UTF_8);}
    private static long stagedFiles(Path root)throws IOException{try(var paths=Files.list(root)){return paths.filter(p->p.getFileName().toString().endsWith(".tmp")).count();}}
    public static void main(String[] args)throws Exception {
        boolean nativeLock=args.length==1&&args[0].endsWith(".exe");
        Path root=Files.createTempDirectory("af-atomic-config-").toRealPath();
        Path target=root.resolve("config.yml");Files.writeString(target,"before");
        try {
            try(var staged=AtomicConfigFile.stage(target,bytes("after"))){
                check(Files.readString(target).equals("before"),"staging leaves live bytes unchanged");
                staged.commit();check(Files.readString(target).equals("after"),"exact image committed");
                try{staged.commit();throw new AssertionError("duplicate commit accepted");}catch(IllegalStateException expected){checks++;}
            }
            check(stagedFiles(root)==0,"successful image leaves no temporary file");
            try(var ignored=AtomicConfigFile.stage(target,bytes("abandoned"))){}
            check(Files.readString(target).equals("after")&&stagedFiles(root)==0,"abandon does not replace target");
            try(var staged=AtomicConfigFile.stage(target,bytes("interrupted"))){
                Thread.currentThread().interrupt();
                try{staged.commit();throw new AssertionError("interrupted write committed");}catch(InterruptedIOException expected){checks++;}
                finally{Thread.interrupted();}
            }
            check(Files.readString(target).equals("after")&&stagedFiles(root)==0,"interrupt preserves original and cleans owned image");
            if(nativeLock){
                check(System.getProperty("os.name").startsWith("Windows"),"native lock fixture requires Windows");
                Process child=new ProcessBuilder(args[0],target.toString()).redirectErrorStream(true).start();
                var input=new PrintWriter(child.getOutputStream(),true);var output=new BufferedReader(new InputStreamReader(child.getInputStream()));
                try {
                    input.println("hold");check("held".equals(output.readLine()),"real Windows reader acquired");
                    try(var staged=AtomicConfigFile.stage(target,bytes("must-not-overwrite"))){
                        long start=System.nanoTime();
                        try{staged.commit();throw new AssertionError("permanent lock replaced");}catch(AccessDeniedException expected){checks++;}
                        check((System.nanoTime()-start)<1_000_000_000L,"denial returns within bounded time");
                    }
                    check(Files.readString(target).equals("after")&&stagedFiles(root)==0,"permanent denial preserves real file");
                    input.println("release");check("released".equals(output.readLine()),"reader released");
                    input.println("hold");check("held".equals(output.readLine()),"transient reader acquired");
                    Thread release=new Thread(()->{LockSupport.parkNanos(3_000_000L);input.println("release");},"release-owned-config-reader");
                    try(var staged=AtomicConfigFile.stage(target,bytes("transient-success"))){release.start();staged.commit();release.join();}
                    check("released".equals(output.readLine()),"transient reader actually released");
                    check(Files.readString(target).equals("transient-success")&&stagedFiles(root)==0,"same staged image succeeds after transient real lock");
                }finally{input.println("quit");if(!child.waitFor(5,java.util.concurrent.TimeUnit.SECONDS)){child.destroyForcibly();throw new AssertionError("owned fixture did not exit");}}
            }
            System.out.println("ATOMIC_CONFIG_TESTS_OK checks="+checks+" nativeWindowsLock="+nativeLock);
        }finally{
            Path expected=Path.of(System.getProperty("java.io.tmpdir")).toRealPath();
            if(!root.getParent().equals(expected)||!root.getFileName().toString().startsWith("af-atomic-config-"))throw new AssertionError("fixture cleanup outside owned temp root");
            try(var files=Files.walk(root)){for(Path file:files.sorted(Comparator.reverseOrder()).toList()){if(!file.normalize().startsWith(root))throw new AssertionError("unexpected cleanup target");Files.delete(file);}}
        }
    }
}
