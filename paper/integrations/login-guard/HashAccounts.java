import xyz.kyngs.librelogin.common.crypto.BCrypt2ACryptoProvider;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
/** Private operator helper: password input is stdin, never a command argument. */
public class HashAccounts {
    public static void main(String[] args) throws Exception {
        var crypto=new BCrypt2ACryptoProvider();
        var in=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));
        String line;
        while((line=in.readLine())!=null) {
            var s=line.split("\\t",2);
            var h=crypto.createHash(new String(Base64.getDecoder().decode(s[1]),StandardCharsets.UTF_8));
            if(h==null) throw new IllegalArgumentException("Invalid password");
            System.out.println(s[0]+"\t"+h.hash()+"\t"+h.salt()+"\t"+h.algo());
        }
    }
}
