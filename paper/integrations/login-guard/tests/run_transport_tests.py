"""Compile the complete LoginGuard and run isolated regressions with pinned API jars.

No proxy is started, no credentials are read, and output must be outside the repo.
"""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[2]
PINNED = {
    "velocity.jar": "fe53021f3168322cb6cb68f78699866fd098df3c306e4359847a10b0d02689ef",
    "LibreLogin.jar": "3df848d4058e63f37cf9fe997542fd49c84374440d116a34ac4052278aa77e4f",
    "packetevents.jar": "1889f17e58030b33ef8c3c9f0d3321c6fb93c0fbd830d96c30af88b2c5eef7b4",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deps", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--java", default="java", help="Java 21 executable, including jdk.compiler")
    parser.add_argument("--source", type=Path, default=ROOT / "src", help="Alternate baseline src directory for red/green comparison")
    args = parser.parse_args()
    output = args.output.resolve()
    if output == REPO or REPO in output.parents or output.exists():
        parser.error("Use a fresh output directory outside the repository")
    jars = [args.deps.resolve() / name for name in PINNED]
    for jar in jars:
        if hashlib.sha256(jar.read_bytes()).hexdigest() != PINNED[jar.name]:
            parser.error("Unreviewed API dependency: " + jar.name)
    classes = output / "classes"
    classes.mkdir(parents=True)
    cp = os.pathsep.join(map(str, jars))
    sources = (sorted(args.source.rglob("*.java"))
               + sorted((ROOT / "tests").glob("*.java"))
               + sorted((REPO / "paper/plugins/shared/src/org/afuhome/identity").glob("*.java")))
    has_trace = (args.source / "org/afuhome/auth/VoiceTransportTrace.java").exists()
    if not has_trace:
        sources = [source for source in sources if source.name != "VoiceTransportTraceTest.java"]
    has_svc = (args.source / "org/afuhome/auth/SvcAddressRouting.java").exists()
    if not has_svc:
        sources = [source for source in sources if source.name != "SvcPacketTest.java"]
    sources += sorted((ROOT / "tests/org").rglob("*.java"))
    subprocess.run([args.java, "com.sun.tools.javac.Main", "-proc:none", "-encoding", "UTF-8",
                    "-source", "21", "-target", "21", "-cp", cp, "-d", str(classes),
                    *map(str, sources)], check=True)
    cp = str(classes) + os.pathsep + cp
    names = ["SvcAddressTest", "SvcPacketTest", "VoiceTransportTest", "VoiceOrderingTest", "VoiceTransportTraceTest", "McbotTransportTest", "AuthObservationTest", "AuthNotificationTest",
             "AuthHeartbeatRecoveryTest", "AuthMessagesTest", "FirstPasswordPolicyTest",
             "PremiumEyePolicyTest", "PortalBridgeTest", "ConfigurationSettingsTest", "IdentityHandoffTest"]
    if not has_trace:
        names.remove("VoiceTransportTraceTest")
    if not has_svc:
        names.remove("SvcPacketTest")
    for name in names:
        qualified = name if name == "PremiumEyePolicyTest" else "org.afuhome.auth." + name
        subprocess.run([args.java, "-ea", "-cp", cp, qualified], check=True)
    subprocess.run([args.java, "-ea", "-cp", cp, "org.afuhome.auth.AtomicHeartbeatSnapshotTest",
                    str(output / "heartbeat.json")], check=True)
    for host in ["127.0.0.1", "0.0.0.0"]:
        subprocess.run([args.java, "-ea", "-cp", cp, "RefreshConcurrencyTest",
                        str(output / ("refresh-" + host)), host], check=True)
    print(f"PASS {len(names) + 3} isolated LoginGuard regression runs; no live server/authentication provider")


if __name__ == "__main__":
    main()
