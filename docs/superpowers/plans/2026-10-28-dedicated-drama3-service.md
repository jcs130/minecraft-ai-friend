# Dedicated Drama 3 Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the RTX 3090 host as a persistent LAN Drama 3 speech server, with the local Qwen GPU container retired from autostart.

**Architecture:** Use the already verified speech.cpp 0.9.0 Windows Vulkan binary and Q4_K GGUF with pre-encoded Kirito, Yui, and two-speaker voices. Windows Task Scheduler starts the native speech process at boot and a second periodic task checks its HTTP health. The Windows firewall allows port 18120 only from the 192.168.3.0/24 LAN; the service does not accept public Internet traffic.

**Tech Stack:** PowerShell 7, Windows Task Scheduler, Windows Defender Firewall, speech.cpp 0.9.0, Docker CLI, Python stdlib smoke test.

**Spec:** `docs/research/DRAMA3-LOCAL-DEPLOYMENT-2026-10-28.md` and the user's 2026-10-28 request to dedicate this machine to Drama 3 while moving the LLM elsewhere.

## Global Constraints

- Use the existing 20,787,264,352-byte Q4_K GGUF and verified speech.cpp v0.9.0 binary under `E:\ai-models\drama3-20261028\speechcpp`.
- Do not commit GGUF weights, reference audio, voice files, logs, secrets, or runtime state.
- Preserve the existing Qwen container data; set its restart policy to `no` and stop it after recording its previous state.
- Keep the LAN endpoint unauthenticated as requested previously, and scope firewall access to the local 192.168.3.0/24 network.
- Deploy the speech service independently of the currently stopped Minecraft stack and existing IndexTTS-2.5 gateway.

## Review Focus

- A boot task running as SYSTEM may not see the Vulkan GPU; start it and verify an actual synthesis, then switch to an interactive logon principal if needed.
- The 24GB card has less than 1GB free at full model load; check steady-state VRAM and reject simultaneous LLM startup.
- A task may report Running even when HTTP is unhealthy; the watchdog must restart the task only after a bounded failed health check.
- Source reference voice files are Japanese; verify actual Chinese audio and document uncertain character-name pronunciation.
- A local connection to the LAN IP does not prove a second machine can connect; distinguish host self-test from remote LAN test.

---

### Task 1: Service scripts and installation

**Files:** Create `tools/drama3/Install-Drama3Service.ps1`, `tools/drama3/Invoke-ElevatedInstall.ps1`, `tools/drama3/Watch-Drama3Service.ps1`, `tools/drama3/drama3_health.py`.

**Interfaces:** The installer registers `Drama3-Speech` and `Drama3-Watchdog`, port 18120 and the Kirito/Yui/cast voices. The health tool returns nonzero for bad HTTP, wrong model, or invalid generated WAV.

- [x] Write installation and watchdog scripts with exact expected paths, task identities, scoped firewall rule, previous-state snapshot, and bounded health retries.
- [x] Run PowerShell parser against both scripts and `python -m py_compile` against the health tool.
- [x] Run the health tool against a stopped server and confirm it fails clearly.

### Task 2: Switch the host to Drama 3

**Files:** Runtime state only in `server/drama3-service/`; no model assets in Git.

**Interfaces:** `http://192.168.3.133:18120/health`, `/v1/models`, and `/v1/audio/speech`.

- [x] Record the current Qwen container restart policy and LAN proxy task state, then stop and disable only those exact local LLM components.
- [ ] Install the firewall and scheduled tasks, start `Drama3-Speech`, and wait for HTTP health.
- [ ] Verify the task principal, active process, GPU allocation, firewall scope, and watchdog behavior after an intentional service-task stop. Current-user task, GPU, and stop/restart verified; SYSTEM/firewall awaits Windows UAC.

### Task 3: Real speech smoke and documentation

**Files:** Create `docs/DRAMA3-DEDICATED-SERVICE.md`; update the research note's status section.

**Interfaces:** The smoke tool requests one Kirito clip, one Yui clip, and one two-speaker clip using the OpenAI-style API, saves WAVs to ignored runtime storage, and checks RIFF/WAV duration/non-silence.

- [x] Run the smoke tool on loopback and the machine's LAN IP; record actual request latency and audio lengths.
- [x] Verify the old local LLM health endpoint no longer answers and the Drama 3 endpoint remains healthy.
- [x] Document LAN client request, model/voice IDs, operational status, restart/rollback steps, licensing, and the unverified remote-machine boundary.
- [ ] Run `git diff --check`, review changed files, commit only source/docs, and follow the repository's main-branch publication rules without force-push.
