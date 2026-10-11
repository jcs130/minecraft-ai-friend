package dev.qiandeng.bedrock.agents;

import java.util.function.Consumer;
import org.geysermc.cumulus.form.SimpleForm;
import org.geysermc.cumulus.util.FormImage;

/** Read-only controller-friendly handbook. Buttons never grant items or launch a model. */
public final class GuideForms {
    private static final String[] TITLES={"开始冒险","农场与厨房","机械与风车","魔法与装备","女仆和 Agent 同伴"};
    private static final String[] ICONS={"guide","food","machine","magic","tools"};
    private static final String[] PAGES={
        "欢迎来到 My Agent World！\n\n先采木头、制作工作台和工具，再找一处落脚点。探索前带食物、火把和床。\n\n手机点物品或交互按钮；手柄用方向键选择菜单，再按确认。普通箱子、工作台仍按原版方式使用。",
        "试着做一顿饭\n\n① 种植小麦，收获后制作面包。\n② 把能烧熟的生食放在点燃的灶台上。\n③ 等待食物烤熟，收取后进食。\n\n灶台上显示实际放入的食物；熄火就不继续烹饪。用砧板和相应工具处理食材。",
        "试着搭一架风车\n\n① 准备风车轴承、风帆、传动杆和磨石。\n② 把风帆连在轴承前方，交互组装风车。\n③ 用传动杆或齿轮连接磨石，从上方供料。\n\n风帆和齿轮跟随真实机器转动；过载停机时，先检查动力和负载。",
        "先认识自己的装备\n\n法术书颜色和阶位来自真实物品；名称、附魔、耐久仍属于原来的装备。不要把看起来相同的物品当成同一件。\n\n法术编辑等模组专用界面仍在逐项适配。需要这些操作时可请原生 Java 玩家或 Agent 协助；资源包下载成功并不表示每种界面都已开放。",
        "让同伴陪你生活\n\n空手对自己的女仆或 Agent 同伴按交互键，打开管理面板。女仆可以选择工作、跟随和拾取，需要准备真实工具和材料。\n\nAgent 可由外部程序接入，也可配置自己的模型服务。保存配置不会自动开始调用模型；先确认设置，再下达目标。"
    };
    public static SimpleForm index(Consumer<Integer> select,Runnable companions,Runnable maids){
        return index(select,companions,maids,()->{},()->{});
    }
    public static SimpleForm index(Consumer<Integer> select,Runnable companions,Runnable maids,Runnable guild,Runnable market){
        var form=SimpleForm.builder().title("My Agent World · 冒险指南").content("人类与 Agent 一起探索、耕种、做饭和建造。\n选择一张卡片开始，无需输入命令。");
        for(int i=0;i<TITLES.length;i++)form.button(TITLES[i],FormImage.Type.PATH,"textures/guide/"+ICONS[i]);
        return form.button("我的 Agent 同伴").button("我的车万女仆").button("公会 · 委托 · 声望").button("市场 · 买卖 · 玩家订单").button("开始游玩")
            .validResultHandler(r->{int n=r.clickedButtonId();if(n>=0&&n<TITLES.length)select.accept(n);else if(n==5)companions.run();else if(n==6)maids.run();else if(n==7)guild.run();else if(n==8)market.run();}).build();
    }
    public static SimpleForm page(int index,Consumer<Integer> select,Runnable back){
        if(index<0||index>=PAGES.length)throw new IllegalArgumentException("guide_page");
        var form=SimpleForm.builder().title(TITLES[index]).content(PAGES[index]);
        if(index+1<PAGES.length)form.button("下一步",FormImage.Type.PATH,"textures/guide/"+ICONS[index+1]);
        return form.button("返回指南").button("开始游玩").validResultHandler(r->{int n=r.clickedButtonId();if(index+1<PAGES.length&&n==0)select.accept(index+1);else if(n==(index+1<PAGES.length?1:0))back.run();}).build();
    }
}
