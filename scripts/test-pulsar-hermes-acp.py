"""Offline contract tests. Run with the vendored venv; no prompt/provider call."""
import importlib.util
import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "hermes-agent"))
spec = importlib.util.spec_from_file_location("pulsar_acp", root / "scripts/pulsar-hermes-acp.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class ToolBoundaryTests(unittest.TestCase):
    def test_missing_history_is_a_protocol_error_not_empty_success(self):
        adapter.configure_boundary()
        from acp_adapter.server import HermesACPAgent
        from acp.exceptions import RequestError
        mock_load = AsyncMock(return_value=None)
        mock_load._pulsar_strict = False
        with patch.object(HermesACPAgent, "load_session", new=mock_load):
            adapter.configure_boundary()
            with self.assertRaisesRegex(RequestError, "history unavailable"):
                asyncio.run(HermesACPAgent.load_session(object(), cwd=".", session_id="absent"))

    def test_existing_history_load_response_is_preserved(self):
        adapter.configure_boundary()
        from acp_adapter.server import HermesACPAgent
        response = object()
        mock_load = AsyncMock(return_value=response)
        # AsyncMock dynamically invents attributes; this must be false explicitly.
        mock_load._pulsar_strict = False
        with patch.object(HermesACPAgent, "load_session", new=mock_load):
            adapter.configure_boundary()
            self.assertIs(asyncio.run(HermesACPAgent.load_session(object())), response)

    def test_no_default_tools(self):
        self.assertEqual(adapter.governed_toolsets(), ["pulsar-governed"])
        self.assertEqual(adapter.governed_toolsets(["hermes-acp", "terminal", "browser"]), ["pulsar-governed"])

    def test_only_pulsar_mcp_survives(self):
        self.assertEqual(adapter.governed_toolsets(["hermes-acp"], ["other", "pulsar"]),
                         ["pulsar-governed", "mcp-pulsar"])

    def test_rebuild_keeps_pulsar_not_host_tools(self):
        self.assertEqual(adapter.governed_toolsets(["pulsar-governed", "mcp-pulsar", "terminal"]),
                         ["pulsar-governed", "mcp-pulsar"])

    def test_unknown_runtime_requires_review(self):
        with patch.object(adapter, "version", return_value="99.0.0"):
            with self.assertRaisesRegex(RuntimeError, "requalification"):
                adapter.configure_boundary()

    def test_real_pinned_runtime_surface_and_rebuild_alias(self):
        adapter.configure_boundary()
        import acp_adapter.session
        import acp_adapter.server
        import hermes_cli.env_loader
        from model_tools import get_tool_definitions
        self.assertIs(acp_adapter.session._expand_acp_enabled_toolsets, adapter.governed_toolsets)
        self.assertIs(acp_adapter.server._expand_acp_enabled_toolsets, adapter.governed_toolsets)
        self.assertEqual(hermes_cli.env_loader.load_hermes_dotenv(project_env=".env"), [])
        # Real registry: no terminal, files, browser, memory, code or delegate tool.
        self.assertEqual(get_tool_definitions(enabled_toolsets=adapter.governed_toolsets(), quiet_mode=True), [])

    def test_real_registry_only_includes_explicit_pulsar_tools(self):
        adapter.configure_boundary()
        from tools.registry import registry
        from model_tools import get_tool_definitions
        for server in ["pulsar", "unrelated"]:
            name = f"mcp_{server}_read_fixture"
            registry.register(name=name, toolset=f"mcp-{server}",
                              schema={"name": name, "description": "Offline test", "parameters": {"type": "object", "properties": {}}},
                              handler=lambda args: "unused")
        tools = get_tool_definitions(enabled_toolsets=adapter.governed_toolsets(["hermes-acp"], ["pulsar", "unrelated"]), quiet_mode=True)
        self.assertEqual([tool["function"]["name"] for tool in tools], ["mcp_pulsar_read_fixture"])


if __name__ == "__main__":
    unittest.main()
