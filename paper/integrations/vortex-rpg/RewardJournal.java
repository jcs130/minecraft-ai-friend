package io.vortexcore.quest;

import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** Durable evidence across quest/XP/economy stores. Never replays an uncertain reward. */
public final class RewardJournal {
    private final Path root;
    public RewardJournal(Path root){this.root=root;}
    public synchronized Ticket prepare(UUID player,String quest,Instant started,List<String> rewards) throws IOException {
        String id;
        try{id=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest((player+"\n"+quest+"\n"+started).getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException impossible){throw new AssertionError(impossible);}
        Path file=root.resolve(player.toString()).resolve(id+".properties");Files.createDirectories(file.getParent());
        if(Files.exists(file))throw new IOException("已有领奖记录待核对；不重复发奖，请查任务状态并联系服主。");
        Properties p=new Properties();p.setProperty("player",player.toString());p.setProperty("quest",quest);
        p.setProperty("startedAt",started.toString());p.setProperty("state","PREPARED");
        for(int n=0;n<rewards.size();n++){p.setProperty("reward."+n+".definition",rewards.get(n));p.setProperty("reward."+n,"PENDING");}
        Files.createFile(file); // Exclusive reservation also covers concurrent API/GUI claims.
        var ticket=new Ticket(file,p);ticket.save();return ticket;
    }
    public int pending(UUID player) throws IOException {
        Path directory=root.resolve(player.toString());if(!Files.exists(directory))return 0;
        try(var files=Files.list(directory)){
            int count=0,visited=0;
            for(Path file:files.filter(p->p.getFileName().toString().matches("[a-f0-9]{64}\\.properties")).toList()){
                if(++visited>4096)throw new IOException("奖励记录过多，需服主核查");
                if(Files.size(file)>65536)throw new IOException("奖励记录大小异常");
                Properties p=new Properties();try(var in=Files.newInputStream(file)){p.load(in);}
                if(!player.toString().equals(p.getProperty("player"))||p.getProperty("state")==null)throw new IOException("奖励记录不可验证");
                if(!"COMPLETE".equals(p.getProperty("state")))count++;
            }
            return count;
        }
    }
    public static final class Ticket {
        private final Path file;private final Properties data;
        private Ticket(Path file,Properties data){this.file=file;this.data=data;}
        private void save() throws IOException {
            Path tmp=Files.createTempFile(file.getParent(),"reward-",".tmp");
            try{
                try(var out=Files.newOutputStream(tmp)){data.store(out,"Qiandengji reward evidence; ISSUING means unknown, do not replay");}
                try(var channel=FileChannel.open(tmp,StandardOpenOption.WRITE)){channel.force(true);}
                Files.move(tmp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            } finally {Files.deleteIfExists(tmp);}
        }
        public synchronized void committed() throws IOException {data.setProperty("state","QUEST_COMMITTED");save();}
        public synchronized void issuing(int index) throws IOException {
            if(!"QUEST_COMMITTED".equals(data.getProperty("state"))||!"PENDING".equals(data.getProperty("reward."+index)))throw new IOException("奖励状态不允许再次执行");
            data.setProperty("reward."+index,"ISSUING");save();
        }
        public synchronized void applied(int index) throws IOException {
            if(!"ISSUING".equals(data.getProperty("reward."+index)))throw new IOException("缺少执行证据");
            data.setProperty("reward."+index,"APPLIED");save();
        }
        public synchronized void complete() throws IOException {
            if(!"QUEST_COMMITTED".equals(data.getProperty("state")))throw new IOException("任务尚未确认保存");
            for(String key:data.stringPropertyNames())if(key.matches("reward\\.\\d+")&&!"APPLIED".equals(data.getProperty(key)))throw new IOException("奖励尚未全部确认");
            data.setProperty("state","COMPLETE");save();
        }
    }
}
