from django.contrib.auth.models import User
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from .models import Department, Staff, WorkloadReport


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
        self.hod_csse  = self._make_staff('hod_csse',  'HOD',      self.dept_csse)
        self.hod_phys  = self._make_staff('hod_phys',  'HOD',      self.dept_physics)
        self.ops       = self._make_staff('ops1',       'SCHOOL_OPS', self.dept_csse)
        self.hos       = self._make_staff('hos1',       'HOS',      self.dept_csse)

        # One PENDING report belonging to the CSSE academic
        self.report = WorkloadReport.objects.create(
            staff=self.academic,
            academic_year=2025,
            semester='S1',
            snapshot_fte=self.academic.fte,
            snapshot_department=self.dept_csse,
            status='PENDING',
        )

    def _make_staff(self, username, role, department):
        user = User.objects.create_user(username=username, password='testpass')
        # Use a hash suffix to guarantee uniqueness across all test methods
        import hashlib
        staff_number = hashlib.md5(username.encode()).hexdigest()[:8]
        return Staff.objects.create(
            user=user,
            staff_number=staff_number,
            role=role,
            department=department,
        )

    def _auth_client(self, staff):
        """Return an APIClient with a valid JWT for the given staff member."""
        token = RefreshToken.for_user(staff.user).access_token
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        return client


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

    def test_hod_csse_can_approve_csse_report(self):
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
        # Approve once — should succeed
        client = self._auth_client(self.hod_csse)
        client.post(f'/api/supervisor/approve/{self.report.report_id}/')

        # Approve again — should get 409 Conflict
        res = client.post(f'/api/supervisor/approve/{self.report.report_id}/')
        self.assertEqual(res.status_code, 409)

    def test_reject_requires_comment(self):
        client = self._auth_client(self.hod_csse)
        res = client.post(
            f'/api/supervisor/reject/{self.report.report_id}/',
            data={},  # no comment
            format='json'
        )
        self.assertEqual(res.status_code, 422)

    def test_reject_with_comment_succeeds(self):
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
