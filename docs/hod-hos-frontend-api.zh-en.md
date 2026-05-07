# HoD / HoS Frontend Interface Alignment (ZH / EN)

## 1. Scope / 范围

**中文**

本文档用于帮助后端同学对齐当前前端原型中与 `HoD` 和 `HoS` 相关的页面行为、字段结构、筛选条件、审批动作、报表导出和权限分配逻辑。  
文档分为两层：

- `Current frontend prototype`：当前前端页面已经实现的 mock 行为
- `Backend alignment target`：后端正式接入时应遵循的接口契约和业务规则

**English**

This document helps backend developers align with the current frontend prototype for the `HoD` and `HoS` pages, including page behavior, data fields, filters, approval actions, report export, and permission assignment.  
The document separates two layers:

- `Current frontend prototype`: the mock behavior already implemented in the frontend
- `Backend alignment target`: the API contract and business rules the backend should implement

---

## 2. Page Map / 页面映射

| Route | Page | Current frontend component | Notes |
| --- | --- | --- | --- |
| `/department-head` | HoD Dashboard | `frontend/src/pages/Supervisor.tsx` | HoD workload approval page |
| `/school-head` | HoS Dashboard | `frontend/src/pages/HeadofSchool.tsx` | HoS approval + permission assignment |
| `/academic` | Academic self-submission page | `frontend/src/pages/Academic.tsx` | Currently used for academic submission |
| `/role` | Role selection | `frontend/src/pages/Role.tsx` | Current HoD card still points to `/supervisor`; route naming should be corrected |

**中文补充**

- 当前路由里 HoD 正式页面是 `/department-head`
- `Role.tsx` 里 HoD 卡片仍然写的是 `/supervisor`，这是一个前端命名/跳转待修正点

**English note**

- The real HoD route in the router is `/department-head`
- The HoD card inside `Role.tsx` still points to `/supervisor`; this is a frontend naming / routing issue to be corrected

---

## 3. Key Business Differences / 关键业务差异

### 3.1 Academic submission vs HoD self-submission / Academic 提交与 HoD 自提交流程

**中文**

1. `Academic` 在 `/academic` 提交 `submit request` 后，只进入 `HoD` 页面 `/department-head` 的审批列表，不影响 `HoS`
2. `HoD` 也需要提交自己的工时，但这个流程虽然目前复用 `/academic` 页面的交互风格，业务上不能再叫 `Academic`
3. `HoD` 自己提交的工时，目标审批人应该是 `HoS`，即最终应出现在 `/school-head`

**English**

1. When an `Academic` submits a request from `/academic`, it should appear only in the `HoD` queue on `/department-head`, not in `HoS`
2. `HoD` also needs to submit personal workload, but although the current UI may reuse the `/academic` page pattern, this flow should not be named `Academic`
3. A `HoD` self-submission should be reviewed by `HoS`, so it should eventually appear in `/school-head`

### 3.2 Mailbox report scope / 邮箱报表范围差异

**中文**

1. `HoD` 邮箱应只看到自己学院 / department 的报表
2. `HoS` 邮箱逻辑应和 `Ops` (`/school-operations`) 一致，因为 `HoS` 和 `Ops` 都能看所有学院情况

**English**

1. The `HoD` mailbox should show reports only for the HoD's own department
2. The `HoS` mailbox should follow the same logic as `Ops` (`/school-operations`) because both `HoS` and `Ops` can view all departments

### 3.3 Current mock caveat / 当前 mock 注意事项

**中文**

当前 `Supervisor.tsx` 里的 HoD 邮箱 mock 使用的是 `Annual Department Reports` 命名和 demo 数据；  
但根据你的最新业务说明，后端正式实现时应以“`自己学院的学期报告`”作为目标规则。

**English**

The current HoD mailbox mock in `Supervisor.tsx` uses `Annual Department Reports` wording and demo data.  
However, based on the latest product clarification, the backend should treat `department-scoped semester reports` as the target behavior.

---

## 4. Shared Frontend Data Shape / 共享前端数据结构

### 4.1 Approval item / 审批项

Current frontend list/detail pages for HoD and HoS are driven by a shared request-like structure.

```json
{
  "id": 101,
  "sourceWorkloadId": 88,
  "studentId": "12345931",
  "semesterLabel": "Sem1",
  "periodLabel": "2025-1",
  "name": "Dias John",
  "unit": "CITS2200",
  "notes": "Original ops note",
  "description": "Original description",
  "requestReason": "wrong",
  "title": "Lecturer",
  "department": "Physics",
  "rate": 70,
  "status": "pending",
  "hours": 793.5,
  "supervisorNote": "",
  "cancelled": false,
  "detailSnapshot": {
    "breakdown": {
      "Teaching": [{ "name": "CITS2200", "hours": 173 }],
      "Assigned Roles": [{ "name": "Program Chair", "hours": 20 }],
      "HDR": [{ "name": "Student A", "hours": 2 }],
      "Service": [{ "name": "Committee support", "hours": 10 }],
      "Research (residual)": [{ "name": "Research (residual)", "hours": 0 }]
    }
  }
}
```

### 4.2 Breakdown category / 工作量拆分 tab

Both HoD and HoS detail modals currently use these tabs:

- `Teaching`
- `Assigned Roles`
- `HDR`
- `Service`
- `Research (residual)`

### 4.3 Decision note / 审批备注

Approval / rejection currently supports a free-text note to send back to the requester.

```json
{
  "decision": "approve",
  "note": "Please update the justification and resubmit."
}
```

---

## 5. HoD Frontend Interface / HoD 前端接口

### 5.1 Page summary / 页面概览

**Route**: `/department-head`  
**Frontend component**: `frontend/src/pages/Supervisor.tsx`

**Visible tabs / 可见标签**

- `Workload Approval`
- `Visualization`
- `Export Excel`

### 5.2 Search and list / 搜索与列表

**Current UI fields / 当前页面筛选项**

- `Name`
- `Staff ID`
- `Year & Semester`
- `Status Filter`

**Current list columns / 当前列表列**

- `Task`
- `Name`
- `Title`
- `Reasons`
- `Department`
- `Status`
- `Total Work Hours`
- `Submitted Time`

**Backend alignment target / 建议后端列表接口**

`GET /api/hod/workload-requests`

Query params:

| Param | Type | Meaning |
| --- | --- | --- |
| `name` | string | Fuzzy search by display name |
| `staffId` | string | Exact or partial staff ID |
| `year` | number | Reporting year |
| `semester` | `S1 \| S2` | Semester filter |
| `status` | `pending \| approved \| rejected \| all` | Status filter |
| `page` | number | Pagination |
| `pageSize` | number | Pagination size |

Example response:

```json
{
  "items": [
    {
      "id": 101,
      "sourceWorkloadId": 88,
      "staffId": "12345931",
      "name": "Dias John",
      "title": "Lecturer",
      "department": "Physics",
      "reason": "wrong",
      "status": "pending",
      "totalWorkHours": 793.5,
      "submittedAt": "2026-03-17T16:00:00+08:00"
    }
  ],
  "page": 1,
  "pageSize": 10,
  "total": 1
}
```

### 5.3 Detail modal / 详情弹窗

**Current detail fields / 当前详情字段**

- `Name`
- `Staff ID`
- `Target teaching ratio`
- `Actual teaching ratio`
- `Total work hours`
- `Employment type`
- `New Staff`
- `HoD Review`
- `Workload Breakdown`
- `School of Operations notes`
- `Application Reason`

**Backend alignment target / 建议后端详情接口**

`GET /api/hod/workload-requests/{requestId}`

Example response:

```json
{
  "id": 101,
  "staffId": "12345931",
  "name": "Dias John",
  "title": "Lecturer",
  "department": "Physics",
  "periodLabel": "2025-1",
  "targetTeachingRatio": 50.0,
  "actualTeachingRatio": 16.8,
  "totalWorkHours": 1030.5,
  "employmentType": "Full-time",
  "isNewStaff": false,
  "hodReviewRequired": false,
  "schoolOperationsNotes": "Original note from Ops",
  "applicationReason": "wrong",
  "status": "pending",
  "breakdown": {
    "Teaching": [{ "name": "CITS2002", "hours": 173 }],
    "Assigned Roles": [],
    "HDR": [],
    "Service": [],
    "Research (residual)": []
  },
  "canEditBreakdown": true,
  "cancelled": false
}
```

### 5.4 Approve / reject / 审批动作

**Current frontend behavior / 当前前端行为**

- pending item shows `Approve` and `Decline`
- note modal appears before final decision
- status and note are written back to the requester-side mock state

**Backend alignment target / 建议后端审批接口**

`POST /api/hod/workload-requests/{requestId}/decision`

Request:

```json
{
  "decision": "approve",
  "note": "Approved after checking the workload breakdown."
}
```

Response:

```json
{
  "id": 101,
  "status": "approved",
  "reviewedBy": {
    "staffId": "12345931",
    "name": "Rachel"
  },
  "reviewedAt": "2026-05-08T12:30:00+08:00",
  "note": "Approved after checking the workload breakdown."
}
```

### 5.5 HoD mailbox report / HoD 邮箱报表

**Required business rule / 业务规则**

- HoD sees reports only for the HoD's own department
- Based on your latest clarification, the target behavior should be `department-scoped semester reports`
- The current prototype already supports inbox display + Excel download, but the naming/data seed is still a local mock

**Backend alignment target / 建议后端接口**

`GET /api/hod/reports/semester`

Query params:

- `year`
- `semester`

Example response:

```json
{
  "items": [
    {
      "id": "hod-report-2025-S1-physics",
      "year": 2025,
      "semester": "S1",
      "department": "Physics",
      "title": "2025 S1 Physics report generated",
      "createdAt": "2025-07-01T09:00:00+08:00",
      "downloadUrl": "/api/hod/reports/semester/hod-report-2025-S1-physics/download",
      "unread": true
    }
  ]
}
```

Download:

`GET /api/hod/reports/semester/{reportId}/download`

**Excel expectation / Excel 期望**

- one row per department workload request item
- include at least:
  - `Staff ID`
  - `Name`
  - `Department`
  - `Title`
  - `Semester`
  - `Status`
  - `Total Work Hours`
  - `Submitted Time`
  - `Application Reason`
  - `HoD Review Note`

### 5.6 Visualization / 可视化

**Current UI filters / 当前筛选**

- `fromYear`
- `toYear`
- `semester`

**Backend alignment target / 建议后端接口**

`GET /api/hod/analytics/workloads`

Query params:

- `fromYear`
- `toYear`
- `semester=All|S1|S2`

Suggested response sections:

- summary cards
- yearly / semester trend
- approved / rejected / pending counts
- workload hours distribution

### 5.7 Export Excel / 导出 Excel

**Backend alignment target / 建议后端接口**

`GET /api/hod/exports/workloads`

Query params:

- `fromYear`
- `toYear`
- `semester`

Response:

- binary `.xlsx`

### 5.8 Upstream submission to HoD / 流入 HoD 的提交流程

**Current frontend prototype / 当前原型**

`Academic.tsx` currently writes submit requests into HoD-facing mock storage.

**Backend alignment target / 建议后端接口**

`POST /api/academic/workload-requests`

Request:

```json
{
  "sourceWorkloadId": 88,
  "staffId": "12345931",
  "periodLabel": "2025-1",
  "applicationReason": "wrong",
  "title": "Lecturer",
  "department": "Physics",
  "totalWorkHours": 793.5,
  "targetTeachingRatio": 50.0,
  "teachingTargetHours": 400,
  "detailSnapshot": {
    "breakdown": {
      "Teaching": [{ "name": "CITS2200", "hours": 173 }]
    }
  }
}
```

Important rule:

- Normal academic submission goes to `HoD`
- It should not appear in the `HoS` page directly

### 5.9 HoD self-submission to HoS / HoD 自提交流向 HoS

**Business clarification / 业务说明**

- HoD also submits personal workload
- This should reuse a similar self-service UI pattern, but should not continue to be named `Academic`
- The target reviewer for HoD self-submission is `HoS`

**Backend alignment target / 建议后端接口**

`POST /api/hod/self-workload-requests`

Request shape can be the same as academic submission, but actor / target role is different.

---

## 6. HoS Frontend Interface / HoS 前端接口

### 6.1 Page summary / 页面概览

**Route**: `/school-head`  
**Frontend component**: `frontend/src/pages/HeadofSchool.tsx`

**Visible tabs / 可见标签**

- `HoS Workload Approval`
- `Permission Assignment`
- `Visualization`
- `Export Excel`

### 6.2 Search and list / 搜索与列表

**Current UI fields / 当前筛选项**

- `Name`
- `Staff ID`
- `Department`
- `Year & Semester`
- `Status Filter`

**Current list columns / 当前列表列**

- `Task`
- `Name`
- `Title`
- `Reasons`
- `Department`
- `Status`
- `Total Work Hours`
- `Submitted Time`

**Backend alignment target / 建议后端列表接口**

`GET /api/hos/workload-requests`

Query params:

| Param | Type | Meaning |
| --- | --- | --- |
| `name` | string | Name fuzzy search |
| `staffId` | string | Staff ID search |
| `department` | string | Department filter |
| `year` | number | Reporting year |
| `semester` | `S1 \| S2` | Semester filter |
| `status` | `pending \| approved \| rejected \| all` | Status filter |
| `page` | number | Pagination |
| `pageSize` | number | Pagination size |

Example response:

```json
{
  "items": [
    {
      "id": 201,
      "staffId": "12345931",
      "name": "Dias John",
      "title": "Lecturer",
      "department": "Physics",
      "reason": "wrong",
      "status": "pending",
      "totalWorkHours": 793.5,
      "submittedAt": "2026-03-17T16:00:00+08:00"
    }
  ],
  "page": 1,
  "pageSize": 10,
  "total": 1
}
```

### 6.3 Detail modal / 详情弹窗

The current HoS detail modal has been aligned to the HoD detail structure, but it remains an independent page implementation.

**Current detail fields / 当前详情字段**

- `Name`
- `Staff ID`
- `Target teaching ratio`
- `Actual teaching ratio`
- `Total work hours`
- `Employment type`
- `New Staff`
- `HoD Review`
- `Workload Breakdown`
- `School of Operations notes`
- `Application Reason`

**Backend alignment target / 建议后端详情接口**

`GET /api/hos/workload-requests/{requestId}`

Response shape can match the HoD detail contract.

### 6.4 Approve / reject / 审批动作

**Backend alignment target / 建议后端接口**

`POST /api/hos/workload-requests/{requestId}/decision`

Request:

```json
{
  "decision": "reject",
  "note": "Please revise the workload breakdown before final approval."
}
```

### 6.5 HoS mailbox report / HoS 邮箱报表

**Required business rule / 业务规则**

- HoS mailbox should behave like `Ops`
- HoS can see all departments
- The report type is semester-level distribution reporting with Excel download

**Current frontend prototype / 当前原型**

- the page already uses a `Semester Distribution Reports` modal
- demo data is seeded on the frontend
- download is already handled entirely in the frontend mock

**Backend alignment target / 建议后端接口**

`GET /api/hos/reports/semester-distribution`

Query params:

- `year`
- `semester`
- optional `department`

Example response:

```json
{
  "items": [
    {
      "id": "hos-report-2025-S1",
      "year": 2025,
      "semester": "S1",
      "title": "2025 S1 distribution report generated",
      "createdAt": "2025-07-01T09:00:00+08:00",
      "downloadUrl": "/api/hos/reports/semester-distribution/hos-report-2025-S1/download",
      "unread": true
    }
  ]
}
```

Download:

`GET /api/hos/reports/semester-distribution/{reportId}/download`

### 6.6 Permission Assignment / 权限分配

**Current UI sections / 当前页面功能**

- search staff
- import template
- assign role
- assign department
- persist and view assigned role list
- disable assignment

**Current role domain / 当前角色范围**

- `HoD`
- `Admin`

**Current department domain / 当前部门范围**

- `Physics`
- `Mathematics & Statistics`
- `Computer Science & Software Engineering`
- `Senior School Coordinator`

**Suggested staff list API / 建议人员搜索接口**

`GET /api/hos/staff-directory`

Query params:

- `firstName`
- `lastName`
- `staffId`
- `isActive`

Example response:

```json
{
  "items": [
    {
      "id": 1,
      "staffId": "12345931",
      "firstName": "Dias",
      "lastName": "John",
      "email": "dias.john@uwa.edu.au",
      "title": "Lecturer",
      "currentDepartment": "Physics",
      "isActive": true,
      "isNewEmployee": false,
      "notes": ""
    }
  ]
}
```

**Suggested import API / 建议模板导入接口**

`POST /api/hos/staff-directory/import`

- multipart upload
- backend validates template and returns parsed rows + validation messages

**Suggested assignment create API / 建议分配接口**

`POST /api/hos/role-assignments`

Request:

```json
{
  "staffId": "12345931",
  "role": "HoD",
  "department": "Physics"
}
```

Response:

```json
{
  "id": 5001,
  "staffId": "12345931",
  "name": "Dias John",
  "role": "HoD",
  "department": "Physics",
  "permissions": [
    "View Workload",
    "Approve Workload",
    "Update Workload"
  ],
  "assignedAt": "2026-05-08T12:30:00+08:00",
  "status": "active"
}
```

**Suggested assignment list API / 建议已分配列表接口**

`GET /api/hos/role-assignments`

**Suggested disable API / 建议停用接口**

`PATCH /api/hos/role-assignments/{assignmentId}/status`

Request:

```json
{
  "status": "disabled"
}
```

### 6.7 Visualization / 可视化

**Current UI filters / 当前筛选**

- `fromYear`
- `toYear`
- `semester`
- `department`

**Backend alignment target / 建议后端接口**

`GET /api/hos/analytics/workloads`

Query params:

- `fromYear`
- `toYear`
- `semester=All|S1|S2`
- `department=All Departments|Physics|...`

Suggested response sections:

- school summary
- department comparison
- yearly and semester trends
- workload and approval distribution

### 6.8 Export Excel / 导出 Excel

**Backend alignment target / 建议后端接口**

`GET /api/hos/exports/workloads`

Query params:

- `fromYear`
- `toYear`
- `semester`
- `department`

Response:

- binary `.xlsx`

---

## 7. Current Frontend Mock Storage / 当前前端 mock 存储

These are not final backend APIs, but they explain how the frontend is currently wired before backend integration.

| Key | Used by | Meaning |
| --- | --- | --- |
| `academic_to_supervisor_requests_v1` | Academic / HoD / HoS | pending submission queue mock |
| `supervisor_requests_state_v1` | HoD / HoS | locally merged approval state |
| `academic_status_sync_v1` | Academic / HoD / HoS | request status sync mock |
| `academic_notes_sync_v1` | Academic / HoD / HoS | reviewer note sync mock |
| `hod_annual_report_inbox_v1` | HoD | current prototype mailbox cache |
| `hos_semester_report_inbox_v1` | HoS | HoS mailbox cache |
| `hod_role_assignments_v1` | HoS | permission assignment cache |

**中文**

后端接入后，这些 `localStorage` key 应逐步退出，只保留必要的前端 UI 缓存。

**English**

Once backend APIs are integrated, these `localStorage` keys should gradually be removed, except for optional UI-only caching if needed.

---

## 8. Recommended Integration Order / 建议联调顺序

**中文**

建议后端联调顺序如下：

1. 先接 `HoD / HoS workload request list + detail + decision`
2. 再接 `Academic -> HoD` 提交流程
3. 再区分 `HoD self-submission -> HoS`
4. 然后接 `HoD / HoS mailbox report download`
5. 最后接 `HoS permission assignment`, visualization, export

**English**

Recommended backend integration order:

1. First implement `HoD / HoS workload request list + detail + decision`
2. Then wire `Academic -> HoD` submission
3. Then separate `HoD self-submission -> HoS`
4. After that, integrate `HoD / HoS mailbox report download`
5. Finally implement `HoS permission assignment`, visualization, and export

---

## 9. Known Frontend Notes / 当前前端注意点

**中文**

- `Role.tsx` 中 HoD 卡片路由仍指向 `/supervisor`，与 `App.tsx` 中的 `/department-head` 不一致
- HoD 邮箱 prototype 当前仍使用 annual wording，但后端应按你最新规则实现成 department-scoped semester reports
- HoD 和 HoS 的详情布局已经尽量对齐，但它们仍应保持独立页面逻辑和独立权限边界

**English**

- The HoD card in `Role.tsx` still points to `/supervisor`, while the real app route is `/department-head`
- The HoD mailbox prototype still uses annual wording, but the backend should implement department-scoped semester reports based on the latest requirement
- HoD and HoS detail layouts are visually aligned, but they should remain independent pages with independent permission boundaries

