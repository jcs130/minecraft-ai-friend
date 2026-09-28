# Kirito First Person Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return a fresh, textured Minecraft view from Kirito's eyes in `view_scene`, with vertical FOV 120° and grounded HUD labels.

**Architecture:** Export a bounded, loaded-only block snapshot and camera pose from Kirito's actual Numen body. Feed those blocks into a private Prismarine renderer in the supervised world service and capture a frame with headless Chromium. This source never uses Goddess or an additional Minecraft login. Include pose and frame provenance and reject unavailable or stale views. The existing semantic grid remains available as a map.

**Tech Stack:** Node 22, prismarine-viewer, Playwright Core, Chromium, Python FastMCP.

**Spec:** `docs/SURVIVOR-VISION-DESIGN.md`; current user request, 2026-09-25.

## Global Constraints

- Preserve existing viewer sessions and Kirito's action lease; image capture is read-only.
- Do not report a semantic map or observer viewpoint as Kirito's screenshot.
- Use bounded capture time, image size, and concurrency; no stale-frame fallback.
- Deploy with health probe and production smoke assertion per `world/AGENTS.md`.

## Review Focus

- Kirito absent or in another dimension: no image returned.
- Numen has no loaded chunks around Kirito: no image returned.
- Viewer slots full: capture fails clearly and does not evict users.
- Renderer initializes without terrain: reject sky-only frame.
- Movement during capture: state the sampled pose and time, never claim atomicity.
- HUD range labels distinguish raycast hit from nearby objects that may be occluded.

---

### Task 1: Numen snapshot and renderer capture

**Files:** `world/numen-actuator-src/neoforge/src/main/java/com/dwinovo/numen/actuator/NumenVisionSnapshot.java`, `world/src/numen-snapshot-view.mts`, `world/src/mc-modern-viewer.mts`, `world/src/agent-frame.mts`, `world/runtime-images/Dockerfile.world`, `world/tests-ai/agent-frame.test.mjs`.

- [x] Add tests for target identity, loaded-only snapshot validation, scene readiness, and bounded PNG response.
- [x] Implement read-only Numen camera, textured rendering, and headless capture with a health signal.
- [x] Run targeted Node tests and actual local frame smoke (120°, 640×360, 69,356-byte raw PNG).

### Task 2: MCP exposure

**Files:** `world/survival/scene_view.py`, `world/survival/mcp_server.py`, `world/survival/controller.py`, `tests/test_survival_scene_mcp.py`, `tests/test_survival_scene_view.py`.

- [x] Add MCP test requiring a true first-person screenshot and source metadata.
- [x] Route `view_scene` to the renderer, retain semantic map mode, and update prompt.
- [x] Run targeted Python tests and the production MCP image call (text + image blocks, HUD overlay).

### Task 3: Operational verification

**Files:** `world/ops/health/health_mon.py`, relevant compose and smoke tools.

- [x] Build and restart affected services, preserving existing profiles and tools.
- [x] Verify screenshot dimensions, visible rendered terrain, viewpoint evidence, health, and existing viewer behavior.
