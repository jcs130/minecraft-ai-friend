package local.qdj.maids.brain;

import java.util.*;

/** Operation effects shared by discovery, execution receipts and historical recall. */
final class ResidentCliContract {
    record Operation(String syntax, boolean queryOnly, String effect, boolean discoverable) {
        String key(){return syntax.startsWith("arena recycle quote ")?"arena recycle quote":syntax.split(" [<\\[]",2)[0];}
    }
    private static Operation read(String syntax){return new Operation(syntax,true,"read_only",true);}
    private static Operation write(String syntax,String effect){return new Operation(syntax,false,effect,true);}
    // Existing accepted subcommands still need truthful receipts, but exposing an
    // extra capability also requires its native end-to-end acceptance.
    private static Operation internal(Operation operation){return new Operation(operation.syntax(),operation.queryOnly(),operation.effect(),false);}
    static final List<Operation> OPERATIONS=List.of(
        read("status"),read("land here"),read("land list [page]"),read("land info <ID>"),read("land members <ID> [page]"),
        write("land trust <ID> <player-or-resident UUID>","change_owned_land_membership"),write("land untrust <ID> <player-or-resident UUID>","change_owned_land_membership"),
        read("archive status"),read("archive list [book --page 1]"),internal(read("archive mine")),read("archive info <UUID>"),read("archive read <UUID> [--page 1]"),
        write("archive create <书名>|<正文>","publish_book"),write("archive restore <UUID>","consume_owned_blank_book_for_copy"),
        write("guild join","join_guild"),read("guild board [page]"),read("guild status"),write("guild accept <ID>","accept_not_complete_commission"),
        write("guild verify","verify_actual_commission_progress"),write("guild claim","claim_verified_commission_reward"),write("guild abandon","abandon_commission"),
        read("tasks list"),read("tasks info <ID>"),read("tasks status"),read("arena status"),read("arena entrance"),
        write("arena start","enroll_only_when_actual_entry_conditions_pass"),write("arena leave","leave_current_trial"),
        read("arena recycle list"),read("arena recycle quote bag <slot> <count>"),internal(read("arena recycle status <quoteId>")),
        write("arena recycle sell <quoteId>","sell_exact_quoted_items"),read("arena shop list [all|supplies|daily|food] [page]"),read("arena wallet"),
        write("arena shop buy <offerId>","purchase_to_personal_reward_queue"),read("arena stash summary"),read("arena stash inventory"),read("arena stash list <page 1-10>"),
        write("arena stash take <stashSlot 1-540> <count 1-64>","transfer_personal_box_to_actual_bag"),
        write("arena stash putslot <nativeBagSlot 0-based> <count 1-64>","transfer_actual_bag_to_personal_box"),
        write("arena stash collect","transfer_existing_reward_queue_to_personal_box"),
        read("dungeon list [--page 1]"),read("dungeon info <ID>"),read("dungeon status [ID]"),
        write("dungeon travel <ID>","travel_to_dungeon_entrance_not_enroll"),write("dungeon start <ID> [normal|adventure|apocalypse]","start_dungeon"),
        write("dungeon join <ID>","join_dungeon"),write("dungeon resume","resume_existing_run"),write("dungeon leave","leave_dungeon"),write("dungeon claim [ID]","claim_earned_dungeon_reward"),
        read("photo status"),read("photo album"),read("photo info <名字>"),write("photo take <名字> third 1 --story <经历>","request_real_camera_capture"),
        internal(write("photo cancel","cancel_capture")),internal(write("photo title <名字> <标题>","edit_own_photo_title")),internal(write("photo story <名字> <经历>","edit_own_photo_story")),
        write("photo exhibit <名字>","exhibit_own_photo"),internal(write("photo withdraw <名字>","withdraw_own_photo"))
    );
    static Map<String,Object> describe(String command){
        String normalized=command==null?"":command.strip().replaceAll(" +"," ");
        var operation=OPERATIONS.stream().filter(op->normalized.equals(op.key())||normalized.startsWith(op.key()+" "))
            .max(Comparator.comparingInt(op->op.key().length())).orElse(null);
        if(operation==null)return Map.of("queryOnly",false,"operationEffect","unknown","completionScope","unknown");
        var row=new LinkedHashMap<String,Object>();row.put("operation",operation.key());row.put("queryOnly",operation.queryOnly());
        row.put("operationEffect",operation.effect());row.put("completionScope",operation.queryOnly()?"query_snapshot_not_world_action":"single_operation_not_overall_objective");
        if(operation.key().equals("arena entrance")){
            row.put("operationNotice","Returns entrance coordinates and current conditions only; it does not move, enroll or start. Walk to the returned entrance, then inspect entry conditions before starting.");
            row.put("nextSafeRead","arena status");
        }
        return row;
    }
    static List<String> available(){return OPERATIONS.stream().filter(Operation::discoverable).map(Operation::syntax).toList();}
    static List<String> readOnly(){return OPERATIONS.stream().filter(Operation::discoverable).filter(Operation::queryOnly).map(Operation::key).toList();}
}
