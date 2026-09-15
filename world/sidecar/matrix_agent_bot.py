"""Per-agent Matrix bot: each QiandengJi agent connects independently.

Each instance:
1. Logs in as ONE agent's Matrix account (their own credentials)
2. Listens for @mentions of THAT agent
3. Forwards to that agent's QwenPaw session (their own brain)
4. Posts the reply back as that agent (their own voice)

Usage: python matrix_agent_bot.py --agent qiandengji-goddess
       python matrix_agent_bot.py --agent qiandengji-engineer
       (run one process per agent)
"""
import argparse, json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CREDS_PATH = ROOT / 'server/secret/agentteam-credentials.json'
QWENPAW = 'http://127.0.0.1:18089/api'
POLL_MS = 8000  # Matrix long-poll timeout

# Matrix name -> QwenPaw agent ID
QWENPAW_MAP = {
    'qiandengji-goddess': 'mc-god',
    'qiandengji-engineer': 'qd-engineer',
    'qiandengji-steward': 'qd-steward',
    'qiandengji-survivor': 'qd-survivor',
    'qiandengji-yui': '5swvhK',
}

def log(agent, msg):
    print('[%s] %s' % (agent, msg), flush=True)

def http(method, url, headers=None, body=None, timeout=30):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, method=method, data=data,
                                 headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(4 * 1024 * 1024)
            return json.loads(raw) if raw else {}, r.status
    except urllib.error.HTTPError as e:
        return {'error': e.code}, e.code
    except Exception as e:
        return {'error': str(e)[:100]}, 0


class AgentMatrixBot:
    """One agent, one Matrix connection, one QwenPaw brain."""

    def __init__(self, agent_name):
        creds = json.loads(CREDS_PATH.read_text(encoding='utf-8'))
        info = creds['agents'][agent_name]
        self.agent_name = agent_name
        self.display = info['display']
        self.hs = creds['homeserver'].rstrip('/')
        self.token = info['access_token']
        self.user_id = info['user_id']
        self.room_id = creds['room']['id']
        self.qwenpaw_id = QWENPAW_MAP[agent_name]
        self.next_batch = None
        self.session_id = 'matrix-%s' % agent_name
        log(agent_name, 'initialized: %s -> qwenpaw:%s, room=%s...' % (
            self.user_id[:30], self.qwenpaw_id, self.room_id[:20]))

    def matrix(self, method, path, body=None):
        url = self.hs + '/_matrix/client/v3' + path
        return http(method, url, {'Authorization': 'Bearer ' + self.token}, body)

    def is_mention_for_me(self, event):
        """Check if this event @mentions THIS agent (not others)."""
        content = event.get('content', {})
        if content.get('msgtype') != 'm.text':
            return None
        sender = event.get('sender', '')
        if sender == self.user_id:
            return None  # My own message, skip
        body = content.get('body', '')
        formatted = content.get('formatted_body', '')

        # Check plain text @mention
        if '@' + self.agent_name in body:
            return body
        # Check display name @mention
        if '@' + self.display in body:
            return body
        # Check matrix.to link in formatted body
        if self.user_id in formatted:
            return body
        return None

    def ask_qwenpaw(self, text):
        """Send to this agent's own QwenPaw session and get reply."""
        body = {'text': text, 'channel': 'matrix', 'session_id': self.session_id}
        url = '%s/console/chat?agent=%s' % (QWENPAW, self.qwenpaw_id)
        result, status = http('POST', url, None, body, timeout=120)
        if status == 200:
            return result.get('final_text') or result.get('reply') or str(result)[:500]
        return None

    def send(self, text):
        """Post a message to the room as THIS agent."""
        txn = str(int(time.time() * 1000)) + '-' + self.agent_name[:4]
        self.matrix('PUT', '/rooms/%s/send/m.room.message/%s' % (self.room_id, txn),
                    {'msgtype': 'm.text', 'body': text})

    def run(self):
        log(self.agent_name, 'bot started, polling Matrix as %s' % self.user_id[:40])
        while True:
            try:
                path = '/sync?timeout=%d&filter={"room":{"timeline":{"limit":3}}}' % POLL_MS
                if self.next_batch:
                    path += '&since=' + self.next_batch
                result, status = self.matrix('GET', path)
                if status != 200 or 'error' in result:
                    log(self.agent_name, 'sync error: %s, retrying in 10s' % result.get('error'))
                    time.sleep(10)
                    continue

                self.next_batch = result.get('next_batch')
                room = result.get('rooms', {}).get('join', {}).get(self.room_id, {})
                events = room.get('timeline', {}).get('events', [])

                for ev in events:
                    text = self.is_mention_for_me(ev)
                    if not text:
                        continue
                    sender_short = ev.get('sender', '?').split(':')[0].lstrip('@')
                    log(self.agent_name, 'mentioned by %s: %s' % (sender_short, text[:60]))

                    # Send typing notification (best effort)
                    self.matrix('PUT', '/rooms/%s/typing/%s' % (self.room_id, self.user_id),
                                {'typing': True, 'timeout': 120000})

                    # Ask my own QwenPaw brain
                    prompt = '[Matrix 运营组] %s @你：%s' % (sender_short, text)
                    reply = self.ask_qwenpaw(prompt)

                    if reply:
                        reply_short = reply[:2000]
                        self.send(reply_short)
                        log(self.agent_name, 'replied (%d chars)' % len(reply_short))
                    else:
                        self.send('（我的大脑暂时连不上，稍后再试）')
                        log(self.agent_name, 'qwenpaw unavailable')

                    # Stop typing
                    self.matrix('PUT', '/rooms/%s/typing/%s' % (self.room_id, self.user_id),
                                {'typing': False})

            except KeyboardInterrupt:
                log(self.agent_name, 'shutting down')
                break
            except Exception as e:
                log(self.agent_name, 'poll error: %s' % repr(e)[:100])
                time.sleep(10)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Per-agent Matrix bot')
    parser.add_argument('--agent', required=True, choices=list(QWENPAW_MAP.keys()))
    args = parser.parse_args()
    bot = AgentMatrixBot(args.agent)
    bot.run()
