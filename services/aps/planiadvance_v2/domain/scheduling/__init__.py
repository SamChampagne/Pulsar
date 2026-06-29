"""APS scheduling engine — pure domain logic.

Public entrypoints:

- :class:`Scheduler`: legacy orchestrator, kept mainly for backward
  compatibility. New runtime flows should go through
  :func:`resolve_strategy`.
- :class:`SchedulerStrategy`: pluggable algorithm contract. Built-in
  strategies include ``greedy`` (forward dispatching), ``backward``
  (just-in-time), ``hybrid`` (forward/backward portfolio), ``infinite``
  (rough-cut), and ``cpsat`` (OR-Tools exact solver). Pick one via
  :func:`resolve_strategy`.
- :class:`SchedulingContext`: the bundle of inputs (work orders, machines,
  calendars, resources, horizon).
- :class:`Objective`: weighted multi-objective cost function.
- :class:`InfeasibilityReport`: structured diagnosis returned when a run
  cannot complete.
- :mod:`heuristics`: pluggable operation-ordering strategies (used by
  the greedy strategy).
- :mod:`constraints`: pluggable feasibility rules.

The engine has **no** dependency on the database, FastAPI or any framework,
so it can be exercised by plain pytest without fixtures.
"""

from .analysis import (
    BottleneckResult,
    CriticalPathResult,
    GanttEntry,
    MachineAnalysis,
    ScheduleAnalysis,
    WorkOrderFlowTime,
    analyze_schedule,
    compute_bottleneck,
    compute_critical_path,
    compute_flow_times,
    export_gantt,
)
from .backward_strategy import BackwardGreedyStrategy  # noqa: E402, F401
from .calendar_resolver import CalendarResolver
from .capacity import (
    MachineCapacityBucket,
    MachineCapacityLedger,
    MachineCapacitySummary,
    build_machine_capacity_ledger,
)
from .context import SchedulingContext
from .cpsat_strategy import CpSatOptions, CpSatStrategy  # noqa: E402, F401
from .diagnosis import (
    Blocker,
    BlockerKind,
    InfeasibilityReport,
    OperationDiagnosis,
)
from .feasibility import (
    FeasibilityIssue,
    FeasibilityReport,
    IssueKind,
    IssueSeverity,
    RelaxationSuggestion,
    check_feasibility,
    suggest_relaxations,
)
from .frozen import FrozenAssignment
from .genetic_algorithm_strategy import (  # noqa: E402, F401
    GeneticAlgorithmOptions,
    GeneticAlgorithmStrategy,
)

# Import the concrete strategies so they auto-register themselves.
# Kept at the bottom to avoid circular imports with the rest of the package.
from .greedy_strategy import GreedyStrategy  # noqa: E402, F401
from .heuristics import (
    ApparentTardinessCost,
    CriticalRatioFirst,
    EarliestDueDateFirst,
    Heuristic,
    ShortestProcessingTimeFirst,
    resolve_heuristic,
)
from .hybrid_strategy import HybridForwardBackwardStrategy  # noqa: E402, F401
from .infinite_strategy import InfiniteCapacityStrategy  # noqa: E402, F401
from .lns_strategy import LNSOptions, LNSStrategy  # noqa: E402, F401
from .lot_splitter import LotSplitResult, reassemble_schedule, split_lots
from .material_ledger import MaterialAssessment, MaterialLedger, MaterialReservation
from .metrics import ScheduleMetrics, ScheduleStability, compute_metrics
from .multi_start_strategy import (  # noqa: E402, F401
    MultiStartConfig,
    MultiStartOptions,
    MultiStartStrategy,
)
from .objective import Objective, score_schedule
from .scheduler import Scheduler
from .setup_lookup import resolve_setup_minutes
from .simulated_annealing_strategy import (  # noqa: E402, F401
    SimulatedAnnealingOptions,
    SimulatedAnnealingStrategy,
)
from .slot_finder import SlotFinder
from .strategy import (
    SchedulerStrategy,
    StrategyResult,
    available_strategies,
    available_strategy_profiles,
    get_strategy_profile,
    register_strategy,
    resolve_strategy,
)
from .tabu_search_strategy import (  # noqa: E402, F401
    TabuSearchOptions,
    TabuSearchStrategy,
)
from .timeline import ResourceTimeline

__all__ = [
    "ApparentTardinessCost",
    "BackwardGreedyStrategy",
    "Blocker",
    "BottleneckResult",
    "BlockerKind",
    "CalendarResolver",
    "CpSatOptions",
    "CpSatStrategy",
    "CriticalPathResult",
    "CriticalRatioFirst",
    "EarliestDueDateFirst",
    "FeasibilityIssue",
    "FeasibilityReport",
    "FrozenAssignment",
    "GanttEntry",
    "GeneticAlgorithmOptions",
    "GeneticAlgorithmStrategy",
    "GreedyStrategy",
    "HybridForwardBackwardStrategy",
    "LNSOptions",
    "LNSStrategy",
    "LotSplitResult",
    "MachineAnalysis",
    "MachineCapacityBucket",
    "MachineCapacityLedger",
    "MachineCapacitySummary",
    "MaterialAssessment",
    "MaterialLedger",
    "MaterialReservation",
    "MultiStartConfig",
    "MultiStartOptions",
    "MultiStartStrategy",
    "Heuristic",
    "InfiniteCapacityStrategy",
    "InfeasibilityReport",
    "IssueKind",
    "IssueSeverity",
    "Objective",
    "OperationDiagnosis",
    "RelaxationSuggestion",
    "ResourceTimeline",
    "ScheduleAnalysis",
    "ScheduleMetrics",
    "ScheduleStability",
    "Scheduler",
    "SchedulerStrategy",
    "SchedulingContext",
    "ShortestProcessingTimeFirst",
    "SimulatedAnnealingOptions",
    "SimulatedAnnealingStrategy",
    "SlotFinder",
    "TabuSearchOptions",
    "TabuSearchStrategy",
    "WorkOrderFlowTime",
    "StrategyResult",
    "analyze_schedule",
    "available_strategies",
    "available_strategy_profiles",
    "build_machine_capacity_ledger",
    "check_feasibility",
    "compute_bottleneck",
    "compute_critical_path",
    "compute_flow_times",
    "compute_metrics",
    "export_gantt",
    "get_strategy_profile",
    "reassemble_schedule",
    "register_strategy",
    "resolve_heuristic",
    "resolve_setup_minutes",
    "resolve_strategy",
    "score_schedule",
    "split_lots",
    "suggest_relaxations",
]
