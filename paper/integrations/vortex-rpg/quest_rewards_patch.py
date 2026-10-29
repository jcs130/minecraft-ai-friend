"""Narrow source transformation; rewards await actual native saves/deposits."""
def patch_currency_rewards(q,vault):
 def once(text,before,after):
  assert text.count(before)==1,before[:100]
  return text.replace(before,after,1)
 q=once(q,'            QuestProgress completed = progress.complete();','''            if (definition.rewards().stream().anyMatch(r -> r.type()==QuestRewardType.CURRENCY) && !vaultEconomyBridge.isAvailable()) {
                return CompletableFuture.failedFuture(new IllegalStateException("货币结算服务未就绪；未交付，请稍后查询任务，不要重复领取。"));
            }
            if (definition.rewards().stream().anyMatch(r -> r.type()==QuestRewardType.ITEM || r.type()==QuestRewardType.PERMISSION)) {
                return CompletableFuture.failedFuture(new IllegalStateException("此任务奖励尚未配置可执行结算；本次未交付，请联系服主。"));
            }
            RewardJournal.Ticket ticket;
            try { ticket=qiandengjiRewardJournal().prepare(player.getUniqueId(),definition.id(),progress.startedAt(),
                definition.rewards().stream().map(r->r.type()+":"+r.amount()+":"+r.value()).toList()); }
            catch(java.io.IOException error){return CompletableFuture.failedFuture(error);}
            QuestProgress completed = progress.complete();''')
 q=once(q,'return questRepository.saveAtomically(updated).thenApply(saved -> {\n                grantRewards(player, definition);','''return questRepository.saveAtomically(updated).thenCompose(saved -> {
                try {ticket.committed();}catch(java.io.IOException error){return CompletableFuture.failedFuture(error);}
                return grantRewards(player, definition, ticket).thenApply(rewardsDone -> {''')
 q=once(q,'                return true;\n            });\n        });\n    }\n\n    public CompletableFuture<Boolean> abandonQuest','                return true;\n            });});\n        });\n    }\n\n    public CompletableFuture<Boolean> abandonQuest')
 begin=q.index('    private void grantRewards(');end=q.index('    private Set<String> completedQuestIds',begin)
 q=q[:begin]+'''    private RewardJournal qiandengjiRewardJournal() {
        return new RewardJournal(java.util.Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("VortexRPG")).getDataFolder().toPath().resolve("qiandengji-rewards"));
    }
    public int qiandengjiPendingRewards(java.util.UUID player) {
        try{return qiandengjiRewardJournal().pending(player);}
        catch(java.io.IOException error){throw new java.util.concurrent.CompletionException(error);}
    }
    private CompletableFuture<Void> grantRewards(Player player, QuestDefinition definition, RewardJournal.Ticket ticket) {
        CompletableFuture<Void> chain=CompletableFuture.completedFuture(null);
        int index=0;
        for(QuestRewardDefinition reward:definition.rewards()) {
            final int rewardIndex=index++;
            chain=chain.thenCompose(ignored->{
            try{ticket.issuing(rewardIndex);}catch(java.io.IOException error){return CompletableFuture.failedFuture(error);}
            CompletableFuture<Void> done=new CompletableFuture<>();
            switch(reward.type()) {
                case EXPERIENCE -> scheduler.runEntity(player,"quest-reward-xp-"+player.getUniqueId(),()->{
                    if(!player.isOnline()){done.completeExceptionally(new IllegalStateException("奖励结果待核对；请查询任务，勿自动重试。"));return;}
                    playerProfileService.grantExperience(player,(long)reward.amount(),"quest reward");
                    playerProfileService.qiandengjiSave(player).whenComplete((saved,error)->{if(error==null)done.complete(null);else done.completeExceptionally((Throwable)error);});
                });
                case CURRENCY -> vaultEconomyBridge.depositAsync(player,reward.amount()).whenComplete((amount,error)->{
                    if(error!=null||amount==null||amount.isEmpty()){done.completeExceptionally(new IllegalStateException("货币奖励结果待核对；不能认定成功，勿重复领取，请联系服主。"));return;}
                    scheduler.runEntity(player,"quest-reward-money-message",()->messageService.send(player,"<gold>货币已入账："+vaultEconomyBridge.formatAmount(amount.getAsDouble())+"</gold>"));
                    done.complete(null);
                });
                case COMMAND -> scheduler.runGlobal("quest-reward-command-"+player.getUniqueId(),()->{
                    try{if(!Bukkit.dispatchCommand(Bukkit.getConsoleSender(),reward.value().replace("{player}",player.getName())))throw new IllegalStateException("奖励命令未确认，勿重复领取");done.complete(null);}
                    catch(Exception e){done.completeExceptionally(e);}
                });
                default -> done.completeExceptionally(new IllegalStateException("此奖励类型尚未支持；请联系服主核对，勿重复领取。"));
            }
            return done.thenRun(()->{try{ticket.applied(rewardIndex);}catch(java.io.IOException error){throw new java.util.concurrent.CompletionException(error);}});
            });
        }
        return chain.thenRun(()->{try{ticket.complete();}catch(java.io.IOException error){throw new java.util.concurrent.CompletionException(error);}});
    }

'''+q[end:]
 vault=once(vault,'    private CompletableFuture<OptionalDouble> depositAsync(','    public CompletableFuture<OptionalDouble> depositAsync(')
 vault=once(vault,'            EconomyResponse response = eco.depositPlayer(player, normalized);','''            EconomyResponse response;
            try { response = eco.depositPlayer(player, normalized); }
            catch (Exception error) { future.completeExceptionally(error); return; }''')
 return q,vault
