"""Framework-owned strategic review lifecycle. Host frontends only transport envelopes."""

import hashlib
import json
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime

from .configuration import _boolean, _integer
from .host_context import HostContextPort, validate_host_context
from . import review_evidence
from . import review_projects
from .mailbox import Mailbox, observation
from .observations import body_feedback, feedback_signal, fact_preview, spatial_text, tool_failure_view, native_outcome_summary
from .death_memory import hydrate_combat, DeathMemory, lifecycle, scope_key, recovery_context
from .stage_applicability import body_baseline


@dataclass(frozen=True)
class ReviewPolicy:
    enabled: bool = False
    min_interval_seconds: int = 60
    review_interval_seconds: int = 180
    idle_presence_seconds: int = 45
    review_max_output_tokens: int = 3072

    @classmethod
    def parse(cls, raw):
        minimum = _integer(raw, "min_interval_seconds", 60, 30, 900)
        return cls(_boolean(raw, "enabled", False), minimum,
                   _integer(raw, "review_interval_seconds", 180, minimum, 1800),
                   _integer(raw, "idle_presence_seconds", 45, 30, 900),
                   _integer(raw, "review_max_output_tokens", 3072, 128, 32768))


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def review_observation(status, now):
    snapshot = status.get("observation", status)
    try:
        age = now - datetime.fromisoformat(snapshot["updated_at"]).timestamp()
    except (KeyError, TypeError, ValueError):
        return None
    if not 0 <= age <= 30 or snapshot.get("phase") not in {"running", "failed"}:
        return None
    if snapshot.get("phase") == "running" and snapshot.get("game_connected") is not True:
        return None
    facts = {part["key"]: str(part.get("text", "")) for part in snapshot.get("facts", {}).get("parts", [])}
    if not facts.get("body") or not facts.get("gear"):
        return None
    active = snapshot.get("current_goal") or {}
    pending = [{key: task.get(key) for key in ("kind", "id", "phase", "terminal")} for task in snapshot.get("pending", [])[:16]]
    useful = {key: facts.get(key, "")[:size] for key, size in (
        ("body", 180), ("gear", 420), ("foodReserve", 160), ("life", 250), ("place", 180),
        ("clock", 80), ("queue", 350), ("structure", 300), ("terrain", 250), ("bodyRestriction", 400), ("serverFeedback", 1800), ("messages", 800),
        ("inventoryIds", 1200), ("equip", 240), ("options", 500))}
    useful["lastTask"] = fact_preview(spatial_text(facts.get("lastTask", "")), 1000)
    # These are the core's project/method summaries, not host personal memory.
    # Keep explicit abridgement and original query handles for longer entries.
    for key, size in (("goals", 1200), ("methods", 900)):
        useful[key] = fact_preview(facts.get(key, ""), size)
    originals, original_status = review_evidence.original_facts(facts, useful)
    reads = snapshot.get("read_activity") or {}
    reads = {key: min(999, reads[key]) for key in (
        "mc_help", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_tool_help", "mc_original",
        "mc_knowledge", "mc_messages", "mc_notices", "mc_options")
        if isinstance(reads, dict) and type(reads.get(key)) is int and reads[key] > 0}
    feedback = body_feedback(snapshot, facts)
    # Raw facts remain in the independent journal/status API; no accumulating prompt history here.
    evidence = {"sampled_at": snapshot["updated_at"], "phase": snapshot["phase"], "connected": snapshot.get("game_connected") is True,
                "standing_goal": str(snapshot.get("standing_goal", "")),
                "current_goal": {**{key: active.get(key) for key in ("id", "goal", "mode", "parent_id")},
                                 "origin": active.get("origin", "unknown")}, "pending": pending,
                "historical_goal": snapshot.get("historical_goal"),
                "facts": useful, "body_events": feedback["body_events"], "native_outcomes": feedback["native_outcomes"],
                "original_facts": originals, "original_fact_status": original_status,
                "outcome_precedence": feedback["outcome_precedence"],
                "fact_originals": {part["key"]: part["original"] for part in snapshot.get("facts", {}).get("parts", [])
                                   if part.get("key") in useful and part.get("original")},
                "planner_error": snapshot.get("planner_error"),
                "tool_failure": tool_failure_view(snapshot.get("tool_failure")),
                "planner_failures": snapshot.get("planner_failures", 0), "runtime_error": snapshot.get("error"), "read_activity": reads,
                "unactioned_replies": snapshot.get("unactioned_replies", 0),
                "planner_retry_seconds": snapshot.get("planner_retry_seconds", 0)}
    # Clocks, sight direction, repeated observation task IDs and positional chatter are not urgent changes.
    material = {key: useful[key] for key in ("body", "gear", "foodReserve", "serverFeedback")}
    terminal = useful["lastTask"]
    if re.search(r'"skill"\s*:\s*"observe"', facts.get("lastTask", "")) and "完成" in facts.get("lastTask", ""):
        terminal = ""  # Repeated successful look-only tasks are not new survival progress.
    episode = snapshot.get("death_episode")
    life = lifecycle(snapshot.get("facts", {}))
    life = life if isinstance(life, dict) else {}
    if (isinstance(episode, dict) and scope_key(episode.get("scope"))
            and episode.get("scope") == snapshot.get("game_identity") and isinstance(episode.get("source_event"), dict)
            and life.get("episodeId") in {None, episode.get("id")}):
        evidence["death_episode"] = episode
        evidence["death_recovery"] = recovery_context(episode, snapshot.get("facts", {}), evidence["current_goal"])
    # Stable safety boundary, excluding movement, clock, inventory and ordinary
    # task progress. Keep it separate from evidence refreshed during delivery.
    evidence["body_baseline"] = {
        "scope": scope_key(snapshot.get("game_identity")),
        "run": snapshot.get("facts", {}).get("run"),
        "lifecycle": {"phase": life.get("phase"), "episodeId": life.get("episodeId")
                      or evidence.get("death_episode", {}).get("id")},
        "restriction": feedback["bodyRestriction"], "phase": snapshot["phase"],
        "unknown": [task for task in pending if task.get("phase") in {"unknown", "outcome_unknown"}],
        "uncertain": snapshot.get("uncertain") is True or snapshot.get("error_code") == "outcome_unknown",
    }
    urgent = "runtime_failed" if snapshot["phase"] == "failed" else (
        "death:" + str(episode.get("id")) if "death_episode" in evidence else None)
    return {"session": str(snapshot.get("owner_pid", "")) + ":" + str((snapshot.get("viewer") or {}).get("session", "")),
            "material": digest(material), "intent": digest([evidence["standing_goal"], active]),
            "baseline": digest(evidence["body_baseline"]),
            "signal": digest([material, active, evidence["planner_error"], bool(pending), terminal, feedback_signal(feedback),
                              {key: evidence["tool_failure"][key] for key in ("tool", "error")} if evidence["tool_failure"] else None]),
            "urgent": urgent, "scope": scope_key(snapshot.get("game_identity")), "evidence": evidence}


def brief(text, size):
    raw = str(text).encode("utf-8")
    return raw.decode() if len(raw) <= size else raw[:size - 3].decode("utf-8", errors="ignore") + "…"


def summary(evidence):
    facts = evidence["facts"]
    goal = "站立目标:" + brief(evidence["standing_goal"], 360)
    if user := evidence.get("current_user_goal"):
        goal += "；当前用户目标:" + brief(user["goal"], 360)
    if (active := evidence["current_goal"].get("goal")) and (not user or user["id"] != evidence["current_goal"].get("id")):
        goal += "；阶段(" + evidence["current_goal"]["origin"] + "):" + brief(active, 180)
    if historical := evidence.get("historical_goal"):
        goal += "；历史提案（须重新评估，非当前指令）:" + brief(historical["goal"], 180)
    readings = "；".join(brief(facts[key], size) for key, size in (
        ("body", 120), ("foodReserve", 120), ("gear", 420), ("queue", 150)))
    # A 70-byte inventory preview hid already-owned tools from the main brain.
    # Bounded evidence still fits in one short review, without a summary model.
    unchanged = evidence.get("material_unchanged_seconds", 0)
    activity = f"；生命/物资读数连续{unchanged}秒未变"
    reads = sum(evidence.get("read_activity", {}).values())
    if reads:
        activity += f"；连续查询{reads}次（查询不代表行动进展）"
    terminal = [row for row in evidence["native_outcomes"] if not row["observation_only"] and row.get("terminal") is True]
    if terminal:
        activity += "；" + native_outcome_summary(terminal[-1])
    if failure := evidence.get("tool_failure"):
        activity += "；最近未解工具错误:" + failure["tool"] + " " + brief(failure["error"], 210)
    if server_feedback := facts.get("serverFeedback"):
        activity += "；" + brief(server_feedback, 1200)
    if episode := evidence.get("death_episode"):
        activity += "；实际死亡事件:" + episode["id"] + "（可选叙述；本次历史事实不证明学会或改进）"
        activity += "；重生后须按当前位置和物资重新判断原阶段是否适用，并说明继续、修改或暂缓的理由"
    return goal + "；新鲜观测:" + readings + activity


class ReviewPort:
    """One cross-process strategic mailbox; the native controller remains sole body owner."""

    def __init__(self, directory, *, now=time.time):
        self.directory = directory.resolve()
        self.path = self.directory / "reviews.sqlite3"
        self.mailbox = Mailbox(self.directory)
        self.now = now

    def request_id(self, review_id):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, self.directory.as_uri() + ":" + review_id))

    def current_observation(self, status):
        """Sanitize even pre-upgrade snapshots before any current-review operation."""
        if not review_observation(status, self.now()):
            return None
        snapshot = status.get("observation", status)
        episode = DeathMemory(self.directory).current_episode(
            snapshot.get("game_identity"), snapshot.get("facts", {}), pending=True)
        supplied = snapshot.get("death_episode")
        if episode and isinstance(supplied, dict) and all(supplied.get(key) == episode.get(key) for key in ("id", "scope", "source_event")):
            episode = hydrate_combat(supplied, episode)  # Keep fresh additive evidence and lossless receipts.
        return review_observation({**snapshot, "death_episode": episode}, self.now())

    def speech_current(self, correlation):
        """Validate output against this decision, allowing only its own new goal."""
        current = self.current_observation(observation(self.directory))
        if (self.stopping() or not current or current["session"] != correlation["session"]
                or current["scope"] != correlation["scope"] or current["baseline"] != correlation["baseline"]
                or self.now() > correlation["expires_at"]):
            return False
        if self.mailbox.intent_revision() == correlation["revision"]:
            return True
        with self.mailbox.connection() as db:
            row = db.execute("SELECT id FROM commands WHERE kind IN ('goal','feedback','stop') ORDER BY rowid DESC LIMIT 1").fetchone()
            return bool(row and row[0] == correlation["decision_id"])

    def reconcile(self, state):
        """Recover a mailbox commit if the process died before saving its review receipt."""
        review = state.get("review", {})
        if not review or review.get("result"):
            return
        request_id = self.request_id(review["id"])
        receipt = self.mailbox.get(request_id)
        if not receipt:
            return
        with self.mailbox.connection() as db:
            row = db.execute("SELECT payload FROM commands WHERE id=?", (request_id,)).fetchone()
            payload = json.loads(row[0])
        decision = payload.get("review_decision") or ("revise" if payload.get("revision_of") else "insert")
        choice = {"decision": decision, "goal": "" if decision == "continue" else payload["goal"], "reason": "recovered_mailbox_receipt"}
        review.update(choice=choice, recovered=True, result={"acknowledged": True, "dispatched": True,
                      "decision": decision, "verified": False, "request_id": request_id,
                      "delivery": receipt["delivery"], "recovered": True})
        state["last_request_id"] = request_id
        state["last_decision"] = {**choice, "at": self.now(), "heartbeat_id": review["id"], "request_id": request_id}

    @contextmanager
    def transaction(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5)
        try:
            with db:
                db.execute("CREATE TABLE IF NOT EXISTS review_state (id INTEGER PRIMARY KEY, body TEXT NOT NULL)")
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT body FROM review_state WHERE id=1").fetchone()
                state = json.loads(row[0]) if row else {}
                yield state
                review = state.get("review", {})
                episode = review.get("evidence", {}).get("death_episode")
                if episode and db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='death_episodes'").fetchone():
                    row = db.execute("SELECT body FROM death_episodes WHERE scope=? AND id=?",
                                     (scope_key(episode["scope"]), episode["id"])).fetchone()
                    if row:
                        recorded = json.loads(row[0])
                        history = recorded.get("host_review", {})
                        recorded["host_review"] = {"review_id": review["id"], "offered_at": review.get("last_attempt", history.get("offered_at")),
                            "transport_accepted": review.get("notification_accepted") is True or history.get("transport_accepted") is True,
                            "accepted_at": review.get("accepted_at", history.get("accepted_at")),
                            "inspected_at": review.get("inspected_at", history.get("inspected_at")),
                            "acknowledged": review.get("result", {}).get("acknowledged") is True or history.get("acknowledged") is True,
                            "playback_verified": False}
                        if (reflection := review.get("reflection")) and not (recorded.get("reflection") or recorded.get("lesson")):
                            recorded["reflection"] = reflection
                            if reflection["outcome"] == "lesson":
                                recorded["lesson"] = {k: reflection[k] for k in ("lesson", "applicability", "evidence", "source", "hypothesis", "behavioral_improvement_verified")}
                        if (completion := review.get("reflection_completion")) and not recorded.get("reflection_completion"):
                            recorded["reflection_completion"] = completion
                        db.execute("UPDATE death_episodes SET body=?, notified=? WHERE scope=? AND id=?",
                                   (json.dumps(recorded, ensure_ascii=False), int(recorded["host_review"]["transport_accepted"]),
                                    scope_key(episode["scope"]), episode["id"]))
                db.execute("INSERT OR REPLACE INTO review_state VALUES(1,?)", (json.dumps(state, ensure_ascii=False),))
        finally:
            db.close()

    def state(self):
        if not self.path.exists():
            return {}
        db = sqlite3.connect(f"{self.path.as_uri()}?mode=ro", uri=True, timeout=5)
        try:
            row = db.execute("SELECT body FROM review_state WHERE id=1").fetchone()
            return json.loads(row[0]) if row else {}
        finally:
            db.close()

    def death_record(self, episode):
        """Read under the caller's review write lock; never create history."""
        db = sqlite3.connect(f"{self.path.as_uri()}?mode=ro", uri=True, timeout=5)
        try:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='death_episodes'").fetchone():
                return None, None
            key = scope_key(episode["scope"])
            row = db.execute("SELECT body FROM death_episodes WHERE scope=? AND id=?", (key, episode["id"])).fetchone()
            newest = db.execute("SELECT id FROM death_episodes WHERE scope=? ORDER BY rowid DESC LIMIT 1", (key,)).fetchone()
            return json.loads(row[0]) if row else None, newest[0] if newest else None
        finally:
            db.close()

    def configure(self, policy):
        with self.transaction() as state:
            state["policy"] = asdict(policy)

    def stopping(self):
        if not self.mailbox.path.exists():
            return False
        with self.mailbox.connection() as db:
            return db.execute("SELECT 1 FROM commands WHERE kind='stop' AND state IN ('queued','dispatching') LIMIT 1").fetchone() is not None

    def observe(self, snapshot):
        """Called by the existing runtime publish path, never by a frontend timer."""
        now = self.now()
        observed = self.current_observation(snapshot)
        if not observed or self.stopping():
            return
        observed["evidence"]["current_user_goal"] = self.mailbox.current_user_goal(observed["evidence"]["current_goal"].get("id"))
        with self.transaction() as state:
            self.reconcile(state)
            policy = ReviewPolicy.parse(state.get("policy", {}))
            if not policy.enabled:
                return
            review_projects.record(state, observed, now)
            if projects := review_projects.view(state, observed, now):
                observed["evidence"]["project_observations"] = projects
            previous = state.get("review", {})
            previous_episode = previous.get("evidence", {}).get("death_episode")
            superseded_death = bool(previous_episode
                and previous_episode["id"] != observed["evidence"].get("death_episode", {}).get("id")
                and (not previous.get("result") or previous["result"].get("error") == "main_brain_not_acknowledged"
                     or previous["result"].get("reflection_pending")))
            if superseded_death:
                state["last_superseded_review"] = {"id": previous["id"], "episode_id": previous_episode["id"],
                    "reason": "death_episode_superseded", "acknowledged": previous.get("result", {}).get("acknowledged") is True,
                    "inspected_at": previous.get("inspected_at"), "historical": True}
                # Only the invalid current-death envelope loses its backoff. The
                # unfinished episode and all actual delivery/lesson receipts stay.
                state.pop("retry_after", None)
            revision = self.mailbox.intent_revision()
            same_session = previous.get("session") == observed["session"]
            same_intent = previous.get("revision") == revision and previous.get("intent") == observed["intent"]
            urgent = superseded_death or bool(observed["urgent"] and observed["urgent"] != previous.get("urgent"))
            if state.get("material") != observed["material"] or not same_session:
                state.update(material=observed["material"], material_since=now)
            observed["evidence"]["material_unchanged_seconds"] = int(now - state.get("material_since", now))
            # A disconnected body cannot offer a review. Its first delivery
            # must use fresh evidence, rather than charging unavailable time to
            # a host which was never asked. Actual/unknown offers and direct
            # inspections retain their bounded acknowledgement backoff.
            never_offered = (previous.get("attempts") == 0 and "last_attempt" not in previous
                and previous.get("notification_status") is None and not previous.get("notification_accepted")
                and "inspected_at" not in previous and "choice" not in previous)
            unoffered_expired = (same_session and same_intent and never_offered
                and now - previous.get("created_at", now) > 180
                and (not previous.get("result")
                     or previous["result"].get("error") == "main_brain_not_acknowledged"))
            if unoffered_expired:
                state["last_expired_unoffered_review"] = {"id": previous["id"],
                    "created_at": previous["created_at"], "expired_at": now,
                    "reason": "unoffered_review_expired", "acknowledged": False, "historical": True}
                state.pop("retry_after", None)
                urgent = True  # One fresh envelope, never a body action or old acknowledgement.
            if now < state.get("retry_after", 0) and not urgent and same_session and same_intent:
                return
            pending = previous and not previous.get("result") and same_session and same_intent and not urgent
            if pending:
                if now - previous["created_at"] > 180:
                    previous["result"] = {"acknowledged": False, "error": "main_brain_not_acknowledged"}
                    state["retry_after"] = now + 300
                else:
                    if previous.get("notification_accepted") and previous.get("evidence", {}).get("death_episode"):
                        observed["evidence"]["death_episode"] = hydrate_combat(previous["evidence"]["death_episode"], observed["evidence"].get("death_episode"))
                    previous["evidence"] = observed["evidence"]
                    previous["summary"] = summary(observed["evidence"])
                    if previous.get("signal") != observed["signal"] or previous.get("baseline") != observed["baseline"]:
                        # Bind dedup to the evidence the main brain will inspect,
                        # so acknowledging it cannot wake the same episode again.
                        previous["signal"] = observed["signal"]
                        if previous.get("trigger") == "periodic_review":
                            previous["trigger"] = "state_changed"
                return
            elapsed = now - state.get("created_at", 0)
            changed = not same_session or not same_intent or observed["signal"] != previous.get("signal")
            idle_due = bool(previous and same_session and same_intent and not changed
                            and now - state.get("submitted_at", state.get("created_at", now)) >= policy.idle_presence_seconds)
            if not urgent and not idle_due and (elapsed < policy.min_interval_seconds or (not changed and elapsed < policy.review_interval_seconds)):
                return
            state.update(created_at=now, review={**observed, "id": uuid.uuid4().hex[:12], "created_at": now,
                         "revision": revision, "attempts": 0, "summary": summary(observed["evidence"]),
                         "trigger": "state_changed" if observed["urgent"] == "runtime_failed" else "death_review" if observed["evidence"].get("death_episode") else "state_changed" if urgent or changed else "idle_presence" if idle_due else "periodic_review"})

    def offer(self):
        """Claim one bounded delivery attempt; does not manufacture a game event."""
        current = self.current_observation(observation(self.directory))
        if not current or self.stopping():
            return {"offered": False, "reason": "no_fresh_running_observation"}
        with self.transaction() as state:
            self.reconcile(state)
            review = state.get("review", {})
            if not state.get("policy", {}).get("enabled") or not review or review.get("result"):
                return {"offered": False, "reason": "no_pending_review"}
            if (episode := review.get("evidence", {}).get("death_episode")) and episode["id"] != current["evidence"].get("death_episode", {}).get("id"):
                return {"offered": False, "reason": "death_episode_superseded", "historical": True, "episode_id": episode["id"]}
            if current["session"] != review["session"] or current["intent"] != review["intent"] or self.mailbox.intent_revision() != review["revision"]:
                return {"offered": False, "reason": "review_superseded"}
            now = self.now()
            if not 0 <= now - review["created_at"] <= 180:
                return {"offered": False, "reason": "review_expired"}
            if review["attempts"] >= 2 or now - review.get("last_attempt", 0) < 90:
                return {"offered": False, "reason": "awaiting_main_brain"}
            review["attempts"] += 1
            review["last_attempt"] = now
            episode = review.get("evidence", {}).get("death_episode")
            opportunity_id = "death-" + digest([review["scope"], episode["id"]])[:24] if episode else review["id"]
            review["opportunity"] = {"id": opportunity_id, "kind": review["trigger"], "offered_at": now,
                                     "expires_at": review["created_at"] + 180, "playback_verified": False}
            return {"offered": True, "review": json.loads(json.dumps(review))}

    def delivered(self, review_id, accepted):
        with self.transaction() as state:
            review = state.get("review", {})
            if review.get("id") == review_id:
                review["notification_accepted"] = review.get("notification_accepted") is True or accepted is True
                review["notification_status"] = "accepted" if accepted is True else "rejected" if accepted is False else "unknown"
                if accepted:
                    review["accepted_at"] = self.now()
                    state["submitted_at"] = self.now()

    def defer(self, review_id, accepted):
        """Complete a quiet periodic context delivery without claiming a main decision."""
        current = self.current_observation(observation(self.directory))
        if self.stopping():
            return {"is_error": True, "error": "disabled_or_stopped"}
        with self.transaction() as state:
            review = state.get("review", {})
            if not state.get("policy", {}).get("enabled"):
                return {"is_error": True, "error": "disabled_or_stopped"}
            if review.get("id") != review_id:
                return {"is_error": True, "error": "review_superseded"}
            if review.get("trigger") != "periodic_review" or review.get("evidence", {}).get("death_episode"):
                return {"is_error": True, "error": "meaningful_review_requires_decision"}
            if (not current or current["session"] != review["session"] or current["intent"] != review["intent"]
                    or current.get("urgent") or current.get("scope") != review.get("scope")
                    or current["baseline"] != review.get("baseline")
                    or current["signal"] != review["signal"] or self.mailbox.intent_revision() != review["revision"]
                    or not 0 <= self.now() - review["created_at"] <= 180):
                return {"is_error": True, "error": "review_expired_or_changed"}
            if review.get("result"):
                return review["result"]
            result = {"acknowledged": False, "dispatched": False, "verified": False,
                      "deferred": accepted is True, "context_only": True}
            if accepted is True:
                review["result"] = result
            return result

    def bind_character(self, review_id, reference, profile):
        """Static public identity after fresh inspection; no strategic effects."""
        current = self.current_observation(observation(self.directory))
        with self.transaction() as state:
            review = state.get("review", {})
            if (not current or self.stopping() or not state.get("policy", {}).get("enabled")
                    or review.get("result", {}).get("acknowledged")
                    or review.get("id") != review_id or review.get("inspected_evidence_ref") != reference
                    or current["session"] != review.get("session") or current["scope"] != review.get("scope")
                    or current["baseline"] != review.get("baseline") or current["intent"] != review.get("intent")
                    or self.mailbox.intent_revision() != review.get("revision")
                    or not 0 <= self.now() - review.get("inspected_at", 0) <= 30):
                return {"available": False, "reason": "inspection_superseded"}
            context = HostContextPort(self.directory, now=self.now)
            if not profile:
                context.clear_static()
                return {"available": False, "reason": "public_profile_unavailable"}
            return context.publish_static(profile, scope=current["scope"])

    def decide(self, review_id, decision, reason="", goal="", *, lineage_offset=None, host_context=None,
               death_reflection=None, before_dispatch=None, require_inspection=False, compact=False,
               evidence_ref=None, detail_path=None, detail_offset=0):
        if evidence_ref is not None:
            if decision != "inspect" or host_context is not None or death_reflection is not None or before_dispatch is not None:
                return {"is_error": True, "error": "detail_is_read_only"}
            if self.stopping():
                return {"is_error": True, "error": "disabled_or_stopped"}
            return review_evidence.detail(self.directory, review_id, evidence_ref, detail_path, detail_offset)
        if detail_path is not None or detail_offset != 0:
            return {"is_error": True, "error": "evidence_reference_required"}
        if decision == "inspect" and (death_reflection is not None or before_dispatch is not None):
            return {"is_error": True, "error": "inspect_is_read_only"}
        if host_context is not None:
            try:
                host_context = validate_host_context(host_context)
            except ValueError as error:
                return {"is_error": True, "error": str(error)}
            if decision == "inspect":
                return {"is_error": True, "error": "inspect_is_read_only"}
        if decision not in {"inspect", "continue", "insert", "revise"} or not all(isinstance(v, str) for v in (review_id, reason, goal)):
            return {"is_error": True, "error": "invalid_review"}
        if lineage_offset is not None and (decision != "inspect" or type(lineage_offset) is not int or lineage_offset < 0):
            return {"is_error": True, "error": "invalid_lineage_offset"}
        if len(reason) > 600 or len(goal) > 2000 or (decision != "inspect" and not reason.strip()) or (decision in {"insert", "revise"} and not goal.strip()):
            return {"is_error": True, "error": "reason_and_stage_goal_required"}
        snapshot = observation(self.directory)
        current = self.current_observation(snapshot)
        choice = {"decision": decision, "reason": reason.strip(), "goal": goal.strip()}
        with self.transaction() as state:
            self.reconcile(state)
            review = state.get("review", {})
            if not state.get("policy", {}).get("enabled") or self.stopping():
                return {"is_error": True, "error": "disabled_or_stopped"}
            if review.get("id") != review_id:
                return {"is_error": True, "error": "review_superseded"}
            compare = ("decision", "goal") if review.get("recovered") else ("decision", "goal", "reason")
            if review.get("choice") and any(review["choice"][key] != choice[key] for key in compare) and decision != "inspect":
                return {"is_error": True, "error": "review_choice_conflict"}
            episode = review.get("evidence", {}).get("death_episode")
            legacy_pending = bool(review.get("result", {}).get("acknowledged") and episode
                                  and not review.get("reflection")
                                  and review.get("result", {}).get("reflection_pending", True))
            if review.get("result") and not legacy_pending:
                return review["result"]
            if (not current or current["session"] != review["session"]
                    or (not legacy_pending and not 0 <= self.now() - review["created_at"] <= 180)):
                return {"is_error": True, "error": "review_expired_or_game_unavailable"}
            if episode and (current["scope"] != review.get("scope") or current["scope"] != scope_key(episode["scope"])
                    or current["evidence"].get("death_episode", {}).get("id", episode["id"]) != episode["id"]
                    or current["evidence"]["body_baseline"]["lifecycle"].get("episodeId") not in {None, episode["id"]}):
                return {"is_error": True, "error": "death_episode_superseded",
                        "next": "Inspect the current heartbeat and death episode; historical recovery decisions cannot be replayed."}
            if episode:
                recorded, newest = self.death_record(episode)
                if recorded is None or newest != episode["id"]:
                    return {"is_error": True, "error": "death_episode_superseded",
                            "next": "Use the current scoped episode; this historical or missing death cannot complete the current review."}
                if recorded.get("reflection") or recorded.get("lesson"):
                    if not legacy_pending:
                        if death_reflection is not None:
                            return {"is_error": True, "error": "death_reflection_already_completed",
                                    "next": "This scoped episode is already complete. Inspect and decide normally without replacing its historical reflection."}
                        review["evidence"].pop("death_episode", None)
                        review["evidence"].pop("death_recovery", None)
                        episode = None
                    elif not recorded.get("reflection") and death_reflection is not None:
                        return {"is_error": True, "error": "death_reflection_already_completed",
                                "next": "The saved historical planner lesson is complete; do not replace it with a new death reflection."}
            if (decision != "inspect" and episode and not (recorded.get("reflection") or recorded.get("lesson"))
                    and recorded.get("combat_observations", []) != review.get("inspected_combat_observations", [])):
                return {"is_error": True, "error": "fresh_recovery_inspection_required",
                        "next": "Inspect this same heartbeat again; later native combat evidence was attached to this death."}
            if decision != "inspect" and current["baseline"] != review.get("baseline"):
                return {"is_error": True, "error": "critical_baseline_changed",
                        "next": "Inspect this heartbeat again before deciding: death/respawn, scope, body restrictions or unknown outcomes changed. Earlier body evidence is historical."}
            previous = self.mailbox.get(state.get("last_request_id", ""))
            historical = current["evidence"].get("historical_goal") or {}
            reassessable = bool(previous and previous["delivery"] == "needs_reassessment"
                and previous["request_id"] == historical.get("id")
                and (self.mailbox.current_user_goal(historical.get("id")) or {}).get("id")
                    == (self.mailbox.current_user_goal(current["evidence"]["current_goal"].get("id")) or {}).get("id"))
            can_revise = reassessable or bool(previous and previous["delivery"] == "planning"
                and previous["request_id"] == current["evidence"]["current_goal"].get("id"))
            stage = {"request_id": previous["request_id"], "delivery": previous["delivery"], "can_revise": can_revise} if previous else None
            if decision == "inspect":
                if lineage_offset is not None:
                    chain = self.mailbox.goal_lineage(historical.get("id") or current["evidence"]["current_goal"].get("id"))
                    end = min(len(chain), lineage_offset + 4)
                    return {"heartbeat_id": review_id, "goal_lineage": chain[lineage_offset:end],
                            "next_offset": end, "has_more": end < len(chain)}
                fresh = current["evidence"]
                fresh["current_user_goal"] = self.mailbox.current_user_goal(fresh["current_goal"].get("id"))
                if projects := review_projects.view(state, current, self.now()):
                    fresh["project_observations"] = projects
                if candidate := fresh.get("death_episode"):
                    saved, _ = self.death_record(candidate)
                    if saved and (saved.get("reflection") or saved.get("lesson")):
                        fresh.pop("death_episode", None)
                        fresh.pop("death_recovery", None)
                if review.get("scope") == current["scope"] and episode:
                    fresh.setdefault("death_episode", episode)  # Explicit historical event, not current inventory.
                    fresh["death_recovery"] = recovery_context(episode, snapshot.get("observation", snapshot).get("facts", {}), fresh["current_goal"])
                if not legacy_pending and (current["intent"] != review["intent"] or self.mailbox.intent_revision() != review["revision"]):
                    return {"is_error": True, "error": "intent_or_scope_changed"}
                review.update(evidence=fresh, scope=current["scope"], baseline=current["baseline"], inspected_at=self.now())
                reference = review_evidence.save(self.directory, review,
                    self.mailbox.goal_lineage(historical.get("id") or fresh["current_goal"].get("id")), state.get("last_decision"))
                review["inspected_evidence_ref"] = reference
                review["inspected_combat_observations"] = (fresh.get("death_episode") or {}).get("combat_observations", [])
                if legacy_pending:
                    review["reflection_inspected_at"] = self.now()
                result = {"heartbeat_id": review_id, **review["evidence"], "stage_delivery": stage,
                        "legacy_reflection_completion": {"choice": review["choice"], "receipt": review["result"],
                            "reflection_already_saved": bool(recorded.get("reflection") or recorded.get("lesson")),
                            "next": "Resubmit this original choice to complete only this episode. Include death_reflection only if no reflection/lesson is already saved. Goal, speech and context will not be replayed."} if legacy_pending else None,
                        "next": "Submit the minimal final transaction in completion_contract now. Use original evidence queries if needed; never invent a lesson.",
                        "goal_authority": "current_user_goal is explicitly user-sourced. host_review is a proposed stage subordinate to current user intent and the standing goal; unknown origin is not user authorization. last_decision is prior model judgment, not fresh world evidence. Query inspect with lineage_offset=0 for full original parent goals, four per page.",
                        "last_decision": state.get("last_decision")}
                if compact:
                    result = {"heartbeat_id": review_id, **review_evidence.compact(fresh, reference, state.get("last_decision")),
                        "stage_delivery": stage, "acknowledged": False,
                        "legacy_reflection_completion": result["legacy_reflection_completion"],
                        "goal_authority": "User goal and standing goal govern; host_review is your subordinate stage. Planning is delivery, not actual work. Details include original goal_lineage.",
                        "next": "Submit the minimal final transaction in completion_contract now. Use original evidence queries if needed; never invent a lesson."}
                else:
                    result["evidence_ref"] = reference
                result["completion_contract"] = review_evidence.completion_contract(
                    review_id, reference, pending_death=bool(fresh.get("death_episode")),
                    legacy=result["legacy_reflection_completion"])
                # Put the atomic completion requirements before optional detail.
                # Small host output budgets otherwise repeatedly truncate the
                # final recovery call while the native body keeps querying.
                return {"heartbeat_id": review_id, "completion_contract": result["completion_contract"], **result}
            if require_inspection and not review.get("inspected_at"):
                return {"is_error": True, "error": "fresh_inspection_required"}
            if isinstance(death_reflection, dict) and "evidence_ref" in death_reflection:
                reference = death_reflection["evidence_ref"]
                if (not episode or not isinstance(reference, str) or not re.fullmatch(r"[0-9a-f]{24}", reference)
                        or not review.get("inspected_at") or reference != review.get("inspected_evidence_ref")):
                    return {"is_error": True, "error": "death_evidence_reference_mismatch"}
                death_reflection = {key: value for key, value in death_reflection.items() if key != "evidence_ref"}
                if death_reflection.get("episode_id", episode["id"]) != episode["id"]:
                    return {"is_error": True, "error": "death_episode_mismatch"}
                death_reflection["episode_id"] = episode["id"]
                if death_reflection.get("outcome") == "lesson":
                    death_reflection["evidence"] = death_reflection.get("evidence") or ("Inspected episode " + episode["id"] + "; evidence_ref=" + reference)
            reflection = None
            saved_completion = bool(legacy_pending and (recorded.get("reflection") or recorded.get("lesson")))
            if episode and death_reflection is None and not saved_completion:
                if reference := review.get("inspected_evidence_ref"):
                    return {"is_error": True, "error": "death_reflection_required",
                        "completion_contract": review_evidence.completion_contract(review_id, reference, pending_death=True),
                        "next": "Retry this same choice using the same inspection and its bound death_reflection contract. "
                            "No delivery, speech or acknowledgement occurred. Inspect again only if freshness or baseline validation requires it."}
                return {"is_error": True, "error": "death_reflection_required",
                        "next": "Inspect this heartbeat, then include death_reflection with episode_id and either lesson/applicability/evidence referencing the episode or source run, or outcome=deferred with an honest reason. Retry this same choice; this call has no delivery or acknowledgement effects."}
            if saved_completion and death_reflection is None:
                inspected = review.get("reflection_inspected_at")
                if inspected is None or not 0 <= self.now() - inspected <= 180:
                    return {"is_error": True, "error": "fresh_recovery_inspection_required"}
            if death_reflection is not None:
                try:
                    reflection = DeathMemory.validate_reflection(death_reflection, review["evidence"].get("death_episode"))
                except ValueError as error:
                    return {"is_error": True, "error": str(error)}
                inspected = review.get("reflection_inspected_at") if legacy_pending else review.get("inspected_at")
                if inspected is None or not 0 <= self.now() - inspected <= 180:
                    return {"is_error": True, "error": "fresh_recovery_inspection_required",
                            "next": "Inspect this heartbeat again, then submit a lesson or justified deferral."}
                if reflection["outcome"] == "lesson":
                    recovery = recovery_context(review["evidence"]["death_episode"], snapshot.get("observation", snapshot).get("facts", {})).get("current", {})
                    if (not review.get("inspected_at") or current["evidence"]["body_baseline"]["lifecycle"].get("phase") != "alive"
                            or recovery.get("inventorySynced") is not True or not recovery.get("position")):
                        return {"is_error": True, "error": "fresh_recovery_inspection_required"}
            if legacy_pending:
                # Complete only the already acknowledged episode. The original
                # decision, delivery and speech receipts are immutable here.
                if stored_reflection := recorded.get("reflection") or reflection:
                    review["reflection"] = stored_reflection
                review["reflection_completion"] = recorded.get("reflection_completion") or {
                    "id": str(uuid.uuid5(uuid.NAMESPACE_URL, review["scope"] + ":" + episode["id"])),
                    "episode_id": episode["id"], "scope": episode["scope"], "at": self.now(),
                }
                review["result"].update(reflection_pending=False, reflection_completion=review["reflection_completion"])
                state.pop("retry_after", None)
                return review["result"]
            if decision == "continue" and goal.strip():
                return {"is_error": True, "error": "continue_cannot_deliver_new_goal",
                        "acknowledged": False, "dispatched": False, "verified": False,
                        "stage_delivery": stage,
                        "next": "continue preserves the existing plan and does not deliver goal. "
                            "Omit goal to keep that plan, or explicitly choose insert/revise to deliver "
                            "a corrective stage; revise requires stage_delivery.can_revise. "
                            "No choice, speech or new goal was committed."}
            request_id = self.request_id(review_id)
            existing = self.mailbox.get(request_id)
            if not existing and (self.mailbox.intent_revision() != review["revision"] or current["intent"] != review["intent"]):
                return {"is_error": True, "error": "intent_revision_changed"}
            revalidate = decision == "continue" and reassessable
            if (decision in {"insert", "revise"} or revalidate) and not existing:
                if current["evidence"]["phase"] != "running" or not current["evidence"]["connected"]:
                    return {"is_error": True, "error": "game_not_running"}
                if decision == "revise" and not can_revise:
                    return {"is_error": True, "error": "no_active_review_stage"}
                if decision == "insert" and previous and previous["delivery"] in {"queued", "dispatching", "planning", "paused"}:
                    return {"is_error": True, "error": "previous_intent_pending", "request_id": previous["request_id"],
                            "stage_delivery": stage, "next": "Use revise to adjust your delivered active stage; queued/paused stages must wait. Explicit user feedback uses the regular intent mailbox."}
                if not revalidate and goal.strip() == (current["evidence"]["current_goal"].get("goal") or current["evidence"]["standing_goal"]):
                    return {"is_error": True, "error": "goal_already_active"}
            result = {"acknowledged": True, "dispatched": False, "decision": decision, "verified": False,
                      "reply": "已记录主脑判断，未新增任务。"}
            if before_dispatch is not None:
                try:
                    result["speech"] = before_dispatch({"review_id": review_id, "decision_id": request_id,
                        "session": review["session"], "scope": review["scope"], "revision": review["revision"], "baseline": review["baseline"],
                        "expires_at": review["created_at"] + 180, "opportunity_id": review.get("opportunity", {}).get("id", review_id)})
                except Exception:
                    result["speech"] = {"status": "enqueue_failed", "playback_verified": False}
            if decision in {"insert", "revise"} or revalidate:
                try:
                    facts = snapshot.get("observation", snapshot).get("facts", {})
                    latest = next(iter(DeathMemory(self.directory).entries(snapshot.get("observation", snapshot).get("game_identity"))), None)
                    payload = {"goal": historical["goal"] if revalidate else goal.strip(), "mode": "insert", "origin": "host_review",
                               "stage_baseline": body_baseline(facts, latest), "review_decision": decision}
                    if parent := current["evidence"]["current_goal"].get("id"):
                        payload["parent_id"] = parent
                    if decision == "revise" or revalidate:
                        payload["revision_of"] = previous["request_id"]
                        if reassessable:
                            payload["parent_id"] = previous["request_id"]
                    receipt = self.mailbox.submit("feedback", payload, request_id,
                                                  expected_revision=review["revision"])
                except ValueError as error:
                    return {"is_error": True, "error": str(error)}
                state["last_request_id"] = request_id
                result.update(dispatched=True, request_id=request_id, delivery=receipt["delivery"],
                              reply=("阶段目标修订已投递，保留现有身体动作与先前用户目标；尚未证明完成。" if decision == "revise" else
                                     "阶段目标已投递，原生队列在安全检查点插入；尚未证明完成。"))
            if reflection:
                review["reflection"] = reflection
            result["reflection_pending"] = bool(review["evidence"].get("death_episode") and not reflection)
            review.update(choice=choice, result=result)
            if result["reflection_pending"]:
                state["retry_after"] = self.now() + 300
            if host_context is not None:
                try:
                    result["host_context"] = HostContextPort(self.directory, now=self.now).publish(
                        host_context, session=review["session"], revision=self.mailbox.intent_revision())
                except OSError:
                    result["host_context"] = {"available": False, "reason": "host_context_write_failed"}
            state["last_decision"] = {**choice, "at": self.now(), "heartbeat_id": review_id, "request_id": result.get("request_id")}
            return result


