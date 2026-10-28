package org.qiandengji.vortex;

import com.google.gson.*;
import io.vortexcore.integration.vault.VaultEconomyBridge;
import io.vortexcore.quest.RewardJournal;
import java.util.*;
import java.util.function.Consumer;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Reuses the native Vault hook and durable reward journal; never replays unknown deposits. */
final class RecyclingSettlement {
    private final JavaPlugin plugin;
    private final VaultEconomyBridge vault;
    private final EconomyReceipts journal;
    private final Set<UUID> busy=new HashSet<>();
    private final Gson gson=new Gson();
    RecyclingSettlement(JavaPlugin plugin,VaultEconomyBridge vault){
        this.plugin=plugin;this.vault=vault;
        journal=new EconomyReceipts(plugin.getDataFolder().toPath().resolve("recycle-receipts"));
    }
    String state(Player p){
        var out=new LinkedHashMap<String,Object>();out.put("currency","金币");
        out.put("available",vault.isAvailable());
        if(vault.isAvailable())out.put("balance",vault.balance(p));
        try{out.put("pending",busy.contains(p.getUniqueId())||journal.pending(p.getUniqueId()));}
        catch(Exception unreadable){out.put("pending",true);out.put("reason","receipt_unavailable");}
        return gson.toJson(out);
    }
    void settle(Player p,String quote,long coins,String snapshot,Runnable remove,Consumer<String> finish){
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("entity thread required");
        UUID.fromString(quote);
        if(coins<1||coins>2048||snapshot.length()>24000)throw new IllegalArgumentException("invalid recycling quote");
        if(!p.isOnline()||p.isDead()||!vault.isAvailable()){
            finish.accept(result(false,"economy_unavailable",quote,null));return;
        }
        final RewardJournal.Ticket ticket;
        try{
            if(busy.contains(p.getUniqueId())||journal.pending(p.getUniqueId())){
                finish.accept(result(false,"recycle_pending",quote,null));return;
            }
            // Full original stack/source metadata is private recovery evidence,
            // not a second inventory. The stable quote ID reserves this sale.
            ticket=journal.begin(p.getUniqueId(),"recycle-"+quote,
                List.of("ESCROW:"+snapshot,"CURRENCY:"+coins));
            ticket.committed();busy.add(p.getUniqueId());ticket.issuing(0);
            remove.run(); // Original AF slot/fingerprint validation and durable inventory/stash save.
            ticket.applied(0);ticket.issuing(1);
        }catch(Exception uncertain){
            busy.remove(p.getUniqueId());finish.accept(result(false,"recycle_unverified",quote,null));return;
        }
        try{
            vault.depositAsync(p,coins).whenComplete((paid,error)->{
                Runnable completed=()->{
                    boolean ok=false;
                    try{
                        if(error!=null||paid==null||paid.isEmpty()||Math.abs(paid.getAsDouble()-coins)>.00001)
                            throw new IllegalStateException("native deposit not confirmed");
                        ticket.applied(1);journal.finish(p.getUniqueId(),ticket);ok=true;
                    }catch(Exception uncertain){/* Keep original escrow and ISSUING evidence. No restore/redeposit. */}
                    finally{busy.remove(p.getUniqueId());}
                    finish.accept(result(ok,ok?"ok":"recycle_unverified",quote,ok?vault.balance(p):null));
                };
                if(Bukkit.isPrimaryThread())completed.run();
                else if(plugin.isEnabled())Bukkit.getScheduler().runTask(plugin,completed);
                // Shutdown leaves the durable journal unresolved for explicit reconciliation.
            });
        }catch(Exception uncertain){
            busy.remove(p.getUniqueId());finish.accept(result(false,"recycle_unverified",quote,null));
        }
    }
    /** Same Vault provider as Vortex. Debit first; credit only after durable domain state. */
    String money(Player p,String request,long delta,String snapshot,Runnable domainWrite){
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("entity thread required");
        if(!request.matches("[a-zA-Z0-9_:-]{1,120}")||delta==0||Math.abs(delta)>1_000_000_000L||snapshot.length()>24000)
            throw new IllegalArgumentException("invalid money request");
        try{
            if(journal.completed(p.getUniqueId(),request))return result(false,"transaction_already_completed",request,vault.balance(p));
            if(busy.contains(p.getUniqueId())||journal.pending(p.getUniqueId()))return result(false,"money_pending",request,null);
            var registration=Bukkit.getServicesManager().getRegistration(net.milkbowl.vault.economy.Economy.class);
            if(!p.isOnline()||!vault.isAvailable()||registration==null||!vault.providerName().equals(registration.getProvider().getName()))
                return result(false,"economy_unavailable",request,null);
            var bank=registration.getProvider();double before=vault.balance(p);
            if(delta<0&&before < -delta)return result(false,"insufficient_balance",request,before);
            var ticket=journal.begin(p.getUniqueId(),request,List.of("DOMAIN:"+snapshot,"GOLD:"+delta+";before="+before));
            ticket.committed();busy.add(p.getUniqueId());
            if(delta>0){ticket.issuing(0);domainWrite.run();ticket.applied(0);}
            ticket.issuing(1);
            var paid=delta>0?bank.depositPlayer(p,delta):bank.withdrawPlayer(p,-delta);
            if(paid==null||!paid.transactionSuccess()||Math.abs(paid.amount-Math.abs(delta))>.00001||Math.abs(vault.balance(p)-before-delta)>.00001)
                throw new IllegalStateException("native bank operation unconfirmed");
            ticket.applied(1);
            if(delta<0){ticket.issuing(0);domainWrite.run();ticket.applied(0);}
            journal.finish(p.getUniqueId(),ticket);
            return result(true,"ok",request,vault.balance(p));
        }catch(Exception uncertain){return result(false,"money_unverified",request,null);}
        finally{busy.remove(p.getUniqueId());}
    }
    private String result(boolean success,String reason,String quote,Double balance){
        var out=new LinkedHashMap<String,Object>();out.put("success",success);out.put("reason",reason);
        out.put("quoteId",quote);out.put("currency","金币");if(balance!=null)out.put("balance",balance);
        out.put("pending",Set.of("recycle_pending","recycle_unverified","money_pending","money_unverified").contains(reason));
        return gson.toJson(out);
    }
}
