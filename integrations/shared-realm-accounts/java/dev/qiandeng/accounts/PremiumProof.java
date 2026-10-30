package dev.qiandeng.accounts;
import com.google.gson.JsonObject;
import java.util.UUID;
import static dev.qiandeng.accounts.BridgeFiles.text;
/** Pure predicate; the verified UUID must come from the native Mojang session service. */
public final class PremiumProof {
    public static boolean matches(JsonObject permit,String name,UUID bodyId,UUID verified,long now){
        try{
            return permit!=null&&verified!=null&&"succeeded".equals(text(permit,"state"))&&"identity".equals(text(permit,"operation"))&&"sao".equals(text(permit,"realmId"))
                &&!permit.get("totpRequired").getAsBoolean()&&permit.get("observedAt").getAsLong()<=now+1000
                &&permit.get("permitExpiresAt").getAsLong()>=now&&permit.get("permitExpiresAt").getAsLong()-permit.get("observedAt").getAsLong()<=120000
                &&name.equals(text(permit,"bodyName"))&&name.equals(text(permit,"primaryName"))&&bodyId.toString().equals(text(permit,"bodyUuid"))&&verified.toString().equals(text(permit,"premiumUuid"));
        }catch(RuntimeException malformed){return false;}
    }
}
