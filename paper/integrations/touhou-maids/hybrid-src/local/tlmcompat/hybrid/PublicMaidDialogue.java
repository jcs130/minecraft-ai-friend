package local.tlmcompat.hybrid;

import com.google.gson.JsonObject;
import java.util.UUID;
import java.util.regex.Pattern;

/** Public delivery evidence only; never invoked for native owner-only history. */
final class PublicMaidDialogue {
    private static final Pattern PRIVATE=Pattern.compile("MC_AUTH_|^MC_[A-Z_]+\\s*\\{|/(?:[\\w-]+:)?(?:login|register|changepassword|changepass|password|2fa|totp|auth)\\b|password|passwd|api[ _-]?key|authorization|bearer\\s|(?:sk[-_]|(?:srv|obs|pub|pat)_)[A-Za-z0-9_-]{16}|密码|口令|验证码|密钥|令牌",Pattern.CASE_INSENSITIVE);
    static String line(UUID maid,String owner,String name,String dimension,String operation,String text,int delivered){
        if(maid==null||owner==null||!owner.matches("\\.?[A-Za-z0-9_]{1,16}")||name==null||name.isBlank()||name.length()>32
            ||name.codePoints().anyMatch(Character::isISOControl)||name.contains("（")||name.contains("）")
            ||dimension==null||!dimension.matches("[a-z0-9_.-]+:[a-z0-9_./-]{1,80}")
            ||operation==null||!operation.matches("[A-Za-z0-9_-]{1,64}")||text==null||text.isBlank()||text.length()>1000
            ||text.codePoints().anyMatch(Character::isISOControl)||PRIVATE.matcher(text).find()||PRIVATE.matcher(name).find()
            ||delivered<1||delivered>256)return null;
        JsonObject row=new JsonObject();row.addProperty("schemaVersion",1);row.addProperty("maidUuid",maid.toString());
        row.addProperty("ownerName",owner);row.addProperty("name",name.replaceAll("§[0-9a-fk-or]",""));
        row.addProperty("dimension",dimension);row.addProperty("operationId",operation);row.addProperty("text",text.replaceAll("§[0-9a-fk-or]",""));row.addProperty("delivered",delivered);
        return "QD_PUBLIC_MAID "+row;
    }
}
