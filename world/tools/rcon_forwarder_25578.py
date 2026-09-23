"""TCP port forwarder: 0.0.0.0:25577 → 127.0.0.1:25577 (Docker Desktop WSL2 workaround).

Docker Desktop for Windows WSL2 backend only listens on 127.0.0.1 for
published ports, even when the binding says 0.0.0.0. The netsh portproxy
also doesn't work with Docker Desktop's internal proxy. This script
creates a real TCP listener that forwards to the Docker internal port.
"""
import socket
import threading
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

LISTEN_HOST = '0.0.0.0'
LISTEN_PORT = 25578
FORWARD_HOST = '127.0.0.1'
FORWARD_PORT = 25577


def forward(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except Exception:
        pass
    finally:
        try:
            src.close()
        except Exception:
            pass
        try:
            dst.close()
        except Exception:
            pass


def handle(client):
    try:
        upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        upstream.connect((FORWARD_HOST, FORWARD_PORT))
        t1 = threading.Thread(target=forward, args=(client, upstream), daemon=True)
        t2 = threading.Thread(target=forward, args=(upstream, client), daemon=True)
        t1.start()
        t2.start()
    except Exception as e:
        print(f'  upstream connect failed: {e}')
        try:
            client.close()
        except Exception:
            pass


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((LISTEN_HOST, LISTEN_PORT))
    server.listen(16)
    print(f'TCP forwarder listening on {LISTEN_HOST}:{LISTEN_PORT} → {FORWARD_HOST}:{FORWARD_PORT}')

    # 删掉 netsh portproxy（避免冲突）
    import subprocess
    subprocess.run(['netsh', 'interface', 'portproxy', 'delete', 'v4tov4',
                    f'listenport={LISTEN_PORT}', f'listenaddress=0.0.0.0'],
                   capture_output=True)

    while True:
        client, addr = server.accept()
        print(f'  connection from {addr[0]}:{addr[1]}')
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == '__main__':
    main()
