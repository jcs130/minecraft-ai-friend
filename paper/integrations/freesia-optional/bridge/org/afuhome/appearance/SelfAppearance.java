package org.afuhome.appearance;

import java.util.*;

/** A command from a real authenticated game connection may select only its own
 * public catalog model. No target argument, auth bypass, or native packet forgery. */
final class SelfAppearance {
    record Selection(UUID player, Object connection, long epoch, String name,
                     String model, String texture, long started) {
        String command() { return "ysm model set " + name + " \"" + model + "\" \"" + texture + "\" false"; }
    }
    record Result(String message, Selection selection) {}
    private final Map<UUID, Selection> pending = new HashMap<>();
    private final Map<UUID, Long> changed = new HashMap<>();

    synchronized Result begin(UUID player, Object connection, long epoch, String name,
                              boolean ready, int workers, Map<String, List<String>> catalog,
                              String[] args, long now) {
        if (!ready || epoch < 0) return new Result("请先完成游戏登录并进入世界，再执行 /appearance set。", null);
        if (!name.matches("[A-Za-z0-9_]{1,16}")) return new Result("这个角色未经过当前 Java 外观入口；请用官网本人外观管理。", null);
        if (workers != 1) return new Result("模型服务尚未就绪；稍后 /appearance status 查询，尚未换装。", null);
        if (args.length < 2 || args.length > 3) return new Result("用法：/appearance set <模型ID> [贴图ID]；先 /appearance list 查看。只能修改本人。", null);
        String model = args[1];
        if (!ModelCatalog.validId(model)) return new Result("模型ID无效；请从 /appearance list 选择。", null);
        List<String> textures = catalog.get(model);
        if (textures == null || textures.isEmpty()) return new Result("该模型未在公开目录；先 /appearance list 查看，自己的新文件用官网外观上传。", null);
        if (args.length == 2 && textures.size() != 1) return new Result("此模型有多张贴图，请在 /appearance list 查看后指定贴图ID。", null);
        String texture = args.length == 3 ? args[2] : textures.getFirst();
        if (!texture.matches("[\\p{L}\\p{N}_.-]{1,96}") || !textures.contains(texture))
            return new Result("该贴图不属于这个模型；请按 /appearance list 中的模型和贴图配对。", null);
        Selection old = pending.get(player);
        if (old != null && old.connection == connection && old.epoch == epoch)
            return new Result("原换装请求仍待确认；请 /appearance status 查询，未重复提交。", null);
        changed.entrySet().removeIf(e -> now - e.getValue() >= 30_000);
        if (changed.containsKey(player)) return new Result("换装冷却30秒；请先 /appearance status 确认原结果。", null);
        var selection = new Selection(player, connection, epoch, name, model, texture, now);
        pending.put(player, selection); changed.put(player, now);
        return new Result("换装已提交，等待模型服务确认；结果用 /appearance status 查询。", selection);
    }

    synchronized String observe(UUID player, Object connection, long epoch, boolean ready,
                                String model, String texture, long now) {
        Selection request = pending.get(player);
        if (request == null) return null;
        // A callback or model observation from a prior body/session cannot finish a new request.
        if (request.connection != connection || request.epoch != epoch || !ready) {
            pending.remove(player); return null;
        }
        if (request.model.equals(model) && request.texture.equals(texture)) {
            pending.remove(player);
            return "YSM已应用：" + model + " / " + texture + "。普通皮肤另用 /skin。";
        }
        if (now - request.started >= 15_000) {
            pending.remove(player);
            return "尚未确认换装结果；请 /appearance status 查询，未自动重试。";
        }
        return null;
    }

    synchronized void left(UUID player) { pending.remove(player); }
}
