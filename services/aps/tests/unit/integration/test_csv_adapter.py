from __future__ import annotations

from datetime import datetime

import pytest

from planiadvance_v2.application.integration import (
    CanonicalCsvBundle,
    snapshot_from_csv_bundle,
    validate_snapshot_report,
)


class TestCanonicalCsvAdapter:
    def test_csv_bundle_builds_valid_canonical_snapshot(self):
        snapshot = snapshot_from_csv_bundle(
            CanonicalCsvBundle(
                source_system="erp-csv",
                exported_at=datetime(2026, 1, 5, 7, 0, 0),
                metadata={"site_id": "plant-qc"},
                calendars_csv=(
                    "id,name,weekday,start,end,site_id\n"
                    "CAL-1,Day shift,0,08:00,17:00,plant-qc\n"
                    "CAL-1,Day shift,1,08:00,17:00,plant-qc\n"
                ),
                machines_csv=(
                    "id,name,calendar_id,capabilities,efficiency,site_id\n"
                    "M1,Cutter,CAL-1,cut;primary,1.0,plant-qc\n"
                ),
                work_orders_csv=(
                    "id,name,product_id,item_id,quantity,quantity_uom,"
                    "release_date,due_date,requested_date,priority,status,site_id,"
                    "erp_status,order_type\n"
                    "WO-1,Order 1,P1,ERP-P1,5,case,2026-01-05T08:00:00,"
                    "2026-01-06T17:00:00,2026-01-06T17:00:00,high,released,"
                    "plant-qc,FirmPlanned,manufacturing\n"
                ),
                operations_csv=(
                    "id,work_order_id,sequence,name,duration_minutes,"
                    "eligible_machine_ids,setup_minutes,dependencies,status\n"
                    "OP-1,WO-1,1,Cut,60,M1,10,,pending\n"
                ),
            )
        )

        report = validate_snapshot_report(snapshot)

        assert report.valid is True
        assert snapshot.source_system == "erp-csv"
        assert snapshot.calendars[0].site_id == "plant-qc"
        assert snapshot.machines[0].capabilities == ("cut", "primary")
        assert snapshot.work_orders[0].item_id == "ERP-P1"
        assert snapshot.work_orders[0].quantity_uom == "case"
        assert snapshot.work_orders[0].operations[0].eligible_machine_ids == ("M1",)
        assert snapshot.metadata["source_rows"]["operation"]["OP-1"] == {
            "source_file": "operations.csv",
            "source_row": 2,
        }

    def test_validation_issues_include_csv_source_location(self):
        snapshot = snapshot_from_csv_bundle(
            CanonicalCsvBundle(
                calendars_csv="id,name,weekday,start,end\nCAL-1,Day,0,08:00,17:00\n",
                machines_csv="id,name,calendar_id\nM1,Cutter,CAL-1\n",
                work_orders_csv=(
                    "id,name,product_id,item_id,quantity,quantity_uom,"
                    "release_date,due_date\n"
                    "WO-1,Order 1,P1,ERP-P1,5,ea,2026-01-05T08:00:00,"
                    "2026-01-06T17:00:00\n"
                ),
                operations_csv=(
                    "id,work_order_id,sequence,name,duration_minutes,"
                    "eligible_machine_ids\n"
                    "OP-1,WO-1,1,Cut,60,GHOST-MACHINE\n"
                ),
            )
        )

        report = validate_snapshot_report(snapshot)
        issue = next(
            issue for issue in report.issues if issue.kind == "unknown_machine"
        )

        assert issue.source_file == "operations.csv"
        assert issue.source_row == 2

    def test_csv_bundle_requires_work_order_quantity(self):
        with pytest.raises(ValueError, match="quantity"):
            snapshot_from_csv_bundle(
                CanonicalCsvBundle(
                    calendars_csv="id,name,weekday,start,end\nCAL-1,Day,0,08:00,17:00\n",
                    machines_csv="id,name,calendar_id\nM1,Cutter,CAL-1\n",
                    work_orders_csv=(
                        "id,name,product_id,quantity,release_date,due_date\n"
                        "WO-1,Order 1,P1,,2026-01-05T08:00:00,2026-01-06T17:00:00\n"
                    ),
                    operations_csv=(
                        "id,work_order_id,sequence,name,duration_minutes,eligible_machine_ids\n"
                        "OP-1,WO-1,1,Cut,60,M1\n"
                    ),
                )
            )
