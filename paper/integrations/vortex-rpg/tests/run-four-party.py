"""Offline four-player tests. Native sources are explicit pinned inputs, never downloaded here."""
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


def run(native_source=None, java="java"):
    root = Path(__file__).resolve().parents[1]
    sources = [root / "src/org/qiandengji/vortex/PartyFormation.java", root / "tests/PartyFormationTest.java"]
    mains = ["org.qiandengji.vortex.PartyFormationTest"]
    pins = {
        "io/vortexcore/world/ExpeditionPartyManager.java": "d9955f58f72c1d206889da0ce7c7b691558fa8ed7cd504f0a4d596cdb7220ef5",
        "io/vortexcore/party/PartyRole.java": "650a2d1d86d29dbbdd68b32d989a744ab70712e79ec205a0d77b0bb268509fb8",
    }
    with tempfile.TemporaryDirectory(prefix="four-party-offline-") as temporary:
        destination = Path(temporary)
        if native_source is not None:
            for relative, expected in pins.items():
                source = Path(native_source) / "src/main/java" / relative
                data = source.read_bytes()
                if hashlib.sha256(data).hexdigest() != expected:
                    raise ValueError("native_party_source_changed: explicitly review the new source before repinning")
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                if target.name == "ExpeditionPartyManager.java":
                    # Same read-only API used by the existing qd32 candidate.
                    # Native create/invite/accept/leave/capacity code is unchanged.
                    needle = "    public Collection<PartySnapshot> allParties() {"
                    text = data.decode("utf-8")
                    if text.count(needle) != 1:
                        raise ValueError("native_party_api_boundary_changed")
                    addition = """    public Optional<InviteSnapshot> pendingInviteOf(UUID targetId) {
        PartyInvite invite = targetId == null ? null : pendingInvites.get(targetId);
        if (invite == null || invite.expiresAtEpochMillis <= System.currentTimeMillis() || !parties.containsKey(invite.partyId)) return Optional.empty();
        return Optional.of(new InviteSnapshot(invite.partyId, invite.inviterId, invite.targetId, invite.expiresAtEpochMillis));
    }
    public record InviteSnapshot(UUID partyId, UUID inviterId, UUID targetId, long expiresAtEpochMillis) {}

"""
                    target.write_text(text.replace(needle, addition + needle), encoding="utf-8")
                sources.append(target)
            sources.append(root / "tests/NativeFourPartyTest.java")
            mains.append("org.qiandengji.vortex.NativeFourPartyTest")
        compiler = shutil.which("javac")
        command = [compiler] if compiler else [java, "--module", "jdk.compiler/com.sun.tools.javac.Main"]
        subprocess.run([*command, "-encoding", "UTF-8", "-d", str(destination), *map(str, sources)], check=True, timeout=60)
        for main in mains:
            subprocess.run([java, "-ea", "-cp", str(destination), main], check=True, timeout=30)
    print(json.dumps({"production_changed": False, "network_called": False, "native_manager_tested": native_source is not None,
                      "native_source_sha256": pins if native_source is not None else None}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-source", type=Path)
    parser.add_argument("--java", default="java")
    options = parser.parse_args()
    run(options.native_source, options.java)
