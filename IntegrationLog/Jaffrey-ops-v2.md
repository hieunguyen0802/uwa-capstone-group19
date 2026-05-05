# Jaffrey-ops-v2 — 质量安全连招执行记录（2026-05-03）

## 范围

- 分支：`Jaffrey-ops-v2`
- 主题：对齐 `frontend_api_contract_cn.md` §10 `/admin`，新增 `backend/api/view/ops_admin_views.py`、`WorkloadDistributionJob` / `StaffRoleAssignment`、`api/urls` 挂载、`integration` 辅助说明见 `IntegrationLog/ops.md`

## 工具结果摘要

| 步骤 | 命令 | 结果 | 备注 |
|------|------|------|------|
| pytest（SQLite） | `python -m pytest api/tests.py -q --ds=config.test_settings` | **PASS**（85 tests） | 新增 `TestAdminOpsContract` 烟测 |
| ruff（变更文件） | `python -m ruff check api/view/ops_admin_views.py api/models.py api/urls.py api/services/workload_service.py` | **PASS** | 全仓库 `api` 仍存在历史 F401 |
| flake8（抽样） | `flake8 api/view/ops_admin_views.py api/models.py` | **WARN**（大量 E501 行宽） | 与既有模型/新文件超长行共存；如需门禁需项目级 `setup.cfg noqa` |
| bandit | `bandit -r api/view/ops_admin_views.py` | **PASS**（无告警） |
| pip-audit | `pip_audit -r requirements.txt` | **PASS**（0 vuln） | 未加 `-r` 时会扫到全局环境中的 flask 等噪声 |
| `manage.py check --deploy` | 同上 | **WARN**（HSTS/SECRET_KEY/Cookie secure 等） | 与本分支无关的常见部署告警 |
| mypy | 未跑（项目未标配 django-stubs 且范围大） | **SKIP** |

## OWASP（粗检）

- **A01 失效访问控制**：`SCHOOL_OPS`/`HOS` + `request.staff` 注入；导出 token 绑定 `staff.pk`。
- **A05 安全配置错误**：导出文件放在 `MEDIA_ROOT/exports/`；DEBUG 仅开发；生产应对象存储或签名 URL。
- **A07 认证**：JWT + `IsAuthenticated`；inactive staff 已由装饰器阻挡。
- **A10 SSRF**：`download_url` 由服务端生成相对路径拼接，无用户提供 host。

## 未决 / 下一步

1. flake8 `E501`：团队统一行长或只对 `ops_admin_views` 做适度换行压缩。
2. 若导出数据量超大：将 `_persist_export_workbook` 改为后台任务（Celery 等）并保持 JSON 契约。
3. **`GET /admin/workloads/import/` 契约仅写 `multipart file`**：`year`+`semester` 表单字段在本次为**必需**；已与 cai 文档差异写在 `IntegrationLog/ops.md`。
4. 按 `CLAUDE.md`：merge 前在 GitHub 建 `[FE] Jaffrey-ops-v2 API contract` Issue（本条分支开发中可由负责人补）。
