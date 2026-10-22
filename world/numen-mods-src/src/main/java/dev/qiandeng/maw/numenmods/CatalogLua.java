package dev.qiandeng.maw.numenmods;

import com.dwinovo.numen.sdk.*;
import java.util.*;

/** Uses the pinned official extension API, alongside the host's structured MCP API. */
public final class CatalogLua {
    public record Page(Optional<Integer> offset,Optional<Integer> limit) {}
    public record ModInfo(String id,String name,String version,String support,List<String> operations,String workflow) {}
    public record Listing(int total,int offset,int nextOffset,List<ModInfo> mods) {}
    public record Which(String mod) {}
    @Fn("List actual installed mods and their native Agent interfaces; libraries are not gameplay actions.")
    @Example("local p=maw.mods.list(); for _,m in ipairs(p.mods) do print(m.id,m.support) end")
    public static Listing list(ServerCall call,Page args) {
        var all=ModCatalog.rows();int offset=args.offset().orElse(0),limit=args.limit().orElse(24);
        if(offset<0||offset>10000||limit<1||limit>24)throw new IllegalArgumentException("invalid_mod_page");
        int end=Math.min(all.size(),offset+limit);return new Listing(all.size(),offset,end<all.size()?end:-1,
            all.subList(Math.min(offset,all.size()),Math.max(Math.min(offset,all.size()),end)));
    }
    @Fn("Explain one mod's actual availability, native operations and workflow. An absent mod is explicit.")
    @Example("print(maw.mods.explain(\"minecolonies\"))")
    public static ModInfo explain(ServerCall call,Which args) {return ModCatalog.row(args.mod());}
}
