package local.tlmcompat.hybrid;

/** Native task selection only; no model loop, movement, damage or inventory mutation. */
final class MaidCompanionPolicy {
    enum Action { HOLD, DEFEND, RESTORE }
    static Action choose(boolean eligible,boolean automatic,boolean idle,boolean lowHealth,boolean armed,boolean threat,long quietNanos){
        if(!eligible||lowHealth||!armed)return automatic?Action.RESTORE:Action.HOLD;
        if(automatic)return !threat&&quietNanos>=5_000_000_000L?Action.RESTORE:Action.HOLD;
        return idle&&threat?Action.DEFEND:Action.HOLD;
    }
}
