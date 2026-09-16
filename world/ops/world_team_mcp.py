"""Qwen-owned stdio project collaboration tools, with identity bound at startup."""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
from world_team import members, TeamStore

COMMON_TOOLS = ('team_roster', 'team_context', 'team_cases', 'team_case', 'team_report', 'team_update',
                'team_request_help', 'team_help_status')


def _plain(value):
    return value if value is None or isinstance(value, (str, bool, int)) else None


def unhealthy_service_evidence(sections):
    """Names plus raw state/health/ready fields for services a health record marks not ok.

    Container state, health-check semantics and panel readiness fail independently
    (case-3a152890: one record showed qwenpaw unhealthy while dialogue stayed usable).
    Returning the raw fields lets each role judge a divergence from the record itself.
    """
    health = sections.get('health') if isinstance(sections.get('health'), dict) else {}
    data = health.get('data') if isinstance(health.get('data'), dict) else {}
    rows = data.get('services') if isinstance(data.get('services'), dict) else {}
    unhealthy = sorted(name for name, svc in rows.items()
                       if isinstance(svc, dict) and svc.get('ok') is False)
    operations = sections.get('operations') if isinstance(sections.get('operations'), dict) else {}
    ops_data = operations.get('data') if isinstance(operations.get('data'), dict) else {}
    ops_rows = ops_data.get('services')
    readiness = {row.get('id'): row for row in ops_rows
                 if isinstance(row, dict) and isinstance(row.get('id'), str)
                } if isinstance(ops_rows, list) else {}
    evidence = []
    for name in unhealthy:
        svc = rows.get(name)
        svc = svc if isinstance(svc, dict) else {}
        evidence.append({'name': name, 'state': _plain(svc.get('state')),
                         'health': _plain(svc.get('health')),
                         'ready': _plain(readiness.get(name, {}).get('ready'))})
    return unhealthy, evidence


def survivor_controller_evidence(snapshot):
    """Plain survivor controller fields from a survivor section, or None when the channel is absent.

    The health inspection record measures the survivor container healthcheck while the controller
    self-report (/public/survivor.json, read by survivor_snapshot and adapted by survivor_section)
    describes its body and reconnect state. case-7772e059: an exited/unhealthy container verdict sat
    beside a controller that restored online with restored_identity_verified and the pairing had to be
    hand-copied. Any dict section yields evidence so an expired or unreadable controller record still
    records fresh=false during an unhealthy window; None is reserved for an absent channel. Publishing
    survivor.json as an OperationsTools snapshot section remains a parked, coverage-gated candidate.
    """
    section = snapshot.get('survivor') if isinstance(snapshot, dict) else None
    if not isinstance(section, dict):
        return None
    data = section.get('data') if isinstance(section.get('data'), dict) else {}

    def pick(key):
        value = data.get(key)
        return value if value is None or isinstance(value, (str, bool, int)) else None

    return {'fresh': section.get('fresh') is True, 'status': pick('status'),
            'bodyOnline': pick('bodyOnline'), 'reconnectStatus': pick('reconnectStatus'),
            'reconnectReason': pick('reconnectReason')}


def npc_llm_enabled(sections):
    """Raw npc llmEnabled flag from the world record, or None when absent or malformed.

    compose.yml ships NPC_LLM_ENABLED="0" for the npc sidecar. case-761672 burned many
    shifts re-diagnosing that explicit setting as a live model-service outage while every
    npc thread stayed ok, so team_context surfaces the flag together with the
    configuration-versus-fault distinction instead of leaving it buried in raw data.
    """
    world = sections.get('world') if isinstance(sections.get('world'), dict) else {}
    data = world.get('data') if isinstance(world.get('data'), dict) else {}
    npc = data.get('npc') if isinstance(data.get('npc'), dict) else {}
    enabled = npc.get('llmEnabled')
    return enabled if isinstance(enabled, bool) else None


def npc_health_subchecks(sections):
    """Raw npc healthcheck inputs from the world record, or None when the record has none.

    The npc container healthcheck (tools/npc_health.py) gates on more than thread
    liveness: rcon activity, spell and guild-request polling, and the guild NPC
    identity evidence all count toward the verdict. case-874c6b4133a5affd763b: a
    running-but-unhealthy verdict sat beside a 15-thread all-ok projection with no
    snapshot field naming the failing sub-check, so the projected timestamps and
    the guild identity summary are surfaced verbatim for exactly that divergence.
    """
    world = sections.get('world') if isinstance(sections.get('world'), dict) else {}
    data = world.get('data') if isinstance(world.get('data'), dict) else {}
    npc = data.get('npc') if isinstance(data.get('npc'), dict) else {}
    guild = npc.get('guildNpcs') if isinstance(npc.get('guildNpcs'), dict) else {}
    rows = guild.get('required') if isinstance(guild.get('required'), list) else []
    view = {'rconLastOkAt': _plain(npc.get('rconLastOkAt')),
            'spellLastPollAt': _plain(npc.get('spellLastPollAt')),
            'guildRequestsLastPollAt': _plain(npc.get('guildRequestsLastPollAt')),
            'guildNpcsOk': guild.get('ok') if isinstance(guild.get('ok'), bool) else None,
            'guildNpcsCheckedAt': _plain(guild.get('checkedAt')),
            'guildNpcsStates': {row.get('key'): _plain(row.get('state')) for row in rows
                                if isinstance(row, dict) and isinstance(row.get('key'), str)}}
    scalars = [value for key, value in view.items() if key != 'guildNpcsStates']
    if not view['guildNpcsStates'] and all(value is None for value in scalars):
        return None
    return view


def players_roster_view(sections):
    """The world record's players registry crossed with its own observation, or None.

    case-08e101df69170a7ece6d: the world snapshot's players array is a known-player
    registry (level, mana, skill counts), and it kept listing Kirito after the body was
    lost while native rcon showed only Goddess online; that misread drove a rescue
    attempt the live world correctly rejected. The registry is not a live online list,
    and the record's observedPlayers can lag or stay empty while players are online,
    so this view returns both name sets and both differences to keep the distinction
    readable from the record itself instead of hand-recomputed per shift.
    """
    world = sections.get('world') if isinstance(sections.get('world'), dict) else {}
    data = world.get('data') if isinstance(world.get('data'), dict) else {}
    players = data.get('players')
    if not isinstance(players, list):
        return None
    registry = sorted({row['name'] for row in players
                       if isinstance(row, dict) and isinstance(row.get('name'), str)
                       and row['name'].strip()})
    inner = data.get('world') if isinstance(data.get('world'), dict) else {}
    observed = inner.get('observedPlayers')
    online = sorted({name for name in observed if isinstance(name, str) and name.strip()}) \
        if isinstance(observed, list) else []
    return {'registryCount': len(registry), 'registry': registry, 'observedPlayers': online,
            'registryNotObserved': sorted(set(registry) - set(online)),
            'observedNotInRegistry': sorted(set(online) - set(registry))}


def _parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        marker = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return marker.replace(tzinfo=timezone.utc) if marker.tzinfo is None else marker


def _iso(moment):
    return moment.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def world_process_epoch(sections):
    """Derived world-process start time (updatedAt minus uptimeSec) from a fresh world record.

    None for stale, malformed or partial records: an expired inspection record never feeds the
    epoch history. The derivation exists because hand-recomputed epochs were misread twice
    while tracking the world-process restart pattern in case-3a152890bff3ed93af8b.
    """
    world = sections.get('world') if isinstance(sections.get('world'), dict) else {}
    if world.get('fresh') is False:
        return None
    data = world.get('data') if isinstance(world.get('data'), dict) else {}
    inner = data.get('world') if isinstance(data.get('world'), dict) else {}
    updated_at, uptime = inner.get('updatedAt'), inner.get('uptimeSec')
    marker = _parse_time(updated_at)
    if marker is None or isinstance(uptime, bool) \
            or not isinstance(uptime, (int, float)) or uptime < 0:
        return None
    return marker - timedelta(seconds=uptime)


def survivor_snapshot(public=Path('/public'), clock=time.time):
    """Read fixed public controller metadata; never include model or gameplay text."""
    source = '/public/survivor.json'
    unknown = {'ok': False, 'fresh': False, 'status': 'unknown', 'source': source}
    try:
        root = Path(public)
        path = root / 'survivor.json'
        if not root.is_absolute() or any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
                                        for p in (path, *path.parents)):
            return unknown | {'code': 'survivor_snapshot_invalid_path'}
        size_limit = 2 * 1024 * 1024
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > size_limit:
            return unknown | {'code': 'survivor_snapshot_invalid_file'}
        with path.open('rb') as handle:
            before = os.fstat(handle.fileno())
            raw = handle.read(size_limit + 1)
            after = os.fstat(handle.fileno())
        if len(raw) > size_limit or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            return unknown | {'code': 'survivor_snapshot_changed_or_oversized'}
        value = json.loads(raw.decode('utf-8-sig'))
        if not isinstance(value, dict) or value.get('schema') != 1 or value.get('project') != 'qiandengji-survivor':
            raise ValueError('invalid_schema')
        stamp = value['generatedAt']
        if not isinstance(stamp, str) or len(stamp) > 64:
            raise ValueError('invalid_timestamp')
        at = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        if at.tzinfo is None:
            raise ValueError('timestamp_without_timezone')
        age = clock() - at.timestamp()
        if not -5 <= age <= 120:
            return unknown | {'code': 'survivor_snapshot_stale', 'timestamp': stamp, 'ageSeconds': round(age, 1)}

        def metadata(row, codes=(), flags=()):
            if row is None:
                return {}
            if not isinstance(row, dict):
                raise ValueError('invalid_metadata')
            result = {}
            for key in codes:
                item = row.get(key)
                if item is None:
                    continue
                if not isinstance(item, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}', item):
                    raise ValueError('invalid_metadata_code')
                result[key] = item
            for key in flags:
                if key not in row:
                    continue
                if type(row[key]) is not bool:
                    raise ValueError('invalid_metadata_flag')
                result[key] = row[key]
            return result

        result = metadata(value, ('status', 'pauseReason', 'cancellationStatus', 'wakeReason', 'goalState'),
                          ('enabled', 'autonomous'))
        if 'status' not in result or 'enabled' not in result:
            raise ValueError('missing_controller_state')
        result['lastDecision'] = metadata(value.get('lastDecision'), ('taskId',),
            ('completed', 'nativeTaskCompleted', 'modelCompleted'))
        result['actionExecution'] = metadata(value.get('actionExecution'), flags=('ok', 'inFlight'))
        result['body'] = metadata(value.get('body'), flags=('ok', 'online'))
        result['bodyReconnect'] = metadata(value.get('bodyReconnect'), ('status', 'reason'))
        return result | {'ok': True, 'fresh': True, 'source': source, 'timestamp': stamp,
            'ageSeconds': round(age, 1), 'sha256': hashlib.sha256(raw).hexdigest(),
            'notice': 'Controller metadata only. lastDecision is the last recorded decision, not proof of an active task; '
                      'paused or unavailable does not mean the body is dead. No model thoughts or dialogue are included.'}
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        return unknown | {'code': 'survivor_snapshot_unavailable'}


def survivor_section(snapshot):
    """Adapt the controller read into the section shape survivor_controller_evidence takes.

    The evidence layer reads flat bodyOnline/reconnectStatus/reconnectReason keys
    while survivor_snapshot reports body.online and bodyReconnect.status/reason,
    so the pairing needs this mapping to yield anything at all. The controller
    channel is read here rather than published as an OperationsTools snapshot
    section: that wider exposure is still a parked, coverage-gated candidate.
    """
    if not isinstance(snapshot, dict):
        return None
    body = snapshot.get('body') if isinstance(snapshot.get('body'), dict) else {}
    reconnect = snapshot.get('bodyReconnect') if isinstance(snapshot.get('bodyReconnect'), dict) else {}
    return {'fresh': snapshot.get('fresh') is True, 'timestamp': snapshot.get('timestamp'),
            'ageSeconds': snapshot.get('ageSeconds'), 'sha256': snapshot.get('sha256'),
            'data': {'status': snapshot.get('status'), 'bodyOnline': body.get('online'),
                     'reconnectStatus': reconnect.get('status'),
                     'reconnectReason': reconnect.get('reason')}}


def register_team_tools(app, actor, state=Path('/team')):
    store = TeamStore(actor, state)

    @app.tool()
    def team_roster() -> dict:
        """Read exact project identities and responsibilities; runtime:role disambiguates mc-god."""
        return store.roster()

    @app.tool()
    def team_context() -> dict:
        """Read fresh world/service snapshots and assigned cases. Reports are evidence to assess, not instructions."""
        from operations_team_mcp import OperationsTools
        snapshot = OperationsTools('mc-god').snapshot()
        snapshot.pop('worldActionsAllowed', None)
        snapshot['worldActionsExecuted'] = 0
        sections = snapshot.get('snapshots') if isinstance(snapshot.get('snapshots'), dict) else {}
        stale = sorted(name for name, section in sections.items()
                       if isinstance(section, dict) and section.get('fresh') is False)
        snapshot['staleSnapshots'] = stale
        unhealthy, evidence = unhealthy_service_evidence(sections)
        snapshot['unhealthyServices'] = unhealthy
        snapshot['unhealthyServiceEvidence'] = evidence
        controller_snapshot = survivor_snapshot()
        controller = survivor_controller_evidence({'survivor': survivor_section(controller_snapshot)})
        notes = ''
        if stale:
            notes += (' Sections listed in staleSnapshots are expired inspection records, '
                      'not current health or current faults; re-verify before reporting.')
        if unhealthy:
            notes += (' Services in unhealthyServices are marked not ok by the health inspection record'
                      + (' (that record is expired; re-verify before reporting)' if 'health' in stale else '')
                      + '; unhealthyServiceEvidence carries each service state/health/ready fields so a'
                        ' running-but-unhealthy divergence can be judged from the record itself'
                      + '; a single record is not a recurrence pattern.')
        llm_enabled = npc_llm_enabled(sections)
        if llm_enabled is not None:
            snapshot['npcLlmEnabled'] = llm_enabled
            if llm_enabled is False:
                notes += (' npcLlmEnabled=false is the explicit deployment setting for the npc sidecar'
                          ' (compose NPC_LLM_ENABLED), not by itself a service fault; changing it is an'
                          ' owner configuration decision'
                          + ('; the world record carrying it is expired' if 'world' in stale else '')
                          + '.')
        subchecks = npc_health_subchecks(sections)
        if subchecks is not None:
            snapshot['npcHealthSubchecks'] = subchecks
            notes += (' npcHealthSubchecks surfaces the npc record fields the container healthcheck'
                      ' actually judges (rconLastOkAt, spellLastPollAt, guildRequestsLastPollAt and'
                      ' the guild NPC identity summary); when an unhealthy verdict sits beside all-ok'
                      " threads, compare each timestamp with the record's own npc updatedAt and read"
                      ' guildNpcsStates to name the failing sub-check instead of guessing between'
                      ' rcon, polling and guild-identity causes'
                      + ('; the world record carrying them is expired' if 'world' in stale else '')
                      + ' (case-874c6b4133a5affd763b).')
        roster = players_roster_view(sections)
        if roster is not None:
            snapshot['playersRoster'] = roster
            notes += (' playersRoster cross-checks the world record\'s players array (a known-player'
                      ' registry with level and mana) against the same record\'s observedPlayers:'
                      ' registryNotObserved lists registry names the record is not currently observing;'
                      ' the registry is not a live online list and observedPlayers can lag or stay empty,'
                      ' so online status needs a fresh rcon list receipt (case-08e101df69170a7ece6d: the'
                      ' registry kept listing Kirito while native rcon showed only Goddess online)'
                      + ('; the world record carrying it is expired' if 'world' in stale else '')
                      + '.')
        epoch = world_process_epoch(sections)
        if epoch is not None:
            world_section = sections.get('world') if isinstance(sections.get('world'), dict) else {}
            observed = _parse_time(world_section.get('timestamp')) or epoch
            history = store.record_world_epoch(epoch.timestamp(), observed.timestamp())
            snapshot['worldProcessEpoch'] = _iso(epoch)
            snapshot['worldProcessEpochs'] = [
                {**row, 'startedAt': _iso(datetime.fromtimestamp(row['startedAt'], tz=timezone.utc)),
                 'firstObserved': _iso(datetime.fromtimestamp(row['firstObserved'], tz=timezone.utc)),
                 'lastObserved': _iso(datetime.fromtimestamp(row['lastObserved'], tz=timezone.utc))}
                for row in history]
            if len(history) > 1:
                notes += (' worldProcessEpochs lists derived world-process start epochs observed through'
                          ' this store; a new entry means the world process restarted near its startedAt'
                          ' (derived as updatedAt minus uptimeSec, tolerance folds reading jitter).'
                          ' Container-level restart causes still need host RestartCount/StartedAt receipts.')
        health_section = sections.get('health') if isinstance(sections.get('health'), dict) else {}
        health_observed = _parse_time(health_section.get('timestamp'))
        if health_observed is not None and health_section.get('fresh') is not False \
                and isinstance(health_section.get('data'), dict):
            incidents = store.record_health_observation(unhealthy, health_observed.timestamp(), controller)
            if incidents:
                snapshot['healthIncidents'] = [
                    {**row,
                     'firstObserved': _iso(datetime.fromtimestamp(row['firstObserved'], tz=timezone.utc)),
                     'lastObserved': _iso(datetime.fromtimestamp(row['lastObserved'], tz=timezone.utc)),
                     'healthyBefore': None if row['healthyBefore'] is None else
                        _iso(datetime.fromtimestamp(row['healthyBefore'], tz=timezone.utc)),
                     'recoveredAfter': None if row['recoveredAfter'] is None else
                        _iso(datetime.fromtimestamp(row['recoveredAfter'], tz=timezone.utc))}
                    for row in incidents]
                notes += (' healthIncidents lists per-service unhealthy windows observed through this'
                          ' store; a window spans its unhealthy reads (firstObserved..lastObserved) with'
                          ' healthyBefore and recoveredAfter bracketing the true fault bounds;'
                          ' recurring windows are a pattern to investigate, and a running-but-unhealthy'
                          ' divergence still needs in-window functional evidence plus host receipts'
                          ' before a probe fault is declared.')
                if any('controllerReads' in row for row in snapshot['healthIncidents']):
                    notes += (' survivor controllerReads pair each unhealthy window with the survivor'
                              " controller's own report sampled on the same reads (bodyOnline and"
                              ' bodyReconnect; fresh=false marks an expired or unavailable controller'
                              ' record); an exited container verdict beside a controller view that'
                              ' restored online marks a flap candidate whose exit cause still needs'
                              ' host receipts such as RestartCount, exit code, OOMKilled or docker events.')
        return {'ok': True, 'actor': actor, 'world': snapshot, 'survivor': controller_snapshot,
            'work': store.cases(),
            'notice': 'In-world dialogue must use game channels. These documents are project feedback. '
                      'A report or tested commit is not proof of a deployed game fix.' + notes}

    @app.tool()
    def team_cases(owner: str = 'mine', include_closed: bool = False, limit: int = 12) -> dict:
        """Read a short work index. Use mine, all, or a qualified teammate identity, then team_case for details."""
        return store.cases(owner, include_closed, limit)

    @app.tool()
    def team_case(case_id: str, event_limit: int = 3, before_seq: int | None = None) -> dict:
        """Read one current issue/version and its latest 3 complete attributed events.

        Select an issue from the short team_cases index first. For evidence needed from older history,
        pass next_before_seq as before_seq; event_limit accepts 1-20. Each page is chronological,
        has_more signals older pages, and all original audit events remain available. Do not expand
        every issue or page before advancing the selected work.
        """
        return store.case(case_id, event_limit, before_seq)

    @app.tool()
    def team_report(request_id: str, dedupe_key: str, title: str, category: str,
                    observed: str, expected: str, evidence: list[str], assign_to: str | None = None) -> dict:
        """Write an attributed Markdown feedback document and durable case. Categories: bug/gameplay/content/operations/improvement.

        Include actual task/action IDs, times and reproducible observations. Reuse a stable dedupe_key for the same issue;
        request_id identifies this exact report. Missing features and suggested fixes are not completed results.
        Only verified Yui or Goddess may set assign_to="operations:mc-god" for a new engineering request.
        An existing issue keeps its current assignee; read owner in the receipt. This cannot close another role's work.
        """
        return store.report(request_id, dedupe_key, title, category, observed, expected, evidence, assign_to)

    @app.tool()
    def team_update(request_id: str, case_id: str, expected_version: int, status: str,
                    note: str, evidence: list[str], assign_to: str | None = None) -> dict:
        """Update owned work with receipts. Status: open/working/blocked/needs_review; coordinators may resolve or merge duplicates.

        Only Goddess or the project coordinator assigns work or closes a reviewed case. Code changes need testing;
        deployments and gameplay outcomes need independent receipts. On case_changed read again; do not overwrite.
        """
        return store.update(request_id, case_id, expected_version, status, note, evidence, assign_to)

    @app.tool()
    def team_request_help(case_id: str, recipient: str = 'owner') -> dict:
        """Ask the responsible operations Agent to handle an existing issue now via a native Qwen background task.

        First record real evidence with team_report. Same case version/recipient is submitted once, even after timeout.
        recipient is owner or a qualified operational actor (game:mc-god, operations:mc-god, game:qd-guild-planner).
        Does not send game dialogue or wake the reporting character on reply. Keep helpId and read status later.
        """
        from team_help import request_help
        return request_help(actor, case_id, recipient, root=state)

    @app.tool()
    def team_help_status(help_id: str) -> dict:
        """Read an existing native help task; unknown submissions are not repeated. Check the case for repair evidence."""
        from team_help import help_status
        return help_status(actor, help_id, root=state)

    from team_recruitment import MANAGERS
    if actor in MANAGERS:
        @app.tool()
        def team_recruit(profession_key: str, name: str, profession: str) -> dict:
            """Recruit a persistent professional Agent into game Qwen (18089) with its own workspace and skills.

            First inspect team_roster and reuse existing specialists. Stable profession_key is lowercase ASCII 3-36 chars.
            A repeat returns the same person; name/profession cannot silently change. No body/admin credentials inherited.
            The new member gets the current planner model route and ordinary file/learning/team tools, no new daemon.
            Temporary analysis instead uses the available native spawn_subagent tool. Creation makes no model call.
            """
            from team_recruitment import recruit
            return recruit(actor, profession_key, name, profession)
    return list(COMMON_TOOLS)


def main():
    from mcp.server.fastmcp import FastMCP
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', choices=members(), required=True)
    parser.add_argument('--native-runtime', default=None,
                        help='native host runtime declared by a migrated driver card')
    parser.add_argument('--native-role', default=None,
                        help='native host role declared by a migrated driver card')
    args = parser.parse_args()
    if (args.native_runtime is None) != (args.native_role is None):
        parser.error('--native-runtime and --native-role must be given together')
    server = FastMCP('qiandengji-project-team')
    app = server
    if args.native_runtime is not None:
        from world_team_hosts import require_host, host_tool_app
        require_host(args.actor, args.native_runtime, args.native_role)
        app = host_tool_app(server, args.actor, args.native_runtime, args.native_role)
    register_team_tools(app, args.actor)
    from party_role_capabilities import is_bound_yui
    if args.actor == 'game:mc-god' or is_bound_yui(args.actor):
        from world_admin_tools import register_admin_tools
        register_admin_tools(app, args.actor)
    if args.actor in ('game:mc-god', 'game:qd-guild-planner', 'operations:mc-priest'):
        from world_content_tools import register_content_tools
        register_content_tools(app, args.actor)
    server.run(transport='stdio')


if __name__ == '__main__':
    main()
