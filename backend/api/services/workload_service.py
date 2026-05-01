from decimal import Decimal, ROUND_HALF_UP

from api.models import WorkloadReport


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
        pts = item.allocated_hours or Decimal('0.00')
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

    # Rule 2 / Rule 5 prerequisites missing in current schema.
    # We intentionally flag anomaly until Target Teaching% and Target Band are persisted.
    reasons.append('missing_target_teaching_pct')
    reasons.append('missing_target_band')

    # Rule 3 (tr_denominator_invalid)
    if denominator <= Decimal('0'):
        reasons.append('tr_denominator_invalid')

    calc_tr = Decimal('0.00')
    if denominator > Decimal('0'):
        calc_tr = _quantize_2(teaching_pts / denominator)

    # Rule 4 (tr_out_of_range)
    if calc_tr < Decimal('0') or calc_tr > Decimal('1'):
        reasons.append('tr_out_of_range')

    # Rule 5 (tr_discrepancy): requires target_band which current schema lacks.
    calculated_band = _teaching_band(calc_tr)

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


def persist_report_anomaly(report):
    result = evaluate_mvp_anomaly(report)
    if report.is_anomaly != result['is_anomaly']:
        report.is_anomaly = result['is_anomaly']
        report.save(update_fields=['is_anomaly', 'updated_at'])
    return result
