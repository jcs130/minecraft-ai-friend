/* SPDX-License-Identifier: MPL-2.0 */
package meow.kikir.freesia.velocity.network.ysm;
import java.util.UUID;

/** Session identity, finite readbacks and stale callbacks; actual YSM tested on a private fixture. */
public final class WorkerStateRestoreGateTest {
    private static int checks;
    private static void check(boolean pass, String name) { if (!pass) throw new AssertionError(name); checks++; }
    public static void main(String[] args) {
        var gate = new WorkerStateRestoreGate();var id = UUID.randomUUID();Object mapper = new Object(), worker = new Object();
        check(gate.pending(id, worker, 0) == null, "unsolicited native save is not a recovery reply");
        check(gate.issue(id,1,mapper,worker,-1,3,0)==null, "missing gameplay entity is not queried");
        check(gate.issue(id,1,mapper,worker,10,-1,0)==null, "missing worker entity is not queried");
        var one = gate.issue(id,1,mapper,worker,10,3,0);
        check(one != null && one.attempt()==1, "actual session can request one snapshot");
        check(gate.pending(id,worker,1)==one, "same worker can return a snapshot");
        check(gate.pending(id,new Object(),1)==null, "another worker cannot satisfy it");
        check(gate.current(one,1,mapper,worker,10,3,1), "complete current identity accepted");
        check(!gate.current(one,2,mapper,worker,10,3,1), "old epoch rejected");
        check(!gate.current(one,1,new Object(),worker,10,3,1), "old mapper rejected");
        check(!gate.current(one,1,mapper,new Object(),10,3,1), "old controller rejected");
        check(!gate.current(one,1,mapper,worker,11,3,1), "different gameplay entity rejected");
        check(!gate.current(one,1,mapper,worker,10,4,1), "different worker entity rejected");
        check(gate.issue(id,1,mapper,worker,10,3,4_999_999_999L)==null, "retry rate is bounded");
        var two=gate.issue(id,1,mapper,worker,10,3,5_000_000_000L);
        check(two!=null&&two.attempt()==2, "second bounded attempt");
        check(!gate.current(one,1,mapper,worker,10,3,5_000_000_001L), "late first reply cannot consume the newer ticket");
        gate.finish(one);
        check(gate.pending(id,worker,5_000_000_001L)==two, "late completion does not finish a newer request");
        var three=gate.issue(id,1,mapper,worker,10,3,10_000_000_000L);
        check(three!=null&&three.attempt()==3, "last bounded attempt");
        check(gate.issue(id,1,mapper,worker,10,3,15_000_000_000L)==null, "no unbounded background retries");
        check(gate.pending(id,worker,31_000_000_000L)==null, "late native save expires");
        gate.remove(id);
        check(!gate.current(three,1,mapper,worker,10,3,11_000_000_000L), "disconnect invalidates the old request");
        var reconnect=gate.issue(id,2,new Object(),worker,20,4,12_000_000_000L);
        check(reconnect!=null&&reconnect.attempt()==1, "new mapper starts its own finite recovery");
        gate.finish(reconnect);
        check(gate.pending(id,worker,12_000_000_001L)==null, "completion cannot be replayed");
        check(gate.issue(id,2,reconnect.mapper(),worker,20,4,20_000_000_000L)==null, "successful recovery does not query again");
        var changed=gate.issue(id,3,new Object(),worker,30,5,21_000_000_000L);
        check(changed!=null&&changed.attempt()==1, "new backend permits a fresh recovery");
        check(!gate.current(reconnect,3,changed.mapper(),worker,30,5,21_000_000_001L), "finished old epoch remains rejected");
        var bounded=new WorkerStateRestoreGate();
        for(int i=0;i<WorkerStateRestoreGate.LIMIT;i++)check(bounded.issue(UUID.randomUUID(),1,new Object(),worker,i,i,0)!=null,"bounded online slot "+i);
        check(bounded.issue(UUID.randomUUID(),1,new Object(),worker,100,100,0)==null,"online slot limit enforced");
        System.out.println("Worker state recovery checks: "+checks);
    }
}
