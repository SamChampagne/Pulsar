"""Outcome tests on structured results, never on generated prose."""
import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("turns", Path(__file__).with_name("pulsar-hermes-turns.py"))
turns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(turns)


class OutcomeTests(unittest.TestCase):
    def test_multimodal_persistence_override_cannot_erase_pixels(self):
        captured = {}
        class Engine:
            def run_conversation(self, *args, **kwargs):
                captured.update(kwargs)
                return {"completed": True}
        class Acp:
            async def prompt(self, *args, **kwargs):
                pass
        turns.install_turn_contract(Engine, Acp)
        content = [{"type": "image_url", "image_url": {"url": "data:image/png;base64,fixture"}}]
        Engine().run_conversation(user_message=content, persist_user_message="text only")
        self.assertIsNone(captured["persist_user_message"])
        self.assertIs(captured["user_message"], content)

    def test_success_requires_explicit_completion(self):
        for result in [None, {}, {"final_response": "Success!"}, {"completed": False}]:
            with self.subTest(result=result):
                self.assertEqual(turns.classify_result(result)["status"], "failed")
        self.assertEqual(turns.classify_result({"completed": True})["status"], "succeeded")

    def test_prose_is_not_an_error_signal(self):
        result = turns.classify_result({"completed": True, "final_response": "HTTP 400 is an example of an error"})
        self.assertEqual(result, {"version": 1, "status": "succeeded"})

    def test_failed_partial_and_error_override_completed(self):
        for flag in [{"error": "private key"}, {"failed": True}, {"partial": True}]:
            result = turns.classify_result({"completed": True, **flag})
            self.assertEqual(result["status"], "failed")
            self.assertNotIn("private", str(result))

    def test_interrupted_is_not_success(self):
        self.assertEqual(turns.classify_result({"completed": True, "interrupted": True})["status"], "cancelled")

    def test_usage_is_observed_cumulative_not_a_price(self):
        result = turns.classify_result({"completed": True, "prompt_tokens": 0, "completion_tokens": True, "total_tokens": -1, "estimated_cost_usd": 25})
        self.assertEqual(result["usage"], {"scope": "runtime_session", "inputTokens": 0, "outputTokens": None, "totalTokens": None})
        self.assertNotIn("cost", str(result))

    def exercise(self, outputs, run=True, stop="end_turn"):
        from acp.schema import PromptResponse
        class Engine:
            def run_conversation(self, *args, **kwargs):
                value = outputs.pop(0)
                if isinstance(value, Exception):
                    raise value
                return value
        state = SimpleNamespace(agent=Engine())
        class Acp:
            session_manager = SimpleNamespace(get_session=lambda _: state)
            async def prompt(self, prompt, session_id, **kwargs):
                if run:
                    result = state.agent.run_conversation(conversation_history=[])
                    self.final_text = result.get("final_response")
                return PromptResponse(stop_reason=stop)
        turns.install_turn_contract(Engine, Acp)
        # Reinstallation is idempotent, as in repeated test imports.
        turns.install_turn_contract(Engine, Acp)
        return Acp()

    def test_bridge_emits_failure_and_suppresses_provider_prose(self):
        acp = self.exercise([{"completed": False, "failed": True, "error": "secret", "final_response": "secret"}])
        response = asyncio.run(acp.prompt([], "s"))
        wire = response.model_dump(by_alias=True)
        self.assertEqual(wire["_meta"]["pulsarTurn"]["status"], "failed")
        self.assertEqual(wire["stopReason"], "refusal")
        self.assertEqual(acp.final_text, "")
        self.assertNotIn("secret", str(wire))

    def test_exception_is_typed_and_sanitized(self):
        acp = self.exercise([ValueError("secret")])
        response = asyncio.run(acp.prompt([], "s"))
        self.assertEqual(response.field_meta["pulsarTurn"]["status"], "failed")
        self.assertEqual(acp.final_text, "")

    def test_later_failure_does_not_reuse_a_success(self):
        acp = self.exercise([{"completed": True}, {"failed": True}])
        first = asyncio.run(acp.prompt([], "s"))
        second = asyncio.run(acp.prompt([], "s"))
        self.assertEqual(first.field_meta["pulsarTurn"]["status"], "succeeded")
        self.assertEqual(second.field_meta["pulsarTurn"]["status"], "failed")

    def test_no_engine_completion_is_unknown_not_success(self):
        acp = self.exercise([], run=False)
        self.assertEqual(asyncio.run(acp.prompt([], "s")).field_meta["pulsarTurn"]["code"], "PROTOCOL_ERROR")

    def test_acp_cancel_overrides_completion(self):
        acp = self.exercise([{"completed": True}], stop="cancelled")
        self.assertEqual(asyncio.run(acp.prompt([], "s")).field_meta["pulsarTurn"]["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
