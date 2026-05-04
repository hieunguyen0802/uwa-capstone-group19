# progress.md

## 2026-05-04 — Jaffrey-pageinfo / 页面共用接口

- 实现契约 §11：`/api/profile/me/`、`/api/profile/avatar/`、`/api/messages/`（GET+POST）。
- 运行 backend-quality-combo：`ruff`（改动文件）、`bandit`（pageinfo_views）、`pip-audit`、`manage.py check --deploy`；本地因 `DATABASES.HOST=db` 无法创建测试库，`manage.py test` 未通过（见 `IntegrationLog/pageinfo.md`）。
- 修复 `api/urls.py` 中 `get_my_workloads` 重复导入导致 `supervisor/list/` 误指向学术视图的问题。

后续：在 Docker 或可达 PostgreSQL 上跑全量 `python manage.py test`；按 pip-audit 升级 Django/DRF 等依赖；生产环境用 nginx/S3 托管 `MEDIA` 并关闭 `DEBUG`。
