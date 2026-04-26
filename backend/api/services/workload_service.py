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
        # Use snapshot_department so historical data stays scoped correctly
        # even if a staff member later transfers to another department.
        return qs.filter(snapshot_department=staff.department)
    # HOS and SCHOOL_OPS see everything
    return qs
