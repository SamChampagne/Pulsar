"""Tiny HTTP mock to exercise call_connector_api / push_* blocks.

Run with `python tests/e2e_mock_erp.py` while the studio is up; it
listens on :8765 (matches the seeded `Mock ERP` connector endpoint).
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8765


WORK_ORDERS_RESPONSE = {
    "orders": [
        {
            "id": "WO-1",
            "name": "WO-1 / P-001 batch",
            "product_id": "P-001",
            "quantity": 10,
            "release_date": "2026-05-09",
            "due_date": "2026-05-15",
            "status": "released",
            "operations": [
                {
                    "id": "OP-WO-1-10",
                    "work_order_id": "WO-1",
                    "sequence": 10,
                    "name": "Laser cut",
                    "duration_minutes": 60,
                    "eligible_machine_ids": ["LASER-1"],
                },
                {
                    "id": "OP-WO-1-20",
                    "work_order_id": "WO-1",
                    "sequence": 20,
                    "name": "QA inspection",
                    "duration_minutes": 30,
                    "eligible_machine_ids": ["QA-1"],
                },
            ],
        },
        {
            "id": "WO-2",
            "name": "WO-2 / P-002 batch",
            "product_id": "P-002",
            "quantity": 5,
            "release_date": "2026-05-12",
            "due_date": "2026-05-20",
            "status": "released",
            "operations": [
                {
                    "id": "OP-WO-2-10",
                    "work_order_id": "WO-2",
                    "sequence": 10,
                    "name": "CNC machining",
                    "duration_minutes": 90,
                    "eligible_machine_ids": ["CNC-FAST"],
                },
            ],
        },
    ],
    # Machines + calendars are intentionally NOT exposed by the mock:
    # the canonical machine contract (snapshot_codec._machine_from_json)
    # requires calendar_id, which in turn requires a complete calendar
    # entity. A real ERP integration sources machines from master data
    # already in APS — the mock stays minimal and the starter relies on
    # machines being present in the target workspace at import time.
}


class _Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path.startswith("/work-orders"):
            self._send_json(200, WORK_ORDERS_RESPONSE)
            return
        if self.path.startswith("/health"):
            self._send_json(200, {"ok": True})
            return
        self._send_json(404, {"error": "not_found", "path": self.path})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else ""
        echo = {"received_path": self.path, "body": body[:500]}
        self._send_json(200, echo)

    def log_message(self, format: str, *args) -> None:  # quiet
        return


def main() -> None:
    server = HTTPServer(("0.0.0.0", PORT), _Handler)
    print(f"mock erp listening on :{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == "__main__":
    main()
