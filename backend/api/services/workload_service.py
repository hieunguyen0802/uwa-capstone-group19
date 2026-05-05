from decimal import Decimal, ROUND_HALF_UP

from api.models import WorkloadReport

POINT_TO_HOURS = Decimal('17.25')


def get_workload_queryset(staff):
    """
    Returns a WorkloadReport queryset scoped to what `staff` is allowed to see.

    ACADEMIC  — only their own reports
    HOD       — all reports in their department (snapshot_department matches)
    HOS / SCHOOL_OPS — all current reports, no restriction
    """
    qs = WorkloadReport.objects.filter(is_current=True).select_related(
        'staff__user', 'staff__department', 'snapshot_department'
    )
    if staff.role == 'ACADEMIC':
        return qs.filter(staff=staff)
    if staff.role == 'HOD':
        return qs.filter(snapshot_department=staff.department)
    return qs


def _quantize_2(value: Decimal) -> Decimal:
    return value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _teaching_band(calc_tr: Decimal) -> str:
    if calc_tr <= Decimal('0.20'):
        return 'Research Focused'
    if calc_tr <= Decimal('0.79'):
        return 'Balanced Teaching & Research'
    return 'Teaching Focused'


def evaluate_mvp_anomaly(report, department_conflict=False):
    """
    Evaluate MVP anomaly rules from Source/EXCEL.md.

    Returns:
      {
        'is_anomaly': bool,
        'reasons': [str],
        'metrics': {
            'teaching_pts': Decimal,
            'research_pts': Decimal,
            'calc_tr': Decimal,
            'calculated_band': str,
        }
      }
    """
    items = list(report.items.all())

    teaching_pts = Decimal('0.00')
    hdr_pts = Decimal('0.00')
    service_pts = Decimal('0.00')
    assigned_roles_pts = Decimal('0.00')

    for item in items:
        hours = item.allocated_hours or Decimal('0.00')
        pts = hours / POINT_TO_HOURS
        if item.category == 'TEACHING':
            teaching_pts += pts
        elif item.category == 'HDR_SUPERVISION':
            hdr_pts += pts
        elif item.category == 'SERVICE':
            service_pts += pts
        elif item.category == 'ASSIGNED_ROLE':
            assigned_roles_pts += pts

    teaching_pts = _quantize_2(teaching_pts)
    hdr_pts = _quantize_2(hdr_pts)
    service_pts = _quantize_2(service_pts)
    assigned_roles_pts = _quantize_2(assigned_roles_pts)

    expected_points = _quantize_2((report.snapshot_fte or Decimal('0.00')) * Decimal('100'))

    denominator = _quantize_2(expected_points - (assigned_roles_pts + service_pts + hdr_pts))
    research_pts = _quantize_2(expected_points - (teaching_pts + assigned_roles_pts + service_pts + hdr_pts))

    reasons = []

    # Rule 1 (teaching_total_mismatch):
    # Current schema only stores aggregated TEACHING items, not five sub-point columns.
    if teaching_pts < Decimal('0'):
        reasons.append('teaching_total_mismatch')

    target_teaching_pct = getattr(report, 'target_teaching_pct', None)
    target_band = getattr(report, 'target_band', None)

    if target_teaching_pct is not None:
        target_teaching_pts = _quantize_2(
            (Decimal(target_teaching_pct) / Decimal('100')) * Decimal('100') * (report.snapshot_fte or Decimal('0.00'))
        )
        if abs(teaching_pts - target_teaching_pts) > Decimal('0.01'):
            reasons.append('teaching_mismatch')

    # Rule 3 (tr_denominator_invalid)
    if denominator <= Decimal('0'):
        reasons.append('tr_denominator_invalid')

    calc_tr = Decimal('0.00')
    if denominator > Decimal('0'):
        calc_tr = _quantize_2(teaching_pts / denominator)

    # Rule 4 (tr_out_of_range)
    if calc_tr < Decimal('0') or calc_tr > Decimal('1'):
        reasons.append('tr_out_of_range')

    # Rule 5 (tr_discrepancy): compare with target band only when available.
    calculated_band = _teaching_band(calc_tr)
    if target_band is not None and target_band != calculated_band:
        reasons.append('tr_discrepancy')

    if department_conflict:
        reasons.append('department_conflict')

    unique_reasons = sorted(set(reasons))
    return {
        'is_anomaly': len(unique_reasons) > 0,
        'reasons': unique_reasons,
        'metrics': {
            'teaching_pts': teaching_pts,
            'research_pts': research_pts,
            'calc_tr': calc_tr,
            'calculated_band': calculated_band,
        },
    }


def persist_report_anomaly(report, department_conflict=False):
    result = evaluate_mvp_anomaly(report, department_conflict=department_conflict)
    if report.is_anomaly != result['is_anomaly']:
        report.is_anomaly = result['is_anomaly']
        report.save(update_fields=['is_anomaly', 'updated_at'])
    return result


# ─── Shared query helpers (used by both academic and supervisor views) ─────────

def _parse_year_range(request):
    """Parse year_from / year_to from query params. Returns (int|None, int|None).

    Also accepts frontend alias keys from IntegrationLog frontend contract:
      from_year / to_year (e.g. admin & headofschool visualization/export).
    """
    try:
        yf_raw = (
            request.GET.get('year_from')
            or request.GET.get('from_year')
            or ''
        )
        yt_raw = (
            request.GET.get('year_to')
            or request.GET.get('to_year')
            or ''
        )
        year_from = int(yf_raw) if yf_raw else None
        year_to = int(yt_raw) if yt_raw else None
    except (ValueError, TypeError):
        year_from = year_to = None
    return year_from, year_to


def _filter_reports_by_range(qs, year_from, year_to, semester_filter):
    if year_from:
        qs = qs.filter(academic_year__gte=year_from)
    if year_to:
        qs = qs.filter(academic_year__lte=year_to)
    if semester_filter and semester_filter.upper() != 'ALL':
        qs = qs.filter(semester=semester_filter.upper())
    return qs


def _build_semester_label(year: int, semester: str) -> str:
    return f"{year} {semester}"


def _reporting_period_label(year_from, year_to, semester_filter) -> str:
    year_part = f"{year_from or '?'}-{year_to or '?'}"
    sem_part = 'All Semesters' if not semester_filter or semester_filter.upper() == 'ALL' else semester_filter.upper()
    return f"{year_part} {sem_part}"
