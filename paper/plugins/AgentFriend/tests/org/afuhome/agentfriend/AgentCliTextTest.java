package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;

public final class AgentCliTextTest {
    private static int checks;
    private static void check(String name, boolean condition) { if (!condition) throw new AssertionError(name); checks++; }
    private static JsonObject object(String text) { return JsonParser.parseString(text).getAsJsonObject(); }
    private static JsonObject help(String text) { return AgentCliCatalog.helpData(text.split(" +"), List.of()); }
    private static String text(List<String> lines) { return String.join("\n", lines); }
    private static void invalidPage(Runnable action) {
        try { action.run(); throw new AssertionError("invalid page accepted"); } catch (IllegalArgumentException expected) { checks++; }
    }
    public static void main(String[] args) throws Exception {
        JsonObject root = help("--help");
        List<String> names = root.getAsJsonArray("commands").asList().stream().map(item -> item.getAsJsonObject().get("name").getAsString()).toList();
        check("seven familiar entries put adventuring and profession on the first page", names.equals(List.of("status","tasks","skills","dungeon","profession","inventory","rules")));
        String brief = text(AgentCliText.help(root));
        check("home help bounded", brief.length() < 1000 && !brief.contains("MC_CLI_") && !brief.contains("observedAt"));
        check("group does not promise JSON for every action", !root.get("usage").getAsString().contains("--json"));
        check("pagination remains discoverable", brief.contains(root.get("nextCommand").getAsString()));
        for (String command : List.of("world board", "coach next", "coach guide"))
            check("implemented JSON is documented: " + command, help(command + " --help").get("jsonSupported").getAsBoolean());
        JsonObject learn = help("skills learn example --help");
        String action = text(AgentCliText.help(learn));
        check("real help consumption and verification exposed", action.contains(learn.get("consumption").getAsString()) && action.contains(learn.get("resultQuery").getAsString()));
        check("help distinguishes action from a read", action.contains("执行动作") && !learn.get("actionReadOnly").getAsBoolean());
        check("unsupported format is explicit", text(AgentCliText.help(help("guild claim --help"))).contains("不支持 --json"));
        check("invalid help has one short recovery", AgentCliText.help(help("missing --help")).size() == 1);
        check("JSON help pagination remains JSON", help("--help --json").get("nextCommand").getAsString().endsWith("--json"));
        int pages = root.get("pages").getAsInt(); Set<String> all = new HashSet<>();
        for (int page = 1; page <= pages; page++) for (JsonElement item : help("--help --page " + page).getAsJsonArray("commands"))
            check("no duplicate root", all.add(item.getAsJsonObject().get("name").getAsString()));
        check("advanced commands still discoverable", all.containsAll(Set.of("arena","dungeon","photo","world")));
        for (String group : List.of("dungeon", "landmark", "arena recycle", "guild exam", "guild exam supplies"))
            check("existing group help is reachable: " + group, help(group + " --help").has("commands"));
        for (String command : List.of("dungeon list", "dungeon info", "dungeon status"))
            check("existing dungeon queries have precise help: " + command, help(command + " --help").get("actionReadOnly").getAsBoolean());

        JsonObject state = object("{\"name\":\"ag_Test\",\"health\":20,\"food\":18,\"mana\":null,\"maxMana\":null,\"authentication\":{\"status\":\"unknown\",\"authorized\":null},\"mainlineGraduated\":false,\"nextCommand\":\"/mycli tasks status\"}");
        String before = state.toString(), status = text(AgentCliText.state(state));
        check("presentation never mutates the observation", before.equals(state.toString()));
        check("unknown mana is not zero", status.contains("魔力 未知/未知") && !status.contains("null"));
        check("unknown authentication does not claim failed login", status.contains("不能据此判断未登录"));
        state.addProperty("sessionId", UUID.randomUUID().toString()); state.addProperty("observedAt", 123456L);
        check("volatile metadata never leaks into default text", status.equals(text(AgentCliText.state(state))));
        state.add("authentication", object("{\"status\":\"authenticated\",\"authorized\":true}")); state.addProperty("downed", true);
        check("actual auth and rescue state shown", text(AgentCliText.state(state)).contains("已验证；倒地"));

        List<JsonObject> progress = new ArrayList<>();
        progress.add(object("{\"section\":\"main\",\"title\":\"新手主线\",\"graduated\":false,\"nextCommand\":\"/mycli tasks list\",\"missingConditions\":[\"完整交付委托\",\"读目录\"]}"));
        for (int i = 0; i < 6; i++) progress.add(object("{\"section\":\"training\",\"title\":\"专项\",\"done\":true,\"nextCommand\":\"/mycli progress\"}"));
        progress.add(object("{\"section\":\"guild\",\"title\":\"冒险者公会委托\",\"status\":\"active\",\"nextCommand\":\"/mycli tasks status\"}"));
        String snapshot = progress.toString(), overview = text(AgentCliText.progress(progress, "all", 1));
        check("all sections visible without dumping six trainings", overview.contains("新手主线：未毕业") && overview.contains("已完成 6/6") && overview.contains("冒险者公会委托：进行中"));
        check("actual missing condition and next command retained", overview.contains("完整交付委托") && overview.contains("/mycli tasks status"));
        check("summary does not mutate completion or proof", progress.toString().equals(snapshot));
        List<JsonObject> many = new ArrayList<>();
        for (int i = 0; i < 8; i++) many.add(object("{\"section\":\"training\",\"title\":\"专项" + i + "\",\"done\":false,\"stage\":\"not_enrolled\"}"));
        check("text progress uses existing pagination", text(AgentCliText.progress(many, "training", 1)).contains("/mycli progress training 2"));
        check("second page has no stale previous rows", !text(AgentCliText.progress(many, "training", 2)).contains("专项0"));
        invalidPage(() -> AgentCliText.progress(many, "training", 0)); invalidPage(() -> AgentCliText.progress(many, "training", 3));
        check("observer is explicit", text(AgentCliText.progress(List.of(object("{\"eligible\":false,\"reason\":\"observer\"}")), "all", 1)).contains("观战账号不参加任务"));

        JsonObject skill = object("{\"id\":\"prospect\",\"name\":\"探矿术\",\"level\":1,\"manaCost\":6,\"cooldownRemainingMs\":null,\"reason\":\"target_or_context_not_checked\"}");
        List<JsonObject> skills = Collections.nCopies(8, skill); snapshot = skill.toString();
        String skillText = text(AgentCliText.skills(skills, "all", 1));
        check("unknown cooldown is not ready or zero", skillText.contains("冷却 未知") && skillText.contains("仍需核对目标或环境") && !skillText.contains("条件就绪"));
        check("skill page bounded and complete command retained", skillText.length() < 1600 && skillText.contains("/mycli skills status all 2"));
        check("skill presentation preserves source", snapshot.equals(skill.toString()));
        check("empty skill list is not an error", text(AgentCliText.skills(List.of(), "mine", 1)).contains("共 0 项"));
        invalidPage(() -> AgentCliText.skills(skills, "all", 99));
        Path manual = Path.of(args[0]).toAbsolutePath().getParent().getParent().getParent().resolve("docs/MYCLI_AGENT_CLI.md");
        var examples = Pattern.compile("(?m)^/mycli ([^\\r\\n]+)$").matcher(Files.readString(manual));
        int documented = 0;
        while (examples.find()) {
            String example = examples.group(1);
            check("documented example is discoverable: " + example, !help(example + " --help").has("errorCode"));
            documented++;
        }
        check("manual keeps a small tested starting set", documented >= 6 && documented <= 20);
        System.out.println("PASS " + checks + " compact CLI checks");
    }
}
