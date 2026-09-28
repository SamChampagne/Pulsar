"""TEST ONLY: exercise the A1 boundary on an explicitly pinned candidate.

Never called by the API. Dummy credentials, disposable HOME, loopback network.
The version override deliberately bypasses the production rejection for this
experiment only; success does NOT enroll the candidate in production.
"""
import importlib.util
import ipaddress
import os
from pathlib import Path
import socket
import sys
from importlib.metadata import version
from unittest.mock import patch

candidate = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(candidate))
runtime_version = version("hermes-agent")
if runtime_version not in ("0.16.0", "0.21.5"):
    raise RuntimeError("Qualification requires the pinned candidate distribution")
home = Path(os.environ["HERMES_HOME"]).resolve()
if not (home / "PULSAR_QUALIFICATION_ONLY").is_file():
    raise RuntimeError("Disposable qualification home required")

# Defense in depth for THIS test, not an OS sandbox. Refuse external DNS and
# socket connections before importing runtime/provider packages. Only the two
# synthetic services in the parent process use the configured port. Loopback
# sockets also support Python's own Windows asyncio socketpair implementation.
original_connect = socket.socket.connect
original_connect_ex = socket.socket.connect_ex
original_getaddrinfo = socket.getaddrinfo
allowed_port = int(os.environ["PULSAR_FIXTURE_PORT"])


def check_address(address):
    if not isinstance(address, tuple) or len(address) < 2:
        raise OSError("Qualification permits only loopback TCP")
    if not ipaddress.ip_address(address[0]).is_loopback:
        raise OSError("External network disabled during qualification")


def connect(sock, address):
    check_address(address)
    return original_connect(sock, address)


def connect_ex(sock, address):
    check_address(address)
    return original_connect_ex(sock, address)


def getaddrinfo(host, port, *args, **kwargs):
    if host not in ("localhost", "127.0.0.1", "::1", b"127.0.0.1") or int(port) != allowed_port:
        raise OSError("External DNS disabled during qualification")
    return original_getaddrinfo(host, port, *args, **kwargs)


socket.socket.connect = connect
socket.socket.connect_ex = connect_ex
socket.getaddrinfo = getaddrinfo
spec = importlib.util.spec_from_file_location(
    "pulsar_boundary", Path(__file__).resolve().parents[1] / "pulsar-hermes-acp.py")
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)
with patch.object(boundary, "version", return_value="0.16.0"):
    boundary.configure_boundary()

# Check all alias sites introduced by the split ACP modules, not just server.
if runtime_version == "0.21.5":
    import acp_adapter.commands
    assert acp_adapter.commands._expand_acp_enabled_toolsets is boundary.governed_toolsets
import acp_adapter.server
import acp_adapter.session
assert acp_adapter.server._expand_acp_enabled_toolsets is boundary.governed_toolsets
assert acp_adapter.session._expand_acp_enabled_toolsets is boundary.governed_toolsets
from acp_adapter.entry import main
main([])
