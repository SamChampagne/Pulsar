"""Edge case probe 06: fresh DB without seed — API behavior.

Hits each canonical-flow endpoint. Captures status + body excerpt.
Goal: no HTTP 500 anywhere; clean 401/403/404/422 with structured body.
"""
import httpx

BASE = "http://localhost:8000"
HEADERS = {"X-Organization-Id": "missing", "X-User-Id": "missing"}


def hit(method: str, path: str, **kwargs) -> None:
    try:
        resp = httpx.request(method, f"{BASE}{path}", timeout=10, **kwargs)
        body = resp.text[:300].replace("\n", " ")
        print(f"  {method} {path} -> {resp.status_code}: {body}")
    except Exception as exc:
        print(f"  {method} {path} -> EXCEPTION: {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    hit("GET", "/health")
    hit("GET", "/ready")
    hit("GET", "/auth/me", headers=HEADERS)
    hit("POST", "/auth/login", json={"organization_id": "missing", "user_id": "missing"})
    hit("GET", "/scheduling/runs", headers=HEADERS)
    hit("POST", "/scheduling/run", json={"horizon_days": 14, "strategy": "greedy"}, headers=HEADERS)
    hit("GET", "/scheduling/runs/sched-not-real/dashboard", headers=HEADERS)
    hit("GET", "/scheduling/runs/sched-not-real/gantt", headers=HEADERS)
    hit("GET", "/work-orders", headers=HEADERS)
    hit("GET", "/machines", headers=HEADERS)
    hit("GET", "/scheduling/strategies")
