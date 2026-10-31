package org.qiandengji.vortex;

import java.util.*;

/** Pure deterministic snapshots. No Bukkit, network, clocks, game or model calls. */
public final class PartyFormationTest {
    private static int checks;
    private static final UUID A=new UUID(0,1),B=new UUID(0,2),C=new UUID(0,3),D=new UUID(0,4),E=new UUID(0,5);
    private static final UUID PARTY=new UUID(1,1),OTHER=new UUID(1,2);
    private static final List<PartyFormation.Actor> FOUR=List.of(actor(A),actor(B),actor(C),actor(D));
    private static PartyFormation.Actor actor(UUID id){return new PartyFormation.Actor(id,"Peer"+id.getLeastSignificantBits(),true);}
    private static void check(boolean ok){if(!ok)throw new AssertionError("four-party check "+checks);checks++;}
    private static Map<UUID,PartyFormation.Team> team(UUID... ids){
        var result=new HashMap<UUID,PartyFormation.Team>();
        var t=new PartyFormation.Team(PARTY,A,new LinkedHashSet<>(Arrays.asList(ids)));
        for(UUID id:ids)result.put(id,t);return result;
    }
    private static Map<String,Object> plan(UUID self,Map<UUID,PartyFormation.Team> teams,Map<UUID,PartyFormation.Invitation> invites){
        return PartyFormation.plan(self,FOUR,teams,invites);
    }
    private static void phase(Map<String,Object> result,String phase,String action){
        check(result.get("phase").equals(phase));check(result.get("nextAction").equals(action));
        check(result.get("queryOnly").equals(true)&&result.get("automaticActions").equals(false));
        check(result.get("requiredMembers").equals(4));
        check(result.get("nearbyHearingVerified").equals(false)&&result.get("activityParticipationVerified").equals(false));
    }
    public static void main(String[] args){
        phase(plan(A,Map.of(),Map.of()),"not_created","create");
        for(UUID self:List.of(B,C,D))phase(plan(self,Map.of(),Map.of()),"awaiting_creation","wait");
        var two=team(A,B);var invites=new HashMap<UUID,PartyFormation.Invitation>();
        var first=plan(A,two,invites);phase(first,"inviting","invite");check(first.get("nextCommand").equals("/mycli guild party invite Peer3"));
        invites.put(C,new PartyFormation.Invitation(PARTY,A));
        phase(plan(C,two,invites),"invited","accept");
        var second=plan(A,two,invites);check(second.get("nextCommand").equals("/mycli guild party invite Peer4"));
        invites.put(D,new PartyFormation.Invitation(PARTY,A));phase(plan(A,two,invites),"awaiting_acceptance","wait");
        phase(plan(B,two,invites),"awaiting_teammates","wait");
        check(!plan(A,two,invites).get("membershipConfirmed").equals(true));
        var three=team(A,B,C);phase(plan(D,three,invites),"invited","accept");
        var four=team(A,B,C,D);
        for(UUID self:List.of(A,B,C,D)){
            var ready=plan(self,four,Map.of());phase(ready,"formed","inspect_gathering");
            check(ready.get("membershipConfirmed").equals(true));check(((List<?>)ready.get("joined")).size()==4);
            check(((List<?>)ready.get("missing")).isEmpty());check(ready.get("nativePartyId").equals(PARTY.toString()));
        }
        var split=team(A,B);split.put(C,new PartyFormation.Team(OTHER,C,Set.of(C,D)));split.put(D,split.get(C));
        phase(plan(A,split,Map.of()),"conflicting_parties","inspect");
        phase(plan(C,team(A,B),Map.of(C,new PartyFormation.Invitation(OTHER,E))),"other_invitation","inspect");
        phase(plan(C,team(A,B),Map.of()),"awaiting_invite","wait");
        phase(plan(A,team(A,B),Map.of(C,new PartyFormation.Invitation(OTHER,E),D,new PartyFormation.Invitation(OTHER,E))),"conflicting_invitations","inspect");
        var offline=List.of(actor(A),actor(B),new PartyFormation.Actor(C,"Peer3",false),new PartyFormation.Actor(D,"Peer4",false));
        check(PartyFormation.plan(A,offline,team(A,B),Map.of()).get("phase").equals("awaiting_online_members"));
        var leaderOffline=List.of(new PartyFormation.Actor(A,"Peer1",false),actor(B),actor(C),actor(D));
        check(PartyFormation.plan(B,leaderOffline,team(A,B),Map.of()).get("phase").equals("leader_offline"));
        // Four membership records remain four when a member is offline; gathering is a separate observation.
        check(PartyFormation.plan(A,offline,four,Map.of()).get("membershipConfirmed").equals(true));
        var outside=Map.of(A,new PartyFormation.Team(PARTY,E,Set.of(E,A)));
        phase(plan(A,outside,Map.of()),"leader_outside_roster","inspect");
        try{PartyFormation.plan(A,List.of(actor(A),actor(A)),Map.of(),Map.of());throw new AssertionError("duplicate accepted");}
        catch(IllegalArgumentException expected){checks++;}
        try{PartyFormation.plan(A,List.of(actor(A),actor(B),actor(C),actor(D),actor(E),actor(new UUID(0,6))),Map.of(),Map.of());throw new AssertionError("oversized plan accepted");}
        catch(IllegalArgumentException expected){checks++;}
        try{PartyFormation.plan(E,FOUR,Map.of(),Map.of());throw new AssertionError("outsider accepted");}
        catch(IllegalArgumentException expected){checks++;}
        var source=team(A,B);var before=new HashMap<>(source);plan(A,source,invites);check(source.equals(before));
        // Outsiders still occupy native slots. Do not advertise invitations or
        // acceptance which cannot form the requested roster under the real cap.
        UUID extra=new UUID(0,6);
        var full=team(A,B,C,E,extra);var fullBefore=new HashMap<>(full);
        for(UUID self:List.of(A,B,C,D)){
            var blocked=plan(self,full,Map.of(D,new PartyFormation.Invitation(PARTY,A)));
            phase(blocked,"capacity_conflict","inspect");
            check(blocked.get("nextCommand").equals("/mycli guild party status"));
            check(blocked.get("nativeCapacity").equals(5));
        }
        check(full.equals(fullBefore));
        phase(plan(A,team(A,B,E,extra),Map.of()),"capacity_conflict","inspect");
        // An exact fit is still actionable; a fifth existing member does not
        // invalidate a roster which has already joined successfully.
        phase(plan(A,team(A,B,C,E),Map.of()),"inviting","invite");
        check(plan(A,team(A,B,C,E),Map.of()).get("nextCommand").equals("/mycli guild party invite Peer4"));
        phase(plan(A,team(A,B,C,D,E),Map.of()),"formed","inspect_gathering");
        // Existing two-member parties stay valid; no four-person-only global restriction.
        check(PartyFormation.plan(A,List.of(actor(A),actor(B)),two,Map.of()).get("membershipConfirmed").equals(true));
        System.out.println("four-party-checks="+checks+" passed=true");
    }
}
