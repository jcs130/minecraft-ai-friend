package org.qiandengji.vortex;

import io.vortexcore.world.ExpeditionPartyManager;
import java.time.Duration;
import java.util.*;

/** Exercise the real native manager; each actor follows only its own read-only plan. */
public final class NativeFourPartyTest {
    private static int checks;
    private static void check(boolean value){if(!value)throw new AssertionError("native four-player check "+checks);checks++;}
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
    public static void main(String[]args){
        var manager=new ExpeditionPartyManager(Duration.ofDays(1));
        var actors=List.of(new PartyFormation.Actor(new UUID(0,1),"Peer1",true),
            new PartyFormation.Actor(new UUID(0,2),"Peer2",true),new PartyFormation.Actor(new UUID(0,3),"Peer3",true),
            new PartyFormation.Actor(new UUID(0,4),"Peer4",true));
        int creates=0,invites=0,accepts=0;
        for(int round=0;round<8;round++){
            boolean formed=true;
            for(var actor:actors){
                var result=plan(manager,actor.id(),actors);
                if(result.get("membershipConfirmed").equals(true))continue;
                formed=false;String action=(String)result.get("nextAction");
                switch(action){
                    case "create" -> {check(manager.createParty(actor.id()).success());creates++;}
                    case "invite" -> {
                        String line=(String)result.get("nextCommand");String target=line.substring(line.lastIndexOf(' ')+1);
                        UUID id=actors.stream().filter(a->a.name().equals(target)).findFirst().orElseThrow().id();
                        check(manager.invite(actor.id(),id).success());invites++;
                        var nativeInvite=manager.pendingInviteOf(id).orElseThrow();
                        check(nativeInvite.inviterId().equals(actor.id()));
                        check(manager.partyOf(id).isEmpty()); // Invitation alone did not join.
                    }
                    case "accept" -> {
                        check(manager.pendingInviteOf(actor.id()).isPresent());
                        check(manager.acceptInvite(actor.id()).success());accepts++;
                    }
                    case "wait" -> check(manager.partyOf(actor.id()).isEmpty()||!manager.membersOf(actor.id()).isEmpty());
                    default -> throw new AssertionError("Unexpected native plan: "+result);
                }
            }
            if(formed)break;
        }
        check(creates==1&&invites==3&&accepts==3);
        var nativeParty=manager.partyOf(actors.get(0).id()).orElseThrow();
        check(nativeParty.members().size()==4);
        for(var actor:actors){
            check(manager.partyOf(actor.id()).orElseThrow().partyId().equals(nativeParty.partyId()));
            var result=plan(manager,actor.id(),actors);check(result.get("membershipConfirmed").equals(true));
            check(result.get("nativePartyId").equals(nativeParty.partyId().toString()));
        }
        // The upstream capacity is five; minimum four is not a guessed two-member limit.
        UUID fifth=new UUID(0,5),sixth=new UUID(0,6);
        check(manager.invite(nativeParty.leaderId(),fifth).success());check(manager.acceptInvite(fifth).success());
        check(!manager.invite(nativeParty.leaderId(),sixth).success());
        check(manager.leave(fifth).success());
        // Leaving and native leader election do not silently create a replacement party.
        check(manager.leave(actors.get(0).id()).success());
        var remaining=manager.partyOf(actors.get(1).id()).orElseThrow();
        check(remaining.partyId().equals(nativeParty.partyId())&&remaining.members().size()==3);
        check(!plan(manager,actors.get(0).id(),actors).get("membershipConfirmed").equals(true));
        check(manager.invite(remaining.leaderId(),actors.get(0).id()).success());
        check(plan(manager,actors.get(0).id(),actors).get("nextAction").equals("accept"));
        check(manager.acceptInvite(actors.get(0).id()).success());
        check(manager.partyOf(actors.get(0).id()).orElseThrow().partyId().equals(nativeParty.partyId()));
        System.out.println("native-four-party-checks="+checks+" passed=true creates="+creates+" invites="+invites+" accepts="+accepts);
    }
}
