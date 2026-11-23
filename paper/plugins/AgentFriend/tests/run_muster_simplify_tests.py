"""Execute the real selectMusterInvitees / join bodies and audit the real start body.

Regression for #36 (simplify dungeon muster): the starter must open directly without a blocking
confirmation_required gate; spectators and native maid residents are never auto-mustered; equipment
is notify-only; a willing player joins with one command that enrolls in-site or teleports to the
first-room muster area, with no --confirm token. No server connection or player data is used; the
fixture replaces the external Bukkit/muster boundaries, not the control flow under test.
"""
import argparse
import os
from pathlib import Path
import subprocess


def method(source, signature):
    start = source.index(signature)
    brace = source.index("{", start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, help="AgentFriend root of an older revision for the same regression")
    args = parser.parse_args()
    root = args.source_root or Path(__file__).resolve().parents[1]
    site = (root / "src/org/afuhome/agentfriend/SiteDungeonManager.java").read_text(encoding="utf-8")
    invitees = method(site, "static List<Player> selectMusterInvitees(List<Player> online,UUID starter,")
    join = method(site, "private void join(Player p,Site s,String confirmation)")
    start = method(site, "private void start(Player p,Site s,Mode mode,String confirmation)")
    # Structural audit of the real start body: the blocking confirmation gate is gone, the roster is
    # starter-only, nearby eligibles are invited, and missing equipment is a notice rather than a block.
    assert "reviewEntry(" not in start, "start must not call the blocking reviewEntry gate"
    assert "entryRoster(" not in start, "start must not auto-build a blocking bystander roster"
    assert "confirmation_required" not in start, "start must not emit confirmation_required"
    assert "inviteMuster(s,p)" in start, "start must invite nearby eligible players/agents"
    assert "List.of(starter)" in start, "start roster must be starter-only"
    assert "仍可开场" in start, "missing equipment must be notify-only in start"
    template = r'''
import java.util.*;
public class MusterSimplifyProbe {
 static int passed;
 static void check(boolean b){if(!b)throw new AssertionError("unexpected simplify result");passed++;}
 static class Location {}
 static class Player {final UUID id;final Location loc=new Location();Player(UUID id){this.id=id;}public UUID getUniqueId(){return id;}public Location getLocation(){return loc;}}
 static class Site {String id="illager_camp";String name="黑旗林营";boolean inside=true;boolean contains(Location l){return inside;}}
 static class EntryMember {final UUID id;EntryMember(UUID id){this.id=id;}}
 static class Run {Site site=new Site();String id="run1";Set<UUID> declined=new HashSet<>();}
 static Map<String,Run> runs=new HashMap<>();
 static Set<UUID> observers=new HashSet<>();
 static boolean station=false;
 static String joinProblem="";
 static boolean enrollResult=true;
 static List<String> events=new ArrayList<>();
 static class Plugin {boolean isObserver(Player p){return observers.contains(p.getUniqueId());}}
 static Plugin plugin=new Plugin();
 void require(boolean b,String reason){if(!b)throw new IllegalArgumentException(reason);}
 boolean atStation(Site s,Location l){return station;}
 String entryProblem(Player p,Run r,Location l){return joinProblem;}
 void permit(Site s,EntryMember m){events.add("permit");}
 EntryMember entryMember(Site s,Player p){return new EntryMember(p.getUniqueId());}
 boolean enroll(Player p,Run r){events.add("enroll");return enrollResult;}
 void runResult(Player p,String action,String site,String run){events.add("runResult");}
 void musterTravel(Player p,Site s,Run r){events.add("musterTravel");}
 __INVITEES__
 __JOIN__
 static Player player(UUID id){return new Player(id);}
 static List<UUID> ids(List<Player> players){List<UUID> out=new ArrayList<>();for(Player p:players)out.add(p.getUniqueId());return out;}
 static Run run(){Run r=new Run();runs.put(r.site.id,r);return r;}
 static void reset(){runs.clear();observers.clear();events.clear();station=false;joinProblem="";enrollResult=true;}
 static String thrown(Runnable r){try{r.run();return null;}catch(IllegalArgumentException e){return e.getMessage();}}
 public static void main(String[] args){
  UUID starter =UUID.fromString("00000000-0000-0000-0000-000000000001");
  UUID observer=UUID.fromString("00000000-0000-0000-0000-000000000002");
  UUID maid    =UUID.fromString("00000000-0000-0000-0000-000000000003");
  UUID readyA  =UUID.fromString("00000000-0000-0000-0000-000000000004");
  UUID readyB  =UUID.fromString("00000000-0000-0000-0000-000000000005");
  UUID ineligible=UUID.fromString("00000000-0000-0000-0000-000000000006");
  MusterSimplifyProbe m=new MusterSimplifyProbe();Site s=new Site();
  java.util.function.Predicate<Player> isObserver=p->observers.contains(p.getUniqueId());
  java.util.function.Predicate<Player> isResident=p->p.getUniqueId().equals(maid);
  java.util.function.Function<Player,String> admission=p->p.getUniqueId().equals(ineligible)?"当前状态不允许进入":"";
  java.util.function.Predicate<Player> atFirst=p->true;

  // selectMusterInvitees: starter, observers and native maid residents are excluded; eligibles kept, sorted.
  observers.add(observer);
  check(ids(selectMusterInvitees(List.of(player(starter),player(observer),player(maid),player(readyA)),starter,isObserver,isResident,admission,atFirst)).equals(List.of(readyA)));
  // All bystanders are observers/maids => nobody invited (starter still opens solo via start).
  check(selectMusterInvitees(List.of(player(starter),player(observer),player(maid)),starter,isObserver,isResident,admission,atFirst).isEmpty());
  // Ineligible bystander excluded; two eligibles sorted by UUID regardless of input order.
  check(ids(selectMusterInvitees(List.of(player(readyB),player(ineligible),player(readyA)),starter,isObserver,isResident,admission,atFirst)).equals(List.of(readyA,readyB)));
  // Not standing in the first room => not invited.
  java.util.function.Predicate<Player> notFirst=p->false;
  check(selectMusterInvitees(List.of(player(readyA)),starter,isObserver,isResident,admission,notFirst).isEmpty());
  // Empty input safe.
  check(selectMusterInvitees(List.of(),starter,isObserver,isResident,admission,atFirst).isEmpty());

  // join: no active run => not_participating (no confirmation token involved).
  reset();
  check(thrown(()->m.join(player(readyA),s,null)).equals("not_participating"));
  // join: observer rejected, never teleported or enrolled.
  reset();run();observers.add(observer);
  check(thrown(()->m.join(player(observer),s,null)).equals("already_in_activity_or_not_survival"));
  check(events.isEmpty());
  // join: in-site ready player enrolls directly, no permit, no teleport, no confirmation.
  reset();Run r=run();r.site.inside=true;station=false;joinProblem="";
  m.join(player(readyA),s,null);
  check(events.equals(List.of("enroll","runResult")));
  // join: in-site missing equipment is notify-only => permit then enroll, never blocked.
  reset();r=run();r.site.inside=true;station=false;joinProblem="equipment_required";
  m.join(player(readyA),s,null);
  check(events.equals(List.of("permit","enroll","runResult")));
  // join: a genuine non-equipment blocker still fails closed and restores a prior decline.
  reset();r=run();r.site.inside=true;station=false;joinProblem="party_full";r.declined.add(readyA);
  check(thrown(()->m.join(player(readyA),s,null)).equals("party_full"));
  check(r.declined.contains(readyA));
  check(!events.contains("enroll"));
  // join: outside the site => voluntary teleport path (musterTravel), not a direct enroll.
  reset();r=run();r.site.inside=false;
  m.join(player(readyA),s,null);
  check(events.equals(List.of("musterTravel")));
  // join: standing at the station inside the site => teleport path as well.
  reset();r=run();r.site.inside=true;station=true;
  m.join(player(readyA),s,null);
  check(events.equals(List.of("musterTravel")));

  System.out.println("PASS "+passed+" muster simplify checks");
 }
}
'''
    generated = template.replace("__INVITEES__", invitees).replace("__JOIN__", join)
    args.output.mkdir(parents=True, exist_ok=False)
    source = args.output / "MusterSimplifyProbe.java"
    source.write_text(generated, encoding="utf-8")
    suffix = ".exe" if os.name == "nt" else ""
    subprocess.run([str(args.jdk / "bin" / ("javac" + suffix)), "--release", "21", "-encoding", "UTF-8", "-d", str(args.output), str(source)], check=True)
    result = subprocess.run([str(args.jdk / "bin" / ("java" + suffix)), "-Dfile.encoding=UTF-8", "-cp", str(args.output), "MusterSimplifyProbe"])
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()