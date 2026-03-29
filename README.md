# Workload System - Docker Guide

This project uses Docker to provide a consistent development environment for all team members.

---

## Prerequisites

Make sure Docker and Docker Compose are installed:

docker --version  
docker-compose --version  

---

## Start the Project

docker-compose up --build  

Builds images (if needed) and starts all services.

---

## Access

Frontend: http://localhost:3000  
Backend: http://localhost:8000  

---

## Stop the Project

docker-compose down  

Stops and removes containers.

---

## Restart (Recommended)

docker-compose restart  

Fast restart without rebuilding. Use this for daily development.

---

## Rebuild (If Needed)

docker-compose down  
docker-compose up --build  

Use this when dependencies or Docker configuration change.

---

## Database

- PostgreSQL runs inside Docker  
- Migrations are applied automatically on startup  

---

## Notes

- Do NOT run backend locally (always use Docker)  
- Use Docker to ensure consistent environments across the team  

---

## Troubleshooting

docker-compose down -v  
docker-compose up --build  

Resets containers and database if something goes wrong.