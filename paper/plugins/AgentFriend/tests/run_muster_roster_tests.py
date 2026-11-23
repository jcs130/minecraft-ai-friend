"""Execute the real entryRoster/selectMusterBystanders method bodies with synthetic players.

Regression for #35 (黑旗林营 illager_camp could not start): a ready starter in the first room was
blocked with confirmation_required because a co-located SPECTATOR bystander was auto-included in the
entry roster and musterAdmission rejects observers. No server connection or player data is used; the
fixture replaces the external Bukkit/muster boundaries, not the roster control flow under test.
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
    roster = method(site, "private List<EntryMember> entryRoster(Player starter,Site site,boolean stationEntry)")
    select = method(site, "static List<Player> selectMusterBystanders(List<Player> located,UUID starter,")
    template = r'''
import java.util.*;
public class MusterRosterProbe {
 static int passed;
 static void check(boolean b){if(!b)throw new AssertionError("unexpected roster result");passed++;}
 static class Location {}
 static class Player {final UUID id;final Location loc=new Location();Player(UUID id){this.id=id;}public UUID getUniqueId(){return id;}public Location getLocation(){return loc;}}
 static class Site {String id="illager_camp";}
 static class EntryMember {final UUID id;EntryMember(UUID id){this.id=id;}}
 static final int PARTY_LIMIT=40;
 static Map<String,Object> groundMusters=new HashMap<>();
 static List<Player> ONLINE=new ArrayList<>();
 static Map<UUID,String> admissions=new HashMap<>();
 static class ResidentCli {static List<Player> online(){return ONLINE;}}
 EntryMember entryMember(Site site,Player p){return new EntryMember(p.getUniqueId());}
 boolean atFirstRoom(Site site,Location at){return true;}
 boolean atStation(Site site,Location at){return true;}
 String musterAdmission(Site site,Player p){return admissions.getOrDefault(p.getUniqueId(),"");}
 __SELECT__
 __ROSTER__
 static List<UUID> ids(List<EntryMember> members){List<UUID> out=new ArrayList<>();for(EntryMember m:members)out.add(m.id);return out;}
 static Player player(UUID id){return new Player(id);}
 public static void main(String[] args){
  UUID starter =UUID.fromString("00000000-0000-0000-0000-000000000001");
  UUID observer=UUID.fromString("00000000-0000-0000-0000-000000000002");
  UUID readyA  =UUID.fromString("00000000-0000-0000-0000-000000000003");
  UUID readyB  =UUID.fromString("00000000-0000-0000-0000-000000000004");
  String blocked="当前状态不允许进入",reward="请先领取这处遗迹的旧奖励";
  MusterRosterProbe m=new MusterRosterProbe();Site s=new Site();
  java.util.function.Function<Player,String> admission=p->admissions.getOrDefault(p.getUniqueId(),"");

  // #35: ready starter + co-located observer => roster holds only the starter (no confirmation block).
  admissions.clear();admissions.put(starter,"");admissions.put(observer,blocked);
  ONLINE=List.of(player(starter),player(observer));
  check(ids(m.entryRoster(player(starter),s,false)).equals(List.of(starter)));

  // An eligible co-located bystander still joins (party play preserved).
  admissions.clear();admissions.put(starter,"");admissions.put(readyA,"");
  ONLINE=List.of(player(starter),player(readyA));
  check(ids(m.entryRoster(player(starter),s,false)).equals(List.of(starter,readyA)));

  // Mixed: observer dropped, eligible kept, starter first then bystanders sorted by UUID.
  admissions.clear();admissions.put(starter,"");admissions.put(observer,blocked);admissions.put(readyA,"");admissions.put(readyB,"");
  ONLINE=List.of(player(readyB),player(observer),player(starter),player(readyA));
  check(ids(m.entryRoster(player(starter),s,false)).equals(List.of(starter,readyA,readyB)));

  // A bystander holding an unclaimed reward is ineligible and excluded.
  admissions.clear();admissions.put(starter,"");admissions.put(readyA,"");admissions.put(readyB,reward);
  ONLINE=List.of(player(starter),player(readyA),player(readyB));
  check(ids(m.entryRoster(player(starter),s,false)).equals(List.of(starter,readyA)));

  // All observers => starter alone can still start solo.
  admissions.clear();admissions.put(starter,"");admissions.put(observer,blocked);
  ONLINE=List.of(player(starter),player(observer),player(observer));
  check(ids(m.entryRoster(player(starter),s,false)).equals(List.of(starter)));

  // selectMusterBystanders: party limit applies AFTER eligibility filtering.
  admissions.clear();admissions.put(observer,blocked);admissions.put(readyA,"");
  check(ids2(selectMusterBystanders(List.of(player(observer),player(readyA)),starter,admission,1)).equals(List.of(readyA)));
  // starter never re-added; sorted by UUID; empty input safe.
  admissions.clear();admissions.put(starter,"");admissions.put(readyA,"");admissions.put(readyB,"");
  check(ids2(selectMusterBystanders(List.of(player(readyB),player(starter),player(readyA)),starter,admission,39)).equals(List.of(readyA,readyB)));
  check(selectMusterBystanders(List.of(),starter,admission,39).isEmpty());

  System.out.println("PASS "+passed+" muster bystander roster checks");
 }
 static List<UUID> ids2(List<Player> players){List<UUID> out=new ArrayList<>();for(Player p:players)out.add(p.getUniqueId());return out;}
}
'''
    generated = template.replace("__SELECT__", select).replace("__ROSTER__", roster)
    args.output.mkdir(parents=True, exist_ok=False)
    source = args.output / "MusterRosterProbe.java"
    source.write_text(generated, encoding="utf-8")
    suffix = ".exe" if os.name == "nt" else ""
    subprocess.run([str(args.jdk / "bin" / ("javac" + suffix)), "--release", "21", "-encoding", "UTF-8", "-d", str(args.output), str(source)], check=True)
    result = subprocess.run([str(args.jdk / "bin" / ("java" + suffix)), "-Dfile.encoding=UTF-8", "-cp", str(args.output), "MusterRosterProbe"])
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()