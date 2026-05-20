"""
E2E test configuration.

One Chrome window (maximised), multiple tabs — one per user role.
Tokens are generated fresh via Django's simplejwt on each test session.
sessionStorage is per-tab so different tabs carry different auth tokens.
"""
from __future__ import annotations

import subprocess
import json
from typing import Generator

import pytest
from playwright.sync_api import Browser, BrowserContext, Page

COMPOSE_FILE = "docker-compose.yml"
BASE_URL = "http://localhost:3000"
API_URL  = "http://localhost:8000"

ROLE_EMAILS = {
    "ops":        "24053566@student.uwa.edu.au",
    "hod":        "mrcaiqidi@outlook.com",
    "doe_john":   "211528745@qq.com",
    "patel_lina": "stitchy.cai@gmail.com",
    "dias_jack":  "2079674537@qq.com",
    "hos":        "24140443@student.uwa.edu.au",
}


# ── helpers ───────────────────────────────────────────────────────────────────

def _generate_tokens(email: str) -> dict[str, str]:
    """Generate a 30-day JWT pair via Django shell."""
    code = (
        "from rest_framework_simplejwt.tokens import RefreshToken;"
        "from django.contrib.auth import get_user_model;"
        "from datetime import timedelta;"
        "User = get_user_model();"
        f"u = User.objects.get(email='{email}');"
        "r = RefreshToken.for_user(u);"
        "r.set_exp(lifetime=timedelta(days=30));"
        "at = r.access_token;"
        "at.set_exp(lifetime=timedelta(days=30));"
        "import json; print(json.dumps({'access': str(at), 'refresh': str(r)}))"
    )
    result = subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, "exec", "backend",
         "python", "manage.py", "shell", "-c", code],
        capture_output=True, text=True, check=True,
    )
    output = [l for l in result.stdout.splitlines() if l.strip()][-1]
    return json.loads(output)


def _inject_script(tokens: dict[str, str]) -> str:
    return (
        f"sessionStorage.setItem('access_token',  '{tokens['access']}');"
        f"sessionStorage.setItem('refresh_token', '{tokens['refresh']}');"
    )


def _make_tab(context: BrowserContext, role: str) -> Page:
    """Open a new tab in the shared window and wire up auth tokens for role."""
    tokens = _generate_tokens(ROLE_EMAILS[role])
    page = context.new_page()
    page.add_init_script(_inject_script(tokens))
    return page


def reset_all_workloads() -> None:
    """Delete every workload-related row for a clean slate before Test 1."""
    code = (
        "from api.models import AuditLog, WorkloadReport, WorkloadDistributionJob, Message;"
        "AuditLog.objects.all().delete();"
        "WorkloadReport.objects.all().update(superseded_by=None);"
        "WorkloadReport.objects.all().delete();"
        "WorkloadDistributionJob.objects.all().delete();"
        "Message.objects.all().delete();"
        "print('All workload data cleared')"
    )
    subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, "exec", "backend",
         "python", "manage.py", "shell", "-c", code],
        capture_output=True, text=True, check=True,
    )


def reset_academic_workflow(emails: list[str]) -> None:
    """Reset WorkloadReport + WorkloadItem state so the academic workflow can re-run."""
    emails_repr = repr(emails)
    code = (
        "from api.models import WorkloadReport, WorkloadItem, AuditLog;"
        "from django.contrib.auth import get_user_model;"
        f"emails = {emails_repr};"
        "User = get_user_model();"
        "reports = WorkloadReport.objects.filter(staff__user__email__in=emails, is_current=True);"
        "AuditLog.objects.filter(report__in=reports).exclude(action_type='DISTRIBUTED').delete();"
        "reports.update(status='INITIAL', confirmation_status='UNCONFIRMED', confirmation_at=None);"
        "WorkloadItem.objects.filter(report__in=reports, unit_code='CITS2020').update(unit_code='CITS2002');"
        "print('Reset done')"
    )
    subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, "exec", "backend",
         "python", "manage.py", "shell", "-c", code],
        capture_output=True, text=True, check=True,
    )


def set_staff_active(staff_number: str, is_active: bool) -> None:
    """Flip one staff record active/inactive to force a predictable distribution failure."""
    code = (
        "from api.models import Staff;"
        f"staff = Staff.objects.get(staff_number='{staff_number}');"
        f"staff.is_active = {bool(is_active)!r};"
        "staff.save(update_fields=['is_active', 'updated_at']);"
        "print(f'{staff.staff_number} active={staff.is_active}')"
    )
    subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, "exec", "backend",
         "python", "manage.py", "shell", "-c", code],
        capture_output=True, text=True, check=True,
    )


# ── launch maximised ──────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args: dict) -> dict:
    return {
        **browser_type_launch_args,
        "args": [*(browser_type_launch_args.get("args") or []), "--start-maximized"],
    }


# ── single shared context (one browser window, many tabs) ─────────────────────

@pytest.fixture(scope="session")
def shared_context(browser: Browser) -> Generator[BrowserContext, None, None]:
    ctx = browser.new_context(no_viewport=True)
    yield ctx
    ctx.close()


# ── per-role page fixtures (tabs in the shared window) ───────────────────────

@pytest.fixture(scope="session")
def ops_page(shared_context: BrowserContext) -> Generator[Page, None, None]:
    page = _make_tab(shared_context, "ops")
    yield page


@pytest.fixture(scope="session")
def hod_page(shared_context: BrowserContext) -> Generator[Page, None, None]:
    page = _make_tab(shared_context, "hod")
    yield page


@pytest.fixture(scope="session")
def doe_john_page(shared_context: BrowserContext) -> Generator[Page, None, None]:
    page = _make_tab(shared_context, "doe_john")
    yield page


@pytest.fixture(scope="session")
def patel_lina_page(shared_context: BrowserContext) -> Generator[Page, None, None]:
    page = _make_tab(shared_context, "patel_lina")
    yield page


@pytest.fixture(scope="session")
def dias_jack_page(shared_context: BrowserContext) -> Generator[Page, None, None]:
    page = _make_tab(shared_context, "dias_jack")
    yield page


@pytest.fixture(scope="session")
def hos_page(shared_context: BrowserContext) -> Generator[Page, None, None]:
    page = _make_tab(shared_context, "hos")
    yield page
