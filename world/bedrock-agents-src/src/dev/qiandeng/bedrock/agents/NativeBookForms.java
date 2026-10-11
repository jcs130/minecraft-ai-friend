package dev.qiandeng.bedrock.agents;

import java.util.*;
import java.util.function.*;
import org.geysermc.cumulus.form.SimpleForm;

/** Actual installed handbook text, paginated for touch/controller navigation. */
public final class NativeBookForms {
    private NativeBookForms() {}
    public static SimpleForm index(Map<String,Object> data,Consumer<String> entry,IntConsumer page,Runnable models,Runnable guide) {
        int offset=((Number)data.get("offset")).intValue();List<Map<String,Object>> rows=MawAgentsExtension.rows(data.get("entries"));
        var b=SimpleForm.builder().title(Objects.toString(data.get("title"))).content("原模组中文说明 · "+data.get("total")+" 条\n当前适配原书文字与配方编号；Java 的配方图和 3D 页面仍需适配。\n使用返回键关闭；再次使用手中书即可重开。");
        for(var row:rows)b.button(Objects.toString(row.get("name")));
        boolean next=Boolean.TRUE.equals(data.get("hasMore")),previous=offset>0;
        if(next)b.button("下一页");if(previous)b.button("上一页");b.button("模型配置 / Agent / 女仆").button("冒险指南");
        return b.validResultHandler(r->{int n=r.clickedButtonId();if(n<rows.size()){entry.accept(Objects.toString(rows.get(n).get("id")));return;}n-=rows.size();if(next){if(n--==0){page.accept(offset+16);return;}}if(previous){if(n--==0){page.accept(Math.max(0,offset-16));return;}}if(n==0)models.run();else guide.run();}).build();
    }
    public static SimpleForm entry(Map<String,Object> data,Runnable back,Runnable models) {
        @SuppressWarnings("unchecked") var entry=(Map<String,Object>)data.get("entry");
        return SimpleForm.builder().title(Objects.toString(entry.get("name"))).content(Objects.toString(entry.get("text")))
            .button("返回目录").button("模型配置 / Agent / 女仆").validResultHandler(r->{if(r.clickedButtonId()==0)back.run();else models.run();}).build();
    }
}
