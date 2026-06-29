"""Use cases that build report payloads consumed by the PdfRenderer."""

from .build_executive_dashboard import BuildExecutiveDashboard
from .build_late_order_report import BuildLateOrderReport
from .build_production_sheet import (
    BuildProductionSheet,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    ReportError,
    RequestedDateOutsideHorizon,
)
from .build_wo_traveler import BuildWoTraveler, WorkOrderNotFoundForReport
from .executive_dashboard_payload import (
    ExecutiveDashboardOutput,
    KpiSnapshot,
    ScheduleSample,
    TopLateOrder,
)
from .late_order_classifier import classify_late_order_reason
from .late_order_payload import (
    REASON_TO_ACTION,
    LateOrderLine,
    LateOrderPayload,
    LateOrderReason,
    RecommendedAction,
)
from .production_sheet_payload import ProductionSheetLine, ProductionSheetPayload
from .wo_traveler_payload import (
    CoverageStatus,
    WoTravelerMaterialLine,
    WoTravelerOperationLine,
    WoTravelerPayload,
)

__all__ = [
    "BuildExecutiveDashboard",
    "BuildLateOrderReport",
    "BuildProductionSheet",
    "BuildWoTraveler",
    "CoverageStatus",
    "ExecutiveDashboardOutput",
    "KpiSnapshot",
    "LateOrderLine",
    "LateOrderPayload",
    "LateOrderReason",
    "MachineNotFoundForReport",
    "NoPublishedScheduleForReport",
    "ProductionSheetLine",
    "ProductionSheetPayload",
    "REASON_TO_ACTION",
    "RecommendedAction",
    "ReportError",
    "RequestedDateOutsideHorizon",
    "ScheduleSample",
    "TopLateOrder",
    "WoTravelerMaterialLine",
    "WoTravelerOperationLine",
    "WoTravelerPayload",
    "WorkOrderNotFoundForReport",
    "classify_late_order_reason",
]
