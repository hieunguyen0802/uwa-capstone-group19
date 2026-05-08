"""
End-to-end smoke for the live docker-compose.test stack.

PREREQUISITE — run once before this test:

    docker compose -f docker-compose.test.yml up -d --build
    docker compose -f docker-compose.test.yml exec backend python manage.py migrate
    docker compose -f docker-compose.test.yml exec backend python manage.py seed_smoke

THEN run the smoke:

    cd backend && pytest api/tests/test_smoke_e2e.py -v

Point at a different host:

    SMOKE_BASE_URL=http://localhost:18000 pytest api/tests/test_smoke_e2e.py

This file is NOT collected by Django's default test runner (skipped if server
is unreachable). It is meant as a live-stack contract probe, not a unit test.
"""
from __future__ import annotations

import os

import pytest
import requests

BASE_URL = os.environ.get("SMOKE_BASE_URL", "http://localhost:18000").rstrip("/")
SEED_PASSWORD = "SmokePass123!"
TIMEOUT = 10


def _alive() -> bool:
    try:
        # A public-ish endpoint: login with empty body returns 400, not 502 — proves Django is up.
        r = requests.post(f"{BASE_URL}/api/auth/login/", json={}, timeout=TIMEOUT)
        return r.status_code in (200, 400, 401, 403, 404, 405)
    except requests.RequestException:
        return False


pytestmark = pytest.mark.skipif(
    not _alive(),
    reason=(
        f"Live stack not reachable at {BASE_URL}. "
        "Run `docker compose -f docker-compose.test.yml up -d` and seed_smoke first."
    ),
)


def _login(username: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login/",
        json={"email": username, "password": SEED_PASSWORD},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    data = r.json()
    assert "access" in data and "role" in data, f"login response missing fields: {data}"
    return data["access"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def tokens() -> dict:
    """Log in all four seed roles once; cache the access tokens."""
    return {
        "academic": _login("academic1"),
        "hod":      _login("hod_csse"),
        "ops":      _login("ops1"),
        "hos":      _login("hos1"),
    }


# ─── Auth ────────────────────────────────────────────────────────────────────

class TestAuth:
    def test_login_returns_access_and_role(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login/",
            json={"email": "academic1", "password": SEED_PASSWORD},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "ACADEMIC"
        assert body["access"]

    def test_wrong_password_is_400(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login/",
            json={"email": "academic1", "password": "wrong"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 400


# ─── Academic golden path ────────────────────────────────────────────────────

class TestAcademic:
    def test_list_own_workloads(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/academic/workloads/",
            headers=_auth(tokens["academic"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Contract v3: paginated list with 'items'
        assert "items" in body or isinstance(body, list), f"shape: {list(body) if isinstance(body, dict) else type(body)}"

    def test_role_gate_blocks_academic_from_supervisor(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/supervisor/workload-requests/",
            headers=_auth(tokens["academic"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 403


# ─── HoD (supervisor) golden path ────────────────────────────────────────────

class TestHoD:
    def test_list_workload_requests(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/supervisor/workload-requests/",
            headers=_auth(tokens["hod"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

    def test_visualization(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/supervisor/visualization/",
            headers=_auth(tokens["hod"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text


# ─── HoS golden path ─────────────────────────────────────────────────────────

class TestHoS:
    def test_staff_directory(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/hos/staff-directory",
            headers=_auth(tokens["hos"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

    def test_workload_requests(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/hos/workload-requests",
            headers=_auth(tokens["hos"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

    def test_role_assignments(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/hos/role-assignments",
            headers=_auth(tokens["hos"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text


# ─── School Ops golden path ──────────────────────────────────────────────────

class TestSchoolOps:
    def test_workload_list(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/school-operations/workloads",
            headers=_auth(tokens["ops"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

    def test_staff_list(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/school-operations/staff",
            headers=_auth(tokens["ops"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

    def test_visualization(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/school-operations/visualization",
            headers=_auth(tokens["ops"]),
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text


# ─── Profile (shared) ────────────────────────────────────────────────────────

class TestProfile:
    @pytest.mark.parametrize("role_key", ["academic", "hod", "ops", "hos"])
    def test_profile_me_for_each_role(self, tokens, role_key):
        r = requests.get(
            f"{BASE_URL}/api/profile/me/",
            headers=_auth(tokens[role_key]),
            timeout=TIMEOUT,
        )
        assert r.status_code in (200, 404), f"{role_key}: {r.status_code} {r.text}"
