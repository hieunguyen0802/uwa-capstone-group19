from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AuditLog, Department, Staff, WorkloadItem, WorkloadReport


# ─── Shared test fixture ──────────────────────────────────────────────────────

class BaseTestCase(APITestCase):
    """
    Creates two departments and one staff member per role.
    All tests inherit from this so they don't repeat setup code.

    Java equivalent: a @BeforeEach method in a JUnit base class.
    """

    def setUp(self):
        # Two departments — used to verify HOD cannot cross department boundaries
        self.dept_csse = Department.objects.create(name='CSSE')
        self.dept_physics = Department.objects.create(name='Physics')

        # One staff per role
        self.academic = self._make_staff('academic1', 'ACADEMIC', self.dept_csse)
        self.hod_csse = self._make_staff('hod_csse', 'HOD', self.dept_csse)
        self.hod_phys = self._make_staff('hod_phys', 'HOD', self.dept_physics)
        self.ops = self._make_staff('ops1', 'SCHOOL_OPS', self.dept_csse)
        self.hos = self._make_staff('hos1', 'HOS', self.dept_csse)

        # One INITIAL report belonging to the CSSE academic (Daniela just imported it)
        self.report = WorkloadReport.objects.create(
            staff=self.academic,
            academic_year=2025,
            semester='S1',
            snapshot_fte=self.academic.fte,
            snapshot_department=self.dept_csse,
            status='INITIAL',
        )

    def _make_staff(self, username, role, department):
        password = f'{username}_Pass123!'
        user = User.objects.create_user(username=username, password=password)
        # Use a hash suffix to guarantee uniqueness across all test methods
        import hashlib
        staff_number = hashlib.sha256(username.encode()).hexdigest()[:8]
        return Staff.objects.create(
            user=user,
            staff_number=staff_number,
            role=role,
            department=department,
        )

    def _make_anomaly_report(self, staff, year=2025, semester='S1'):
        """Create a report guaranteed to trigger tr_denominator_invalid (snapshot_fte=0)."""
        return WorkloadReport.objects.create(
            staff=staff,
            academic_year=year,
            semester=semester,
            snapshot_fte=Decimal('0.00'),  # denominator = 0 → always anomaly
            snapshot_department=staff.department,
            status='INITIAL',
        )

    def _make_clean_report(self, staff, year=2025, semester='S1'):
        """Create a report guaranteed to have no anomaly (fte=1.0, no items, no target fields)."""
        return WorkloadReport.objects.create(
            staff=staff,
            academic_year=year,
            semester=semester,
            snapshot_fte=Decimal('1.00'),
            snapshot_department=staff.department,
            status='INITIAL',
        )

    def _auth_client(self, staff):
        """Return an APIClient with a valid JWT for the given staff member."""
        token = RefreshToken.for_user(staff.user).access_token
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        return client

    def _item_ids(self, res):
        """Extract report id list from a paginated workload list response."""
        return [item['id'] for item in res.data['data']['items']]

    def _submit_report(self, report, staff=None):
        """Academic submits a WORKLOAD_REQUEST so HOD can act on the report."""
        actor = staff or self.academic
        AuditLog.objects.create(
            report=report,
            action_by=actor,
            action_type='COMMENT',
            comment='Submitting for review.',
            changes={'kind': 'WORKLOAD_REQUEST', 'status': 'pending'},
        )
        report.status = 'PENDING'
        report.save(update_fields=['status', 'updated_at'])

    def _confirm_report_via_api(self, report, staff=None):
        """Confirm one report via the public API."""
        actor = staff or self.academic
        client = self._auth_client(actor)
        return client.post(
            f'/api/academic/workloads/{report.report_id}/confirm/',
            data={'confirmation': 'confirmed'},
            format='json',
        )


# ─── Test: require_role decorator ────────────────────────────────────────────

class TestRequireRole(BaseTestCase):
    """
    Verifies that the @require_role decorator blocks wrong roles with 403.
    These are pure permission-boundary tests — no business logic involved.
    """

    def test_academic_cannot_access_supervisor_list(self):
        # ACADEMIC calling a HOD/OPS/HOS-only endpoint must get 403
        client = self._auth_client(self.academic)
        res = client.get('/api/supervisor/requests/')
        self.assertEqual(res.status_code, 403)

    def test_hod_can_access_supervisor_list(self):
        client = self._auth_client(self.hod_csse)
        res = client.get('/api/supervisor/requests/')
        self.assertEqual(res.status_code, 200)

    def test_unauthenticated_gets_401(self):
        # No token at all — DRF JWT middleware returns 401 before our decorator runs
        res = self.client.get('/api/supervisor/requests/')
        self.assertEqual(res.status_code, 401)

    def test_hod_cannot_access_academic_endpoint(self):
        # HOD calling an ACADEMIC-only endpoint must get 403
        client = self._auth_client(self.hod_csse)
        res = client.get('/api/workloads/my/')
        self.assertEqual(res.status_code, 403)

    def test_academic_can_access_own_workloads(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/workloads/my/')
        self.assertEqual(res.status_code, 200)


# ─── Test: HOD data isolation ─────────────────────────────────────────────────

class TestHODDataIsolation(BaseTestCase):
    """
    Verifies that HOD can only see and act on reports in their own department.
    The report fixture belongs to dept_csse.
    """

    def test_hod_csse_sees_csse_report_in_list(self):
        # Academic must submit first; only then does the report appear in HOD's pending list.
        self._submit_report(self.report)
        client = self._auth_client(self.hod_csse)
        res = client.get('/api/supervisor/requests/')
        self.assertEqual(res.status_code, 200)
        all_ids = (
            [r['report_id'] for r in res.data['pending']] +
            [r['report_id'] for r in res.data['approved']] +
            [r['report_id'] for r in res.data['history']]
        )
        self.assertIn(str(self.report.report_id), all_ids)

    def test_hod_physics_cannot_see_csse_report(self):
        # Physics HOD's queryset is filtered to dept_physics — CSSE report is invisible
        client = self._auth_client(self.hod_phys)
        res = client.get('/api/supervisor/requests/')
        self.assertEqual(res.status_code, 200)
        all_ids = (
            [r['report_id'] for r in res.data['pending']] +
            [r['report_id'] for r in res.data['approved']] +
            [r['report_id'] for r in res.data['history']]
        )
        self.assertNotIn(str(self.report.report_id), all_ids)

    def test_hod_physics_cannot_approve_csse_report(self):
        # get_workload_queryset filters by dept, so the report is not found → 404
        client = self._auth_client(self.hod_phys)
        res = client.post(f'/api/supervisor/approve/{self.report.report_id}/')
        self.assertEqual(res.status_code, 404)

    def test_hod_cannot_approve_before_academic_submits(self):
        # Gate: HOD gets 409 CONFLICT if report is still INITIAL (academic has not submitted)
        client = self._auth_client(self.hod_csse)
        res = client.post(f'/api/supervisor/approve/{self.report.report_id}/')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['code'], 'CONFLICT')

    def test_hod_cannot_reject_before_academic_submits(self):
        client = self._auth_client(self.hod_csse)
        res = client.post(
            f'/api/supervisor/reject/{self.report.report_id}/',
            data={'comment': 'Trying to reject without submission.'},
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['code'], 'CONFLICT')

    def test_hod_csse_can_approve_csse_report(self):
        self._submit_report(self.report)
        client = self._auth_client(self.hod_csse)
        res = client.post(f'/api/supervisor/approve/{self.report.report_id}/')
        self.assertEqual(res.status_code, 200)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, 'APPROVED')


# ─── Test: approval state machine ────────────────────────────────────────────

class TestApprovalStateMachine(BaseTestCase):
    """
    Verifies that the status machine rejects illegal transitions.
    """

    def test_cannot_approve_already_approved_report(self):
        # Academic submits first, then HOD approves twice
        self._submit_report(self.report)
        client = self._auth_client(self.hod_csse)
        client.post(f'/api/supervisor/approve/{self.report.report_id}/')

        # Approve again — should get 409 Conflict
        res = client.post(f'/api/supervisor/approve/{self.report.report_id}/')
        self.assertEqual(res.status_code, 409)

    def test_reject_requires_comment(self):
        self._submit_report(self.report)
        client = self._auth_client(self.hod_csse)
        res = client.post(
            f'/api/supervisor/reject/{self.report.report_id}/',
            data={},  # no comment
            format='json'
        )
        self.assertEqual(res.status_code, 422)

    def test_reject_with_comment_succeeds(self):
        self._submit_report(self.report)
        client = self._auth_client(self.hod_csse)
        res = client.post(
            f'/api/supervisor/reject/{self.report.report_id}/',
            data={'comment': 'Teaching hours look incorrect.'},
            format='json'
        )
        self.assertEqual(res.status_code, 200)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, 'REJECTED')

    def test_academic_cannot_submit_twice(self):
        # First query submission
        client = self._auth_client(self.academic)
        client.post(
            '/api/queries/',
            data={'workload_report_id': str(self.report.report_id), 'comment': 'I disagree with this.'},
            format='json'
        )
        # Second submission on same report — already has a COMMENT log, should fail
        res = client.post(
            '/api/queries/',
            data={'workload_report_id': str(self.report.report_id), 'comment': 'Trying again.'},
            format='json'
        )
        self.assertEqual(res.status_code, 409)


# ─── Test: Academic workload view + query submission (#3) ─────────────────────

class TestAcademicWorkloadAndQuery(BaseTestCase):
    """
    Verifies GET /api/workloads/my/ and POST /api/queries/ behaviour.
    """

    def test_academic_sees_own_report(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/workloads/my/')
        self.assertEqual(res.status_code, 200)
        ids = [r['report_id'] for r in res.data]
        self.assertIn(str(self.report.report_id), ids)

    def test_academic_does_not_see_other_report(self):
        # Create a second academic in the same dept and verify they cannot see each other's reports
        other = self._make_staff('academic2', 'ACADEMIC', self.dept_csse)
        client = self._auth_client(other)
        res = client.get('/api/workloads/my/')
        self.assertEqual(res.status_code, 200)
        ids = [r['report_id'] for r in res.data]
        self.assertNotIn(str(self.report.report_id), ids)

    def test_submit_query_creates_audit_log(self):
        from api.models import AuditLog
        client = self._auth_client(self.academic)
        res = client.post(
            '/api/queries/',
            data={'workload_report_id': str(self.report.report_id), 'comment': 'Hours look wrong.'},
            format='json'
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['report_id'], str(self.report.report_id))
        self.assertTrue(
            AuditLog.objects.filter(report=self.report, action_type='COMMENT').exists()
        )

    def test_submit_query_missing_comment_returns_400(self):
        client = self._auth_client(self.academic)
        res = client.post(
            '/api/queries/',
            data={'workload_report_id': str(self.report.report_id)},
            format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_submit_query_missing_report_id_returns_400(self):
        client = self._auth_client(self.academic)
        res = client.post(
            '/api/queries/',
            data={'comment': 'Something is off.'},
            format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_hod_cannot_submit_query(self):
        # POST /api/queries/ is ACADEMIC-only
        client = self._auth_client(self.hod_csse)
        res = client.post(
            '/api/queries/',
            data={'workload_report_id': str(self.report.report_id), 'comment': 'test'},
            format='json'
        )
        self.assertEqual(res.status_code, 403)

    def test_academic_cannot_query_other_academic_report(self):
        # Academic2 tries to query Academic1's report — should get 404
        other = self._make_staff('academic3', 'ACADEMIC', self.dept_csse)
        client = self._auth_client(other)
        res = client.post(
            '/api/queries/',
            data={'workload_report_id': str(self.report.report_id), 'comment': 'Not mine.'},
            format='json'
        )
        self.assertEqual(res.status_code, 404)


class TestAcademicContractEndpoints(BaseTestCase):
    def test_academic_workloads_contract_shape(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?status=all&page=1&page_size=10')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])
        self.assertIn('data', res.data)
        self.assertIn('items', res.data['data'])

    def test_academic_workload_detail_contract_shape(self):
        client = self._auth_client(self.academic)
        res = client.get(f'/api/academic/workloads/{self.report.report_id}/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])
        self.assertIn('breakdown', res.data['data'])
        self.assertIn('supervisor_note', res.data['data'])

    def test_confirm_workload_blocked_by_anomaly(self):
        # Use a report with snapshot_fte=0 to guarantee tr_denominator_invalid anomaly.
        # The base fixture report (fte=1.0, no items) has no anomaly — that was a bug.
        anomaly_report = self._make_anomaly_report(self.academic, year=2025, semester='S2')
        client = self._auth_client(self.academic)
        res = client.post(
            f'/api/academic/workloads/{anomaly_report.report_id}/confirm/',
            data={'confirmation': 'confirmed'},
            format='json'
        )
        self.assertEqual(res.status_code, 409)
        self.assertIn('anomaly', res.data['errors'])

    def test_confirm_workload_invalid_value(self):
        client = self._auth_client(self.academic)
        res = client.post(
            f'/api/academic/workloads/{self.report.report_id}/confirm/',
            data={'confirmation': 'unconfirmed'},
            format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_submit_workload_request_success(self):
        self._confirm_report_via_api(self.report)
        client = self._auth_client(self.academic)
        res = client.post(
            '/api/academic/workload-requests/',
            data={
                'workload_ids': [str(self.report.report_id)],
                'request_reason': 'Please review my updated workload.',
            },
            format='json'
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data['success'])
        self.assertEqual(res.data['data']['status'], 'pending')

    def test_submit_workload_request_duplicate_conflict(self):
        self._confirm_report_via_api(self.report)
        client = self._auth_client(self.academic)
        payload = {
            'workload_ids': [str(self.report.report_id)],
            'request_reason': 'Please review my updated workload.',
        }
        first = client.post('/api/academic/workload-requests/', data=payload, format='json')
        self.assertEqual(first.status_code, 201)

        second = client.post('/api/academic/workload-requests/', data=payload, format='json')
        self.assertEqual(second.status_code, 409)

    def test_submit_workload_request_reason_required(self):
        client = self._auth_client(self.academic)
        res = client.post(
            '/api/academic/workload-requests/',
            data={'workload_ids': [str(self.report.report_id)], 'request_reason': ''},
            format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_submit_workload_request_reason_length(self):
        client = self._auth_client(self.academic)
        res = client.post(
            '/api/academic/workload-requests/',
            data={
                'workload_ids': [str(self.report.report_id)],
                'request_reason': 'a' * 241,
            },
            format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_hod_forbidden_on_academic_contract_endpoints(self):
        client = self._auth_client(self.hod_csse)
        res = client.get('/api/academic/workloads/')
        self.assertEqual(res.status_code, 403)


# ─── Test: academic workload list filters ─────────────────────────────────────

class TestAcademicWorkloadFilters(BaseTestCase):
    """
    Verifies that status / year / semester / confirmation query params
    correctly narrow the list, and that pagination works.

    Why these matter: cai's frontend sends these params from the filter bar.
    If the backend ignores them, the UI will show wrong data silently.
    """

    def setUp(self):
        super().setUp()
        # Three reports for the same academic: different status, year, semester
        self.r_approved = WorkloadReport.objects.create(
            staff=self.academic, academic_year=2025, semester='S2',
            snapshot_fte=Decimal('1.00'), snapshot_department=self.dept_csse,
            status='APPROVED',
        )
        self.r_2024 = WorkloadReport.objects.create(
            staff=self.academic, academic_year=2024, semester='S1',
            snapshot_fte=Decimal('1.00'), snapshot_department=self.dept_csse,
            status='PENDING',
        )

    def test_filter_status_pending_excludes_approved(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?status=pending')
        self.assertEqual(res.status_code, 200)
        ids = self._item_ids(res)
        self.assertNotIn(str(self.r_approved.report_id), ids)
        for item in res.data['data']['items']:
            self.assertEqual(item['status'], 'pending')

    def test_filter_status_approved_excludes_pending(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?status=approved')
        self.assertEqual(res.status_code, 200)
        ids = self._item_ids(res)
        self.assertIn(str(self.r_approved.report_id), ids)
        self.assertNotIn(str(self.report.report_id), ids)

    def test_filter_year_2024_excludes_2025(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?year=2024')
        self.assertEqual(res.status_code, 200)
        ids = self._item_ids(res)
        self.assertIn(str(self.r_2024.report_id), ids)
        self.assertNotIn(str(self.report.report_id), ids)

    def test_filter_semester_s2_excludes_s1(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?semester=S2')
        self.assertEqual(res.status_code, 200)
        ids = self._item_ids(res)
        self.assertIn(str(self.r_approved.report_id), ids)
        self.assertNotIn(str(self.report.report_id), ids)

    def test_filter_confirmation_confirmed(self):
        # Confirm the 2024 report, then filter by confirmed — only it should appear
        AuditLog.objects.create(
            report=self.r_2024,
            action_by=self.academic,
            action_type='COMMENT',
            changes={'kind': 'CONFIRMATION', 'confirmation': 'confirmed'},
        )
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?confirmation=confirmed')
        self.assertEqual(res.status_code, 200)
        ids = self._item_ids(res)
        self.assertIn(str(self.r_2024.report_id), ids)
        self.assertNotIn(str(self.report.report_id), ids)

    def test_filter_confirmation_unconfirmed(self):
        # No reports have been confirmed → all should appear under unconfirmed
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?confirmation=unconfirmed')
        self.assertEqual(res.status_code, 200)
        ids = self._item_ids(res)
        self.assertIn(str(self.report.report_id), ids)


# ─── Test: academic data ownership (new contract endpoints) ───────────────────

class TestAcademicOwnership(BaseTestCase):
    """
    Verifies that an academic can only see and act on their own reports
    via the new /api/academic/* endpoints.

    This is the RBAC boundary test for the academic role.
    get_workload_queryset filters by staff=request.staff for ACADEMIC role,
    so any attempt to access another academic's report should return 404
    (not 403 — the record simply doesn't exist in their queryset).
    """

    def setUp(self):
        super().setUp()
        self.other = self._make_staff('academic_other', 'ACADEMIC', self.dept_csse)
        self.other_report = self._make_clean_report(self.other, year=2025, semester='S2')

    def test_list_does_not_expose_other_academic_report(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/')
        self.assertEqual(res.status_code, 200)
        ids = [item['id'] for item in res.data['data']['items']]
        self.assertNotIn(str(self.other_report.report_id), ids)

    def test_detail_returns_404_for_other_academic_report(self):
        client = self._auth_client(self.academic)
        res = client.get(f'/api/academic/workloads/{self.other_report.report_id}/')
        self.assertEqual(res.status_code, 404)

    def test_confirm_returns_404_for_other_academic_report(self):
        client = self._auth_client(self.academic)
        res = client.post(
            f'/api/academic/workloads/{self.other_report.report_id}/confirm/',
            data={'confirmation': 'confirmed'},
            format='json',
        )
        self.assertEqual(res.status_code, 404)

    def test_submit_request_returns_400_for_other_academic_report(self):
        # workload_ids validation checks the scoped queryset; foreign id → count mismatch → 400
        client = self._auth_client(self.academic)
        res = client.post(
            '/api/academic/workload-requests/',
            data={
                'workload_ids': [str(self.other_report.report_id)],
                'request_reason': 'Trying to submit for someone else.',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)


# ─── Test: confirm success + idempotency ──────────────────────────────────────

class TestAcademicConfirmSuccess(BaseTestCase):
    """
    Verifies the happy path for POST /api/academic/workloads/{id}/confirm/
    and that confirming twice does not create duplicate AuditLog entries.

    The confirm endpoint calls persist_report_anomaly before writing the log.
    A clean report (fte=1.0, no items, no target fields) has no anomaly,
    so the confirm should succeed with 200.
    """

    def setUp(self):
        super().setUp()
        self.clean_report = self._make_clean_report(self.academic, year=2025, semester='S2')

    def test_confirm_success_returns_200_and_confirmed(self):
        client = self._auth_client(self.academic)
        res = client.post(
            f'/api/academic/workloads/{self.clean_report.report_id}/confirm/',
            data={'confirmation': 'confirmed'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])
        self.assertEqual(res.data['data']['confirmation'], 'confirmed')
        self.assertEqual(res.data['data']['id'], str(self.clean_report.report_id))

    def test_confirm_writes_audit_log(self):
        client = self._auth_client(self.academic)
        client.post(
            f'/api/academic/workloads/{self.clean_report.report_id}/confirm/',
            data={'confirmation': 'confirmed'},
            format='json',
        )
        self.assertTrue(
            AuditLog.objects.filter(
                report=self.clean_report,
                action_type='COMMENT',
                changes__kind='CONFIRMATION',
                changes__confirmation='confirmed',
            ).exists()
        )

    def test_confirm_is_idempotent_no_duplicate_log(self):
        # Confirming twice must not create a second AuditLog entry
        client = self._auth_client(self.academic)
        client.post(
            f'/api/academic/workloads/{self.clean_report.report_id}/confirm/',
            data={'confirmation': 'confirmed'},
            format='json',
        )
        res2 = client.post(
            f'/api/academic/workloads/{self.clean_report.report_id}/confirm/',
            data={'confirmation': 'confirmed'},
            format='json',
        )
        self.assertEqual(res2.status_code, 200)
        count = AuditLog.objects.filter(
            report=self.clean_report,
            changes__kind='CONFIRMATION',
        ).count()
        self.assertEqual(count, 1)

    def test_confirm_detail_shows_confirmed_after_confirm(self):
        # After confirming, GET detail must return confirmation='confirmed'
        client = self._auth_client(self.academic)
        client.post(
            f'/api/academic/workloads/{self.clean_report.report_id}/confirm/',
            data={'confirmation': 'confirmed'},
            format='json',
        )
        res = client.get(f'/api/academic/workloads/{self.clean_report.report_id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['data']['confirmation'], 'confirmed')


# ─── Test: visualization endpoint ─────────────────────────────────────────────

class TestAcademicVisualization(BaseTestCase):
    """
    Verifies GET /api/academic/visualization/ response shape and filters.

    cai's frontend reads: reporting_period_label, my_vs_department_trend,
    total_hours_trend. If any key is missing the chart will silently break.
    """

    def test_visualization_returns_required_keys(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/visualization/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])
        data = res.data['data']
        self.assertIn('reporting_period_label', data)
        self.assertIn('my_vs_department_trend', data)
        self.assertIn('total_hours_trend', data)

    def test_visualization_trend_items_have_correct_keys(self):
        # Add a workload item so the trend has at least one data point
        WorkloadItem.objects.create(
            report=self.report,
            category='TEACHING',
            unit_code='CITS5206',
            allocated_hours=Decimal('86.25'),
        )
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/visualization/')
        self.assertEqual(res.status_code, 200)
        trend = res.data['data']['my_vs_department_trend']
        if trend:
            self.assertIn('semester', trend[0])
            self.assertIn('my_hours', trend[0])
            self.assertIn('department_average', trend[0])

    def test_visualization_year_filter(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/visualization/?year_from=2025&year_to=2025')
        self.assertEqual(res.status_code, 200)

    def test_visualization_semester_filter(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/visualization/?semester=S1')
        self.assertEqual(res.status_code, 200)

    def test_hod_forbidden_on_visualization(self):
        client = self._auth_client(self.hod_csse)
        res = client.get('/api/academic/visualization/')
        self.assertEqual(res.status_code, 403)

    def test_unauthenticated_gets_401_on_visualization(self):
        res = self.client.get('/api/academic/visualization/')
        self.assertEqual(res.status_code, 401)


# ─── Test: export endpoint ────────────────────────────────────────────────────

class TestAcademicExport(BaseTestCase):
    """
    Verifies GET /api/academic/export/ returns a real xlsx binary stream.

    NOTE FOR FRONTEND ALIGNMENT:
    cai's contract expects JSON { download_url: "..." }.
    Our backend returns the file directly as a binary response with
    Content-Disposition: attachment. The frontend must handle this as a
    Blob download (fetch → response.blob() → URL.createObjectURL),
    NOT as a JSON parse. This is the standard browser download pattern
    and avoids the need for server-side file storage.
    """

    def test_export_returns_xlsx_content_type(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/export/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res['Content-Type'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )

    def test_export_has_attachment_content_disposition(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/export/')
        self.assertIn('attachment', res['Content-Disposition'])
        self.assertIn('.xlsx', res['Content-Disposition'])

    def test_export_with_year_filter(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/export/?year_from=2025&year_to=2025')
        self.assertEqual(res.status_code, 200)

    def test_export_empty_when_no_approved_reports(self):
        # Export only includes APPROVED reports; fixture report is PENDING → file is valid but empty
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/export/')
        self.assertEqual(res.status_code, 200)
        # File must still be a valid xlsx (non-empty bytes)
        self.assertGreater(len(res.content), 0)

    def test_hod_forbidden_on_export(self):
        client = self._auth_client(self.hod_csse)
        res = client.get('/api/academic/export/')
        self.assertEqual(res.status_code, 403)

    def test_unauthenticated_gets_401_on_export(self):
        res = self.client.get('/api/academic/export/')
        self.assertEqual(res.status_code, 401)


# ─── Test: response field alignment with cai's contract ──────────────────────

class TestAcademicContractFieldAlignment(BaseTestCase):
    """
    Verifies that every field cai's frontend reads is present and correctly typed.

    This is the contract alignment test — if any field name or type changes,
    this test catches it before it reaches the frontend.

    Reference: IntegrationLog/cai-academic_api_contract_cn.md sections 7.3 / 7.4
    """

    def setUp(self):
        super().setUp()
        WorkloadItem.objects.create(
            report=self.report,
            category='TEACHING',
            unit_code='CITS5206',
            description='Teaching Hrs',
            allocated_hours=Decimal('86.25'),
        )
        WorkloadItem.objects.create(
            report=self.report,
            category='SERVICE',
            allocated_hours=Decimal('172.50'),
        )
        # Two extra reports so pagination tests can assert total >= 3
        self._make_clean_report(self.academic, year=2025, semester='S2')
        self._make_clean_report(self.academic, year=2024, semester='S1')

    def test_list_item_has_all_required_fields(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/')
        self.assertEqual(res.status_code, 200)
        item = res.data['data']['items'][0]
        for field in ('id', 'employee_id', 'name', 'title', 'description',
                      'status', 'confirmation', 'total_hours', 'pushed_time'):
            self.assertIn(field, item, msg=f"Missing field: {field}")

    def test_list_item_status_is_lowercase(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/')
        item = res.data['data']['items'][0]
        self.assertEqual(item['status'], item['status'].lower())

    def test_list_item_confirmation_is_unconfirmed_by_default(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/')
        item = res.data['data']['items'][0]
        self.assertEqual(item['confirmation'], 'unconfirmed')

    def test_list_item_total_hours_is_numeric(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/')
        item = res.data['data']['items'][0]
        self.assertIsInstance(item['total_hours'], float)

    def test_detail_breakdown_has_four_categories(self):
        client = self._auth_client(self.academic)
        res = client.get(f'/api/academic/workloads/{self.report.report_id}/')
        breakdown = res.data['data']['breakdown']
        for cat in ('Teaching', 'Assigned Roles', 'HDR', 'Service'):
            self.assertIn(cat, breakdown, msg=f"Missing breakdown category: {cat}")

    def test_detail_breakdown_items_have_name_and_hours(self):
        client = self._auth_client(self.academic)
        res = client.get(f'/api/academic/workloads/{self.report.report_id}/')
        teaching = res.data['data']['breakdown']['Teaching']
        self.assertTrue(len(teaching) > 0)
        self.assertIn('name', teaching[0])
        self.assertIn('hours', teaching[0])
        self.assertIsInstance(teaching[0]['hours'], float)

    def test_detail_supervisor_note_is_empty_string_by_default(self):
        client = self._auth_client(self.academic)
        res = client.get(f'/api/academic/workloads/{self.report.report_id}/')
        self.assertEqual(res.data['data']['supervisor_note'], '')

    def test_detail_supervisor_note_populated_after_reject(self):
        # Academic submits first, then HOD rejects with a comment
        self._submit_report(self.report)
        hod_client = self._auth_client(self.hod_csse)
        hod_client.post(
            f'/api/supervisor/reject/{self.report.report_id}/',
            data={'comment': 'Please revise teaching hours.'},
            format='json',
        )
        academic_client = self._auth_client(self.academic)
        res = academic_client.get(f'/api/academic/workloads/{self.report.report_id}/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['data']['supervisor_note'], 'Please revise teaching hours.')

    def test_pagination_page_size_1(self):
        # With 3 reports and page_size=1, page 1 should return exactly 1 item
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?page=1&page_size=1')
        self.assertEqual(res.status_code, 200)
        data = res.data['data']
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['page'], 1)
        self.assertEqual(data['page_size'], 1)
        self.assertGreaterEqual(data['total'], 3)

    def test_pagination_page_2(self):
        # Page 2 with page_size=1 should return a different item than page 1
        client = self._auth_client(self.academic)
        p1 = client.get('/api/academic/workloads/?page=1&page_size=1')
        p2 = client.get('/api/academic/workloads/?page=2&page_size=1')
        self.assertEqual(p1.status_code, 200)
        self.assertEqual(p2.status_code, 200)
        id_p1 = self._item_ids(p1)[0]
        id_p2 = self._item_ids(p2)[0]
        self.assertNotEqual(id_p1, id_p2)


# ─── Test: Codex findings fixes ───────────────────────────────────────────────

class TestCodexFixes(BaseTestCase):
    """
    Regression tests for the 4 confirmed Codex findings fixed in this branch.

    F2: Partial commit — submit_workload_requests must be all-or-nothing.
    F3: Re-submit blocked — academic must be able to re-submit after HOD rejects.
    F4: department_conflict gap — detail/confirm must use the same anomaly logic as list.
    F5: Pagination 500 — invalid page/page_size must return 400, not 500.
    """

    def test_f5_invalid_page_returns_400(self):
        # ?page=foo must return 400, not 500
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?page=foo')
        self.assertEqual(res.status_code, 400)

    def test_f5_invalid_page_size_returns_400(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?page_size=notanumber')
        self.assertEqual(res.status_code, 400)

    def test_f5_page_size_zero_clamped_not_500(self):
        # page_size=0 is clamped to 1 (min), must not crash
        client = self._auth_client(self.academic)
        res = client.get('/api/academic/workloads/?page_size=0')
        self.assertEqual(res.status_code, 200)

    def test_f3_academic_can_resubmit_after_hod_rejects(self):
        # After HOD rejects, the WORKLOAD_REQUEST log still has status='pending' in JSON,
        # but report.status is now REJECTED. The duplicate check must allow re-submission.
        client_academic = self._auth_client(self.academic)
        client_hod = self._auth_client(self.hod_csse)

        # Academic submits first request
        self._confirm_report_via_api(self.report)
        first = client_academic.post(
            '/api/academic/workload-requests/',
            data={'workload_ids': [str(self.report.report_id)], 'request_reason': 'Please review.'},
            format='json',
        )
        self.assertEqual(first.status_code, 201)

        # HOD rejects
        client_hod.post(
            f'/api/supervisor/reject/{self.report.report_id}/',
            data={'comment': 'Hours look wrong.'},
            format='json',
        )
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, 'REJECTED')

        # Academic must be able to re-submit after rejection
        second = client_academic.post(
            '/api/academic/workload-requests/',
            data={'workload_ids': [str(self.report.report_id)], 'request_reason': 'Revised and resubmitting.'},
            format='json',
        )
        self.assertEqual(second.status_code, 201)

    def test_f2_duplicate_check_before_any_creation(self):
        # Submit two reports in one call where the second is a duplicate.
        # The first must NOT be created (all-or-nothing).
        clean = self._make_clean_report(self.academic, year=2024, semester='S1')
        client = self._auth_client(self.academic)
        self._confirm_report_via_api(self.report)
        self._confirm_report_via_api(clean)

        # Pre-create a pending request for self.report only
        client.post(
            '/api/academic/workload-requests/',
            data={'workload_ids': [str(self.report.report_id)], 'request_reason': 'First.'},
            format='json',
        )

        before_count = AuditLog.objects.filter(
            changes__kind='WORKLOAD_REQUEST',
        ).count()

        # Now submit [clean, self.report] — self.report is a duplicate
        res = client.post(
            '/api/academic/workload-requests/',
            data={
                'workload_ids': [str(clean.report_id), str(self.report.report_id)],
                'request_reason': 'Batch attempt.',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 409)

        after_count = AuditLog.objects.filter(
            changes__kind='WORKLOAD_REQUEST',
        ).count()
        # No new entries must have been created (clean's entry must not exist)
        self.assertEqual(before_count, after_count)

    def test_f4_department_conflict_blocks_confirm(self):
        # Create a second report for the same staff/year/semester in a different department.
        # This triggers department_conflict. The confirm endpoint must also detect it.
        WorkloadReport.objects.create(
            staff=self.academic,
            academic_year=self.report.academic_year,
            semester=self.report.semester,
            snapshot_fte=Decimal('1.00'),
            snapshot_department=self.dept_physics,  # different dept → conflict
            status='PENDING',
        )
        client = self._auth_client(self.academic)
        res = client.post(
            f'/api/academic/workloads/{self.report.report_id}/confirm/',
            data={'confirmation': 'confirmed'},
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertIn('anomaly', res.data['errors'])
        self.assertIn('department_conflict', res.data['errors']['anomaly'])


class TestHoSContractEndpoints(BaseTestCase):
    def setUp(self):
        super().setUp()
        self._submit_report(self.report)
        WorkloadItem.objects.create(
            report=self.report,
            category='TEACHING',
            unit_code='CITS5206',
            description='Teaching load',
            allocated_hours=Decimal('40.00'),
        )

    def test_hos_can_access_workload_requests(self):
        client = self._auth_client(self.hos)
        res = client.get('/api/headofschool/workload-requests/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['success'])

    def test_academic_forbidden_on_hos_workload_requests(self):
        client = self._auth_client(self.academic)
        res = client.get('/api/headofschool/workload-requests/')
        self.assertEqual(res.status_code, 403)

    def test_hos_staff_list_contract_shape(self):
        client = self._auth_client(self.hos)
        res = client.get('/api/headofschool/staff/?page=1&page_size=10')
        self.assertEqual(res.status_code, 200)
        item = res.data['data']['items'][0]
        for key in ('staff_id', 'first_name', 'last_name', 'email', 'department', 'active_status'):
            self.assertIn(key, item)

    def test_hos_staff_update_success(self):
        client = self._auth_client(self.hos)
        payload = {
            'staff_id': self.academic.staff_number,
            'first_name': 'Updated',
            'last_name': 'Teacher',
            'email': 'updated.teacher@uwa.edu.au',
            'title': 'Professor',
            'department': 'Physics',
            'active_status': 'Active',
        }
        res = client.patch(f'/api/headofschool/staff/{self.academic.staff_number}/', data=payload, format='json')
        self.assertEqual(res.status_code, 200)
        self.academic.refresh_from_db()
        self.assertEqual(self.academic.user.first_name, 'Updated')
        self.assertEqual(self.academic.department.name, 'Physics')

    def test_hos_create_and_disable_role_assignment(self):
        client = self._auth_client(self.hos)
        create_res = client.post(
            '/api/headofschool/role-assignments/',
            data={
                'staff_id': self.academic.staff_number,
                'role': 'HoD',
                'department': 'Physics',
                'permissions': ['View Workload', 'Approve Workload', 'Update Workload'],
            },
            format='json',
        )
        self.assertEqual(create_res.status_code, 200)
        assignment_id = create_res.data['data']['id']
        self.academic.refresh_from_db()
        self.assertEqual(self.academic.role, 'HOD')

        disable_res = client.post(
            f'/api/headofschool/role-assignments/{assignment_id}/disable/',
            data={'reason': 'Permission no longer required'},
            format='json',
        )
        self.assertEqual(disable_res.status_code, 200)
        self.academic.refresh_from_db()
        self.assertEqual(self.academic.role, 'ACADEMIC')

    def test_hos_visualization_contract_shape(self):
        client = self._auth_client(self.hos)
        res = client.get('/api/headofschool/visualization/?from_year=2024&to_year=2026&semester=All')
        self.assertEqual(res.status_code, 200)
        data = res.data['data']
        self.assertIn('summary', data)
        self.assertIn('department_stats', data)
        self.assertIn('workload_trend', data)

    def test_hos_export_returns_xlsx(self):
        client = self._auth_client(self.hos)
        res = client.get('/api/headofschool/export/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res['Content-Type'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
class TestHODV2CaiFindings(BaseTestCase):
    """Regression tests for issues reported during HOD v2 review."""

    def test_submit_requires_confirmation(self):
        client = self._auth_client(self.academic)
        res = client.post(
            '/api/academic/workload-requests/',
            data={'workload_ids': [str(self.report.report_id)], 'request_reason': 'Try submit without confirm'},
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertIn(str(self.report.report_id), res.data['errors']['workload_ids'])

    def test_submit_blocks_anomaly_even_if_confirmed_flag_exists(self):
        anomaly_report = self._make_anomaly_report(self.academic, year=2026, semester='S1')
        AuditLog.objects.create(
            report=anomaly_report,
            action_by=self.academic,
            action_type='COMMENT',
            changes={'kind': 'CONFIRMATION', 'confirmation': 'confirmed'},
        )
        client = self._auth_client(self.academic)
        res = client.post(
            '/api/academic/workload-requests/',
            data={'workload_ids': [str(anomaly_report.report_id)], 'request_reason': 'Bypass anomaly check'},
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertIn(str(anomaly_report.report_id), res.data['errors']['anomaly'])

    def test_inactive_staff_token_cannot_access_protected_endpoint(self):
        client = self._auth_client(self.academic)
        self.academic.is_active = False
        self.academic.save(update_fields=['is_active'])
        res = client.get('/api/academic/workloads/')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['code'], 'ACCOUNT_INACTIVE')

    def test_legacy_supervisor_list_hides_unconfirmed_initial(self):
        client = self._auth_client(self.hod_csse)
        unconfirmed_res = client.get('/api/supervisor/requests/')
        self.assertEqual(unconfirmed_res.status_code, 200)
        self.assertEqual(unconfirmed_res.data['initial'], [])

        AuditLog.objects.create(
            report=self.report,
            action_by=self.academic,
            action_type='COMMENT',
            changes={'kind': 'CONFIRMATION', 'confirmation': 'confirmed'},
        )
        confirmed_res = client.get('/api/supervisor/requests/')
        self.assertEqual(confirmed_res.status_code, 200)
        initial_ids = [r['report_id'] for r in confirmed_res.data['initial']]
        self.assertIn(str(self.report.report_id), initial_ids)

    def test_login_supports_staff_id_and_user_email(self):
        login_user = User.objects.create_user(
            username='non_email_username',
            email='real.email@uwa.edu.au',
            password='LoginPass123!',
        )
        login_staff = Staff.objects.create(
            user=login_user,
            staff_number='87654321',
            role='ACADEMIC',
            department=self.dept_csse,
        )

        by_staff = self.client.post(
            '/api/login/',
            data={'staff_id': login_staff.staff_number, 'password': 'LoginPass123!'},
            format='json',
        )
        self.assertEqual(by_staff.status_code, 200)
        self.assertIn('access', by_staff.data)

        by_email = self.client.post(
            '/api/login/',
            data={'email': login_user.email, 'password': 'LoginPass123!'},
            format='json',
        )
        self.assertEqual(by_email.status_code, 200)
        self.assertIn('access', by_email.data)

    def test_breakdown_invalid_payload_does_not_delete_existing_items(self):
        self._submit_report(self.report)
        WorkloadItem.objects.create(
            report=self.report,
            category='TEACHING',
            unit_code='CITS9999',
            allocated_hours=Decimal('10.00'),
        )
        before_count = self.report.items.count()
        client = self._auth_client(self.hod_csse)
        res = client.post(
            f'/api/supervisor/workload-requests/{self.report.report_id}/decision/',
            data={
                'decision': 'approved',
                'note': 'bad breakdown',
                'breakdown': {'Teaching': [{'name': '', 'hours': 'abc'}]},
            },
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.report.refresh_from_db()
        self.assertEqual(self.report.items.count(), before_count)

    def test_resubmit_uses_latest_reason_and_submitted_time(self):
        self._confirm_report_via_api(self.report)
        academic_client = self._auth_client(self.academic)
        hod_client = self._auth_client(self.hod_csse)

        first = academic_client.post(
            '/api/academic/workload-requests/',
            data={'workload_ids': [str(self.report.report_id)], 'request_reason': 'first reason'},
            format='json',
        )
        self.assertEqual(first.status_code, 201)
        first_log = AuditLog.objects.filter(
            report=self.report,
            changes__kind='WORKLOAD_REQUEST',
        ).order_by('-created_at').first()
        first_log.created_at = timezone.now() - timedelta(days=1)
        first_log.save(update_fields=['created_at'])

        reject = hod_client.post(
            f'/api/supervisor/reject/{self.report.report_id}/',
            data={'comment': 'please revise'},
            format='json',
        )
        self.assertEqual(reject.status_code, 200)

        second = academic_client.post(
            '/api/academic/workload-requests/',
            data={'workload_ids': [str(self.report.report_id)], 'request_reason': 'second reason'},
            format='json',
        )
        self.assertEqual(second.status_code, 201)

        listing = hod_client.get('/api/supervisor/workload-requests/?status=pending')
        self.assertEqual(listing.status_code, 200)
        row = next(item for item in listing.data['data']['items'] if item['id'] == str(self.report.report_id))
        self.assertEqual(row['request_reason'], 'second reason')
        self.assertIn(timezone.now().strftime('%Y-%m-%d'), row['submitted_time'])
