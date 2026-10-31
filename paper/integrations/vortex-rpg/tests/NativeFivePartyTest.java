package org.qiandengji.vortex;

import io.vortexcore.world.ExpeditionPartyManager;
import java.time.Duration;
import java.util.*;

/** Full native five-slot flow; a four-actor intent never requires filling the fifth slot. */
public final class NativeFivePartyTest {
    private static int checks;
    private static void check(boolean ok){if(!ok)throw new AssertionError("native five-player check "+checks);checks++;}
    private static Map<String,Object> plan(ExpeditionPartyManager manager,UUID self,List<PartyFormation.Actor> actors){
        var teams=new HashMap<UUID,PartyFormation.Team>();var invites=new HashMap<UUID,PartyFormation.Invitation>();
        for(var actor:actors){
            manager.partyOf(actor.id()).ifPresent(s->teams.put(actor.id(),new PartyFormation.Team(s.partyId(),s.leaderId(),s.members())));
            manager.pendingInviteOf(actor.id()).ifPresent(i->invites.put(actor.id(),new PartyFormation.Invitation(i.partyId(),i.inviterId())));
        }
        var before=List.copyOf(manager.allParties());
        var result=PartyFormation.plan(self,actors,teams,invites);
        check(before.equals(List.copyOf(manager.allParties())));return result;
    }
    public static void main(String[] args){
        var manager=new ExpeditionPartyManager(Duration.ofDays(1));
        var actors=new ArrayList<PartyFormation.Actor>();
        for(int i=1;i<=5;i++)actors.add(new PartyFormation.Actor(new UUID(2,i),"FivePeer"+i,true));
        int creates=0,invites=0,accepts=0;boolean fourSlotsVerified=false;
        for(int round=0;round<10;round++){
            boolean complete=true;
            for(var actor:actors){
                var result=plan(manager,actor.id(),actors);
                if(result.get("membershipConfirmed").equals(true))continue;
                complete=false;
                switch((String)result.get("nextAction")){
                    case "create" -> {check(manager.createParty(actor.id()).success());creates++;}
                    case "invite" -> {
                        String command=(String)result.get("nextCommand");String target=command.substring(command.lastIndexOf(' ')+1);
                        UUID id=actors.stream().filter(a->a.name().equals(target)).findFirst().orElseThrow().id();
                        check(manager.invite(actor.id(),id).success());invites++;
                        check(manager.partyOf(id).isEmpty());
                    }
                    case "accept" -> {
                        if(actor.id().equals(actors.get(4).id())){
                            check(manager.membersOf(actors.get(0).id()).size()==4);
                            // Four current companions are a valid formed group, leaving a native slot free.
                            check(plan(manager,actors.get(0).id(),actors.subList(0,4)).get("membershipConfirmed").equals(true));
                            check(!plan(manager,actors.get(0).id(),actors).get("membershipConfirmed").equals(true));
                            check(plan(manager,actors.get(0).id(),actors).get("nextAction").equals("wait"));
                            fourSlotsVerified=true;
                        }
                        check(manager.pendingInviteOf(actor.id()).isPresent());
                        check(manager.acceptInvite(actor.id()).success());accepts++;
                    }
                    case "wait" -> check(result.get("automaticActions").equals(false));
                    default -> throw new AssertionError("Unexpected five-player plan: "+result);
                }
            }
            if(complete)break;
        }
        check(fourSlotsVerified&&creates==1&&invites==4&&accepts==4);
        var actual=manager.partyOf(actors.get(0).id()).orElseThrow();check(actual.members().size()==5);
        for(var actor:actors){
            var result=plan(manager,actor.id(),actors);
            check(result.get("membershipConfirmed").equals(true));check(result.get("requiredMembers").equals(5));
            check(result.get("nativePartyId").equals(actual.partyId().toString()));
            check(manager.membersOf(actor.id()).equals(actual.members()));
            check(result.get("nearbyHearingVerified").equals(false));
        }
        UUID sixth=new UUID(2,6);check(!manager.invite(actual.leaderId(),sixth).success());
        check(!manager.acceptInvite(sixth).success());check(manager.partyOf(sixth).isEmpty());
        check(manager.membersOf(actual.leaderId()).size()==5);
        System.out.println("native-five-party-checks="+checks+" passed=true creates="+creates+" invites="+invites+" accepts="+accepts);
    }
}
