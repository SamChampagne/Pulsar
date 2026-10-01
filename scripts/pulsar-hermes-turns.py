"""Pulsar ACP outcome bridge. Only structured engine fields determine success.

Loaded by the pinned wrapper, not the Hermes CLI. No business tools or permissions.
The engine remains trusted code; this is not a process sandbox.
"""
import asyncio
from functools import wraps


def classify_result(result):
    if not isinstance(result, dict):
        return {"version": 1, "status": "failed", "code": "PROTOCOL_ERROR"}
    if result.get("interrupted") is True:
        outcome = {"version": 1, "status": "cancelled", "code": "CANCELLED"}
    elif result.get("error") or result.get("failed") is True:
        outcome = {"version": 1, "status": "failed", "code": "RUNTIME_FAILURE"}
    elif result.get("partial") is True or result.get("completed") is not True:
        outcome = {"version": 1, "status": "failed", "code": "INCOMPLETE"}
    else:
        outcome = {"version": 1, "status": "succeeded"}
    def count(key):
        value = result.get(key)
        return value if type(value) is int and 0 <= value <= 9007199254740991 else None
    usage = {"scope": "runtime_session", "inputTokens": count("prompt_tokens"),
             "outputTokens": count("completion_tokens"), "totalTokens": count("total_tokens")}
    if any(usage[k] is not None for k in ("inputTokens", "outputTokens", "totalTokens")):
        outcome["usage"] = usage
    return outcome


def install_turn_contract(agent_class, acp_class):
    original_run = agent_class.run_conversation
    if not getattr(original_run, "_pulsar_outcome", False):
        @wraps(original_run)
        def run(self, *args, **kwargs):
            # Bound to the actual AIAgent, never inferred from assistant prose.
            content = kwargs.get("user_message")
            if isinstance(content, list) and any(
                isinstance(part, dict) and part.get("type") in ("image_url", "input_image")
                for part in content
            ):
                # ACP 0.16 supplies a text-only persistence override. Its early
                # crash-resilience save mutates live messages BEFORE inference,
                # silently erasing images. Preserve pixels in the tenant history.
                kwargs["persist_user_message"] = None
            try:
                result = original_run(self, *args, **kwargs)
            except Exception:
                result = {"completed": False, "failed": True,
                          "messages": kwargs.get("conversation_history") or []}
            self._pulsar_turn_result = classify_result(result)
            if self._pulsar_turn_result["status"] != "succeeded":
                # Do not relay provider diagnostics/secrets as assistant text.
                result = dict(result) if isinstance(result, dict) else {}
                result["final_response"] = ""
            return result
        run._pulsar_outcome = True
        agent_class.run_conversation = run

    original_prompt = acp_class.prompt
    if not getattr(original_prompt, "_pulsar_outcome", False):
        @wraps(original_prompt)
        async def prompt(self, prompt, session_id, **kwargs):
            from acp.schema import PromptResponse
            state = await asyncio.to_thread(self.session_manager.get_session, session_id)
            engine = state.agent if state else None
            if engine:
                engine._pulsar_turn_result = None
            try:
                response = await original_prompt(self, prompt=prompt, session_id=session_id, **kwargs)
            except Exception:
                response = PromptResponse(stop_reason="refusal")
            outcome = getattr(engine, "_pulsar_turn_result", None) or classify_result(None)
            if getattr(response, "stop_reason", None) == "cancelled":
                outcome = {**outcome, "status": "cancelled", "code": "CANCELLED"}
            elif getattr(response, "stop_reason", None) != "end_turn" and outcome["status"] == "succeeded":
                outcome = {**outcome, "status": "failed", "code": "INCOMPLETE"}
            stop = "end_turn" if outcome["status"] == "succeeded" else (
                "cancelled" if outcome["status"] == "cancelled" else "refusal")
            # Only our closed metadata; do not leak provider exception payloads.
            return PromptResponse(stop_reason=stop, field_meta={"pulsarTurn": outcome})
        prompt._pulsar_outcome = True
        acp_class.prompt = prompt
