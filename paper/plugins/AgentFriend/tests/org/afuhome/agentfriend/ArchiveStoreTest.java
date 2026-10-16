package org.afuhome.agentfriend;
import java.nio.file.*;
import java.util.*;
import java.sql.*;
public final class ArchiveStoreTest {
    private static int checks;
    private static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);checks++;System.out.println("PASS "+name);}
    public static void main(String[] args)throws Exception{
        if(args.length>0&&args[0].equals("crash-write")){
            var db=new ArchiveStore(Path.of(args[1]));
            var e=new ArchiveStore.Entry(args[2],"book",args[3],"ag_WalQA","断电恢复","数据库已提交，但进程没有正常关闭。","{}",true,1004,1);
            db.create("crash-commit",e,List.of(new ArchiveStore.Attachment("original.png","image/png",new byte[]{1,2,3})));
            Runtime.getRuntime().halt(0);
        }
        Path dir=Files.createTempDirectory("qd-archive-test-");Path file=dir.resolve("archive.sqlite");
        String author=UUID.randomUUID().toString(),reader=UUID.randomUUID().toString(),id=UUID.randomUUID().toString();
        byte[] pixels={0,1,2,3,(byte)255};
        var first=new ArchiveStore.Entry(id,"book",author,"ag_Archivist","营地的第一夜","我在营地看见了灯。","{\"source\":\"diary\"}",true,1000,1);
        try{
            try(var db=new ArchiveStore(file)){
                check(db.create("create-1",first).equals(first),"commit original book and request together");
                var retry=new ArchiveStore.Entry(UUID.randomUUID().toString(),"book",author,"ChangedName",first.title(),first.body(),first.metadata(),true,2000,1);
                check(db.create("create-1",retry).equals(first)&&db.count()==1,"retry recovers the original ID without adding a book");
                boolean conflict=false;try{db.create("create-1",new ArchiveStore.Entry(id,"book",author,"ag_Archivist","different","changed","{}",true,1000,1));}catch(IllegalArgumentException expected){conflict=true;}
                check(conflict&&db.count()==1,"reused request with different content is rejected");
                check(db.list("book",reader,1).size()==1,"ordinary reader sees public diary");
                var privatePhoto=new ArchiveStore.Entry(UUID.randomUUID().toString(),"photo",author,"ag_Archivist","原片","","{}",false,1001,1);
                db.create("photo-1",privatePhoto);check(db.list("photo",reader,1).isEmpty()&&db.list("photo",author,1).size()==1,"existing owner-only photo policy is preserved");
                String hash=db.blob(id,1,"original.png","image/png",pixels);
                check(hash.equals(db.blob(id,1,"original.png","image/png",pixels)),"attachment retry preserves exact original bytes");
                boolean overwrite=false;try{db.blob(id,1,"original.png","image/png",new byte[]{9});}catch(IllegalArgumentException expected){overwrite=true;}
                check(overwrite&&Arrays.equals(db.blob(id,1,"original.png"),pixels),"original attachment cannot be replaced");
                boolean traversal=false;try{db.blob(id,1,"../outside.png","image/png",pixels);}catch(IllegalArgumentException expected){traversal=true;}
                check(traversal,"attachment path traversal rejected before writing");
                String physical=db.copy(id,1,reader);check(physical!=null&&db.count()==2,"physical copy receipt does not mint another original");
                boolean forgery=false;try{db.create("forge",new ArchiveStore.Entry(id,"book",reader,"Other","forged","text","{}",true,1002,2));}catch(SecurityException expected){forgery=true;}
                check(forgery&&db.get(id,0).equals(first),"another author cannot append a forged edition");
                var edition=new ArchiveStore.Entry(id,"book",author,"ag_Archivist",first.title(),"第二版的故事。",first.metadata(),true,1003,2);
                db.create("edition-2",edition);check(db.get(id,1).equals(first)&&db.get(id,0).equals(edition),"new edition retains original text and queries latest");
            }
            try(var db=new ArchiveStore(file)){
                check(db.get(id,1).equals(first)&&db.get(id,0).version()==2,"cold reopen retains original and edition");
                check(Arrays.equals(db.blob(id,1,"original.png"),pixels),"cold reopen retains and validates attachment bytes");
                check(db.list("book",reader,1).size()==1,"public list has one latest edition per book");
                boolean page=false;try{db.list("book",reader,0);}catch(IllegalArgumentException expected){page=true;}check(page,"invalid pages never become unbounded reads");
            }
            String interrupted=UUID.randomUUID().toString();Path crashed=dir.resolve("interrupted.sqlite");
            String java=Path.of(System.getProperty("java.home"),"bin","java.exe").toString();
            Process child=new ProcessBuilder(java,"-Xint","-Xmx64m","-cp",System.getProperty("java.class.path"),ArchiveStoreTest.class.getName(),"crash-write",crashed.toString(),interrupted,author).inheritIO().start();
            check(child.waitFor()==0,"fixture exits abruptly after commit without closing SQLite");
            try(var db=new ArchiveStore(crashed)){
                check(db.get(interrupted,1).body().contains("没有正常关闭")&&Arrays.equals(db.blob(interrupted,1,"original.png"),new byte[]{1,2,3}),"WAL recovery restores committed text and original bytes after abrupt exit");
            }
            try(var db=new ArchiveStore(file);var injected=DriverManager.getConnection("jdbc:sqlite:"+file)){
                String photo=UUID.randomUUID().toString();var p=new ArchiveStore.Entry(photo,"photo",author,"ag_Archivist","完整原图","故事","{\"imageIndex\":17}",true,1005,1);
                try(var q=injected.createStatement()){q.execute("CREATE TRIGGER reject_fixture BEFORE INSERT ON archive_blobs WHEN NEW.name='fail.png' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");}
                long before=db.count();boolean rollback=false;
                try{db.create("atomic-photo",p,List.of(new ArchiveStore.Attachment("original.png","image/png",pixels),new ArchiveStore.Attachment("fail.png","image/png",pixels)));}catch(SQLException expected){rollback=true;}
                check(rollback&&db.get(photo,0)==null&&db.count()==before,"attachment failure rolls back entry, request and all original bytes");
                check(db.create("atomic-photo",p,List.of(new ArchiveStore.Attachment("original.png","image/png",pixels))).equals(p)&&Arrays.equals(db.blob(photo,1,"original.png"),pixels),"same request recovers after rolled-back photo commit");
                String print=UUID.randomUUID().toString();
                check(db.copy(id,2,reader,"restore-stable",print).equals(print)&&db.copy(id,2,reader,"restore-stable",UUID.randomUUID().toString()).equals(print),"duplicate restoration reserves exactly one print attempt");
                boolean collision=false;try{db.copy(id,1,reader,"restore-stable",UUID.randomUUID().toString());}catch(IllegalArgumentException expected){collision=true;}
                check(collision,"restore request cannot be reused for a different edition");
                check(db.count()==before+1,"copy retries do not change original count or award new evidence");
                check(db.photoIndex().get(17).id().equals(photo),"native image index resolves the existing original without an album-cap dependency");
                boolean kind=false;try{db.create("changed-kind",new ArchiveStore.Entry(id,"notice",author,"ag_Archivist","x","x","{}",true,1006,3));}catch(IllegalArgumentException expected){kind=true;}
                check(kind,"an existing book cannot change kind across editions");
            }
            Path future=dir.resolve("future.sqlite");
            try(var connection=DriverManager.getConnection("jdbc:sqlite:"+future);var q=connection.createStatement()){q.execute("PRAGMA user_version=2");}
            boolean unknown=false;try(var ignored=new ArchiveStore(future)){throw new AssertionError("future schema accepted");}catch(SQLException expected){unknown=true;}
            try(var connection=DriverManager.getConnection("jdbc:sqlite:"+future);var q=connection.createStatement();var r=q.executeQuery("PRAGMA user_version")){r.next();check(unknown&&r.getInt(1)==2,"future database schema fails closed without downgrading its version");}
            System.out.println("PASS "+checks+" archive database checks");
        }finally{
            Path absolute=dir.toRealPath();if(!absolute.getParent().equals(Path.of(System.getProperty("java.io.tmpdir")).toRealPath()))throw new IllegalStateException("Unexpected test path");
            try(var paths=Files.list(absolute)){for(Path p:paths.toList())Files.delete(p);}Files.delete(absolute);
        }
    }
}
