"""Mock SFTP server for Studio v2 walkthrough.

Spawns a tiny SFTP server on localhost:2222 that accepts user
"plani" / password "plani" and writes uploaded files to
``./mock_sftp_root/``. Use for testing the Send To SFTP block
without provisioning a real SFTP host.

Run standalone:
    python tests/e2e_mock_sftp.py

The host key is generated fresh on each launch (in-memory) so the
client must accept unknown hosts. The PlaniAdvance SFTP transport
already uses ``AutoAddPolicy`` which handles this.
"""

from __future__ import annotations

import os
import socket
import threading
from pathlib import Path

import paramiko

PORT = 2222
USER = "plani"
PASSWORD = "plani"
ROOT = Path(__file__).resolve().parent.parent / "mock_sftp_root"
ROOT.mkdir(exist_ok=True)


class _Server(paramiko.ServerInterface):
    def check_auth_password(self, username: str, password: str) -> int:
        if username == USER and password == PASSWORD:
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def get_allowed_auths(self, username: str) -> str:
        return "password"

    def check_channel_request(self, kind: str, chanid: int) -> int:
        if kind == "session":
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_subsystem_request(self, channel: paramiko.Channel, name: str) -> bool:
        if name == "sftp":
            channel.transport.set_subsystem_handler(
                "sftp", paramiko.SFTPServer, _SftpHandle
            )
            return True
        return False


class _SftpHandle(paramiko.SFTPServerInterface):
    def _abs(self, path: str) -> Path:
        clean = path.lstrip("/")
        return ROOT / clean if clean else ROOT

    def list_folder(self, path: str):
        target = self._abs(path)
        if not target.exists():
            return paramiko.SFTP_NO_SUCH_FILE
        return [self.stat(str(target / p.name)) for p in target.iterdir()]

    def stat(self, path: str):
        target = self._abs(path)
        if not target.exists():
            return paramiko.SFTP_NO_SUCH_FILE
        st = os.stat(target)
        attr = paramiko.SFTPAttributes.from_stat(st)
        attr.filename = target.name
        return attr

    def lstat(self, path: str):
        return self.stat(path)

    def open(self, path: str, flags: int, attr):
        target = self._abs(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            mode = "wb" if flags & os.O_WRONLY else "rb"
            handle = open(target, mode)
        except OSError:
            return paramiko.SFTP_FAILURE
        fobj = paramiko.SFTPHandle(flags)
        fobj.readfile = handle
        fobj.writefile = handle
        return fobj

    def remove(self, path: str):
        target = self._abs(path)
        if target.exists():
            target.unlink()
            return paramiko.SFTP_OK
        return paramiko.SFTP_NO_SUCH_FILE

    def mkdir(self, path: str, attr):
        self._abs(path).mkdir(parents=True, exist_ok=True)
        return paramiko.SFTP_OK

    def rmdir(self, path: str):
        target = self._abs(path)
        if target.exists():
            target.rmdir()
            return paramiko.SFTP_OK
        return paramiko.SFTP_NO_SUCH_FILE


def _serve_one(client_sock: socket.socket) -> None:
    transport = paramiko.Transport(client_sock)
    transport.add_server_key(paramiko.RSAKey.generate(2048))
    transport.start_server(server=_Server())
    channel = transport.accept(20)
    if channel is None:
        transport.close()
        return
    while transport.is_active():
        threading.Event().wait(1)


def main() -> None:
    print(f"Mock SFTP listening on 0.0.0.0:{PORT} (user={USER} pwd={PASSWORD})")
    print(f"Files will land in: {ROOT}")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", PORT))
    sock.listen(5)
    while True:
        client_sock, addr = sock.accept()
        print(f"  <- connection from {addr}")
        threading.Thread(target=_serve_one, args=(client_sock,), daemon=True).start()


if __name__ == "__main__":
    main()
