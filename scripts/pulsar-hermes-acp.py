"""Pulsar-owned entrypoint for the pinned Hermes adapter, not a general CLI.

Keeps upstream unmodified. An upgrade must requalify this integration contract.
This tool boundary is defense in depth, NOT an OS/container sandbox.
"""
import os
import sys
from pathlib import Path
from importlib.metadata import version


def governed_toolsets(toolsets=None, mcp_server_names=None):
    # A nonempty, defined, EMPTY base prevents Hermes' default-tool fallback.
    # Rebuilds (set_model/resume) use this same function.
    return ["pulsar-governed"] + (["mcp-pulsar"] if "mcp-pulsar" in (toolsets or [])
                                 or "pulsar" in (mcp_server_names or []) else [])


def configure_boundary():
    if version("hermes-agent") != "0.16.0":
        raise RuntimeError("Hermes version requires Pulsar adapter requalification")
    # Do not load a project/operator .env, including during run_agent import.
    import hermes_cli.env_loader
    hermes_cli.env_loader.load_hermes_dotenv = lambda *args, **kwargs: []
    import toolsets
    toolsets.TOOLSETS["pulsar-governed"] = {
        "description": "Pulsar governed MCP tools only", "tools": [], "includes": []
    }
    import acp_adapter.session
    acp_adapter.session._expand_acp_enabled_toolsets = governed_toolsets
    # Bind server's imported alias as well, whether imported before or after us.
    import acp_adapter.server
    acp_adapter.server._expand_acp_enabled_toolsets = governed_toolsets
    import importlib.util
    from run_agent import AIAgent
    # Pulsar owns conversation titles. The pinned runtime otherwise starts an
    # untracked auxiliary LLM call AFTER the reported turn has completed.
    import agent.title_generator
    agent.title_generator.maybe_auto_title = lambda *args, **kwargs: None
    spec = importlib.util.spec_from_file_location(
        "pulsar_turns", Path(__file__).with_name("pulsar-hermes-turns.py"))
    turns = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(turns)
    turns.install_turn_contract(AIAgent, acp_adapter.server.HermesACPAgent)
    # ACP's router serializes a None load response as {}, i.e. apparent success.
    # Never silently accept a missing tenant history (resume creates a fresh id).
    agent_class = acp_adapter.server.HermesACPAgent
    original_load = agent_class.load_session
    if not getattr(original_load, "_pulsar_strict", False):
        async def strict_load(self, *args, **kwargs):
            result = await original_load(self, *args, **kwargs)
            if result is None:
                from acp.exceptions import RequestError
                raise RequestError(-32602, "Session history unavailable")
            return result
        strict_load._pulsar_strict = True
        agent_class.load_session = strict_load


def main():
    home = os.environ.get("HERMES_HOME")
    if not home or not Path(home).is_absolute():
        raise RuntimeError("Pulsar tenant home is required")
    # Resolve our trusted dependency explicitly; never import from the dossier cwd.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "hermes-agent"))
    configure_boundary()
    from acp_adapter.entry import main as run
    run([])


if __name__ == "__main__":
    main()
