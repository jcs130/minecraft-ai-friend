"""Patch the pinned native join/load lifecycle; cache hits can finish in JoinEvent."""
def patch_profiles(text, replace_once):
    text=replace_once(text,'repository.loadPlayer(player.getUniqueId()).whenComplete((snapshot, error) -> {','''CompletableFuture<?> previousSave=pendingSaves.get(player.getUniqueId());
        CompletableFuture<?> saveGate=previousSave==null?CompletableFuture.completedFuture(null):previousSave;
        saveGate.thenCompose(ignored -> repository.loadPlayer(player.getUniqueId())).whenComplete((snapshot, error) -> {''')
    text=replace_once(text,'loadingPlayers.remove(player.getUniqueId());\n                return;','// Keep this session blocked; never save an empty placeholder over unreadable data.\n                return;')
    before='''            scheduler.runEntity(player, "profile-join-load-" + player.getUniqueId(), () -> {
                if (!player.isOnline()) {
                    loadingPlayers.remove(player.getUniqueId());
                    return;
                }
                profile.applySnapshot(snapshot == null ? PlayerSnapshot.create(player.getUniqueId()) : snapshot);
                loadingPlayers.remove(player.getUniqueId());
                classSkillService.applyLiveAttributes(player, profile);
                if (!classSkillService.hasClass(profile)) {
                    messageService.send(player, "Welcome to VortexRPG. Use <yellow>/class</yellow> to choose your path.");
                }
            });'''
    after='''            // A cached load completes inside PlayerJoinEvent, when Paper may
            // still report isValid=false. Defer before requesting the entity task.
            scheduler.runGlobal("profile-join-ready-" + player.getUniqueId(), () -> {
                if (!player.isOnline() || profiles.get(player.getUniqueId()) != profile) return;
                scheduler.runEntity(player, "profile-join-load-" + player.getUniqueId(), () -> {
                    if (!player.isOnline() || profiles.get(player.getUniqueId()) != profile) return;
                    profile.applySnapshot(snapshot == null ? PlayerSnapshot.create(player.getUniqueId()) : snapshot);
                    loadingPlayers.remove(player.getUniqueId());
                    classSkillService.applyLiveAttributes(player, profile);
                    if (!classSkillService.hasClass(profile)) {
                        messageService.send(player, "Welcome to VortexRPG. Use <yellow>/class</yellow> to choose your path.");
                    }
                });
            });'''
    text=replace_once(text,before,after)
    text=replace_once(text,'loadingPlayers.remove(player.getUniqueId());\n        UnifiedPlayer profile = profiles.remove(player.getUniqueId());\n        if (profile != null) {','boolean incompleteLoad=loadingPlayers.remove(player.getUniqueId());\n        UnifiedPlayer profile = profiles.remove(player.getUniqueId());\n        if (profile != null && !incompleteLoad) {')
    # The narrow API is recompiled with this class instead of losing the ASM ABI.
    text=replace_once(text,'    private CompletableFuture<PlayerSnapshot> queueSave(UUID playerId, String playerName, UnifiedPlayer profile) {','''    public boolean qiandengjiLoading(UUID id){return loadingPlayers.contains(id);}
    public CompletableFuture<PlayerSnapshot> qiandengjiSave(Player p){return queueSave(p.getUniqueId(),p.getName(),profile(p));}
    private CompletableFuture<PlayerSnapshot> queueSave(UUID playerId, String playerName, UnifiedPlayer profile) {''')
    return text.replace('Attribute.MAX_HEALTH','Attribute.GENERIC_MAX_HEALTH')
