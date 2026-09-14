"""Native MCP registration for the three fixed content responsibilities."""
from pathlib import Path
import sys
from typing import Optional

for directory in (Path(__file__).resolve().parents[1] / 'sidecar', Path('/ops-sidecar')):
    if directory.is_dir() and str(directory) not in sys.path:
        sys.path.append(str(directory))
from world_content import ContentQueue, SiteQueue, ACTORS

# Slice two of case boss-chest-adapter-missing: the durable SiteQueue ledger
# becomes reachable through MCP. game:mc-god (the recorded repairOwner) can
# propose/approve venues, append step receipts and reconcile records; the
# other content actors can read the ledger so a designer never treats a
# blocked capability as open. These tools only move JSON receipts;
# worldActionsExecuted stays 0 and no server command ever runs here.
# world_site_read is shared by all three content actors; only the recorded
# repairOwner gets the mutating ledger tools.
SITE_LEDGER_MUTATIONS = ('world_site_propose', 'world_site_approve',
                         'world_site_record', 'world_site_recover')


def content_tools(actor):
    if actor not in ACTORS:
        return ()
    shared = ('world_content_context', 'world_content_read', 'world_site_read',
              'world_content_reachability')
    return shared + ({'game:qd-guild-planner': ('world_content_submit',),
                      'game:mc-god': ('world_content_publish',) + SITE_LEDGER_MUTATIONS,
                      'operations:mc-priest': ('world_content_submit_story',)}[actor])


def register_content_tools(app, actor, state=Path('/team')):
    names = content_tools(actor)
    if not names:
        return ()
    queue = ContentQueue(state)
    sites = SiteQueue(state)

    @app.tool()
    def world_content_context() -> dict:
        """Read fresh real issuers/contracts and supported story objectives; Boss/chest adapter gaps stay explicit."""
        return queue.context()

    @app.tool()
    def world_content_read(content_id: str) -> dict:
        """Read an attributed story proposal and its actual publication receipt; publication is not completion."""
        return queue.read(actor, content_id)

    if actor == 'game:qd-guild-planner':
        @app.tool()
        def world_content_submit(request_id: str, content: dict) -> dict:
            """Submit date/title/story/ending/stages using current context; valid new gather/hunt/visit or existing contracts only."""
            return queue.submit(actor, request_id, content)
    elif actor == 'game:mc-god':
        @app.tool()
        def world_content_publish(request_id: str, content_id: str) -> dict:
            """Approve one designer package for existing NPC publication; inspect the receipt afterward, never assume queued means published."""
            return queue.publish(actor, request_id, content_id)
    else:
        @app.tool()
        def world_content_submit_story(request_id: str, title: str, story: str, objectives: list[str]) -> dict:
            """Submit a story idea for the game designer; this does not create quests, rewards, bosses or chests."""
            return queue.story(actor, request_id, title, story, objectives)

    @app.tool()
    def world_site_read(site_id: str) -> dict:
        """Read one boss/chest venue ledger record with recorded step receipts; a recorded receipt is not proof of server execution."""
        return sites.read(actor, site_id)

    # The seq309 manual Pythagorean intercept (case-fe0b3f68) preserved as a
    # shared receipt channel: every content actor can account a destination
    # against the gateway single-goto limit before writing it into a
    # contract, so an under-reported distance can no longer reach publication
    # review as geometry nobody checked.
    @app.tool()
    def world_content_reachability(target: Optional[dict] = None, issuer: Optional[str] = None,
                                   anchor: Optional[dict] = None, waypoints: Optional[list] = None) -> dict:
        """Horizontal accounting for one contract destination against the gateway single-goto limit (24 blocks, x/z only); give exactly one of target/issuer; pure geometry, worldActionsExecuted stays 0."""
        return queue.reachability(actor, target, issuer, anchor, waypoints)

    if actor == 'game:mc-god':
        @app.tool()
        def world_site_propose(request_id: str, kind: str, venue: dict, note: str = '') -> dict:
            """Register one candidate boss/chest venue in the durable site ledger; venue distance is checked, no world state is touched."""
            return sites.propose(actor, request_id, kind, venue, note)

        @app.tool()
        def world_site_approve(request_id: str, site_id: str) -> dict:
            """Approve one proposed venue record; this is a ledger transition only, the server is not commanded."""
            return sites.approve(actor, request_id, site_id)

        @app.tool()
        def world_site_record(request_id: str, site_id: str, step: str, evidence: dict) -> dict:
            """Append one step receipt (scout/place/proof/cleanup) from your own verified channel; identical evidence replays idempotently."""
            return sites.record(actor, request_id, site_id, step, evidence)

        @app.tool()
        def world_site_recover(site_id: str) -> dict:
            """Reconcile the ledger against receipts on disk; a claimed-but-missing receipt stays outcome_unknown instead of being rewritten."""
            return sites.recover(actor, site_id)
    return names
