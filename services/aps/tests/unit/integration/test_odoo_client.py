from __future__ import annotations

import json

import pytest

from planiadvance_v2.application.integration import (
    OdooAuthenticationError,
    OdooClient,
    OdooRpcError,
)
from planiadvance_v2.application.ports import (
    IntegrationHttpRequest,
    IntegrationHttpResponse,
)


class _RecordingHttpTransport:
    """Test double mirroring the project's HTTP transport fake pattern."""

    def __init__(self) -> None:
        self.requests: list[IntegrationHttpRequest] = []
        self._responses: list[IntegrationHttpResponse] = []

    def queue_json(self, payload: object, *, status_code: int = 200) -> None:
        self._responses.append(
            IntegrationHttpResponse(
                status_code=status_code,
                headers={"content-type": "application/json"},
                body=json.dumps(payload).encode("utf-8"),
            )
        )

    def queue_raw(self, body: bytes, *, status_code: int = 200) -> None:
        self._responses.append(
            IntegrationHttpResponse(status_code=status_code, headers={}, body=body)
        )

    def send(self, request: IntegrationHttpRequest) -> IntegrationHttpResponse:
        self.requests.append(request)
        if not self._responses:
            raise AssertionError(
                f"Unexpected HTTP call (no response queued): {request.method} {request.url}"
            )
        return self._responses.pop(0)


def _make_client(transport: _RecordingHttpTransport) -> OdooClient:
    return OdooClient(
        transport,
        base_url="http://odoo:8069",
        database="planiadvance_test",
        username="admin",
        api_key="sekret-key",
    )


def _body_json(request: IntegrationHttpRequest) -> dict:
    assert request.body is not None
    return json.loads(request.body.decode("utf-8"))


class TestOdooClientAuthenticate:
    def test_sends_common_authenticate_to_jsonrpc_endpoint(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 7})
        client = _make_client(transport)

        uid = client.authenticate()

        assert uid == 7
        assert len(transport.requests) == 1
        request = transport.requests[0]
        assert request.method == "POST"
        assert request.url == "http://odoo:8069/jsonrpc"
        assert request.headers.get("content-type", "").startswith("application/json")
        body = _body_json(request)
        assert body["method"] == "call"
        assert body["params"]["service"] == "common"
        assert body["params"]["method"] == "authenticate"
        assert body["params"]["args"] == ["planiadvance_test", "admin", "sekret-key", {}]

    def test_caches_uid_across_calls(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 12})
        client = _make_client(transport)

        first = client.authenticate()
        second = client.authenticate()

        assert first == 12
        assert second == 12
        assert len(transport.requests) == 1, "should not re-authenticate when uid is cached"

    def test_raises_when_odoo_returns_false_uid(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": False})
        client = _make_client(transport)

        with pytest.raises(OdooAuthenticationError):
            client.authenticate()

    def test_raises_when_odoo_returns_rpc_error(self):
        transport = _RecordingHttpTransport()
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "error": {"code": 200, "message": "Odoo Server", "data": {"name": "AccessDenied"}},
            }
        )
        client = _make_client(transport)

        with pytest.raises(OdooAuthenticationError) as exc_info:
            client.authenticate()
        assert "AccessDenied" in str(exc_info.value) or "Odoo Server" in str(exc_info.value)

    def test_raises_on_http_error_status(self):
        transport = _RecordingHttpTransport()
        transport.queue_raw(b"Service Unavailable", status_code=503)
        client = _make_client(transport)

        with pytest.raises(OdooAuthenticationError) as exc_info:
            client.authenticate()
        assert "503" in str(exc_info.value)

    def test_base_url_trailing_slash_is_normalized(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 1})
        client = OdooClient(
            transport,
            base_url="http://odoo:8069/",
            database="db",
            username="u",
            api_key="k",
        )

        client.authenticate()

        assert transport.requests[0].url == "http://odoo:8069/jsonrpc"


class TestOdooClientSearchRead:
    def test_auto_authenticates_then_executes_search_read(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 7})  # authenticate
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "result": [
                    {"id": 1, "name": "WH/MO/00001", "product_qty": 5.0, "state": "confirmed"},
                    {"id": 2, "name": "WH/MO/00002", "product_qty": 5.0, "state": "confirmed"},
                ],
            }
        )
        client = _make_client(transport)

        records = client.search_read(
            "mrp.production",
            domain=[["state", "=", "confirmed"]],
            fields=["name", "product_qty", "state"],
            limit=50,
        )

        assert len(records) == 2
        assert records[0]["name"] == "WH/MO/00001"
        assert len(transport.requests) == 2

        execute_body = _body_json(transport.requests[1])
        assert execute_body["params"]["service"] == "object"
        assert execute_body["params"]["method"] == "execute_kw"
        args = execute_body["params"]["args"]
        assert args[0] == "planiadvance_test"  # db
        assert args[1] == 7  # uid from authenticate
        assert args[2] == "sekret-key"  # api_key
        assert args[3] == "mrp.production"  # model
        assert args[4] == "search_read"  # method
        assert args[5] == [[["state", "=", "confirmed"]]]  # positional: [domain]
        assert args[6] == {"fields": ["name", "product_qty", "state"], "limit": 50, "offset": 0}

    def test_does_not_re_authenticate_on_second_call(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 7})  # authenticate
        transport.queue_json({"jsonrpc": "2.0", "result": []})  # first search_read
        transport.queue_json({"jsonrpc": "2.0", "result": []})  # second search_read
        client = _make_client(transport)

        client.search_read("mrp.production")
        client.search_read("mrp.workcenter")

        assert len(transport.requests) == 3  # 1 auth + 2 search_read

    def test_defaults_to_empty_domain_no_fields_limit_100(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 1})
        transport.queue_json({"jsonrpc": "2.0", "result": []})
        client = _make_client(transport)

        client.search_read("mrp.production")

        execute_body = _body_json(transport.requests[1])
        args = execute_body["params"]["args"]
        assert args[5] == [[]]  # empty domain
        assert args[6] == {"fields": [], "limit": 100, "offset": 0}

    def test_raises_rpc_error_when_odoo_returns_error(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 1})
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "error": {
                    "code": 200,
                    "message": "Odoo Server",
                    "data": {"name": "ValidationError", "message": "model not found"},
                },
            }
        )
        client = _make_client(transport)

        with pytest.raises(OdooRpcError) as exc_info:
            client.search_read("nonexistent.model")
        assert "ValidationError" in str(exc_info.value) or "model not found" in str(exc_info.value)

    def test_raises_on_http_error_during_execute(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 1})
        transport.queue_raw(b"Internal Server Error", status_code=500)
        client = _make_client(transport)

        with pytest.raises(OdooRpcError) as exc_info:
            client.search_read("mrp.production")
        assert "500" in str(exc_info.value)


class TestOdooClientPullPlanningSnapshot:
    def test_orchestrates_five_search_reads_into_canonical_snapshot(self):
        transport = _RecordingHttpTransport()
        # authenticate
        transport.queue_json({"jsonrpc": "2.0", "result": 7})
        # mrp.production
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "result": [
                    {
                        "id": 1,
                        "name": "WH/MO/00001",
                        "product_id": [42, "Palette"],
                        "product_qty": 5.0,
                        "state": "confirmed",
                        "date_start": "2026-05-15 08:00:00",
                        "date_finished": "2026-05-15 17:00:00",
                        "priority": "0",
                    }
                ],
            }
        )
        # mrp.workorder (related to MO 1)
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "result": [
                    {
                        "id": 10,
                        "name": "Cut",
                        "production_id": [1, "WH/MO/00001"],
                        "workcenter_id": [100, "Cut Station"],
                        "duration_expected": 90.0,
                        "state": "ready",
                    }
                ],
            }
        )
        # mrp.workcenter
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "result": [
                    {
                        "id": 100,
                        "name": "Cut Station",
                        "code": "CUT",
                        "resource_calendar_id": [1000, "Std"],
                        "time_efficiency": 100.0,
                        "default_capacity": 1.0,
                    }
                ],
            }
        )
        # resource.calendar
        transport.queue_json(
            {"jsonrpc": "2.0", "result": [{"id": 1000, "name": "Standard 40h"}]}
        )
        # resource.calendar.attendance
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "result": [
                    {
                        "id": 9001,
                        "calendar_id": [1000, "Standard 40h"],
                        "dayofweek": "0",
                        "hour_from": 8.0,
                        "hour_to": 17.0,
                    }
                ],
            }
        )
        client = _make_client(transport)

        snapshot = client.pull_planning_snapshot()

        # 1 authenticate + 5 search_reads = 6 HTTP calls
        assert len(transport.requests) == 6
        assert snapshot.source_system == "odoo"
        assert len(snapshot.work_orders) == 1
        wo = snapshot.work_orders[0]
        assert wo.id == "1"
        assert len(wo.operations) == 1
        assert wo.operations[0].duration_minutes == 90
        assert len(snapshot.machines) == 1
        assert snapshot.machines[0].id == "100"
        assert snapshot.metadata["vendor"] == "odoo"
        assert snapshot.metadata["productions_count"] == 1

    def test_synthesizes_defaults_when_odoo_has_no_workcenters_or_routings(self):
        """Sam's actual Odoo state: 2 MOs, 0 workorders, 0 workcenters."""
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 2})  # authenticate
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "result": [
                    {"id": 1, "name": "WH/MO/00001", "product_id": [1, "Palette"], "product_qty": 5.0, "state": "confirmed"},
                    {"id": 2, "name": "WH/MO/00002", "product_id": [4, "Petite Palette"], "product_qty": 5.0, "state": "confirmed"},
                ],
            }
        )
        transport.queue_json({"jsonrpc": "2.0", "result": []})  # no workorders
        transport.queue_json({"jsonrpc": "2.0", "result": []})  # no workcenters
        transport.queue_json({"jsonrpc": "2.0", "result": [{"id": 1000, "name": "Standard"}]})
        transport.queue_json({"jsonrpc": "2.0", "result": []})  # no attendances
        client = _make_client(transport)

        snapshot = client.pull_planning_snapshot(default_operation_duration_minutes=120)

        assert len(snapshot.work_orders) == 2
        for wo in snapshot.work_orders:
            assert len(wo.operations) == 1
            assert wo.operations[0].duration_minutes == 120
        # One synthetic default machine
        assert len(snapshot.machines) == 1
        assert snapshot.metadata["synthesized_default_machine"] is True


class TestOdooClientWrite:
    def test_sends_execute_kw_write_with_ids_and_vals(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 7})  # authenticate
        transport.queue_json({"jsonrpc": "2.0", "result": True})
        client = _make_client(transport)

        ok = client.write(
            "mrp.production",
            [1, 2],
            {"date_start": "2026-05-15 08:00:00"},
        )

        assert ok is True
        # 1 authenticate + 1 write
        assert len(transport.requests) == 2
        body = _body_json(transport.requests[1])
        params = body["params"]
        assert params["service"] == "object"
        assert params["method"] == "execute_kw"
        args = params["args"]
        assert args[0] == "planiadvance_test"
        assert args[1] == 7
        assert args[3] == "mrp.production"
        assert args[4] == "write"
        # write payload: [[ids], {vals}]
        assert args[5][0] == [1, 2]
        assert args[5][1] == {"date_start": "2026-05-15 08:00:00"}

    def test_returns_true_without_http_call_when_ids_empty(self):
        transport = _RecordingHttpTransport()
        client = _make_client(transport)

        ok = client.write("mrp.production", [], {"date_start": "x"})

        assert ok is True
        assert transport.requests == []

    def test_raises_when_odoo_returns_non_true(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 7})
        transport.queue_json({"jsonrpc": "2.0", "result": False})
        client = _make_client(transport)

        with pytest.raises(OdooRpcError):
            client.write("mrp.production", [1], {"x": 1})

    def test_propagates_rpc_error_from_odoo(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 7})
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "error": {
                    "code": 200,
                    "message": "Odoo Server",
                    "data": {"name": "ValidationError", "message": "bad field"},
                },
            }
        )
        client = _make_client(transport)

        with pytest.raises(OdooRpcError) as exc_info:
            client.write("mrp.production", [1], {"bogus": 1})
        assert "ValidationError" in str(exc_info.value) or "bad field" in str(exc_info.value)


# ---------------------------------------------------------------------------
# V1.2 P0.3a — HTTP 429 rate-limit backoff
# ---------------------------------------------------------------------------


def _make_client_with_sleep_recorder(
    transport: _RecordingHttpTransport,
) -> tuple[OdooClient, list[float]]:
    """Build a client whose sleep() invocations are recorded instead of
    blocking the test process. Returns (client, sleeps)."""

    sleeps: list[float] = []

    def _record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    client = OdooClient(
        transport,
        base_url="http://odoo:8069",
        database="planiadvance_test",
        username="admin",
        api_key="sekret-key",
        sleep=_record_sleep,
    )
    return client, sleeps


class TestOdooRateLimitBackoff:
    """When Odoo returns HTTP 429 (rate limited), the client retries with
    exponential backoff (1s, 2s, 4s) for up to 3 attempts before giving
    up. Non-429 responses propagate immediately so the caller can decide
    whether to skip or abort the flow."""

    def test_succeeds_after_one_429(self):
        transport = _RecordingHttpTransport()
        # First call: 429. Second call: real auth response.
        transport.queue_raw(b"rate limited", status_code=429)
        transport.queue_json({"jsonrpc": "2.0", "result": 7})

        client, sleeps = _make_client_with_sleep_recorder(transport)
        uid = client.authenticate()

        assert uid == 7
        assert len(transport.requests) == 2  # one 429, one success
        assert sleeps == [1.0]  # waited 1s after the first 429

    def test_succeeds_after_three_429s(self):
        transport = _RecordingHttpTransport()
        transport.queue_raw(b"rate limited", status_code=429)
        transport.queue_raw(b"rate limited", status_code=429)
        transport.queue_raw(b"rate limited", status_code=429)
        transport.queue_json({"jsonrpc": "2.0", "result": 7})

        client, sleeps = _make_client_with_sleep_recorder(transport)
        uid = client.authenticate()

        assert uid == 7
        assert len(transport.requests) == 4
        assert sleeps == [1.0, 2.0, 4.0]  # exponential 1, 2, 4

    def test_gives_up_after_max_retries(self):
        transport = _RecordingHttpTransport()
        # 4 consecutive 429s: 1 initial + 3 retries, all 429.
        for _ in range(4):
            transport.queue_raw(b"rate limited", status_code=429)

        client, sleeps = _make_client_with_sleep_recorder(transport)

        # The error bubbles up through _parse_rpc_result (429 is a non-2xx).
        with pytest.raises(OdooAuthenticationError) as exc_info:
            client.authenticate()

        assert "429" in str(exc_info.value)
        # 4 HTTP calls (1 initial + 3 retries), 3 sleeps in between.
        assert len(transport.requests) == 4
        assert sleeps == [1.0, 2.0, 4.0]

    def test_no_sleep_on_immediate_success(self):
        transport = _RecordingHttpTransport()
        transport.queue_json({"jsonrpc": "2.0", "result": 7})

        client, sleeps = _make_client_with_sleep_recorder(transport)
        client.authenticate()

        assert sleeps == []  # no backoff when first call succeeds

    def test_non_429_errors_do_not_trigger_retry(self):
        """A 500 from Odoo is a server-side bug, not a rate limit — we
        must NOT retry it (would amplify the issue and delay the user)."""

        transport = _RecordingHttpTransport()
        transport.queue_raw(b"internal error", status_code=500)

        client, sleeps = _make_client_with_sleep_recorder(transport)

        with pytest.raises(OdooAuthenticationError):
            client.authenticate()

        assert len(transport.requests) == 1  # no retry
        assert sleeps == []

    def test_429_on_write_path_also_backs_off(self):
        """Search_read and write share the same _post() path, so a 429
        on a push_schedule call also retries. Pin this with the write
        endpoint since slice 3 made it production-critical."""

        transport = _RecordingHttpTransport()
        # First call: authenticate (200).
        transport.queue_json({"jsonrpc": "2.0", "result": 7})
        # Second call: write() → 429 → retry → success.
        transport.queue_raw(b"rate limited", status_code=429)
        transport.queue_json({"jsonrpc": "2.0", "result": True})

        client, sleeps = _make_client_with_sleep_recorder(transport)
        ok = client.write("mrp.production", [1], {"date_start": "2026-01-05 08:00:00"})

        assert ok is True
        assert len(transport.requests) == 3
        assert sleeps == [1.0]
