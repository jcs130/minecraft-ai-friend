package org.qiandengji.vortex;

import java.util.*;

/** A per-actor next step over native snapshots. No party, invite or model state is stored here. */
final class PartyFormation {
    record Actor(UUID id, String name, boolean online) {}
    record Team(UUID id, UUID leader, Set<UUID> members) {
        Team { members = Set.copyOf(members); }
    }
    record Invitation(UUID party, UUID inviter) {}
    private static final String STATUS = "/mycli guild party status";
    // Matches the source-pinned native manager, including members outside this plan.
    private static final int NATIVE_CAPACITY = 5;
    private PartyFormation() {}

    static Map<String,Object> plan(UUID self, List<Actor> requested,
            Map<UUID,Team> nativeTeams, Map<UUID,Invitation> nativeInvites) {
        if (self == null || requested == null || requested.size() < 2 || requested.size() > NATIVE_CAPACITY)
            throw new IllegalArgumentException("invalid_party_plan");
        var actors = new LinkedHashMap<UUID,Actor>();
        var names = new HashSet<String>();
        for (Actor actor : requested) {
            if (actor == null || actor.id() == null || actor.name() == null
                    || !actor.name().matches("[\\p{L}\\p{N}_.]{1,16}")
                    || actors.putIfAbsent(actor.id(), actor) != null
                    || !names.add(actor.name().toLowerCase(Locale.ROOT)))
                throw new IllegalArgumentException("duplicate_or_invalid_party_member");
        }
        if (!actors.containsKey(self)) throw new IllegalArgumentException("party_plan_must_include_self");
        var teams = new LinkedHashMap<UUID,Team>();
        for (UUID id : actors.keySet()) {
            Team team = nativeTeams.get(id);
            if (team == null) continue;
            if (!team.members().contains(id) || !team.members().contains(team.leader()))
                throw new IllegalArgumentException("invalid_native_party_snapshot");
            Team previous = teams.putIfAbsent(team.id(), team);
            if (previous != null && !previous.equals(team))
                throw new IllegalArgumentException("inconsistent_native_party_snapshot");
        }
        var out = new LinkedHashMap<String,Object>();
        out.put("type", "partyPlan"); out.put("queryOnly", true); out.put("sessionOnly", true);
        out.put("requiredMembers", actors.size()); out.put("membershipConfirmed", false);
        out.put("nativeCapacity", NATIVE_CAPACITY);
        out.put("nearbyHearingVerified", false); out.put("activityParticipationVerified", false);
        out.put("requested", actors.values().stream().map(a -> Map.of("uuid", a.id().toString(),
            "name", a.name(), "online", a.online())).toList());
        out.put("nativePartyId", null); out.put("joined", List.of()); out.put("missing", List.copyOf(actors.keySet()).stream().map(UUID::toString).toList());
        out.put("automaticActions", false);
        if (teams.size() > 1)
            return step(out, "conflicting_parties", "inspect", STATUS,
                "目标成员分属多个原生队伍；先协商，不能自动退队、解散或替对方接受邀请");
        Team team = teams.isEmpty() ? null : teams.values().iterator().next();
        UUID leader = team == null ? actors.keySet().iterator().next() : team.leader();
        if (team != null) {
            out.put("nativePartyId", team.id().toString());
            out.put("nativeMemberCount", team.members().size());
            out.put("joined", actors.keySet().stream().filter(team.members()::contains).map(UUID::toString).toList());
            out.put("missing", actors.keySet().stream().filter(id -> !team.members().contains(id)).map(UUID::toString).toList());
            if (team.members().containsAll(actors.keySet())) {
                out.put("membershipConfirmed", true);
                return step(out, "formed", "inspect_gathering", STATUS,
                    "所列成员已在同一个真实队伍中；再查世界和集合，入队不等于听见聊天、完成分工或副本参战");
            }
            long missing = actors.keySet().stream().filter(id -> !team.members().contains(id)).count();
            if (team.members().size() + missing > NATIVE_CAPACITY)
                return step(out, "capacity_conflict", "inspect", STATUS,
                    "原生队伍已有" + team.members().size() + "人，名单还缺" + missing
                    + "人，超过五人容量；先协商调整名单或队伍，不反复邀请、不自动踢人或退队");
        }
        if (!actors.containsKey(leader))
            return step(out, "leader_outside_roster", "inspect", STATUS,
                "原生队长不在本次结伴名单中；联系真实队长，不另建影子队伍或自动转移队长");
        out.put("leaderUuid", leader.toString());
        Actor leaderActor = actors.get(leader);
        if (!leaderActor.online())
            return step(out, "leader_offline", "wait", STATUS, "队长离线；等待或联系，不重复建队");
        Invitation mine = nativeInvites.get(self);
        boolean joined = team != null && team.members().contains(self);
        if (!joined && mine != null) {
            if (team != null && mine.party().equals(team.id()) && team.members().contains(mine.inviter()))
                return step(out, "invited", "accept", "/mycli guild party accept",
                    "本人收到目标原生队伍的有效邀请；自行决定接受，口头答应不算入队");
            return step(out, "other_invitation", "inspect", STATUS,
                "本人收到其他队伍邀请；先核对邀请，不自动接受、拒绝或覆盖");
        }
        if (team == null)
            return self.equals(leader)
                ? step(out, "not_created", "create", "/mycli guild party create", "首位成员发起一次建队，再按实际结果邀请其他人")
                : step(out, "awaiting_creation", "wait", STATUS, "等首位成员建队和邀请，不各自创建不同队伍");
        if (!joined)
            return step(out, "awaiting_invite", "wait", STATUS, "尚未加入目标队伍；等队长邀请，再由本人接受");
        if (!self.equals(leader))
            return step(out, "awaiting_teammates", "wait", STATUS, "本人已入队；等队长邀请其余成员，不重复建队或自动代答");
        boolean pending = false, conflictingInvite = false;
        for (Actor actor : actors.values()) {
            if (team.members().contains(actor.id()) || !actor.online()) continue;
            Invitation invite = nativeInvites.get(actor.id());
            if (invite != null) {
                if (invite.party().equals(team.id()) && team.members().contains(invite.inviter())) pending = true;
                else conflictingInvite = true;
                continue; // Never overwrite somebody's live invitation.
            }
            return step(out, "inviting", "invite", "/mycli guild party invite " + actor.name(),
                "队长只邀请下一位尚未入队且无有效邀请的在线成员；发出邀请后等本人接受");
        }
        if (conflictingInvite)
            return step(out, "conflicting_invitations", "inspect", STATUS, "剩余成员收到其他队伍邀请；先协商处理，不覆盖邀请或代替本人接受");
        return pending
            ? step(out, "awaiting_acceptance", "wait", STATUS, "其余在线成员已有有效邀请；等待本人处理，不反复发送邀请")
            : step(out, "awaiting_online_members", "wait", STATUS, "剩余成员离线；保留当前真实队伍，不把缺席算作已加入");
    }

    private static Map<String,Object> step(Map<String,Object> out, String phase, String action, String command, String explanation) {
        out.put("phase", phase); out.put("nextAction", action); out.put("nextCommand", command); out.put("explanation", explanation);
        return out;
    }
}
