package local.qdj.maids.brain;

import com.google.gson.Gson;
import com.google.gson.JsonParser;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import java.util.UUID;
import java.util.function.Supplier;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.UuidArgument;
import net.minecraft.network.chat.Component;

final class ResidentCommands {
    interface Query {Object get(MaidResidents runtime)throws Exception;}
    static void register(CommandDispatcher<CommandSourceStack> dispatcher,Supplier<MaidResidents> runtime) {
        var root=Commands.literal("maidagent");
        root.then(Commands.literal("resident-map").requires(s->s.hasPermission(2)).executes(c->reply(c.getSource(),runtime.get(),MaidResidents::mapPositions)));
        root.then(Commands.literal("resident-admin").requires(s->s.hasPermission(2))
            .then(Commands.literal("list").executes(c->reply(c.getSource(),runtime.get(),r->r.settings.catalogue())))
            .then(Commands.literal("receipt").then(Commands.argument("maidId",UuidArgument.uuid()).then(Commands.argument("requestId",UuidArgument.uuid())
                .executes(c->reply(c.getSource(),runtime.get(),r->r.settings.receipt(UuidArgument.getUuid(c,"maidId"),UuidArgument.getUuid(c,"requestId")))))))
            .then(Commands.literal("apply").then(Commands.argument("maidId",UuidArgument.uuid())
                .then(Commands.argument("requestId",UuidArgument.uuid()).then(Commands.argument("revision",com.mojang.brigadier.arguments.LongArgumentType.longArg(0))
                    .then(Commands.argument("profile",StringArgumentType.greedyString()).executes(c->reply(c.getSource(),runtime.get(),r->{
                        String raw=StringArgumentType.getString(c,"profile");if(raw.length()>4096)throw new IllegalArgumentException("profile_too_large");
                        return r.settings.applyChecked(UuidArgument.getUuid(c,"maidId"),UuidArgument.getUuid(c,"requestId"),com.mojang.brigadier.arguments.LongArgumentType.getLong(c,"revision"),JsonParser.parseString(raw).getAsJsonObject());
                    }))))))));
        root.then(Commands.literal("resident-actions").executes(c->reply(c.getSource(),runtime.get(),r->ResidentContract.describe())));
        root.then(Commands.literal("residents").executes(c->reply(c.getSource(),runtime.get(),r->r.ids().stream().map(r::publicView).toList())));
        var body=Commands.argument("residentId",UuidArgument.uuid());
        body.then(Commands.literal("travel-receipt").requires(s->s.hasPermission(2)).then(Commands.argument("requestId",UuidArgument.uuid())
            .executes(c->reply(c.getSource(),runtime.get(),r->r.travelReceipt(UuidArgument.getUuid(c,"residentId"),UuidArgument.getUuid(c,"requestId"))))));
        body.then(Commands.literal("status").executes(c->reply(c.getSource(),runtime.get(),r->c.getSource().hasPermission(2)?r.observe(UuidArgument.getUuid(c,"residentId")):r.publicView(UuidArgument.getUuid(c,"residentId")))));
        body.then(Commands.literal("receipt").requires(s->s.hasPermission(2)).then(Commands.argument("requestId",UuidArgument.uuid())
            .executes(c->reply(c.getSource(),runtime.get(),r->r.receipt(UuidArgument.getUuid(c,"residentId"),UuidArgument.getUuid(c,"requestId"))))));
        body.then(Commands.literal("plan").requires(s->s.hasPermission(2)).executes(c->reply(c.getSource(),runtime.get(),r->r.plan(UuidArgument.getUuid(c,"residentId")))));
        body.then(Commands.literal("appearance").requires(s->s.hasPermission(2)).executes(c->reply(c.getSource(),runtime.get(),r->r.appearance(UuidArgument.getUuid(c,"residentId")))));
        body.then(Commands.literal("acknowledge-unknown").requires(s->s.hasPermission(2))
            .then(Commands.argument("requestId",UuidArgument.uuid()).then(Commands.argument("inspectionNote",StringArgumentType.greedyString())
            .executes(c->reply(c.getSource(),runtime.get(),r->r.acknowledgeUnknown(UuidArgument.getUuid(c,"residentId"),UuidArgument.getUuid(c,"requestId"),StringArgumentType.getString(c,"inspectionNote")))))));
        body.then(Commands.literal("home-check").requires(s->s.hasPermission(2)).executes(c->reply(c.getSource(),runtime.get(),r->r.home(UuidArgument.getUuid(c,"residentId"),false,UUID.randomUUID()))));
        body.then(Commands.literal("furnish").requires(s->s.hasPermission(2)).then(Commands.argument("requestId",UuidArgument.uuid())
            .executes(c->reply(c.getSource(),runtime.get(),r->r.home(UuidArgument.getUuid(c,"residentId"),true,UuidArgument.getUuid(c,"requestId"))))));
        body.then(Commands.literal("act").requires(s->s.hasPermission(2)).then(Commands.argument("requestId",UuidArgument.uuid())
            .then(Commands.argument("input",StringArgumentType.greedyString()).executes(c->reply(c.getSource(),runtime.get(),r->{
                String text=StringArgumentType.getString(c,"input");if(text.length()>4096)throw new IllegalArgumentException("input_too_large");
                return r.submit(UuidArgument.getUuid(c,"residentId"),UuidArgument.getUuid(c,"requestId"),JsonParser.parseString(text).getAsJsonObject());})))));
        body.then(Commands.literal("protect").then(Commands.argument("input",StringArgumentType.greedyString()).executes(c->reply(c.getSource(),runtime.get(),r->{
            var id=UuidArgument.getUuid(c,"residentId");var maid=r.body(id);if(maid==null)throw new IllegalArgumentException("body_unavailable");
            String text=StringArgumentType.getString(c,"input");if(text.length()>4096)throw new IllegalArgumentException("input_too_large");
            var value=JsonParser.parseString(text).getAsJsonObject();
            if(!value.keySet().equals(java.util.Set.of("action","at")))throw new IllegalArgumentException("input: exactly action and at required");
            return ResidentProtection.query(maid,value.get("action").getAsString(),ResidentActions.position(value,"at"));}))));
        root.then(Commands.literal("resident").then(body));dispatcher.register(root);
    }
    static int reply(CommandSourceStack source,MaidResidents runtime,Query query) {
        try {if(runtime==null)throw new IllegalArgumentException("residents_unavailable");
            String text="MC_RESIDENT "+new Gson().toJson(query.get(runtime));source.sendSuccess(()->Component.literal(text),false);return 1;
        }catch(Exception failure){source.sendFailure(Component.literal("居民操作未完成："+(failure instanceof IllegalArgumentException?failure.getMessage():"读取原请求状态，勿重放未知操作。")));return 0;}
    }
}
