"""Deterministic, site-scoped material requirements planning.

This is planning, not an inventory ledger or finite-capacity scheduler. Quantities
cross the bridge as decimal strings. Parent netting precedes child explosion so
shared components consume stock once, after ALL parent requirements are known.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_CEILING, Decimal, localcontext
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_BOM_EDGES = 20_000
MAX_EXPLODED_REQUIREMENTS = 100_000


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Component(StrictModel):
    item_id: str
    quantity: Decimal = Field(gt=0, le=1000000000, max_digits=20, decimal_places=9)


class Item(StrictModel):
    id: str
    sku: str
    name: str
    unit: str
    method: Literal["BUY", "MAKE"]
    on_hand: Decimal = Field(ge=0, le=100000000000)
    safety_stock: Decimal = Field(default=Decimal(0), ge=0, le=1000000000)
    minimum_order: Decimal = Field(default=Decimal(0), ge=0, le=1000000000)
    order_multiple: Decimal = Field(default=Decimal("0.001"), gt=0, le=1000000000)
    lead_days: int = Field(default=0, ge=0, le=3650)
    components: list[Component] = Field(default_factory=list, max_length=500)


class Flow(StrictModel):
    id: str
    item_id: str
    quantity: Decimal = Field(gt=0, le=1000000000, max_digits=14, decimal_places=3)
    date: date
    reference: str = Field(max_length=200)


class MrpRequest(StrictModel):
    version: Literal["pulsar.mrp.v1"]
    as_of: date
    horizon_end: date
    items: list[Item] = Field(max_length=2000)
    demands: list[Flow] = Field(max_length=10000)
    supplies: list[Flow] = Field(max_length=10000)


def _quantity(value: Decimal) -> str:
    if not value.is_finite() or abs(value) > Decimal("1000000000000000000"):
        raise ValueError("MRP quantity exceeds the supported planning range")
    return format(value.normalize(), "f")


def calculate_mrp(request: MrpRequest) -> dict:
    with localcontext() as context:
        context.prec = 40
        return _calculate(request)


def _calculate(request: MrpRequest) -> dict:
    if not 0 <= (request.horizon_end - request.as_of).days <= 730:
        raise ValueError("Planning horizon must be ordered and at most 730 days")
    items = {item.id: item for item in request.items}
    if sum(len(item.components) for item in request.items) > MAX_BOM_EDGES:
        raise ValueError("MRP BOM graph exceeds the supported edge limit")
    if len(items) != len(request.items):
        raise ValueError("Duplicate item in MRP snapshot")
    incoming = {key: 0 for key in items}
    depth = dict.fromkeys(items, 0)
    children: dict[str, dict[str, Decimal]] = {}
    for item in request.items:
        if not item.unit.strip():
            raise ValueError(f"Missing unit: {item.sku}")
        if item.method == "MAKE" and not item.components:
            raise ValueError(f"MAKE item requires a non-empty BOM: {item.sku}")
        if item.method == "BUY" and item.components:
            raise ValueError(f"BUY item cannot explode a BOM: {item.sku}")
        merged: dict[str, Decimal] = defaultdict(Decimal)
        for component in item.components:
            if component.item_id not in items:
                raise ValueError(f"Missing component policy: {component.item_id}")
            merged[component.item_id] += component.quantity
        children[item.id] = merged
        for key in merged:
            incoming[key] += 1

    # Kahn's algorithm: deterministic low-level ordering, without recursive depth risk.
    ready = sorted(key for key in items if incoming[key] == 0)
    ordered = []
    while ready:
        key = ready.pop(0)
        ordered.append(key)
        for child in sorted(children[key]):
            incoming[child] -= 1
            depth[child] = max(depth[child], depth[key] + 1)
            if depth[child] > 50:
                raise ValueError("BOM exceeds 50 levels")
            if incoming[child] == 0:
                ready.append(child)
                ready.sort()
    if len(ordered) != len(items):
        raise ValueError("Circular BOM: " + ", ".join(items[k].sku for k in items if incoming[k]))

    demand: dict[str, list[dict]] = defaultdict(list)
    supply: dict[str, list[Flow]] = defaultdict(list)
    exceptions = []
    seen = set()
    for kind, flows in (("demand", request.demands), ("supply", request.supplies)):
        for flow in flows:
            if (kind, flow.id) in seen or flow.item_id not in items:
                raise ValueError(f"Duplicate flow or unknown item: {flow.id}")
            seen.add((kind, flow.id))
            if flow.date > request.horizon_end:
                continue
            if kind == "demand":
                demand[flow.item_id].append(
                    dict(
                        date=flow.date,
                        quantity=flow.quantity,
                        source=flow.id,
                        reference=flow.reference,
                    )
                )
            elif flow.date < request.as_of:
                # An overdue promise is NOT stock and must not silently cover today's need.
                exceptions.append(
                    dict(
                        code="OVERDUE_SUPPLY",
                        item_id=flow.item_id,
                        source=flow.id,
                        date=flow.date.isoformat(),
                        quantity=_quantity(flow.quantity),
                    )
                )
            else:
                supply[flow.item_id].append(flow)

    proposals, rows = [], []
    exploded_count = 0
    for key in ordered:
        item = items[key]
        balance = item.on_hand
        days: dict[date, dict] = defaultdict(lambda: dict(demands=[], supplies=[]))
        for flow in demand[key]:
            days[max(flow["date"], request.as_of)]["demands"].append(flow)
        for flow in supply[key]:
            days[flow.date]["supplies"].append(flow)
        # Safety stock is a FLOOR, not a recurring additional consumption.
        days[request.as_of]
        timeline = []
        gross_total = Decimal(0)
        planned_total = Decimal(0)
        for day in sorted(days):
            bucket = days[day]
            sources = sorted(bucket["demands"], key=lambda value: (value["date"], value["source"]))
            gross = sum((value["quantity"] for value in sources), Decimal(0))
            receipt = sum((value.quantity for value in bucket["supplies"]), Decimal(0))
            available = balance + receipt
            shortage = max(Decimal(0), gross + item.safety_stock - available)
            planned = Decimal(0)
            if shortage:
                planned = (
                    max(shortage, item.minimum_order) / item.order_multiple
                ).to_integral_value(rounding=ROUND_CEILING) * item.order_multiple
                release = day - timedelta(days=item.lead_days)
                proposal_id = f"{key}:{day.isoformat()}"
                proposals.append(
                    dict(
                        id=proposal_id,
                        item_id=key,
                        method=item.method,
                        quantity=_quantity(planned),
                        net_requirement=_quantity(shortage),
                        receipt_date=day.isoformat(),
                        release_date=release.isoformat(),
                        expedite=release < request.as_of,
                        level=depth[key],
                        reasons=[
                            dict(
                                source=s["source"],
                                reference=s["reference"],
                                date=s["date"].isoformat(),
                                quantity=_quantity(s["quantity"]),
                            )
                            for s in sources
                        ],
                        safety_stock=_quantity(item.safety_stock),
                    )
                )
                if release < request.as_of:
                    exceptions.append(
                        dict(
                            code="LATE_RELEASE",
                            item_id=key,
                            source=proposal_id,
                            date=release.isoformat(),
                            quantity=_quantity(planned),
                        )
                    )
                for child, ratio in children[key].items():
                    exploded_count += 1
                    if exploded_count > MAX_EXPLODED_REQUIREMENTS:
                        raise ValueError("MRP explosion too large; reduce the horizon or scope")
                    quantity = planned * ratio
                    _quantity(quantity)
                    demand[child].append(
                        dict(
                            date=release,
                            quantity=quantity,
                            source=proposal_id,
                            reference=f"{item.sku} · {day.isoformat()}",
                        )
                    )
                if len(proposals) > 20000:
                    raise ValueError("MRP exceeds 20,000 proposals; reduce the horizon or scope")
            balance = available + planned - gross
            gross_total += gross
            planned_total += planned
            if sources or receipt or planned:
                timeline.append(
                    dict(
                        date=day.isoformat(),
                        gross=_quantity(gross),
                        scheduled_receipts=_quantity(receipt),
                        planned_receipts=_quantity(planned),
                        projected=_quantity(balance),
                        sources=[
                            dict(
                                id=s["source"],
                                reference=s["reference"],
                                quantity=_quantity(s["quantity"]),
                            )
                            for s in sources
                        ],
                    )
                )
        rows.append(
            dict(
                item_id=key,
                sku=item.sku,
                name=item.name,
                unit=item.unit,
                method=item.method,
                level=depth[key],
                on_hand=_quantity(item.on_hand),
                gross_requirement=_quantity(gross_total),
                planned_receipts=_quantity(planned_total),
                projected_end=_quantity(balance),
                timeline=timeline,
            )
        )
    return dict(
        version="pulsar.mrp.v1",
        engine_revision="planiadvance-d26a8cd.pulsar-mrp1",
        as_of=request.as_of.isoformat(),
        horizon_end=request.horizon_end.isoformat(),
        proposals=proposals,
        items=rows,
        exceptions=exceptions,
        assumptions=[
            "One warehouse; no transfers or reservations",
            "Calendar-day lead times; infinite capacity",
            "Receipts on a date precede that date's demand",
            "Proposals are not firm supply or stock",
            "BOM quantity is component stock units per one parent stock unit; no implicit conversion",
        ],
    )
