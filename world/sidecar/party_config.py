"""Fixed game-party identities; credentials never enter messages or public state."""
import hmac
import os
from pathlib import Path
import re

from qwen_tasks import read_json

FIELDS = ('agentId', 'bodyUuid', 'ownerUuid', 'sessionId', 'userId', 'channel')
PARTY_TOOLS = ('party_status', 'party_send', 'party_message_read')
PARTY_URL = 'http://npc:8091/party/mcp'


class PartyConfig:
    def __init__(self, root=None):
        self.root = Path(root or os.environ.get('PARTY_STATE_DIR', '/mcdata/village/party'))

    def configured(self):
        return (self.root / 'binding.json').is_file()

    def private(self):
        value = read_json(self.root / 'binding.json')
        if value.get('schema') != 1 or value.get('enabled') is not True:
            raise ValueError('party_disabled')
        members = value.get('members')
        if not isinstance(members, list) or len(members) != 2:
            raise ValueError('party_members_invalid')
        if {m.get('kind') for m in members} != {'survivor', 'maid'}:
            raise ValueError('party_bodies_invalid')
        survivor = next(m for m in members if m['kind'] == 'survivor')
        maid = next(m for m in members if m['kind'] == 'maid')
        if survivor.get('agentId') != 'qd-survivor' or maid.get('ownerUuid') != survivor.get('bodyUuid'):
            raise ValueError('party_owner_binding_invalid')
        if (maid.get('userId') != 'maid-' + str(maid.get('bodyUuid'))
                or survivor.get('userId') != 'survival-controller'
                or any(m.get('channel') != 'console' for m in members)):
            raise ValueError('party_native_session_invalid')
        if any(not isinstance(m.get('mcpToken'), str) or not re.fullmatch('[A-Za-z0-9_-]{32,128}', m['mcpToken']) for m in members):
            raise ValueError('party_credential_invalid')
        if members[0]['mcpToken'] == members[1]['mcpToken']:
            raise ValueError('party_credential_collision')
        return value

    def binding(self):
        value = self.private()
        return {k: value[k] for k in ('schema', 'partyId', 'revision', 'limits')} | {
            'members': [{k: m[k] for k in FIELDS} for m in value['members']]}

    def member(self, role):
        found = [m for m in self.private()['members'] if m['agentId'] == role]
        if len(found) != 1:
            raise ValueError('not_party_member')
        return {k: v for k, v in found[0].items() if k != 'mcpToken'}

    def validate_recipient(self, role, message):
        """Recheck the reserved identity immediately before native dispatch."""
        binding = self.binding()
        identities = {m['agentId']: m for m in binding['members']}
        if (message.get('partyId') != binding['partyId']
                or message.get('bindingRevision') != binding['revision']
                or message.get('recipient') != identities.get(role)
                or message.get('sender') not in binding['members']):
            raise ValueError('party_dispatch_binding_changed')
        return identities[role]

    def authenticate(self, authorization):
        if not isinstance(authorization, str) or not authorization.startswith('Bearer ') or len(authorization) > 256:
            raise ValueError('unauthorized_party')
        supplied = authorization[7:].encode('utf8')
        for row in self.private()['members']:
            if hmac.compare_digest(supplied, row['mcpToken'].encode('ascii')):
                return row['agentId']
        raise ValueError('unauthorized_party')


def recipient_tools(body_driver, body_tools, learning_tools=()):
    # Qwen 2.2 DriverCapabilityTool uses <driver>__<tool>, not bare MCP names.
    files = ('Skill', 'read_file', 'write_file', 'edit_file', 'append_file', 'materialize_skill', 'get_current_time')
    return list(files) + [body_driver + '__' + name for name in body_tools] + [
        'qd_learning__' + name for name in learning_tools] + [
        'qd_party__party_status', 'qd_party__party_message_read']
