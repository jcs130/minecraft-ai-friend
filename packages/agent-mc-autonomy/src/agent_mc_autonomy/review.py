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
from .mailbox import Mailbox, observation
from .observations import body_feedback, feedback_signal, fact_preview, spatial_text, tool_failure_view
from .death_memory import DeathMemory, lifecycle, scope_key, recovery_context


@dataclass(frozen=True)
class ReviewPolicy:
    enabled: bool = False
    min_interval_seconds: int = 60
    review_interval_seconds: int = 180

    @classmethod
    def parse(cls, raw):
        minimum = _integer(raw, "min_interval_seconds", 60, 30, 900)
        return cls(_boolean(raw, "enabled", False), minimum,
                   _integer(raw, "review_interval_seconds", 180, minimum, 1800))


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
        ("clock", 80), ("queue", 350), ("structure", 300), ("terrain", 250), ("bodyRestriction", 400))}
    useful["lastTask"] = fact_preview(spatial_text(facts.get("lastTask", "")), 1000)
    reads = snapshot.get("read_activity") or {}
    reads = {key: min(999, reads[key]) for key in (
        "mc_help", "mc_scout", "mc_protocol", "mc_bag", "mc_queue", "mc_blocked", "mc_tool_help", "mc_original",
        "mc_knowledge")
        if isinstance(reads, dict) and type(reads.get(key)) is int and reads[key] > 0}
    feedback = body_feedback(snapshot, facts)
    # Raw facts remain in the independent journal/status API; no accumulating prompt history here.
    evidence = {"sampled_at": snapshot["updated_at"], "phase": snapshot["phase"], "connected": snapshot.get("game_connected") is True,
                "standing_goal": str(snapshot.get("standing_goal", ""))[:600],
                "current_goal": {**{key: active.get(key) for key in ("id", "goal", "mode", "parent_id")},
                                 "origin": active.get("origin", "unknown")}, "pending": pending,
                "facts": useful, "body_events": feedback["body_events"], "native_outcomes": feedback["native_outcomes"],
                "fact_originals": {part["key"]: part["original"] for part in snapshot.get("facts", {}).get("parts", [])
                                   if part.get("key") in useful and part.get("original")},
                "planner_error": snapshot.get("planner_error"),
                "tool_failure": tool_failure_view(snapshot.get("tool_failure")),
                "planner_failures": snapshot.get("planner_failures", 0), "runtime_error": snapshot.get("error"), "read_activity": reads,
                "unactioned_replies": snapshot.get("unactioned_replies", 0),
                "planner_retry_seconds": snapshot.get("planner_retry_seconds", 0)}
    # Clocks, sight direction, repeated observation task IDs and positional chatter are not urgent changes.
    material = {key: useful[key] for key in ("body", "gear", "foodReserve")}
    terminal = useful["lastTask"]
    if re.search(r'"skill"\s*:\s*"observe"', facts.get("lastTask", "")) and "完成" in facts.get("lastTask", ""):
        terminal = ""  # Repeated successful look-only tasks are not new survival progress.
    episode = snapshot.get("death_episode")
    if (isinstance(episode, dict) and scope_key(episode.get("scope"))
            and episode.get("scope") == snapshot.get("game_identity") and isinstance(episode.get("source_event"), dict)):
        evidence["death_episode"] = episode
        evidence["death_recovery"] = recovery_context(episode, snapshot.get("facts", {}), evidence["current_goal"])
    life = lifecycle(snapshot.get("facts", {}))
    life = life if isinstance(life, dict) else {}
    # Stable safety boundary, excluding movement, clock, inventory and ordinary
    # task progress. Keep it separate from evidence refreshed during delivery.
    evidence["body_baseline"] = {
        "scope": scope_key(snapshot.get("game_identity")),
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
    readings = "；".join(brief(facts[key], size) for key, size in (
        ("body", 120), ("foodReserve", 120), ("gear", 420), ("queue", 150)))
    # A 70-byte inventory preview hid already-owned tools from the main brain.
    # Bounded evidence still fits in one short review, without a summary model.
    unchanged = evidence.get("material_unchanged_seconds", 0)
    activity = f"；生命/物资读数连续{unchanged}秒未变"
    reads = sum(evidence.get("read_activity", {}).values())
    if reads:
        activity += f"；连续查询{reads}次（查询不代表行动进展）"
    if failure := evidence.get("tool_failure"):
        activity += "；最近未解工具错误:" + failure["tool"] + " " + brief(failure["error"], 210)
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
        decision = "revise" if payload.get("revision_of") else "insert"
        choice = {"decision": decision, "goal": payload["goal"], "reason": "recovered_mailbox_receipt"}
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
                if (episode and (review.get("notification_accepted") or review.get("result", {}).get("acknowledged"))
                        and db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='death_episodes'").fetchone()):
                    db.execute("UPDATE death_episodes SET notified=1 WHERE scope=? AND id=?",
                               (scope_key(episode["scope"]), episode["id"]))
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
        observed = review_observation(snapshot, now)
        if not observed or self.stopping():
            return
        observed["evidence"]["current_user_goal"] = self.mailbox.current_user_goal(observed["evidence"]["current_goal"].get("id"))
        if episode := observed["evidence"].get("death_episode"):
            if not any(row["id"] == episode["id"] for row in DeathMemory(self.directory).entries(episode["scope"], pending=True)):
                observed["evidence"].pop("death_episode")
                if observed["urgent"] == "death:" + str(episode["id"]):
                    observed["urgent"] = None
        with self.transaction() as state:
            self.reconcile(state)
            policy = ReviewPolicy.parse(state.get("policy", {}))
            if not policy.enabled:
                return
            previous = state.get("review", {})
            episode_id = observed["evidence"].get("death_episode", {}).get("id")
            if (previous.get("notification_accepted") and episode_id
                    and episode_id == previous.get("evidence", {}).get("death_episode", {}).get("id")):
                observed["evidence"].pop("death_episode", None)
                if observed["urgent"] == "death:" + str(episode_id):
                    observed["urgent"] = None
            revision = self.mailbox.intent_revision()
            same_session = previous.get("session") == observed["session"]
            same_intent = previous.get("revision") == revision and previous.get("intent") == observed["intent"]
            urgent = bool(observed["urgent"] and observed["urgent"] != previous.get("urgent"))
            if state.get("material") != observed["material"] or not same_session:
                state.update(material=observed["material"], material_since=now)
            observed["evidence"]["material_unchanged_seconds"] = int(now - state.get("material_since", now))
            if now < state.get("retry_after", 0) and not urgent and same_session and same_intent:
                return
            pending = previous and not previous.get("result") and same_session and same_intent and not urgent
            if pending:
                if now - previous["created_at"] > 180:
                    previous["result"] = {"acknowledged": False, "error": "main_brain_not_acknowledged"}
                    state["retry_after"] = now + 300
                else:
                    if previous.get("notification_accepted") and previous.get("evidence", {}).get("death_episode"):
                        observed["evidence"]["death_episode"] = previous["evidence"]["death_episode"]
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
            if not urgent and (elapsed < policy.min_interval_seconds or (not changed and elapsed < policy.review_interval_seconds)):
                return
            state.update(created_at=now, review={**observed, "id": uuid.uuid4().hex[:12], "created_at": now,
                         "revision": revision, "attempts": 0, "summary": summary(observed["evidence"]),
                         "trigger": "death_review" if observed["evidence"].get("death_episode") else "state_changed" if urgent or changed else "periodic_review"})

    def offer(self):
        """Claim one bounded delivery attempt; does not manufacture a game event."""
        current = review_observation(observation(self.directory), self.now())
        if not current or self.stopping():
            return {"offered": False, "reason": "no_fresh_running_observation"}
        with self.transaction() as state:
            self.reconcile(state)
            review = state.get("review", {})
            if not state.get("policy", {}).get("enabled") or not review or review.get("result"):
                return {"offered": False, "reason": "no_pending_review"}
            if review.get("evidence", {}).get("death_episode") and review.get("notification_accepted"):
                return {"offered": False, "reason": "death_episode_already_delivered"}
            if current["session"] != review["session"] or current["intent"] != review["intent"] or self.mailbox.intent_revision() != review["revision"]:
                return {"offered": False, "reason": "review_superseded"}
            now = self.now()
            if not 0 <= now - review["created_at"] <= 180:
                return {"offered": False, "reason": "review_expired"}
            if review["attempts"] >= 2 or now - review.get("last_attempt", 0) < 90:
                return {"offered": False, "reason": "awaiting_main_brain"}
            review["attempts"] += 1
            review["last_attempt"] = now
            return {"offered": True, "review": json.loads(json.dumps(review))}

    def delivered(self, review_id, accepted):
        with self.transaction() as state:
            review = state.get("review", {})
            if review.get("id") == review_id:
                review["notification_accepted"] = review.get("notification_accepted") is True or accepted is True
                if accepted:
                    state["submitted_at"] = self.now()

    def defer(self, review_id, accepted):
        """Complete a quiet periodic context delivery without claiming a main decision."""
        current = review_observation(observation(self.directory), self.now())
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

    def decide(self, review_id, decision, reason="", goal="", *, lineage_offset=None, host_context=None):
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
        current = review_observation(snapshot, self.now())
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
            if review.get("result"):
                return review["result"]
            if not current or current["session"] != review["session"] or not 0 <= self.now() - review["created_at"] <= 180:
                return {"is_error": True, "error": "review_expired_or_game_unavailable"}
            if decision != "inspect" and current["baseline"] != review.get("baseline"):
                return {"is_error": True, "error": "critical_baseline_changed",
                        "next": "Inspect this heartbeat again before deciding: death/respawn, scope, body restrictions or unknown outcomes changed. Earlier body evidence is historical."}
            previous = self.mailbox.get(state.get("last_request_id", ""))
            can_revise = bool(previous and previous["delivery"] == "planning"
                and previous["request_id"] == current["evidence"]["current_goal"].get("id"))
            stage = {"request_id": previous["request_id"], "delivery": previous["delivery"], "can_revise": can_revise} if previous else None
            if decision == "inspect":
                if lineage_offset is not None:
                    chain = self.mailbox.goal_lineage(current["evidence"]["current_goal"].get("id"))
                    end = min(len(chain), lineage_offset + 4)
                    return {"heartbeat_id": review_id, "goal_lineage": chain[lineage_offset:end],
                            "next_offset": end, "has_more": end < len(chain)}
                fresh = current["evidence"]
                fresh["current_user_goal"] = self.mailbox.current_user_goal(fresh["current_goal"].get("id"))
                if review.get("scope") == current["scope"] and (episode := review["evidence"].get("death_episode")):
                    fresh.setdefault("death_episode", episode)  # Explicit historical event, not current inventory.
                    fresh["death_recovery"] = recovery_context(episode, snapshot.get("observation", snapshot).get("facts", {}), fresh["current_goal"])
                review.update(evidence=fresh, baseline=current["baseline"])
                return {"heartbeat_id": review_id, **review["evidence"], "stage_delivery": stage,
                        "next": "Planning means the stage is delivered, not that native work is running. Use the actual queue. Continue useful work; revise your active stage when evidence warrants a changed strategy; insert a new stage when none is pending. Keep stages within the standing goal and user intent; server-specific quests, exams or capabilities need fresh evidence from this world, not unrelated conversation memories.",
                        "goal_authority": "current_user_goal is explicitly user-sourced. host_review is a proposed stage subordinate to current user intent and the standing goal; unknown origin is not user authorization. last_decision is prior model judgment, not fresh world evidence. Query inspect with lineage_offset=0 for full original parent goals, four per page.",
                        "last_decision": state.get("last_decision")}
            request_id = self.request_id(review_id)
            existing = self.mailbox.get(request_id)
            if not existing and (self.mailbox.intent_revision() != review["revision"] or current["intent"] != review["intent"]):
                return {"is_error": True, "error": "intent_revision_changed"}
            if decision in {"insert", "revise"} and not existing:
                if current["evidence"]["phase"] != "running" or not current["evidence"]["connected"]:
                    return {"is_error": True, "error": "game_not_running"}
                if decision == "revise" and not can_revise:
                    return {"is_error": True, "error": "no_active_review_stage"}
                if decision == "insert" and previous and previous["delivery"] in {"queued", "dispatching", "planning", "paused"}:
                    return {"is_error": True, "error": "previous_intent_pending", "request_id": previous["request_id"],
                            "stage_delivery": stage, "next": "Use revise to adjust your delivered active stage; queued/paused stages must wait. Explicit user feedback uses the regular intent mailbox."}
                if goal.strip() == (current["evidence"]["current_goal"].get("goal") or current["evidence"]["standing_goal"]):
                    return {"is_error": True, "error": "goal_already_active"}
            result = {"acknowledged": True, "dispatched": False, "decision": decision, "verified": False,
                      "reply": "已记录主脑判断，未新增任务。"}
            if decision in {"insert", "revise"}:
                try:
                    payload = {"goal": goal.strip(), "mode": "insert", "origin": "host_review"}
                    if parent := current["evidence"]["current_goal"].get("id"):
                        payload["parent_id"] = parent
                    if decision == "revise":
                        payload["revision_of"] = previous["request_id"]
                    receipt = self.mailbox.submit("feedback", payload, request_id,
                                                  expected_revision=review["revision"])
                except ValueError as error:
                    return {"is_error": True, "error": str(error)}
                state["last_request_id"] = request_id
                result.update(dispatched=True, request_id=request_id, delivery=receipt["delivery"],
                              reply=("阶段目标修订已投递，保留现有身体动作与先前用户目标；尚未证明完成。" if decision == "revise" else
                                     "阶段目标已投递，原生队列在安全检查点插入；尚未证明完成。"))
            review.update(choice=choice, result=result)
            if host_context is not None:
                try:
                    result["host_context"] = HostContextPort(self.directory, now=self.now).publish(
                        host_context, session=review["session"], revision=self.mailbox.intent_revision())
                except OSError:
                    result["host_context"] = {"available": False, "reason": "host_context_write_failed"}
            state["last_decision"] = {**choice, "at": self.now(), "heartbeat_id": review_id, "request_id": result.get("request_id")}
            return result


