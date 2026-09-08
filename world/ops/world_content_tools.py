"""Native MCP registration for the three fixed content responsibilities."""
from pathlib import Path
import sys

for directory in (Path(__file__).resolve().parents[1] / 'sidecar', Path('/ops-sidecar')):
    if directory.is_dir() and str(directory) not in sys.path:
        sys.path.append(str(directory))
from world_content import ContentQueue, ACTORS


def content_tools(actor):
    if actor not in ACTORS:
        return ()
    shared = ('world_content_context', 'world_content_read')
    return shared + ({'game:qd-guild-planner': ('world_content_submit',),
                      'game:mc-god': ('world_content_publish',),
                      'operations:mc-priest': ('world_content_submit_story',)}[actor])


def register_content_tools(app, actor, state=Path('/team')):
    names = content_tools(actor)
    if not names:
        return ()
    queue = ContentQueue(state)

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
    return names
