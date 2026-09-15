"""Matrix ↔ QwenPaw bridge for the QiandengJi ops team.

Logs in as each qiandengji agent, listens for @mentions in the ops room,
forwards to the corresponding QwenPaw agent's chat endpoint, and posts
the reply back to Matrix. Single process, all agents multiplexed.

Usage: python matrix_bridge.py (runs as daemon)
"""
import json, re, sys, threading, time, urllib.request, urllib.error
from pathlib import Path

# --- Config ---
CREDS_PATH = Path(__file__).resolve().parents[2] / 'server/secret/agentteam-credentials.json'
QWENPAW = 'http://127.0.0.1:18089/api'
POLL_INTERVAL = 3  # seconds between sync calls
DEBUG = True

def log(msg):
    if DEBUG:
        ts = time.strftime('%H:%M:%S')
        print('[%s] %s' % (ts, msg), flush=True)

# --- HTTP helpers ---
def http(method, url, headers=None, body=None, timeout=30):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, method=method, data=data,
                                 headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(4 * 1024 * 1024)
            return json.loads(raw) if raw else {}, r.status
    except urllib.error.HTTPError as e:
        return {'error': e.code, 'body': e.read(300).decode('utf-8', 'replace')}, e.code
    except Exception as e:
        return {'error': str(e)[:100]}, 0

# --- Matrix client (minimal, no SDK dependency) ---
class MatrixClient:
    def __init__(self, homeserver, user_id, access_token, room_id):
        self.hs = homeserver.rstrip('/')
        self.user_id = user_id
        self.token = access_token
        self.room_id = room_id
        self.next_batch = None

    def _api(self, method, path, body=None):
        url = self.hs + '/_matrix/client/v3' + path
        return http(method, url, {'Authorization': 'Bearer ' + self.token}, body)

    def sync(self, timeout_ms=10000):
        path = '/sync?timeout=%d&filter={\"room\":{\"timeline\":{\"limit\":5}}}' % timeout_ms
        if self.next_batch:
            path += '&since=' + self.next_batch
        result, status = self._api('GET', path)
        if status == 200:
            self.next_batch = result.get('next_batch')
        return result

    def send_text(self, text):
        txn = str(int(time.time() * 1000))
        body = {'msgtype': 'm.text', 'body': text}
        return self._api('PUT', '/rooms/%s/send/m.room.message/%s' % (self.room_id, txn), body)

    def get_events(self):
        """Poll once and return new messages in our room."""
        result = self.sync(timeout_ms=5000)
        if 'error' in result:
            return []
        room = result.get('rooms', {}).get('join', {}).get(self.room_id, {})
        return room.get('timeline', {}).get('events', [])

# --- QwenPaw bridge ---
def send_to_qwenpaw(agent_id, text):
    """Send a message to a QwenPaw agent and get its reply."""
    # Map Matrix names to QwenPaw agent IDs
    name_map = {
        'qiandengji-goddess': 'mc-god',
        'qiandengji-engineer': 'qd-engineer',
        'qiandengji-steward': 'qd-steward',
        'qiandengji-survivor': 'qd-survivor',
        'qiandengji-yui': '5swvhK',
    }
    qwenpaw_id = name_map.get(agent_id)
    if not qwenpaw_id:
        return None, 'unknown agent mapping for %s' % agent_id

    # Use the console chat endpoint
    body = {
        'text': text,
        'channel': 'matrix',
        'session_id': 'matrix-bridge-%s' % agent_id,
    }
    result, status = http('POST', QWENPAW + '/console/chat?agent=%s' % qwenpaw_id, None, body, timeout=120)
    if status == 200:
        reply = result.get('final_text') or result.get('reply') or str(result)[:500]
        return reply, None
    return None, 'qwenpaw error %s: %s' % (status, str(result)[:200])


# --- Bridge daemon ---
class Bridge:
    def __init__(self):
        creds = json.loads(CREDS_PATH.read_text(encoding='utf-8'))
        self.room_id = creds['room']['id']
        self.hs = creds['homeserver']
        self.clients = {}
        for agent_name, info in creds['agents'].items():
            # Only create a client for the "primary" listener (goddess)
            # Others respond when @mentioned via goddess's event stream
            pass
        # Single client (goddess) monitors the room for all mentions
        goddess = creds['agents']['qiandengji-goddess']
        self.monitor = MatrixClient(self.hs, goddess['user_id'], goddess['access_token'], self.room_id)
        self.creds = creds
        log('bridge initialized, room=%s' % self.room_id[:30])

    def extract_mention(self, event):
        """Check if this event @mentions a qiandengji agent."""
        content = event.get('content', {})
        if content.get('msgtype') != 'm.text':
            return None, None
        body = content.get('body', '')
        sender = event.get('sender', '')
        if 'qiandengji' in sender:
            return None, None  # Ignore our own messages

        # Check for @mentions in the body
        for agent_name in self.creds['agents']:
            display = self.creds['agents'][agent_name].get('display', '')
            if '@' + agent_name in body or '@' + display in body:
                return agent_name, body
        # Also check formatted body for matrix.to links
        formatted = content.get('formatted_body', '')
        for agent_name in self.creds['agents']:
            if agent_name in formatted:
                return agent_name, body
        return None, None

    def send_as(self, agent_name, text):
        """Send a message as a specific agent."""
        info = self.creds['agents'].get(agent_name)
        if not info:
            return
        client = MatrixClient(self.hs, info['user_id'], info['access_token'], self.room_id)
        client.send_text(text)

    def run(self):
        log('bridge started, polling every %ds' % POLL_INTERVAL)
        while True:
            try:
                events = self.monitor.get_events()
                for ev in events:
                    agent, text = self.extract_mention(ev)
                    if not agent:
                        continue
                    sender_short = ev.get('sender', '?').split(':')[0].lstrip('@')
                    log('mention: %s -> %s: %s' % (sender_short, agent, text[:60]))

                    # Send typing indicator (as the mentioned agent)
                    # Forward to QwenPaw
                    prompt = '[Matrix 运营组] %s 说：%s' % (sender_short, text)
                    reply, err = send_to_qwenpaw(agent, prompt)
                    if err:
                        log('ERROR from qwenpaw: %s' % err)
                        self.send_as(agent, '（暂时无法连接我的大脑：%s）' % err[:80])
                    elif reply:
                        # Truncate very long replies for Matrix
                        reply_short = reply[:2000] if len(reply) > 2000 else reply
                        self.send_as(agent, reply_short)
                        log('reply sent as %s (%d chars)' % (agent, len(reply_short)))
            except Exception as e:
                log('poll error: %s' % repr(e)[:120])
                time.sleep(10)

            time.sleep(POLL_INTERVAL)


if __name__ == '__main__':
    bridge = Bridge()
    bridge.run()
