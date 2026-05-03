# Ops / Admin API 学习与联调手记（分支 Jaffrey-ops-v2）

面向 `IntegrationLog/frontend_api_contract_cn.md` 第 **10.x**（`/admin`）契约；便于之后你对照数据流和业务规则复习。

---

## 1. 契约与真实路由前缀

前端文档示例基址常为 `http://localhost:8000`，本项目 Django 将所有 API 挂在 **`/api/`** 之下（见 `backend/config/urls.py`）。

因此例如：

| 契约路径 | 实际请求路径 |
|---------|----------------|
| `GET /admin/workload-requests/` | `GET http://localhost:8000/api/admin/workload-requests/` |
| `GET /admin/export/` | `GET http://localhost:8000/api/admin/export/` |

认证：`Authorization: Bearer <access>`，与普通页面一致。

### 导出（10.9）演进预留

契约要求先返回 **`{ file_name, download_url }`** JSON。**下载二进制**在本次实现中为第二步：

1. `GET /api/admin/export/` → JSON（内含带 `token` 的 `download_url`）。
2. `GET /api/admin/export/download/?token=...` → `.xlsx` 字节。

这样若 cai 将导出改为异步任务或签名 URL，只需替换 `_persist_export_workbook` / 下载视图背后的实现，而路由可先保持稳定。

导入模板：`GET .../import-template/` 返回的 `download_url` 指向 **`.../import-template/download/`**（authenticated），避免仅靠 `DEBUG` 下 `/media/` 暴露在公网的隐患。

---

## 2. 测试中遇到的问题：`PermissionError [WinError 32]`（导出）

### 现象

在 Windows 上跑 `TestAdminOpsContract.test_admin_export_manifest_and_download_roundtrip` 时，`admin_export_download` 在 **`FileResponse` 仍占用文件句柄的情况下**调用 `disk_path.unlink()`，触发：

`PermissionError: [WinError 32] 另一个程序正在使用此文件...`

### 相关代码（修复前）

`FileResponse` 打开磁盘文件并保持句柄直至响应结束，Windows 在未关闭句柄时禁止删除同一文件。

### 修改做法

先将文件 **`read_bytes()` 读入内存**，再 **`unlink`**，最后用 **`HttpResponse(payload_bytes, content_type=...)`** 返回。这样句柄生命周期短，且不依赖操作系统在响应结束后再删除文件。

Linux/macOS 上原写法往往也能工作；统一为内存缓冲可避免跨平台不一致。

对应实现：`backend/api/view/ops_admin_views.py` 中 `admin_export_download`。

---

## 3. RBAC、限流与安全要点（复习清单）

| 主题 | 实现要点 |
|------|-----------|
| 角色 | `/api/admin/*` 使用 `@require_role('SCHOOL_OPS', 'HOS')`，与「全校 Ops / HoS」数据范围一致。 |
| 列表范围 | `_admin_reports_qs` = `get_workload_queryset` + `is_current=True`，**不包含** Hod 的「未确认 INITIAL 隐藏」规则（全校运营需要看全量 CURRENT）。审批仍仅限 `PENDING`。 |
| 上传大小 | Excel `MAX_EXCEL_UPLOAD_BYTES = 5 * 1024 * 1024`，防止 DoS。 |
| 限流 | 导入：`UserRateThrottle` 30/h；导出 manifest/download：60/h（可按环境调）。 |
| 导出令牌 | Django `cache` 存 `staff_uuid`，15 分钟 TTL；下载后删缓存与文件（读入内存后立即删）。 |

---

## 4. 与数据模型的关系（简述）

新增表（migration `0005_...`）：

- **`WorkloadDistributionJob`**：`POST .../workloads/distribute/` 落库占位，便于以后接真实「派发」逻辑与审计。
- **`StaffRoleAssignment`**：HoD / Admin 的「附加授予」列表，不等于修改 `Staff.role` 单一字段。

工作量导入：**必须**附带表单字段 `year`/`academic_year` 与 `semester`，否则无法对齐 `WorkloadReport.academic_year` + `semester`。

---

如需下一步：可在此文件追加你在 Postman/前端联调里遇到的请求样例与响应片段，便于回溯。
