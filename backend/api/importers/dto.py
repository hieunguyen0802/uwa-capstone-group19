from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class WorkloadRowDTO:
    """
    Parsed representation of one row in the import template.
    All hour values are already scaled (Daniela applies contact-hour ratios before upload).
    Fields semester, academic_year, department come from the file header if not present per-row.
    """
    staff_number: str
    staff_name: str
    fte: float
    function: str           # 'T & R' | 'Teach (TI)' | 'Resrch'
    target_band: str        # 'Balanced Teaching & Research' | 'Teaching Focused' | 'Research Focused'
    target_teaching_pct: float
    staff_type: str         # 'Academic staff' | 'Paid casual staff'

    # Teaching (per unit) — one DTO per row, unit_code may be blank for non-teaching staff
    unit_code: Optional[str]
    unit_enrolment: Optional[int]
    teaching_hrs: float
    unit_coord_hrs: float
    teaching_activity_hrs: float
    unit_supervision_hrs: float
    new_unit_dev_hrs: float

    # HDR supervision
    hdr_total_hrs: float

    # Service & roles
    assigned_roles_total_pts: float

    # Context fields — sourced from file header or per-row columns
    semester: str           # 'S1' | 'S2'
    academic_year: int      # e.g. 2025
    department: str         # department name, matched to Department table
