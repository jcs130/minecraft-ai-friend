package dev.qiandeng.maw.saoforge;

public final class CastEvidenceProbe {
    public static void main(String[] args) {
        assert CastEvidence.swordCooldownKey(7, 2).equals("cd7_2");
        assert !CastEvidence.started(100,100,0,0,0,0) : "unrelated NBT cannot prove a cast";
        assert CastEvidence.started(100,88,0,60,0,34);
        assert CastEvidence.started(100,100,0,60,0,0);
        assert CastEvidence.started(100,100,0,0,0,20);
        assert !CastEvidence.started(88,100,40,0,20,0);
        assert CastEvidence.gate(true,true,false,false,false,1,-1,false,0).equals("weapon_not_supported_for_sword_skill");
        assert CastEvidence.gate(true,true,false,false,true,1,-1,false,0)==null : "profession does not require a mod sword";
        assert CastEvidence.gate(true,true,false,false,true,1,-1,false,60).equals("skill_cooldown");
        assert CastEvidence.gate(true,true,false,false,true,1,-1,true,0).equals("native_cast_busy");
        assert CastEvidence.gate(false,true,false,false,true,1,-1,false,0).equals("combat_disabled");
        assert CastEvidence.gate(true,true,false,false,true,0,-1,false,0).equals("profession_required");
        System.out.println("12 cast evidence/gate assertions passed");
    }
}
