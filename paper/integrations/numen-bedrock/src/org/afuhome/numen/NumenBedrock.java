package org.afuhome.numen;

import com.dwinovo.numen.api.brain.*;
import com.dwinovo.numen.api.entity.CompanionRegistry;
import com.dwinovo.numen.api.home.Homes;
import com.dwinovo.numen.api.library.EntryId;
import com.dwinovo.numen.api.agent.llm.ProviderLibrary;
import com.google.gson.*;
import net.minecraft.server.MinecraftServer;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.craftbukkit.CraftServer;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.geysermc.floodgate.api.FloodgateApi;
import org.geysermc.floodgate.api.player.FloodgatePlayer;
import org.geysermc.cumulus.form.*;
import java.nio.file.Files;
import java.util.*;
import java.util.function.IntConsumer;
import java.util.function.Consumer;

/** A Bedrock view of Numen's own owner-scoped API; no separate credential store. */
public final class NumenBedrock extends JavaPlugin implements Listener {
    private final FormTickets tickets = new FormTickets();
    private MinecraftServer minecraft;
    private static final List<String> PROTOCOLS = List.of("chat", "responses", "anthropic");

    @Override public void onEnable() {
        minecraft = ((CraftServer) Bukkit.getServer()).getServer();
        getServer().getPluginManager().registerEvents(this, this);
        Bukkit.getCommandMap().register("numenbedrock", new Command("numenmenu", "Numen基岩设置", "/numenmenu", List.of()) {
            @Override public boolean execute(CommandSender sender, String label, String[] args) {
                if (!(sender instanceof Player player)) { sender.sendMessage("请在游戏内使用此菜单。"); return true; }
                if (canUse(player)) menu(player);
                else player.sendMessage("[Numen] 基岩玩家用 /numenmenu；Java装模组后用 /numen settings。");
                return true;
            }
        });
    }

    @Override public void onDisable() { tickets.clear(); }

    @EventHandler(priority=EventPriority.HIGHEST, ignoreCancelled=true)
    public void settings(PlayerCommandPreprocessEvent event) {
        // Proxy login remains authoritative. Do not resurrect cancelled commands.
        String text = event.getMessage().strip().replaceAll("\\s+", " ");
        if ((text.equalsIgnoreCase("/numen settings") || text.equalsIgnoreCase("/numen:numen settings"))
                && canUse(event.getPlayer())) { event.setCancelled(true); menu(event.getPlayer()); }
    }

    @EventHandler public void quit(PlayerQuitEvent event) { tickets.close(event.getPlayer().getUniqueId()); }

    private boolean canUse(Player player) {
        return player.isOnline() && player.hasPermission("numenbedrock.use")
                && FloodgateApi.getInstance().isFloodgatePlayer(player.getUniqueId());
    }

    private Libraries libraries() { return Libraries.of(minecraft); }

    private List<JsonObject> profiles(Player player) {
        List<JsonObject> entries = new ArrayList<>();
        for (JsonElement element : JsonParser.parseString(libraries().view(player.getUniqueId(), false, Libraries.PROVIDER)).getAsJsonArray()) {
            if (element.isJsonObject() && element.getAsJsonObject().has("id")) entries.add(element.getAsJsonObject());
        }
        return entries;
    }

    private static String str(JsonObject row, String key) {
        return row.has(key) && row.get(key).isJsonPrimitive() ? row.get(key).getAsString() : "";
    }

    private static boolean enabled(JsonObject row) {
        return !row.has("enabled") || row.get("enabled").getAsBoolean();
    }

    private void menu(Player p) {
        simple(p, SimpleForm.builder().title("Numen 同伴")
                .content("模型、个人Key与同伴绑定。沿用本人原Numen资料，修改只影响自己。")
                .button("模型与个人Key").button("我的同伴／绑定模型").button("召唤同伴").button("使用说明"),
                choice -> { switch(choice) {
                    case 0 -> modelList(p); case 1 -> companions(p); case 2 -> summon(p);
                    case 3 -> simple(p, SimpleForm.builder().title("Numen 使用说明")
                            .content("先创建模型档案并配置Key，再召唤同伴、为她绑定档案。\n"
                                    + "同伴需真实物资，遵守生存和建筑保护规则。每人最多2位。\n"
                                    + "Key由服务器保管，服主可读取；不要在聊天中发送。\n"
                                    + "未配置可用模型时不会自主行动；本菜单不会自动测试或消费模型额度。\n"
                                    + "Java面板与基岩菜单使用同一份本人资料。")
                            .button("返回"), ignored -> menu(p));
                    default -> menu(p);
                }});
    }

    private void modelList(Player p) {
        List<JsonObject> rows = profiles(p);
        SimpleForm.Builder form = SimpleForm.builder().title("模型与个人Key").content("选择档案，或新建自己的模型档案。").button("＋ 新建个人档案");
        for (JsonObject row : rows) form.button(str(row,"name") + " · " + str(row,"model")
                + "\n" + (str(row,"keySource").isEmpty() ? "未配置Key" : "Key已配置") + (enabled(row) ? "" : " · 已停用"));
        form.button("返回");
        simple(p, form, index -> {
            if (index == 0) edit(p, new JsonObject());
            else if (index <= rows.size()) modelActions(p, rows.get(index-1));
            else menu(p);
        });
    }

    private void modelActions(Player p, JsonObject row) {
        boolean mine = "mine".equals(str(row,"group"));
        SimpleForm.Builder form = SimpleForm.builder().title(str(row,"name"))
                .content("模型：" + str(row,"model") + "\n服务商：" + str(row,"provider")
                        + "\nKey状态：" + (str(row,"keySource").isEmpty() ? "未配置" : "已有可用Key")
                        + "\n此处不会显示已保存的Key。");
        if (mine) form.button("修改模型档案");
        form.button("填写／替换个人Key").button("清除该服务商的个人Key").button("返回");
        simple(p, form, index -> {
            if (mine && index == 0) { edit(p,row); return; }
            int action = index - (mine ? 1 : 0);
            if (action == 0) keyForm(p,row);
            else if (action == 1) simple(p, SimpleForm.builder().title("确认清除个人Key")
                    .content("仅清除本人服务商「" + str(row,"provider") + "」的Key；同服务商的本人档案都会受影响。服主共享Key保持原样。")
                    .button("确认清除").button("取消"), confirm -> {
                        if (confirm == 0) { libraries().saveOwnKey(p.getUniqueId(),str(row,"provider"),"");
                            verifySaved(p, null, null, str(row,"provider"), ""); }
                        else modelActions(p,row);
                    });
            else modelList(p);
        });
    }

    private void edit(Player p, JsonObject row) {
        int selected = Math.max(0, PROTOCOLS.indexOf(str(row,"protocol")));
        custom(p, CustomForm.builder().title("个人模型档案")
                .input("档案名", "例如 我的模型", str(row,"name"))
                .input("服务商标识", "例如 openai", str(row,"provider"))
                .input("模型名称", "填写实际可用的型号", str(row,"model"))
                .dropdown("接口协议", List.of("OpenAI兼容 Chat", "OpenAI Responses", "Anthropic Messages"), selected)
                .input("基础地址（留空用服务商默认值）", "https://example.com/v1", str(row,"base_url"))
                .input("个人Key（明文输入；留空保留）", "服主可读取，避开直播画面")
                .label("提交会保存档案和个人Key；不会自动发起模型请求。"), response -> {
                    ModelDraft draft = new ModelDraft(row,response.asInput(0),response.asInput(1),response.asInput(2),
                            PROTOCOLS.get(response.asDropdown(3)),response.asInput(4),response.asInput(5));
                    Libraries.Result saved = libraries().handle(p.getUniqueId(),false,Libraries.PROVIDER,Libraries.PUT,draft.fields);
                    if (saved.problem() != null) { p.sendMessage("[Numen] 档案未保存，请重新打开菜单检查名称与参数。"); return; }
                    String id = str(row,"id");
                    for (JsonElement e : JsonParser.parseString(saved.entries()).getAsJsonArray())
                        if (e.isJsonObject() && e.getAsJsonObject().has(Libraries.CREATED)) id=e.getAsJsonObject().get(Libraries.CREATED).getAsString();
                    if (!draft.key.isEmpty()) libraries().saveOwnKey(p.getUniqueId(),draft.service,draft.key);
                    verifySaved(p,id,ProviderLibrary.profileToJson(ProviderLibrary.profileFromJson(draft.fields)),
                            draft.service,draft.key.isEmpty() ? null : draft.key);
                });
    }

    private void keyForm(Player p, JsonObject row) {
        custom(p, CustomForm.builder().title("填写个人Key")
                .input("服务商「" + str(row,"provider") + "」的Key", "明文输入，避开直播画面")
                .label("Key由服务器保管，服主可读取。留空取消；替换会影响本人同服务商的档案。"), response -> {
                    String key = ModelDraft.clean(response.asInput(0));
                    if (key.isEmpty()) { modelActions(p,row); return; }
                    // Use the same validator as the profile form without copying the key into that profile.
                    ModelDraft draft = new ModelDraft(new JsonObject(),"key",str(row,"provider"),"key","chat","",key);
                    libraries().saveOwnKey(p.getUniqueId(),draft.service,draft.key);
                    verifySaved(p,null,null,draft.service,draft.key);
                });
    }

    private void verifySaved(Player p, String id, JsonObject expected, String service, String key) {
        var home = Homes.of(minecraft).owner(p.getUniqueId());
        // Queue behind Numen's own writes. Never report a queued write as durable.
        home.io().executor().execute(() -> {
            boolean saved = false;
            try {
                boolean profileOk = true;
                if (id != null && expected != null) {
                    EntryId entry = EntryId.parse(id);
                    if (entry == null) throw new IllegalStateException("profile id missing");
                    var path = home.file("provider").resolve(entry.namespace()).resolve(entry.name()+".json");
                    profileOk = JsonParser.parseString(Files.readString(path)).equals(expected);
                }
                var path = home.file("keys").resolve(service+".key");
                boolean keyOk = key == null || (key.isEmpty() ? !Files.exists(path) : key.equals(Files.readString(path).strip()));
                saved = profileOk && keyOk;
            } catch (Exception failure) {
                // No request body, key, provider URL or exception text in logs.
                getLogger().warning("Numen personal settings readback failed for " + p.getUniqueId());
            }
            boolean confirmed = saved;
            if (isEnabled()) Bukkit.getScheduler().runTask(this, () -> {
                if (Bukkit.getPlayer(p.getUniqueId()) != p || !canUse(p)) return;
                p.sendMessage(confirmed ? "[Numen] 本人配置已保存并核对。用 /numenmenu → 我的同伴绑定模型。"
                        : "[Numen] 保存结果未确认。请重新打开菜单查询；不要反复提交Key。");
            });
        });
    }

    private void companions(Player p) {
        var owned = CompanionRegistry.get(minecraft).ownedBy(p.getUniqueId());
        SimpleForm.Builder form = SimpleForm.builder().title("我的同伴").content("选择同伴绑定模型；只列出本人名下的同伴。");
        for (var entry : owned) form.button(entry.getValue().name());
        form.button("返回");
        simple(p,form,index -> { if (index < owned.size()) bind(p,owned.get(index).getKey()); else menu(p); });
    }

    private void bind(Player p, UUID companion) {
        List<JsonObject> rows = profiles(p).stream().filter(NumenBedrock::enabled).toList();
        SimpleForm.Builder form = SimpleForm.builder().title("绑定模型档案").content("选择可用档案；绑定后聊天可触发模型调用和费用。");
        for (JsonObject row : rows) form.button(str(row,"name") + " · " + str(row,"model"));
        form.button("返回");
        simple(p,form,index -> {
            if (index >= rows.size()) { companions(p); return; }
            var result = OwnerInputs.handle(minecraft,p.getUniqueId(),new OwnerInput.Bind(companion,Slot.PROVIDER,str(rows.get(index),"id")),Venue.PANEL);
            p.sendMessage(result.problem() == null ? "[Numen] 已为本人的同伴绑定模型档案。"
                    : "[Numen] 未能绑定。请确认同伴仍在本人名下且在线，档案没有被停用，再重新打开菜单。");
        });
    }

    private void summon(Player p) {
        custom(p,CustomForm.builder().title("召唤自己的同伴").input("同伴用户名", "1至16位英文字母、数字或下划线")
                .label("会在本人附近以生存模式加入，遵守服务器权限。之后到我的同伴绑定模型。"),response -> {
                    String name = ModelDraft.clean(response.asInput(0));
                    if (!name.matches("[A-Za-z0-9_]{1,16}")) throw new IllegalArgumentException("名字需为1至16位英文字母、数字或下划线。");
                    // Only non-secret text goes through command dispatch; original summon receipts stay private.
                    Bukkit.dispatchCommand(p,"numen player summon " + name);
                });
    }

    private void simple(Player p, SimpleForm.Builder form, IntConsumer action) {
        var connection = FloodgateApi.getInstance().getPlayer(p.getUniqueId());
        UUID ticket = tickets.issue(p.getUniqueId(),System.currentTimeMillis());
        form.validResultHandler(response -> accept(p,connection,ticket,() -> action.accept(response.clickedButtonId())));
        form.closedOrInvalidResultHandler(() -> accept(p,connection,ticket,() -> {}));
        if (!FloodgateApi.getInstance().sendForm(p.getUniqueId(),form.build())) { tickets.close(p.getUniqueId()); p.sendMessage("[Numen] 菜单发送失败，请稍后用 /numenmenu 重试。"); }
    }

    private void custom(Player p, CustomForm.Builder form, Consumer<org.geysermc.cumulus.response.CustomFormResponse> action) {
        var connection = FloodgateApi.getInstance().getPlayer(p.getUniqueId());
        UUID ticket = tickets.issue(p.getUniqueId(),System.currentTimeMillis());
        form.validResultHandler(response -> accept(p,connection,ticket,() -> action.accept(response)));
        form.closedOrInvalidResultHandler(() -> accept(p,connection,ticket,() -> {}));
        if (!FloodgateApi.getInstance().sendForm(p.getUniqueId(),form.build())) { tickets.close(p.getUniqueId()); p.sendMessage("[Numen] 菜单发送失败，请稍后用 /numenmenu 重试。"); }
    }

    private void accept(Player p, FloodgatePlayer connection, UUID ticket, Runnable action) {
        if (!isEnabled()) return;
        Bukkit.getScheduler().runTask(this, () -> {
            if (Bukkit.getPlayer(p.getUniqueId()) != p || !canUse(p)
                    || FloodgateApi.getInstance().getPlayer(p.getUniqueId()) != connection
                    || !tickets.take(p.getUniqueId(),ticket,System.currentTimeMillis())) return;
            try { action.run(); }
            catch (IllegalArgumentException invalid) { p.sendMessage("[Numen] 输入未通过检查，请重新打开菜单检查名称、地址和Key格式。"); }
            catch (Exception failed) {
                getLogger().warning("Numen form operation failed for " + p.getUniqueId());
                p.sendMessage("[Numen] 本次操作结果未确认，请重新打开菜单查询，不要重复提交。");
            }
        });
    }
}
