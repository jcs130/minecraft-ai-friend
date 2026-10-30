package dev.qiandeng.accounts.tests;
import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.plugin.*;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import xyz.kyngs.librelogin.api.provider.LibreLoginProvider;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.*;
import com.google.gson.*;
/** Isolated fixture only. Never included in either production artifact. */
@Plugin(id="shared-account-lab-fixture",name="Isolated native account fixture",version="1",dependencies={@Dependency(id="librelogin")})
public final class NativeFixture {
 private final ProxyServer proxy;
 @Inject public NativeFixture(ProxyServer proxy){this.proxy=proxy;}
 @Subscribe public void start(ProxyInitializeEvent event){
  if(!Files.isRegularFile(Path.of(".shared-account-lab")))throw new IllegalStateException("ISOLATED_FIXTURE_MARKER_REQUIRED");
  Object provider=proxy.getPluginManager().getPlugin("librelogin").flatMap(x->x.getInstance()).orElseThrow();
  var libre=((LibreLoginProvider<Player,RegisteredServer>)provider).getLibreLogin();
  for(String name:List.of("corti","corticam","player","goddess","ag_AdminQa")){
   if(libre.getDatabaseProvider().getByName(name)!=null)continue;
   var hash=libre.getDefaultCryptoProvider().createHash(UUID.randomUUID().toString());var now=new Timestamp(System.currentTimeMillis());
   libre.getDatabaseProvider().insertUser(libre.createUser(UUID.nameUUIDFromBytes(("OfflinePlayer:"+name).getBytes(StandardCharsets.UTF_8)),null,hash,name,now,now,null,null,null,null,null));
  }
  try{
   var cfg=JsonParser.parseString(Files.readString(Path.of("../private/test-credentials.json"))).getAsJsonObject();
   for(String field:List.of("newName","oldName","retryName")){
    if(!cfg.has(field))continue;
    String passwordKey=cfg.has(field+"PasswordKey")?cfg.get(field+"PasswordKey").getAsString():field.equals("newName")&&cfg.has("newPasswordWasChanged")&&cfg.get("newPasswordWasChanged").getAsBoolean()?"changedPassword":"password";
    String name=cfg.get(field).getAsString(),password=cfg.get(passwordKey).getAsString();var user=libre.getDatabaseProvider().getByName(name);
    if(user==null){var now=new Timestamp(System.currentTimeMillis());var hash=libre.getDefaultCryptoProvider().createHash(password);libre.getDatabaseProvider().insertUser(libre.createUser(UUID.nameUUIDFromBytes(("OfflinePlayer:"+name).getBytes(StandardCharsets.UTF_8)),null,hash,name,now,now,null,null,null,null,null));user=libre.getDatabaseProvider().getByName(name);}
    if(!user.isRegistered()||!user.getLastNickname().equals(name)||!libre.getCryptoProvider(user.getHashedPassword().algo()).matches(password,user.getHashedPassword()))throw new IllegalStateException("NATIVE_FIXTURE_PROOF_FAILED");
   }
   Files.writeString(Path.of("../native-fixture-proof.json"),"{\"nativeProviderVerified\":true,\"existingHashesOverwritten\":false}");
  }catch(Exception invalid){throw new IllegalStateException("ISOLATED_FIXTURE_FAILURE",invalid);}
 }
}
