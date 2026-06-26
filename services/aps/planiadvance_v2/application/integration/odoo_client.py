"""Thin JSON-RPC client for Odoo external API.

Speaks the `/jsonrpc` endpoint with two services:
- common.authenticate(db, login, key, {}) -> uid
- object.execute_kw(db, uid, key, model, method, args, kwargs) -> result

API keys (Odoo 14+) are passed in the same slot as the password.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

from planiadvance_v2.application.ports import (
    IntegrationHttpRequest,
    IntegrationHttpResponse,
    IntegrationHttpTransport,
)

from .canonical_snapshot import CanonicalPlanningSnapshot
from .odoo_planning_mapper import build_canonical_snapshot_from_odoo

_JSONRPC_HEADERS = {"content-type": "application/json"}

# V1.2 P0.3a — exponential backoff for HTTP 429 (rate limited) from Odoo.
# Three attempts means the client tolerates a short burst of rate limiting
# before bubbling the error up, without holding the calling request
# indefinitely (max wait is 1 + 2 + 4 = 7 seconds across the 3 retries).
_RATE_LIMIT_MAX_RETRIES = 3
_RATE_LIMIT_BASE_DELAY_SECONDS = 1.0


class OdooClientError(Exception):
    """Base error for Odoo client failures."""


class OdooAuthenticationError(OdooClientError):
    """Raised when authenticate() cannot resolve a uid."""


class OdooRpcError(OdooClientError):
    """Raised when execute_kw returns an error or a non-2xx status."""


class OdooClient:
    def __init__(
        self,
        transport: IntegrationHttpTransport,
        *,
        base_url: str,
        database: str,
        username: str,
        api_key: str,
        timeout_seconds: int = 30,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        self._transport = transport
        self._base_url = base_url.rstrip("/")
        self._database = database
        self._username = username
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds
        self._uid: int | None = None
        # `sleep` is injectable so tests can verify the backoff schedule
        # without actually waiting. Production always uses time.sleep.
        self._sleep = sleep or time.sleep

    @property
    def uid(self) -> int | None:
        return self._uid

    def authenticate(self) -> int:
        if self._uid is not None:
            return self._uid

        payload = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {
                "service": "common",
                "method": "authenticate",
                "args": [self._database, self._username, self._api_key, {}],
            },
        }
        response = self._post(payload)
        result = self._parse_rpc_result(response, error_cls=OdooAuthenticationError)
        if not isinstance(result, int) or result <= 0:
            raise OdooAuthenticationError(
                f"Odoo refused authentication for user {self._username!r} on database "
                f"{self._database!r} (result={result!r})"
            )
        self._uid = result
        return result

    def pull_planning_snapshot(
        self,
        *,
        mo_domain: list[Any] | None = None,
        mo_limit: int = 200,
        default_operation_duration_minutes: int = 60,
        source_system: str = "odoo",
    ) -> CanonicalPlanningSnapshot:
        """One-call orchestration: 5 search_reads + map to canonical APS snapshot.

        Pulls mrp.production (filtered by ``mo_domain``), every related
        mrp.workorder, then mrp.workcenter, resource.calendar and
        resource.calendar.attendance referenced by them. Synthesizes
        defaults via odoo_planning_mapper so the result is always
        structurally valid even if the Odoo MRP setup is minimal.
        """

        productions = self.search_read(
            "mrp.production",
            domain=list(mo_domain or []),
            fields=[
                "name",
                "product_id",
                "product_qty",
                "state",
                "date_start",
                "date_finished",
                "priority",
            ],
            limit=mo_limit,
        )
        production_ids = [p["id"] for p in productions if "id" in p]
        workorders = (
            self.search_read(
                "mrp.workorder",
                domain=[["production_id", "in", production_ids]],
                fields=[
                    "name",
                    "production_id",
                    "workcenter_id",
                    "duration_expected",
                    "state",
                ],
                limit=max(mo_limit * 10, 200),
            )
            if production_ids
            else []
        )
        workcenter_ids = sorted(
            {
                wo["workcenter_id"][0]
                for wo in workorders
                if wo.get("workcenter_id")
            }
        )
        workcenters = (
            self.search_read(
                "mrp.workcenter",
                domain=[["id", "in", workcenter_ids]] if workcenter_ids else [],
                fields=[
                    "name",
                    "code",
                    "resource_calendar_id",
                    "time_efficiency",
                    "default_capacity",
                ],
                limit=200,
            )
            if workcenter_ids
            else self.search_read(
                "mrp.workcenter",
                fields=[
                    "name",
                    "code",
                    "resource_calendar_id",
                    "time_efficiency",
                    "default_capacity",
                ],
                limit=200,
            )
        )
        calendar_ids = sorted(
            {
                wc["resource_calendar_id"][0]
                for wc in workcenters
                if wc.get("resource_calendar_id")
            }
        )
        calendars = (
            self.search_read(
                "resource.calendar",
                domain=[["id", "in", calendar_ids]] if calendar_ids else [],
                fields=["name"],
                limit=200,
            )
            if calendar_ids
            else self.search_read(
                "resource.calendar",
                fields=["name"],
                limit=50,
            )
        )
        cal_id_list = [c["id"] for c in calendars if "id" in c]
        attendances = (
            self.search_read(
                "resource.calendar.attendance",
                domain=[["calendar_id", "in", cal_id_list]],
                fields=["calendar_id", "dayofweek", "hour_from", "hour_to"],
                limit=2000,
            )
            if cal_id_list
            else []
        )
        return build_canonical_snapshot_from_odoo(
            productions=productions,
            workorders=workorders,
            workcenters=workcenters,
            calendars=calendars,
            attendances=attendances,
            source_system=source_system,
            default_operation_duration_minutes=default_operation_duration_minutes,
        )

    def search_read(
        self,
        model: str,
        *,
        domain: list[Any] | None = None,
        fields: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        uid = self.authenticate()
        payload = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {
                "service": "object",
                "method": "execute_kw",
                "args": [
                    self._database,
                    uid,
                    self._api_key,
                    model,
                    "search_read",
                    [list(domain or [])],
                    {
                        "fields": list(fields or []),
                        "limit": int(limit),
                        "offset": int(offset),
                    },
                ],
            },
        }
        response = self._post(payload)
        result = self._parse_rpc_result(response, error_cls=OdooRpcError)
        if not isinstance(result, list):
            raise OdooRpcError(
                f"Expected list from search_read({model!r}), got {type(result).__name__}"
            )
        return result

    def write(
        self,
        model: str,
        ids: list[int],
        vals: dict[str, Any],
    ) -> bool:
        if not ids:
            return True
        uid = self.authenticate()
        payload = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {
                "service": "object",
                "method": "execute_kw",
                "args": [
                    self._database,
                    uid,
                    self._api_key,
                    model,
                    "write",
                    [[int(i) for i in ids], dict(vals)],
                ],
            },
        }
        response = self._post(payload)
        result = self._parse_rpc_result(response, error_cls=OdooRpcError)
        if result is not True:
            raise OdooRpcError(
                f"Odoo write({model!r}, {ids!r}) returned {result!r}, expected True"
            )
        return True

    def _post(self, payload: dict[str, Any]) -> IntegrationHttpResponse:
        # V1.2 P0.3a — retry on HTTP 429 with exponential backoff so a
        # short burst of rate-limiting from the ERP doesn't kill an
        # entire flow run. Non-429 errors propagate immediately; the
        # caller (RunIntegrationFlow) decides whether to skip or abort.
        request = IntegrationHttpRequest(
            method="POST",
            url=f"{self._base_url}/jsonrpc",
            headers=dict(_JSONRPC_HEADERS),
            body=json.dumps(payload).encode("utf-8"),
            timeout_seconds=self._timeout_seconds,
        )
        attempt = 0
        while True:
            response = self._transport.send(request)
            if response.status_code != 429:
                return response
            if attempt >= _RATE_LIMIT_MAX_RETRIES:
                return response
            self._sleep(_RATE_LIMIT_BASE_DELAY_SECONDS * (2**attempt))
            attempt += 1

    @staticmethod
    def _parse_rpc_result(
        response: IntegrationHttpResponse,
        *,
        error_cls: type[OdooClientError],
    ) -> Any:
        if response.status_code < 200 or response.status_code >= 300:
            raise error_cls(
                f"Odoo HTTP {response.status_code}: {response.body[:200]!r}"
            )
        try:
            envelope = json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise error_cls(f"Odoo response was not valid JSON: {exc}") from exc

        if "error" in envelope:
            error = envelope["error"] or {}
            data = error.get("data") or {}
            name = data.get("name") or error.get("message") or "OdooError"
            message = data.get("message") or error.get("message") or ""
            raise error_cls(f"{name}: {message}".strip(": "))

        return envelope.get("result")
