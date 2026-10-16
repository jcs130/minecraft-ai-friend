package org.afuhome.agentfriend;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;

/** Durable originals, independent of physical books/maps and bounded gameplay ledgers.
 * No authentication commands, passwords, chat prompts or client-reported achievements.
 * Call through PublicArchives' single I/O worker; never write image blobs on a tick. */
final class ArchiveStore implements AutoCloseable {
    record Entry(String id,String kind,String author,String authorName,String title,String body,
                 String metadata,boolean published,long createdAt,int version) { }
    record Attachment(String name,String mime,byte[] bytes) {
        Attachment { bytes=bytes.clone(); }
        @Override public byte[] bytes(){return bytes.clone();}
    }
    private final Connection db;
    ArchiveStore(Path file)throws Exception {
        Files.createDirectories(file.toAbsolutePath().getParent());
        Class.forName("org.sqlite.JDBC");
        db=DriverManager.getConnection("jdbc:sqlite:"+file.toAbsolutePath());
        try(Statement q=db.createStatement()){
            q.execute("PRAGMA busy_timeout=5000");q.execute("PRAGMA journal_mode=WAL");
            q.execute("PRAGMA synchronous=FULL");q.execute("PRAGMA foreign_keys=ON");
            try(ResultSet r=q.executeQuery("PRAGMA user_version")){
                if(!r.next()||r.getInt(1)>1)throw new SQLException("Unknown archive schema; retain database and use matching plugin");
            }
            q.execute("CREATE TABLE IF NOT EXISTS archive_entries(id TEXT NOT NULL,version INTEGER NOT NULL,kind TEXT NOT NULL,author TEXT NOT NULL,author_name TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,metadata TEXT NOT NULL,published INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(id,version))");
            q.execute("CREATE TABLE IF NOT EXISTS archive_requests(actor TEXT NOT NULL,request TEXT NOT NULL,fingerprint TEXT NOT NULL,entry_id TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(actor,request),FOREIGN KEY(entry_id,version) REFERENCES archive_entries(id,version))");
            q.execute("CREATE TABLE IF NOT EXISTS archive_blobs(entry_id TEXT NOT NULL,version INTEGER NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,sha256 TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(entry_id,version,name),FOREIGN KEY(entry_id,version) REFERENCES archive_entries(id,version))");
            q.execute("CREATE TABLE IF NOT EXISTS archive_copies(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL,version INTEGER NOT NULL,recipient TEXT NOT NULL,created_at INTEGER NOT NULL,FOREIGN KEY(entry_id,version) REFERENCES archive_entries(id,version))");
            q.execute("CREATE TABLE IF NOT EXISTS archive_copy_requests(actor TEXT NOT NULL,request TEXT NOT NULL,copy_id TEXT NOT NULL,PRIMARY KEY(actor,request),FOREIGN KEY(copy_id) REFERENCES archive_copies(id))");
            q.execute("CREATE INDEX IF NOT EXISTS archive_list ON archive_entries(kind,published,created_at)");
            try(ResultSet check=q.executeQuery("PRAGMA quick_check")){if(!check.next()||!check.getString(1).equals("ok"))throw new SQLException("Archive database check failed; retain original file");}
            q.execute("PRAGMA user_version=1");
        }catch(Exception error){db.close();throw error;}
    }
    static String digest(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    private static void validate(Entry e){
        UUID.fromString(e.id);UUID.fromString(e.author);
        if(!Set.of("book","photo","notice","event").contains(e.kind)||e.authorName==null||e.authorName.length()>64||e.title==null||e.title.isBlank()||e.title.length()>128||e.body==null||e.body.length()>65536||e.metadata==null||e.metadata.length()>131072||e.createdAt<0||e.version<1)throw new IllegalArgumentException("Invalid archive entry");
    }
    synchronized Entry create(String request,Entry entry)throws Exception {
        return create(request,entry,List.of());
    }
    /** A photo and all available original bytes commit together, including its retry receipt. */
    synchronized Entry create(String request,Entry entry,List<Attachment> attachments)throws Exception {
        validate(entry);if(request==null||!request.matches("[A-Za-z0-9_.:-]{1,100}"))throw new IllegalArgumentException("Invalid request ID");
        if(attachments.size()>17)throw new IllegalArgumentException("Too many archive attachments");
        StringBuilder original=new StringBuilder(entry.kind+"\0"+entry.author+"\0"+entry.title+"\0"+entry.body+"\0"+entry.metadata+"\0"+entry.published);
        Set<String> names=new HashSet<>();
        for(Attachment a:attachments.stream().sorted(Comparator.comparing(Attachment::name)).toList()){
            validateAttachment(a.name,a.mime,a.bytes);
            if(!names.add(a.name))throw new IllegalArgumentException("Duplicate attachment name");
            original.append('\0').append(a.name).append('\0').append(a.mime).append('\0').append(digest(a.bytes));
        }
        String fingerprint=digest(original.toString().getBytes(StandardCharsets.UTF_8));
        try(PreparedStatement q=db.prepareStatement("SELECT fingerprint,entry_id,version FROM archive_requests WHERE actor=? AND request=?")){
            q.setString(1,entry.author);q.setString(2,request);
            try(ResultSet rows=q.executeQuery()){if(rows.next()){
                if(!fingerprint.equals(rows.getString(1)))throw new IllegalArgumentException("Request ID already used for different content");
                return get(rows.getString(2),rows.getInt(3));
            }}
        }
        Entry previous=get(entry.id,0);
        if(previous!=null&&!previous.author.equals(entry.author))throw new SecurityException("Only the original author can add an edition");
        if(previous!=null&&!previous.kind.equals(entry.kind))throw new IllegalArgumentException("Archive kind is immutable");
        if(entry.version!=(previous==null?1:previous.version+1))throw new IllegalArgumentException("Archive version changed; query again");
        db.setAutoCommit(false);
        try{
            try(PreparedStatement q=db.prepareStatement("INSERT INTO archive_entries VALUES(?,?,?,?,?,?,?,?,?,?)")){
                q.setString(1,entry.id);q.setInt(2,entry.version);q.setString(3,entry.kind);q.setString(4,entry.author);q.setString(5,entry.authorName);q.setString(6,entry.title);q.setString(7,entry.body);q.setString(8,entry.metadata);q.setInt(9,entry.published?1:0);q.setLong(10,entry.createdAt);q.executeUpdate();
            }
            try(PreparedStatement q=db.prepareStatement("INSERT INTO archive_requests VALUES(?,?,?,?,?)")){
                q.setString(1,entry.author);q.setString(2,request);q.setString(3,fingerprint);q.setString(4,entry.id);q.setInt(5,entry.version);q.executeUpdate();
            }
            for(Attachment a:attachments)blob(entry.id,entry.version,a.name,a.mime,a.bytes);
            db.commit();return entry;
        }catch(Exception e){db.rollback();throw e;}finally{db.setAutoCommit(true);}
    }
    synchronized Entry get(String id,int version)throws SQLException {
        UUID.fromString(id);
        try(PreparedStatement q=db.prepareStatement(version==0?"SELECT * FROM archive_entries WHERE id=? ORDER BY version DESC LIMIT 1":"SELECT * FROM archive_entries WHERE id=? AND version=?")){
            q.setString(1,id);if(version!=0)q.setInt(2,version);
            try(ResultSet rows=q.executeQuery()){return rows.next()?entry(rows):null;}
        }
    }
    synchronized List<Entry> list(String kind,String author,int page)throws SQLException {
        if(page<1||page>10000)throw new IllegalArgumentException("Page out of range");
        String filter="(published=1 OR author=?) AND (?='' OR kind=?)";
        String sql="SELECT * FROM archive_entries a WHERE "+filter+" AND version=(SELECT MAX(version) FROM archive_entries WHERE id=a.id) ORDER BY created_at DESC,id LIMIT 7 OFFSET ?";
        try(PreparedStatement q=db.prepareStatement(sql)){
            q.setString(1,author);q.setString(2,kind);q.setString(3,kind);q.setInt(4,(page-1)*7);
            List<Entry> out=new ArrayList<>();try(ResultSet rows=q.executeQuery()){while(rows.next())out.add(entry(rows));}return out;
        }
    }
    private static Entry entry(ResultSet r)throws SQLException{return new Entry(r.getString("id"),r.getString("kind"),r.getString("author"),r.getString("author_name"),r.getString("title"),r.getString("body"),r.getString("metadata"),r.getInt("published")==1,r.getLong("created_at"),r.getInt("version"));}
    private static void validateAttachment(String name,String mime,byte[] bytes){
        if(name==null||!name.matches("[A-Za-z0-9_.-]{1,80}")||name.contains("..")||!Set.of("image/png","application/json").contains(mime)||bytes.length>16*1024*1024)throw new IllegalArgumentException("Invalid archive attachment");
    }
    synchronized String blob(String id,int version,String name,String mime,byte[] bytes)throws Exception {
        validateAttachment(name,mime,bytes);
        String sha=digest(bytes);
        try(PreparedStatement q=db.prepareStatement("SELECT sha256 FROM archive_blobs WHERE entry_id=? AND version=? AND name=?")){
            q.setString(1,id);q.setInt(2,version);q.setString(3,name);try(ResultSet rows=q.executeQuery()){if(rows.next()){if(!sha.equals(rows.getString(1)))throw new IllegalArgumentException("Original attachment is immutable");return sha;}}
        }
        try(PreparedStatement q=db.prepareStatement("INSERT INTO archive_blobs VALUES(?,?,?,?,?,?)")){
            q.setString(1,id);q.setInt(2,version);q.setString(3,name);q.setString(4,mime);q.setString(5,sha);q.setBytes(6,bytes);q.executeUpdate();return sha;
        }
    }
    synchronized byte[] blob(String id,int version,String name)throws Exception {
        try(PreparedStatement q=db.prepareStatement("SELECT bytes,sha256 FROM archive_blobs WHERE entry_id=? AND version=? AND name=?")){
            q.setString(1,id);q.setInt(2,version);q.setString(3,name);try(ResultSet rows=q.executeQuery()){if(!rows.next())return null;byte[] bytes=rows.getBytes(1);if(!digest(bytes).equals(rows.getString(2)))throw new SQLException("Archive attachment digest mismatch");return bytes;}
        }
    }
    synchronized String copy(String id,int version,String recipient)throws SQLException {
        return copy(id,version,recipient,UUID.randomUUID().toString(),UUID.randomUUID().toString());
    }
    /** Reserve one print attempt before changing inventory. Repeating a request never prints twice.
     * A crash between reservation and inventory update is UNKNOWN, not permission to replay. */
    synchronized String copy(String id,int version,String recipient,String request,String candidate)throws SQLException {
        UUID.fromString(recipient);UUID.fromString(candidate);
        if(!request.matches("[A-Za-z0-9_.:-]{1,100}"))throw new IllegalArgumentException("Invalid print request");
        try(PreparedStatement q=db.prepareStatement("SELECT c.id,c.entry_id,c.version FROM archive_copy_requests r JOIN archive_copies c ON c.id=r.copy_id WHERE actor=? AND request=?")){
            q.setString(1,recipient);q.setString(2,request);
            try(ResultSet r=q.executeQuery()){if(r.next()){
                if(!r.getString(2).equals(id)||r.getInt(3)!=version)throw new IllegalArgumentException("Print request already used for another edition");
                return r.getString(1);
            }}
        }
        db.setAutoCommit(false);
        try{
        try(PreparedStatement q=db.prepareStatement("INSERT INTO archive_copies VALUES(?,?,?,?,?)")){
            q.setString(1,candidate);q.setString(2,id);q.setInt(3,version);q.setString(4,recipient);q.setLong(5,System.currentTimeMillis());q.executeUpdate();
        }
        try(PreparedStatement q=db.prepareStatement("INSERT INTO archive_copy_requests VALUES(?,?,?)")){
            q.setString(1,recipient);q.setString(2,request);q.setString(3,candidate);q.executeUpdate();
        }
        db.commit();return candidate;
        }catch(Exception e){db.rollback();throw e;}finally{db.setAutoCommit(true);}
    }
    synchronized long count()throws SQLException{try(Statement q=db.createStatement();ResultSet r=q.executeQuery("SELECT COUNT(*) FROM archive_entries")){r.next();return r.getLong(1);}}
    synchronized Map<Integer,Entry> photoIndex()throws SQLException{
        Map<Integer,Entry> out=new HashMap<>();
        try(Statement q=db.createStatement();ResultSet r=q.executeQuery("SELECT a.*,json_extract(metadata,'$.imageIndex') AS image_index FROM archive_entries a WHERE kind='photo' AND version=(SELECT MAX(version) FROM archive_entries WHERE id=a.id)")){
            while(r.next()){int index=r.getInt("image_index");if(!r.wasNull())out.put(index,entry(r));}return out;
        }
    }
    @Override public synchronized void close()throws SQLException{try(Statement q=db.createStatement()){q.execute("PRAGMA wal_checkpoint(TRUNCATE)");}finally{db.close();}}
}
