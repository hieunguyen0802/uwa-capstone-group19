# Workload Verification System

A role-scoped, audit-logged web platform that replaces the manual
Excel-and-email workflow used by the UWA School of Physics, Mathematics and
Computing to verify academic workload records. The system was built as the
CITS5206 capstone project for client Daniela Roberts, Senior School Operations
Coordinator.

**Live deployment:** https://witty-bay-067e0b400.7.azurestaticapps.net

---

## Table of Contents

1. [What the system does](#what-the-system-does)
2. [Tech stack](#tech-stack)
3. [Roles](#roles)
4. [Prerequisites](#prerequisites)
5. [Quick start](#quick-start)
6. [Seed accounts](#seed-accounts)
7. [Ports and URLs](#ports-and-urls)
8. [Running the test suite](#running-the-test-suite)
9. [API reference](#api-reference)
10. [User guide and documentation](#user-guide-and-documentation)
11. [Repository layout](#repository-layout)
12. [Production deployment on Azure](#production-deployment-on-azure)
13. [Common operations](#common-operations)
14. [Troubleshooting](#troubleshooting)
15. [Known issues and future work](#known-issues-and-future-work)
16. [Team](#team)

---

## What the system does

- **Imports** the PMC Workload Model spreadsheet and maps it into structured
  workload records by academic year, semester, staff member, department, and
  role.
- **Distributes** each workload record from School Operations to the relevant
  Academic dashboard, replacing the manual screenshot-and-email step.
- **Detects anomalies** automatically against the imported
  Teaching-to-Research target band before the academic confirms the record.
- **Routes review requests** from Academic staff to the correct approver.
  Department-level requests go to the HoD, while HoD self-submissions are routed
  to HoS.
- **Logs state changes** in audit history so import, distribution,
  confirmation, approval, rejection, re-import, staff updates, and permission
  changes remain traceable.
- **Scopes data by role** at the backend query and permission layer, not only in
  the UI, so users cannot access other roles' or departments' records by URL
  manipulation.
- **Supports export and analytics** for Academic, HoD, HoS, and School
  Operations workflows.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Backend | Python 3.11, Django 5.2, Django REST Framework 3.15 |
| Auth | Email OTP login with JWT tokens via djangorestframework-simplejwt |
| Database | PostgreSQL 15 |
| Frontend | React 19, TypeScript, React Router 6, Recharts, Node 18 |
| Excel | openpyxl, SheetJS, ExcelJS |
| DevOps | Docker, Docker Compose, Microsoft Azure |

---

## Roles

The system supports four main roles. Backend access is modelled with Django auth
Groups and enforced by DRF permission classes in `backend/api/permissions.py`.

| Role | What they can do |
| --- | --- |
| **Academic** | View own workload, confirm distributed workloads, submit review requests with a reason, view personal analytics, and export own data. |
| **Head of Department (HoD)** | Choose between department review and personal workload, view requests in assigned department only, approve or reject department requests, and view department analytics. |
| **School Operations** | Import workload spreadsheets, distribute workloads, manage staff records, inspect failed distributions, view school-wide workload data, export reports, and contact staff. |
| **Head of School (HoS)** | Review HoD self-submissions, view school-wide workload information, manage HoD/Admin role assignments, and export school-level data. |

Frontend route map:

| Route | Purpose |
| --- | --- |
| `/login` | Email OTP login. |
| `/role` | HoD role-choice page. |
| `/workload-platform` | Academic personal workload dashboard. |
| `/department-head` | HoD department review dashboard. |
| `/school-operations` | School Operations dashboard. |
| `/school-head` | HoS dashboard. |

---

## Prerequisites

```bash
docker --version
docker compose version
git --version
```

Everything else needed for the normal local stack, including Python, Node, and
PostgreSQL, is provided by containers.

---

## Quick start

This is the path a marker or first-time reviewer should follow from a fresh
clone.

```bash
# 1. Clone
git clone https://github.com/hieunguyen0802/uwa-capstone-group19.git
cd uwa-capstone-group19

# 2. Create local environment file
cp .env.example .env

# 3. Start all four services: db, backend, frontend, pgAdmin
docker compose up --build -d

# 4. Check backend startup
docker compose logs -f backend
# Wait for "Starting development server at http://0.0.0.0:8000/", then Ctrl+C.

# 5. Create the seed accounts and sample reports
docker compose exec backend python manage.py seed_smoke
```

The backend container automatically runs `migrate`, `initialize_rbac`, and
`sync_staff_groups` on startup through `docker-compose.yml`, so those commands
do not need to be run manually for a normal first start.

Open `http://localhost:3000` and log in with one of the seed accounts below.

---

## Seed accounts

`seed_smoke` creates four canonical users in the CSSE department. Use each
account's email address to request an OTP during local testing.

| Username | Role | Email |
| --- | --- | --- |
| `academic1` | Academic | `alice@uwa.test` |
| `hod_csse` | Head of Department | `bob@uwa.test` |
| `ops1` | School Operations | `daniela@uwa.test` |
| `hos1` | Head of School | `harold@uwa.test` |

Re-running `seed_smoke` is idempotent and does not duplicate data.

The supported user-facing login flow is OTP login:

- Request a code with `POST /api/login/request-otp/`.
- Verify the code with `POST /api/login/verify-otp/`.
- In local development, OTP messages are printed in `docker compose logs backend`
  unless SMTP is configured in `.env`.

---

## Ports and URLs

After `docker compose up`, the following services are reachable on the host
machine.

| Service | URL / Address | Purpose |
| --- | --- | --- |
| Frontend | http://localhost:3000 | Main login page and role dashboards. |
| Backend API | http://localhost:8000/api/ | REST endpoints. |
| Django admin | http://localhost:8000/admin/ | Django admin console. |
| PostgreSQL | localhost:5433 | Database connection from host. |
| pgAdmin | http://localhost:5050 | Database browser; login values come from `.env`. |

To connect from pgAdmin to PostgreSQL, use host `db`, port `5432`, and the
database, username, and password values from `.env`.

---

## Running the test suite

The current codebase has **152 automated tests**:

- 136 Django backend API, regression, and security tests in
  `backend/api/tests.py`.
- 13 live-stack smoke tests in `backend/tests_smoke/test_smoke_e2e.py`.
- 3 Playwright browser workflow tests in `e2e/test_workload_workflow.py`.

### Django backend tests

Recommended first check:

```bash
docker compose exec backend python manage.py test api
```

These tests cover RBAC, API permission declarations, authentication, OTP token
behaviour, approval state transitions, anomaly blocking, import validation, HoD
department isolation, HoS and School Operations permissions, audit history,
export endpoints, and regression cases.

### MVP automated regression tests

The team used automated regression coverage after final workload-flow changes
to protect the client-confirmed MVP:

```text
School Operations imports workload
-> School Operations distributes workload
-> Academic confirms or submits a review request
-> HoD or HoS reviews the request
-> audit history, analytics, and export remain consistent
```

Final regression work from 18 May 2026 to 21 May 2026 was integrated mainly
through:

- [PR #65 fix-email-notifications](https://github.com/hieunguyen0802/uwa-capstone-group19/pull/65)
- [PR #66 fix-band-validation](https://github.com/hieunguyen0802/uwa-capstone-group19/pull/66)

### Live-stack smoke tests

The smoke tests probe a separate test stack as a black box. Use a different
Compose project name so it does not collide with the development containers.

```bash
cp .env.test.example .env.test
docker compose --env-file .env.test -f docker-compose.test.yml -p workload-test up --build -d
docker compose --env-file .env.test -f docker-compose.test.yml -p workload-test exec backend python manage.py initialize_rbac
docker compose --env-file .env.test -f docker-compose.test.yml -p workload-test exec backend python manage.py sync_staff_groups
docker compose --env-file .env.test -f docker-compose.test.yml -p workload-test exec backend python manage.py seed_smoke

cd backend
pytest tests_smoke/test_smoke_e2e.py -v
```

The test stack uses ports `55433` for PostgreSQL and `55050` for pgAdmin so it
can coexist with the development stack.

### Browser E2E tests

Browser-level MVP workflow tests are stored in `e2e/test_workload_workflow.py`.
Run them after the backend and frontend are available:

```bash
pytest e2e/ --headed --slowmo=800 -v
```

### Security test coverage

Security guardrails are included in the backend suite. They verify that:

- All API views declare permissions.
- Only explicit login and OTP endpoints are public.
- Unauthenticated protected requests return `401`.
- Wrong-role protected requests return `403`.
- Inactive staff tokens cannot access protected endpoints.
- OTP request, OTP verification, and import endpoints are rate-limited.
- Oversized staff/workload imports and malformed payloads are rejected before
  persistence.
- Production-facing cookie and frame settings are explicit.
- Native Django group/permission checks do not fall back to stale staff role
  fields.

---

## API reference

All protected endpoints require:

```text
Authorization: Bearer <access_token>
```

The access token is returned by `POST /api/login/verify-otp/`. The full source
of truth for route registration is `backend/api/urls.py`.

### Authentication and profile

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/login/request-otp/` | Public | Request a 6-digit OTP. |
| POST | `/api/login/verify-otp/` | Public | Verify OTP and return JWT tokens. |
| GET | `/api/auth/me/` | JWT | Current user profile and permissions. |
| GET | `/api/profile/me/` | JWT | Shared profile endpoint. |

### Academic

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/academic/workloads/` | List own workload reports. |
| GET | `/api/academic/workloads/<id>/` | Detail view of one workload report. |
| POST | `/api/academic/workloads/<id>/confirm/` | Confirm workload, blocked when anomaly rules fail. |
| POST | `/api/academic/workload-requests/` | Submit review request with a reason. |
| GET | `/api/academic/visualization/` | Personal analytics payload. |
| GET | `/api/academic/export/` | Export own workload data. |
| POST | `/api/academic/contact-school-of-operations/` | Contact School Operations. |

### Head of Department

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/hod/workload-requests` | List assigned-department requests. |
| GET | `/api/hod/workload-requests/<id>` | Detail view for one request. |
| POST | `/api/hod/workload-requests/<id>/decision` | Approve or reject a request. |
| GET | `/api/hod/self-workload-requests` | HoD personal workload request view. |
| GET | `/api/hod/analytics/workloads` | Department analytics. |
| GET | `/api/hod/exports/workloads` | Department workload export. |

### School Operations

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/school-operations/workloads` | List workload records. |
| POST | `/api/school-operations/workloads/import` | Import workload spreadsheet. |
| POST | `/api/school-operations/workloads/distribute` | Distribute selected workloads. |
| GET | `/api/school-operations/workloads/distribute-progress/<progress_id>` | Check distribution progress. |
| POST | `/api/school-operations/workloads/<id>/redistribute` | Retry distribution for one workload. |
| GET | `/api/school-operations/staff` | Staff directory. |
| POST | `/api/school-operations/staff/import` | Import staff data. |
| GET | `/api/school-operations/visualization` | School Operations analytics. |
| GET | `/api/school-operations/export` | School-level workload export. |
| GET | `/api/school-operations/audit-log/export` | Export audit log. |

### Head of School

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/hos/workload-requests` | List school-level and HoD self-submitted requests. |
| GET | `/api/hos/workload-requests/<id>` | Detail view for one request. |
| POST | `/api/hos/workload-requests/<id>/decision` | Approve or reject a request. |
| GET | `/api/hos/staff-directory` | School staff directory. |
| POST | `/api/hos/staff-directory/import` | Import staff directory data. |
| GET/POST | `/api/hos/role-assignments` | List or create HoD/Admin assignments. |
| PATCH | `/api/hos/role-assignments/<assignment_id>/status` | Disable or update assignment status. |
| GET | `/api/hos/analytics/workloads` | School-level analytics. |
| GET | `/api/hos/exports/workloads` | School-level export. |

### Shared

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/reports/<id>/history/` | Unified audit timeline for one report. |
| GET | `/api/messages/` | Page messages and content metadata. |

---

## User guide and documentation

The English user guide is published under `docs/user-guides/` so it can be
linked from the report and reviewed by non-Chinese-speaking teammates:

- [English User Guide](docs/user-guides/UserGuides.en.md)

Additional documentation and evidence:

- [HoD/HoS frontend API alignment](docs/hod-hos-frontend-api.zh-en.md)
- [Backend API, regression, and security tests](backend/api/tests.py)
- [Live-stack smoke tests](backend/tests_smoke/test_smoke_e2e.py)
- [Browser E2E MVP workflow tests](e2e/test_workload_workflow.py)
- [Closed pull requests](https://github.com/hieunguyen0802/uwa-capstone-group19/pulls?q=is%3Apr+is%3Aclosed)

---

## Repository layout

```text
uwa-capstone-group19/
|-- backend/                         Django 5.2 project
|   |-- config/                      Settings and URL root
|   |-- api/
|   |   |-- view/                    One module per role/API area
|   |   |   |-- academic_views.py
|   |   |   |-- hod_views.py
|   |   |   |-- hos_v3_views.py
|   |   |   |-- ops_admin_views.py
|   |   |   |-- auth_views.py
|   |   |   |-- otp_views.py
|   |   |   `-- import_views.py
|   |   |-- services/                Business logic testable outside HTTP
|   |   |   |-- workload_service.py
|   |   |   |-- importer_service.py
|   |   |   |-- audit_service.py
|   |   |   |-- email_service.py
|   |   |   `-- otp_service.py
|   |   |-- models.py                Staff, Department, WorkloadReport, AuditLog, etc.
|   |   |-- permissions.py           DRF permission classes per role
|   |   |-- management/commands/     seed_smoke, initialize_rbac, sync_staff_groups
|   |   `-- tests.py                 136 backend tests
|   |-- tests_smoke/                 13 live-stack smoke tests
|   `-- requirements.txt
|-- frontend/                        React 19 SPA
|   |-- src/
|   |   |-- pages/                   One page per role
|   |   |-- api/                     Fetch wrappers
|   |   |-- auth/                    Auth context and route guards
|   |   |-- components/              Shared UI components
|   |   `-- workload/                XLSX template and parser helpers
|   `-- package.json
|-- e2e/                             3 Playwright browser workflow tests
|-- docs/
|   |-- user-guides/
|   |   `-- UserGuides.en.md
|   `-- hod-hos-frontend-api.zh-en.md
|-- db/init/                         Idempotent first-run SQL
|-- docker-compose.yml               Local dev stack
|-- docker-compose.test.yml          Isolated test stack
|-- .env.example                     Copy to .env before first run
`-- README.md
```

---

## Production deployment on Azure

The system is deployed to Microsoft Azure as separate managed services rather
than one all-in-one container.

| Service | Azure resource | URL |
| --- | --- | --- |
| Frontend | Azure Static Web App | https://witty-bay-067e0b400.7.azurestaticapps.net |
| Backend | Azure App Service | https://uwa-capstone-group19-be-hpbgh5eygzeufmh3.australiaeast-01.azurewebsites.net |
| Database | Azure Database for PostgreSQL Flexible Server | `uwa-capstone-group19-db.postgres.database.azure.com` |

The frontend and backend communicate through public endpoints controlled by
environment variables such as `DJANGO_ALLOWED_HOSTS`, `DJANGO_CORS_ORIGINS`,
and `DJANGO_SECURE_SSL`.

---

## Common operations

```bash
# Tail backend logs, useful for local OTP codes
docker compose logs -f backend

# Restart backend after pulling new code
docker compose restart backend

# Apply migrations manually
docker compose exec backend python manage.py migrate

# Rebuild RBAC groups and permissions
docker compose exec backend python manage.py initialize_rbac
docker compose exec backend python manage.py sync_staff_groups

# Open Django shell
docker compose exec backend python manage.py shell

# Run backend tests
docker compose exec backend python manage.py test api

# Wipe everything and start fresh; this destroys local DB data
docker compose down -v
docker compose up --build -d
docker compose exec backend python manage.py seed_smoke
```

---

## Troubleshooting

**Backend container restarts in a loop.**

The database may not have been ready when Django first connected. Wait 30
seconds and check:

```bash
docker compose logs backend
```

If the loop continues in a disposable local environment:

```bash
docker compose down -v
docker compose up --build -d
```

**`seed_smoke` says "no such command".**

The backend container may still be booting or rebuilding. Wait until
`docker compose logs backend` shows the development server starting, then retry.

**Frontend cannot connect to backend.**

The local frontend expects the backend at `http://localhost:8000`. Check that
the backend is running and that `DJANGO_CORS_ORIGINS` includes
`http://localhost:3000` when CORS is configured explicitly.

**Port 3000, 8000, 5433, or 5050 is already in use.**

Stop the conflicting process or change the host-side port in `.env` /
`docker-compose.yml`. If the backend port is changed, frontend API configuration
may also need to be updated.

**OTP login does not send email locally.**

By default, the local email backend prints OTP codes in backend logs. To send
real email, set `EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend` and
configure the SMTP variables in `.env`.

---

## Known issues and future work

Open bugs and future-feature requests are tracked on GitHub Issues using
`bug`, `future-feature`, and `tech-debt` labels.

Known limitations of the delivered MVP:

- **Limited frontend unit-test coverage.** The backend has 136 automated tests
  and the E2E suite covers the main MVP workflow, but broad React component
  coverage remains future work.
- **Not load-tested at full production scale.** The system has been demo-tested
  with seed accounts, but analytics endpoints have not been profiled against
  the full 119-academic production scale.
- **OTP email is console-backend by default in development.** Production SMTP is
  a configuration task that requires deployment credentials.
- **Further production hardening is recommended.** This includes load testing,
  monitoring, audit-log retention policy, and backup/restore drills.

---

## Team

| Name | Role |
| --- | --- |
| Hieu Nguyen | Project Manager |
| Nidhi Sorathiya | Business Analyst / Documentation Lead |
| Mehnaz Monsur | Data Architect / Business Analyst |
| Jiaao Li | Backend Developer |
| Qidi Cai | Backend Developer |

**Client:** Daniela Roberts, Senior School Operations Coordinator, UWA School
of Physics, Mathematics and Computing.

**Facilitator:** Fudong Qin.

**Unit:** CITS5206 Information Technology Capstone Project, Semester 1, 2026.
