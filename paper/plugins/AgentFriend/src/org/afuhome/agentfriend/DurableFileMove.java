package org.afuhome.agentfriend;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import com.sun.jna.*;
import com.sun.jna.win32.StdCallLibrary;

/** Do not acknowledge a rename before the OS has flushed its metadata. */
final class DurableFileMove {
    public interface Kernel extends StdCallLibrary {int MoveFileExW(WString source,WString target,int flags);}
    private static final class Windows {static final Kernel API=Native.load("kernel32",Kernel.class);}
    private DurableFileMove(){}
    static void replace(Path source,Path target)throws IOException {
        if(System.getProperty("os.name").startsWith("Windows")){
            // MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH. Never copy
            // across volumes or schedule deletion at an operating-system boot.
            if(Windows.API.MoveFileExW(new WString(windowsPath(source)),new WString(windowsPath(target)),1|8)==0){
                int code=Native.getLastError();String reason="Windows replacement failed ("+code+")";
                if(code==5||code==32)throw new AccessDeniedException(source.toString(),target.toString(),reason);
                throw new FileSystemException(source.toString(),target.toString(),reason);
            }
        }else{
            Files.move(source,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            forceDirectory(target.toAbsolutePath().getParent());
        }
    }
    static void forceDirectory(Path directory)throws IOException {
        if(!System.getProperty("os.name").startsWith("Windows"))try(FileChannel dir=FileChannel.open(directory,StandardOpenOption.READ)){dir.force(true);}
    }
    private static String windowsPath(Path file){
        String path=file.toAbsolutePath().normalize().toString();
        if(path.startsWith("\\\\?\\"))return path;
        return path.startsWith("\\\\")?"\\\\?\\UNC\\"+path.substring(2):"\\\\?\\"+path;
    }
}
