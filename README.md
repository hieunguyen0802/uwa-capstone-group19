# Workload Verification System

A role-based workload verification platform for UWA PMC School.
Supervisors import Excel workload data; Academics verify or dispute their assigned hours.

---

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Backend  | Python 3.11 · Django 5.2 · DRF 3.15 |
| Auth     | JWT (djangorestframework-simplejwt) |
| Database | PostgreSQL 15                       |
| Frontend | React 18 · Node 18                  |
| DevOps   | Docker · Docker Compose             |

---

## Roles

| Role       | Permissions                                              |
|------------|----------------------------------------------------------|
| Supervisor | Create workload records, view all statuses, action requests |
| Academic   | View own workloads, submit approve / reject decisions    |

---

## Prerequisites

```bash
docker --version        # Docker 20+
docker-compose --version
```

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd uwa-capstone-group19

# 2. Create local env file
cp .env.example .env

# 3. Start all services (backend + frontend + database + pgAdmin)
docker compose up --build -d

# 4. Apply database migrations (first run only)
docker compose exec backend python manage.py migrate

# 5. Create test users (first run only)
docker compose exec backend python manage.py shell
```

Inside the Django shell:
```python
from django.contrib.auth.models import User
from api.models import Staff

supervisor = User.objects.create_user(username='cai', password='test123')
Staff.objects.create(user=supervisor, role='supervisor')

academic = User.objects.create_user(username='jack', password='test123')
Staff.objects.create(user=academic, role='academic')
exit()
```

---

## Access

| Service  | URL                        |
|----------|----------------------------|
| Frontend | http://localhost:3000      |
| Backend  | http://localhost:8000      |
| Database | localhost:5433 (default, configurable in `.env`) |
| pgAdmin  | http://localhost:5050 (default, configurable in `.env`) |

Use pgAdmin login from `.env`:
- Email: `PGADMIN_DEFAULT_EMAIL`
- Password: `PGADMIN_DEFAULT_PASSWORD`

After login, create a server connection:
- Host: `db` (from inside pgAdmin container) or `<host-machine-ip>` (from teammates' own pgAdmin)
- Port: `5432` (container internal) or `${DB_PORT}` (from host network)
- Database: `${POSTGRES_DB}`
- Username: `${POSTGRES_USER}`
- Password: `${POSTGRES_PASSWORD}`

### Team Shared Database (LAN)

If one teammate hosts the Docker database and others connect directly:
1. On host machine, run `docker compose up -d db`.
2. Keep `.env` values shared with team (without committing secrets).
3. Teammates connect with host machine LAN IP, e.g. `192.168.1.20:${DB_PORT}`.
4. Ensure firewall allows inbound `${DB_PORT}`.
5. Use Django migrations as the single source of schema version:
   - `docker compose exec backend python manage.py makemigrations`
   - `docker compose exec backend python manage.py migrate`

Security note:
- For shared/LAN testing, avoid exposing pgAdmin (`5050`) publicly. Prefer sharing only PostgreSQL port and keep pgAdmin host-local.

Recommended workflow:
- Development: each member runs their own local Docker DB.
- Integration/demo: one shared Docker DB in LAN or cloud VM.

### Dual Environment Setup (Isolated Dev + Shared Test)

Use `docker-compose.yml` for local development (isolated), and
`docker-compose.test.yml` as a separate shared test stack.

#### Local development (isolated, default)

```bash
cp .env.example .env
docker compose up -d
```

Local ports:
- Postgres: `5433`
- pgAdmin: `5050`

#### Shared test environment (clean + separate)

```bash
cp .env.test.example .env.test
docker compose --env-file .env.test -f docker-compose.test.yml -p workload-test up -d db backend pgadmin
```

Shared test ports:
- Postgres: `55433`
- pgAdmin: `55050`

This setup is fully isolated from local dev because it uses:
- different compose project name (`-p workload-test`)
- different env file (`.env.test`)
- different volumes (`postgres_data_test`, `pgadmin_data_test`)
- different host ports (`55433`, `55050`)

#### Reset shared test DB to clean state

If test data becomes dirty (e.g. frontend mock logic wrote temporary data):

```bash
docker compose --env-file .env.test -f docker-compose.test.yml -p workload-test down -v
docker compose --env-file .env.test -f docker-compose.test.yml -p workload-test up -d db backend pgadmin
docker compose --env-file .env.test -f docker-compose.test.yml -p workload-test exec backend python manage.py migrate
```

This gives you a fresh test DB schema every time.

---

## API Reference

All protected endpoints require the header:
```
Authorization: Bearer <access_token>
```

### Auth

| Method | Endpoint      | Auth     | Description           |
|--------|---------------|----------|-----------------------|
| POST   | /api/login/   | Public   | Returns JWT tokens    |

Request body:
```json
{ "email": "jack", "password": "test123" }
```

### Academic

| Method | Endpoint                         | Description                  |
|--------|----------------------------------|------------------------------|
| GET    | /api/academic/my-workloads/      | List own workload records     |
| POST   | /api/academic/submit-request/    | Submit approve / reject       |

### Supervisor

| Method | Endpoint                                        | Description                      |
|--------|-------------------------------------------------|----------------------------------|
| GET    | /api/supervisor/requests/                       | All workloads grouped by status  |
| POST   | /api/supervisor/create/                         | Create a workload record         |
| GET    | /api/supervisor/list/                           | Recent workload list             |
| GET    | /api/supervisor/pending-requests/               | Requests awaiting review         |
| POST   | /api/supervisor/action-request/\<id\>/          | Approve or reject a request      |

---

## Database Schema

```
auth_user          — Django built-in user table
api_staff          — user (FK) · role
api_workload       — user · supervisor · unit · hours · status · semester
api_request        — workload (FK) · action · comment · status
```

Status flow:
```
Workload: pending → approved | rejected
Request:  pending → approved | rejected  (set by Supervisor)
```

---

## Development Workflow

```bash
# Restart backend after code changes
docker compose restart backend

# Generate and apply new migrations after model changes
docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py migrate

# Access Django shell
docker compose exec backend python manage.py shell

# Full reset (clears all data)
docker compose down -v
docker compose up --build
```

---

## Git Workflow

```
main          — protected, merge via PR only
feature/*     — one branch per feature / fix
```

```bash
git checkout -b feature/your-feature-name
# ... make changes and commit ...
git push origin feature/your-feature-name
# Open a Pull Request on GitHub
```

---

## Team

| Name  | Role                    |
|-------|-------------------------|
| Hieu  | Project Lead / Backend  |
| Cai   | Frontend / Backend      |
| Jack  | Backend / Auth / API    |
