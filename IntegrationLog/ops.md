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

---

## Codex 安全审查修复记录（2026-05-04，分支 Jaffrey-ops-v2）

cai 用 Codex 对 PR #34 做了质量检查，发现 5 个问题，全部已修复。

---

### P1（重大）：Excel 导入允许直接伪造 APPROVED / PENDING / REJECTED 状态

**出错原因**

`admin_workload_import` 读取 Excel 的 `status` 列，经 `_normalize_front_status()` 规范化后直接写入 `WorkloadReport.status`。攻击者只需在 Excel 里填 `status=approved`，就能绕过 `INITIAL → confirmed → PENDING → approved/rejected` 的完整审批流。

**修改位置**

`backend/api/view/ops_admin_views.py`，原 line 717-718。

**修改前**

```python
raw_status = col(cells, 'status')
norm_status = _normalize_front_status(raw_status) or 'INITIAL'
```

**修改后**

```python
# Always force INITIAL — spreadsheet status column must never bypass the approval workflow.
norm_status = 'INITIAL'
```

**为什么这么改**

导入是数据录入操作，不是审批操作。新建的 `WorkloadReport` 必须从 `INITIAL` 开始走完整流程。Excel 里的 `status` 列对业务无意义，直接丢弃。

---

### P2（一般）：`/api/admin/staff/import/` 被 `staff/<str:staff_id>/` 路由遮蔽，返回 405

**出错原因**

`urls.py` 中 `admin/staff/<str:staff_id>/` 声明在 `admin/staff/import/` 之前。Django 路由按声明顺序匹配，`import` 被当作 `staff_id` 参数，请求落到 `admin_staff_patch`（只接受 PATCH），POST 请求返回 405。

**修改位置**

`backend/api/urls.py`，原 line 88-92。

**修改前**

```python
path('admin/staff/', admin_staff_list),
path('admin/staff/<str:staff_id>/', admin_staff_patch),
path('admin/staff/import-template/', admin_staff_import_template),
path('admin/staff/import-template/download/', admin_staff_import_template_download),
path('admin/staff/import/', admin_staff_import),
```

**修改后**

```python
path('admin/staff/', admin_staff_list),
# Literal paths must come before the parameterised catch-all to avoid shadowing.
path('admin/staff/import-template/', admin_staff_import_template),
path('admin/staff/import-template/download/', admin_staff_import_template_download),
path('admin/staff/import/', admin_staff_import),
path('admin/staff/<str:staff_id>/', admin_staff_patch),
```

**为什么这么改**

Django URL 路由是顺序匹配的，字面量路径必须排在参数化路径之前，否则字面量永远不会被命中。

---

### P2（一般）：角色分配只写 `StaffRoleAssignment`，不更新 `Staff.role`，授权无效

**出错原因**

`admin_role_assignments` POST 只创建了 `StaffRoleAssignment` 行，但 `require_role()` 装饰器检查的是 `Staff.role` 字段。两者不同步，分配 Admin/HoD 后用户仍然 403。

**修改位置**

`backend/api/view/ops_admin_views.py`，`admin_role_assignments` 函数，原 line 1014-1021。

**修改前**

```python
assignment = StaffRoleAssignment.objects.create(...)
```

**修改后**

```python
assignment = StaffRoleAssignment.objects.create(...)

# Sync Staff.role so require_role() checks take effect immediately.
_FRONT_TO_CANONICAL = {'HoD': 'HOD', 'Admin': 'SCHOOL_OPS'}
canonical = _FRONT_TO_CANONICAL.get(role_front)
if canonical:
    staff_row.role = canonical
    staff_row.save(update_fields=['role', 'updated_at'])
```

**为什么这么改**

`require_role` 是整个后端的授权门卫，它只读 `Staff.role`。`StaffRoleAssignment` 是审计/历史记录表，不是授权表。要让分配立即生效，必须同步写 `Staff.role`。映射关系：`HoD → HOD`，`Admin → SCHOOL_OPS`。

---

### P2（一般）：工作量导入接受负数工时，脏数据直接入库

**出错原因**

`hours_val = Decimal(str(hours_raw or '0'))` 只做了类型转换，没有非负校验。Django 的 `objects.create()` 不自动触发 model validators，负数直接写入 `WorkloadItem.allocated_hours`。

**修改位置**

`backend/api/view/ops_admin_views.py`，原 line 724-728。

**修改后（新增校验）**

```python
if hours_val < 0:
    failures.append({'row': offset, 'field': 'total_work_hours', 'message': 'total_work_hours must be non-negative'})
    continue
```

**为什么这么改**

工时是物理量，不可能为负。在服务层拦截比依赖 DB 约束更早，错误信息也更友好（返回到 `errors` 列表而不是 500）。

---

### P3（轻微）：重导入只把旧记录标为非当前，未填 `superseded_by` 也未写 `MODIFIED_BY_REIMPORT` 审计

**出错原因**

旧报告被 `is_current=False` 后，`superseded_by` 字段保持 NULL，无法从旧记录追溯到新记录。同时模型注释明确要求写 `MODIFIED_BY_REIMPORT` 审计条目，但代码未实现。

**修改位置**

`backend/api/view/ops_admin_views.py`，原 line 749-778。

**修改前**

```python
superseded_reports = list(orphan_reports)
for old in superseded_reports:
    old.is_current = False
    old.save(update_fields=['is_current', 'updated_at'])

report = WorkloadReport.objects.create(...)

AuditLog.objects.create(report=report, action_type='IMPORTED', ...)
```

**修改后**

```python
superseded_reports = list(orphan_reports)

report = WorkloadReport.objects.create(...)   # 先建新记录，才能填 superseded_by

for old in superseded_reports:
    old.is_current = False
    old.superseded_by = report                # 补全血缘链
    old.save(update_fields=['is_current', 'superseded_by', 'updated_at'])
    AuditLog.objects.create(
        report=old,
        action_by=request.staff,
        action_type='MODIFIED_BY_REIMPORT',
        changes={'superseded_by': str(report.report_id), 'batch': str(batch_id)},
    )

AuditLog.objects.create(report=report, action_type='IMPORTED', ...)
```

**为什么这么改**

`superseded_by` 是模型设计中明确的血缘字段，不填就破坏了审计链。`MODIFIED_BY_REIMPORT` 是模型注释里约定的审计类型，让 Ops 能从旧记录直接追溯到替换它的新记录。调整顺序（先建新记录再更新旧记录）是因为 `superseded_by` 需要新记录的主键。
