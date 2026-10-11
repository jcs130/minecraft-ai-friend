"""Pinned server-only mixed login configuration and cold offline-account provisioning."""
from pathlib import Path
import hashlib
import json
import os
import secrets
import socket
import subprocess
import time
import uuid
import zipfile
from urllib.request import urlopen

NAME = 'mixauth-1.21.1-1.3.3.jar'
URL = 'https://cdn.modrinth.com/data/GzSiVPHb/versions/nkxiqfJq/' + NAME
SHA256 = 'c57bd2c5ce9f911f8935102aa5beb77b3df147071d669ff5e1f8696e4f98bc3d'
SHA512 = '4cf7c48d5b38bba5440d318f45bdc47481179f4f98245de628164e39c0d6343f0590573be6f258753431214e88fa58e5c405ea81bb03bf7656f571aa4b14eda8'
CONFIG = '''[database]
path = "mixauth/mixauth"
[offline_login]
max_login_attempts = 3
temporary_block_minutes = 5
trusted_login_window_hours = 0
login_timeout_minutes = 5
prompt_interval_seconds = 15
bcrypt_cost = 12
min_password_length = 8
max_password_length = 72
password_blacklist_path = "mixauth/password_blacklist.txt"
[online_validation]
connect_timeout_seconds = 10
request_timeout_seconds = 10
pending_handshake_ttl_seconds = 120
[localization]
default_language = "zh_cn"
auto_detect_player_language = false
'''


def verify(path):
    value = Path(path).read_bytes()
    if len(value) != 3035775 or hashlib.sha256(value).hexdigest() != SHA256 or hashlib.sha512(value).hexdigest() != SHA512:
        raise ValueError('MixAuth artifact hash/size mismatch')
    return Path(path)


def download(directory):
    target = Path(directory) / NAME
    if not target.exists():
        with urlopen(URL, timeout=45) as response:
            data = response.read(4_000_000)
        if hashlib.sha256(data).hexdigest() != SHA256:
            raise ValueError('MixAuth download hash mismatch')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return verify(target)


def configure(server, level):
    target = Path(server) / level / 'serverconfig' / 'mixauth-server.toml'
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_text('utf-8') != CONFIG:
        raise ValueError('Existing auth configuration differs; review explicitly before replacing')
    target.write_text(CONFIG, encoding='utf-8')
    return target


# Standalone JDBC uses the exact nested dependencies shipped by the verified mod.
# INSERT-only protects an existing password; provisioning happens with the game stopped.
PROVISION_JAVA = r'''
import java.sql.*;
import java.nio.charset.StandardCharsets;
import at.favre.lib.crypto.bcrypt.BCrypt;
public class ProvisionOffline {
  public static void main(String[] args) throws Exception {
    char[] password = new String(System.in.readAllBytes(), StandardCharsets.UTF_8).strip().toCharArray();
    String hash = BCrypt.withDefaults().hashToString(12, password);
    java.util.Arrays.fill(password, '\0');
    try (Connection db = DriverManager.getConnection("jdbc:h2:file:" + args[0], "sa", "")) {
      db.setAutoCommit(false);
      try (Statement st = db.createStatement()) {
        st.execute("CREATE TABLE IF NOT EXISTS offline_users (player_uuid VARCHAR PRIMARY KEY,password_hash VARCHAR NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)");
      }
      try (PreparedStatement query = db.prepareStatement("SELECT password_hash FROM offline_users WHERE player_uuid=?")) {
        query.setString(1, args[1]);
        try (ResultSet row = query.executeQuery()) { if (row.next()) throw new IllegalStateException("existing_account_not_overwritten"); }
      }
      try (PreparedStatement st = db.prepareStatement("INSERT INTO offline_users VALUES (?,?,?,?)")) {
        st.setString(1,args[1]);st.setString(2,hash);st.setLong(3,System.currentTimeMillis());st.setLong(4,System.currentTimeMillis());st.executeUpdate();
      }
      db.commit();
      try (Statement st = db.createStatement()) { st.execute("CHECKPOINT SYNC"); }
      System.out.println("offline_account_created");
    }
  }
}
'''


def provision(server, credential_file, username, jar, java, work):
    server, credential_file, work = Path(server).resolve(), Path(credential_file).resolve(), Path(work).resolve()
    verify(jar)
    props = dict(line.split('=', 1) for line in (server / 'server.properties').read_text('utf-8-sig').splitlines() if '=' in line and not line.startswith('#'))
    with socket.socket() as sock:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'): sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        sock.bind(('0.0.0.0', int(props['server-port'])))
    if credential_file.exists(): raise ValueError('Existing game credential must not be overwritten')
    player_uuid = str(uuid.UUID(bytes=hashlib.md5(('OfflinePlayer:' + username).encode()).digest(), version=3))
    credential = {'schemaVersion': 1, 'username': username, 'playerUuid': player_uuid, 'password': secrets.token_urlsafe(32)}
    work.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(jar) as z:
        deps = []
        for name in ('bcrypt-0.10.2.jar', 'bytes-1.5.0.jar', 'h2-2.4.240.jar'):
            target = work / name; target.write_bytes(z.read('META-INF/jarjar/' + name)); deps.append(target)
    source = work / 'ProvisionOffline.java'; source.write_text(PROVISION_JAVA, encoding='utf-8')
    classpath = os.pathsep.join(map(str, [work, *deps]))
    result = subprocess.run([str(Path(java).with_name('javac.exe')), '-encoding', 'UTF-8', '-cp', classpath, str(source)], capture_output=True, text=True)
    if result.returncode: raise RuntimeError('Offline account provisioning compiler failed: ' + result.stderr[-1500:])
    credential_file.parent.mkdir(parents=True, exist_ok=True)
    # Keep the new private credential recoverable even if the database write fails.
    with credential_file.open('x', encoding='utf-8') as f: json.dump(credential, f)
    db_path = server / 'mixauth/mixauth'; db_path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([str(java), '-cp', classpath, 'ProvisionOffline', str(db_path), player_uuid], input=credential['password'], capture_output=True, text=True)
    if result.returncode: raise RuntimeError('Offline account provisioning failed; preserve private credential for reconciliation: ' + result.stderr[-1000:])
    return {'ok': True, 'username': username, 'playerUuid': player_uuid, 'created': True, 'passwordExposed': False}
