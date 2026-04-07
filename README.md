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

# 2. Start all services (backend + frontend + database)
docker-compose up --build

# 3. Apply database migrations (first run only)
docker-compose exec backend python manage.py migrate

# 4. Create test users (first run only)
docker-compose exec backend python manage.py shell
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
| Database | localhost:5433 (admin / password) |

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
docker-compose restart backend

# Generate and apply new migrations after model changes
docker-compose exec backend python manage.py makemigrations
docker-compose exec backend python manage.py migrate

# Access Django shell
docker-compose exec backend python manage.py shell

# Full reset (clears all data)
docker-compose down -v
docker-compose up --build
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
