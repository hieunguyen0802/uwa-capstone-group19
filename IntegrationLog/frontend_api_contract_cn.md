# UWA Capstone 前端接口对接文档（中文版）

## 1. 文档说明

这份文档是**只根据前端页面代码**反推出来的后端接口对接文档，目标是帮助后端同学快速理解：

1. 每个页面是怎么使用的
2. 页面有哪些按钮、筛选、弹窗、导入导出和审批动作
3. 为了让这些页面真正接上后端，需要提供哪些 API

本次读取的页面来源如下：

| 路由                 | 代码来源                                   |
| -------------------- | ------------------------------------------ |
| `/register`        | `origin/feature/qidicai-auth-role-pages` |
| `/login`           | `origin/feature/qidicai-auth-role-pages` |
| `/forgot-password` | `origin/feature/qidicai-auth-role-pages` |
| `/role`            | `origin/feature/qidicai-auth-role-pages` |
| `/academic`        | 以 `main` 分支为主，并参考 PR `#23`    |
| `/supervisor`      | PR `#23` (`pull/23/head`)              |
| `/headofschool`    | `main` 分支                              |
| `/admin`           | `main` 分支                              |

重要说明：

1. 前端代码里目前唯一已经明确写死的真实接口调用是：

```http
POST http://localhost:8000/login/
```

2. 其余接口是根据前端页面字段、按钮、表格、弹窗、Excel 导入导出、筛选条件、图表和业务流推导出来的**推荐接口契约**。
3. 如果后端现有命名和本文不同，可以保留你们自己的接口命名，只要字段语义一致即可。
4. 文档中示例统一使用 `http://localhost:8000` 作为后端基地址。

---

## 2. 全局约定

### 2.1 Base URL

```text
http://localhost:8000
```

### 2.2 通用请求头

```http
Content-Type: application/json
Authorization: Bearer <access_token>
```

文件上传接口使用 `multipart/form-data`。

### 2.3 通用枚举

```json
{
  "status": ["initial", "pending", "approved", "rejected"],
  "confirmation": ["confirmed", "unconfirmed"],
  "semester": ["S1", "S2", "All"],
  "active_status": ["Active", "Inactive"],
  "assign_role": ["HoD", "Admin"]
}
```

#### 工作量状态机说明

| 状态 | 前端显示 | 含义 | 触发条件 |
| --- | --- | --- | --- |
| `initial` | `-` | 初始状态 | Admin/Daniela 派发工作量给 Academic 后自动设置 |
| `pending` | `Pending` | 待审批 | Academic 点击 Submit Request 提交给 HoD 后变为此状态，HoD 尚未决策 |
| `approved` | `Approved` | 已批准 | HoD 点击 Approve 后变为此状态 |
| `rejected` | `Rejected` | 已拒绝 | HoD 点击 Reject/Decline 后变为此状态 |

**关键约束：**
- `initial` → `pending`：由 Academic 的 Submit Request 动作触发，HoD 在此之前无法操作
- `pending` → `approved` / `rejected`：由 HoD 的审批动作触发
- HoD（`/supervisor` 页面）只能看到 Academic 已提交的请求，即 `pending` / `approved` / `rejected` 状态；`initial` 状态表示 Academic 尚未提交，HoD 不可见

### 2.4 通用成功响应

```json
{
  "success": true,
  "message": "ok",
  "data": {}
}
```

### 2.5 通用错误响应

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "email": ["Invalid email format"],
    "password": ["Password must contain uppercase, lowercase, number and special character"]
  }
}
```

### 2.6 通用数据结构

#### 工作量列表项

```json
{
  "id": 101,
  "employee_id": "50123456",
  "name": "Sam Yaka",
  "title": "Professor",
  "department": "Computer Science & Software Engineering",
  "description": "Teaching + HDR + service workload",
  "status": "pending",
  "confirmation": "unconfirmed",
  "total_hours": 42,
  "pushed_time": "2026-03-11 10:30",
  "submitted_time": "2026-03-11 10:00",
  "semester_label": "Sem1",
  "period_label": "2025-1"
}
```

#### 工作量明细拆分

```json
{
  "Teaching": [
    { "name": "CITS2401", "hours": 15 },
    { "name": "CITS2200", "hours": 5 }
  ],
  "Assigned Roles": [
    { "name": "Program Chair", "hours": 20 }
  ],
  "HDR": [
    { "name": "Student A", "hours": 2 }
  ],
  "Service": [
    { "name": "Committee support", "hours": 4 }
  ]
}
```

#### 教职工信息

```json
{
  "staff_id": "50123451",
  "first_name": "Ann",
  "last_name": "Culhane",
  "email": "ann.culhane@uwa.edu.au",
  "title": "Professor",
  "department": "Physics",
  "active_status": "Active"
}
```

#### 权限分配记录

```json
{
  "id": 9001,
  "staff_id": "50123451",
  "name": "Ann Culhane",
  "role": "HoD",
  "department": "Physics",
  "permissions": ["View Workload", "Approve Workload", "Update Workload"],
  "assigned_at": "2026-04-30 10:45",
  "status": "active"
}
```

### 2.7 建议的后端模型层

考虑到后端数据库模型目前还不完整，建议至少补齐下面这组核心模型。

| 模型                        | 建议核心字段                                                                                                                                                                     | 前端为什么需要它                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `Department`              | `id`, `code`, `name`, `school_name`, `is_active`                                                                                                                       | HoS/Admin 的筛选、权限分配、图表统计都依赖它        |
| `ReportingPeriod`         | `id`, `year`, `semester`, `start_date`, `end_date`, `is_open`                                                                                                        | 工作量筛选、图表、导出、工作量下发都依赖它          |
| `StaffProfile`            | `id`, `staff_id`, `email`, `first_name`, `last_name`, `title`, `department_id`, `is_active`, `avatar_url`                                                      | 认证、个人资料、工作量、员工管理都会用到            |
| `UserAccount`             | `id`, `staff_profile_id`, `password_hash`, `is_active`, `must_change_password`, `password_updated_at`, `last_login_at`                                             | 登录、首次设密码、忘记密码都依赖它                  |
| `VerificationCode`        | `id`, `staff_profile_id` 可空, `email`, `purpose`, `code_hash`, `expires_at`, `consumed_at`, `send_count`                                                        | 注册页和忘记密码页都需要验证码模型                  |
| `RoleDefinition`          | `id`, `code`, `name`                                                                                                                                                       | 角色选择页和权限控制依赖它                          |
| `PermissionDefinition`    | `id`, `code`, `name`                                                                                                                                                       | HoS/Admin 权限分配依赖它                            |
| `StaffRoleAssignment`     | `id`, `staff_profile_id`, `role_id`, `department_id` 可空, `status`, `assigned_at`, `disabled_at`                                                                  | `/role`、`/headofschool`、`/admin` 都要用     |
| `WorkloadSubmission`      | `id`, `owner_staff_id`, `reporting_period_id`, `description`, `total_hours`, `status`, `confirmation`, `pushed_at`, `submitted_at`, `updated_at`             | Academic/Supervisor/HoS/Admin 工作量页面都依赖它    |
| `WorkloadBreakdownItem`   | `id`, `workload_submission_id`, `category`, `item_name`, `hours`, `sort_order`                                                                                       | 所有详情弹窗和工时拆分表格都需要它                  |
| `WorkloadApprovalRequest` | `id`, `workload_submission_id`, `requester_staff_id`, `current_reviewer_staff_id` 可空, `current_stage`, `request_reason`, `status`, `created_at`, `closed_at` | 用来替代当前浏览器里 Academic 和审核页之间的假同步  |
| `WorkloadReviewAction`    | `id`, `approval_request_id`, `reviewer_staff_id`, `decision`, `note`, `reviewed_at`, `snapshot_total_hours`                                                        | Supervisor/HoS/Admin 的审批历史和 note 存储都依赖它 |
| `Conversation`            | `id`, `participant_a_id`, `participant_b_id`, `last_message_at`                                                                                                          | 消息面板需要它                                      |
| `Message`                 | `id`, `conversation_id`, `sender_staff_id`, `body`, `sent_at`, `read_at`                                                                                             | 所有聊天弹窗都需要它                                |
| `ImportJob`               | `id`, `job_type`, `uploaded_by_staff_id`, `file_path`, `status`, `summary_json`, `created_at`, `finished_at`                                                     | 员工 / 工作量导入需要它                             |
| `ExportJob` 可选          | `id`, `job_type`, `requested_by_staff_id`, `filters_json`, `file_path`, `status`, `created_at`, `finished_at`                                                    | 如果导出以后是异步任务，建议加上                    |

推荐关系说明：

- 一个 `StaffProfile` 可以对应多条 `StaffRoleAssignment`
- 一个 `WorkloadSubmission` 应该包含多条 `WorkloadBreakdownItem`
- 一个 `WorkloadSubmission` 可以在不同审批阶段产生一条或多条 `WorkloadApprovalRequest`
- 一条 `WorkloadApprovalRequest` 应该拥有多条 `WorkloadReviewAction` 作为审批历史
- 当前前端通过 `localStorage` 在 Academic 和审核页面之间同步状态，后续应该统一改成查询 `WorkloadApprovalRequest + WorkloadReviewAction`

### 2.8 需要后续替换掉的前端临时模式

当前前端里存在一些明显用于测试的临时实现，后端同学需要注意：

- 使用 `localStorage` 当作页面之间的临时数据总线
- 多个页面内置了硬编码的用户、工作量、部门统计和聊天记录
- 一些认证页面在浏览器里用 `Math.random()` 生成验证码，并用 `alert()` 显示
- 多个 Excel 导入导出流程目前完全在浏览器里完成
- 一些图表直接使用硬编码 mock 数据，而不是后端聚合结果
- 一些审批流程通过 `setTimeout()` 模拟异步，但实际上没有落库
- 有些按钮 UI 已经存在，但还没有真正接后端接口

---

## 3. `/login` 页面

### 3.1 页面工作流

这个页面是系统入口页，主要功能是：

1. 用户输入 `Staff ID` 或 `Email Address`
2. 用户输入密码并点击 `Sign In`
3. 登录成功后进入 `/role` 页面
4. 页面支持 `Remember Me`
5. 页面支持跳转到：
   - `/forgot-password`
   - `/register`

从前端代码能看出的校验规则：

- 账号输入最大长度 `254`
- 密码至少 `8` 位
- 必须同时包含：
  - 大写字母
  - 小写字母
  - 数字
  - 特殊字符

### 建议的后端模型

- `StaffProfile`
- `UserAccount`
- `StaffRoleAssignment`

### 当前前端伪逻辑与建议改法

- 在 `frontend/src/pages/Login.tsx` 里，`rememberedLogin` 会把明文密码存进 `localStorage`。这个做法只适合测试，不适合正式环境。建议改成 `refresh token` 或 `http-only cookie`，最多只记住账号标识，不要记住密码。
- 当前页面把整个登录响应直接写进 `localStorage.user`。建议把后端登录响应规范成 `tokens + 规范化 user profile + roles`。
- 登录成功后固定跳去 `/role` 页面，这本身没问题，但下一页展示哪些角色，应该由后端真实返回，而不是依赖前端假设。

### 3.2 接口一览

| Method   | Path        | 作用                        |
| -------- | ----------- | --------------------------- |
| `POST` | `/login/` | 使用 staff id 或 email 登录 |

### 3.3 登录请求

如果用户输入的是 staff id，前端会发送：

```json
{
  "staff_id": "50123456",
  "email": "",
  "password": "Aa123456!"
}
```

如果用户输入的是邮箱，前端会发送：

```json
{
  "staff_id": "",
  "email": "sam.yaka@uwa.edu.au",
  "password": "Aa123456!"
}
```

### 3.4 推荐响应

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "access_token": "jwt-access-token",
    "refresh_token": "jwt-refresh-token",
    "user": {
      "user_id": 12,
      "staff_id": "50123456",
      "email": "sam.yaka@uwa.edu.au",
      "first_name": "Sam",
      "last_name": "Yaka",
      "title": "Professor",
      "department": "Computer Science & Software Engineering"
    },
    "roles": [
      { "key": "academic", "label": "Academic", "route": "/academic" },
      { "key": "supervisor", "label": "Head of Department", "route": "/supervisor" }
    ]
  }
}
```

---

## 4. `/register` 页面

### 4.1 页面工作流

这个页面实际上是“首次使用系统时设置密码”的页面，不是普通意义上的开放注册。

页面工作流程如下：

1. 用户输入 `Employee ID`
2. 用户输入 `Email Address`
3. 点击 `Send Code`
4. 后端给邮箱发送 6 位验证码
5. 用户输入验证码
6. 用户输入新密码和确认密码
7. 点击 `Create Password`
8. 成功后跳转回 `/login`

从前端代码能看出的校验规则：

- `staff_id` 必填
- `email` 必填，且格式合法，最大 `254`
- 验证码必须是 **6 位数字**
- 密码最大 `64`
- 密码必须满足复杂度规则
- 两次密码必须一致
- 页面有发送验证码倒计时 `60s`

### 建议的后端模型

- `StaffProfile`
- `UserAccount`
- `VerificationCode`

### 当前前端伪逻辑与建议改法

- 在 `frontend/src/pages/Register.tsx` 里，验证码是通过 `Math.random()` 在前端生成的，并且通过 `alert()` 直接展示。这明显是测试逻辑，应该改成后端发送验证码接口。
- 当前页面通过前端状态里的 `generatedCode` 来校验验证码。正式实现里应该由后端保存验证码哈希、过期时间和是否已使用。
- 当前“设置成功”只是弹窗后跳转 `/login`，没有真实落库。正式实现应当真正更新 `UserAccount` 里的密码，并在需要时清除首次登录标记，例如 `must_change_password`。

### 4.2 接口一览

| Method   | Path                     | 作用                   |
| -------- | ------------------------ | ---------------------- |
| `POST` | `/register/send-code/` | 发送首次设置密码验证码 |
| `POST` | `/register/complete/`  | 完成首次密码设置       |

### 4.3 发送验证码

请求：

```json
{
  "email": "sam.yaka@uwa.edu.au"
}
```

响应：

```json
{
  "success": true,
  "message": "Verification code sent",
  "data": {
    "email": "sam.yaka@uwa.edu.au",
    "expires_in_seconds": 300
  }
}
```

### 4.4 完成首次设置密码

请求：

```json
{
  "staff_id": "50123456",
  "email": "sam.yaka@uwa.edu.au",
  "verification_code": "123456",
  "password": "Aa123456!",
  "confirm_password": "Aa123456!"
}
```

响应：

```json
{
  "success": true,
  "message": "Password created successfully",
  "data": {
    "staff_id": "50123456",
    "email": "sam.yaka@uwa.edu.au",
    "account_status": "active"
  }
}
```

---

## 5. `/forgot-password` 页面

### 5.1 页面工作流

这个页面用于忘记密码后的重置流程。

页面工作流程如下：

1. 用户输入邮箱
2. 点击 `Send Code`
3. 后端发送 6 位验证码到邮箱
4. 用户输入验证码
5. 输入新密码和确认密码
6. 点击 `Reset Password`
7. 成功后跳转到 `/login`

前端可见校验规则：

- 邮箱必填，格式合法，最大 `254`
- 验证码为 **6 位数字**
- 密码规则与注册页一致
- 两次密码必须一致
- 未发送验证码前不能完成重置

### 建议的后端模型

- `StaffProfile`
- `UserAccount`
- `VerificationCode`

### 当前前端伪逻辑与建议改法

- 在 `frontend/src/pages/ForgotPassword.tsx` 里，重置验证码也是前端生成并通过 `alert()` 展示的，需要改成后端发码。
- 当前重置密码完全由前端逻辑完成。正式流程应该由后端校验验证码是否正确、是否过期、是否已消费，然后再更新密码哈希。
- 现在没有后端限流、重发限制和审计记录。建议后端增加冷却时间、发送次数限制和安全日志。

### 5.2 接口一览

| Method   | Path                            | 作用           |
| -------- | ------------------------------- | -------------- |
| `POST` | `/forgot-password/send-code/` | 发送重置验证码 |
| `POST` | `/forgot-password/reset/`     | 重置密码       |

### 5.3 发送验证码

请求：

```json
{
  "email": "sam.yaka@uwa.edu.au"
}
```

响应：

```json
{
  "success": true,
  "message": "Reset code sent",
  "data": {
    "email": "sam.yaka@uwa.edu.au",
    "expires_in_seconds": 300
  }
}
```

### 5.4 重置密码

请求：

```json
{
  "email": "sam.yaka@uwa.edu.au",
  "verification_code": "123456",
  "password": "Aa123456!",
  "confirm_password": "Aa123456!"
}
```

响应：

```json
{
  "success": true,
  "message": "Password reset successfully",
  "data": {
    "email": "sam.yaka@uwa.edu.au",
    "password_updated_at": "2026-04-30T10:30:00Z"
  }
}
```

---

## 6. `/role` 页面

### 6.1 页面工作流

这个页面是登录成功后的“角色选择页”。

页面工作流程如下：

1. 用户登录成功后进入此页面
2. 页面展示当前用户可进入的角色卡片
3. 用户点击某个角色卡片后跳转到对应业务页面

当前前端代码里展示了两个角色：

- `Head of Department` -> `/supervisor`
- `Academic` -> `/academic`

后续如果系统支持更多角色，也建议从后端动态返回。

### 建议的后端模型

- `RoleDefinition`
- `PermissionDefinition`
- `StaffRoleAssignment`

### 当前前端伪逻辑与建议改法

- 在 `frontend/src/pages/Role.tsx` 里，角色卡片是硬编码的。正式环境应该改成根据后端返回的角色列表动态渲染。
- 当前前端假设了固定路由。建议由后端明确返回该用户当前可用的角色和允许访问的业务入口。
- 如果将来某些用户只有一个角色，也可以直接跳过本页面，但这个判断仍然应该基于后端真实角色数据。

### 6.2 接口一览

| Method  | Path               | 作用                     |
| ------- | ------------------ | ------------------------ |
| `GET` | `/role-options/` | 返回当前登录用户可选角色 |

### 6.3 推荐响应

```json
{
  "success": true,
  "message": "Roles loaded",
  "data": {
    "roles": [
      {
        "key": "supervisor",
        "title": "Head of Department",
        "subtitle": "Manage and review departmental workloads",
        "route": "/supervisor"
      },
      {
        "key": "academic",
        "title": "Academic",
        "subtitle": "Submit and review your own workload",
        "route": "/academic"
      }
    ]
  }
}
```

---

## 7. `/academic` 页面

### 7.1 页面工作流

这个页面是 Academic 用户自己的工作量主页面，主要功能有：

1. 查看自己的工作量列表
2. 按条件筛选自己的工作量：
   - `status`
   - `confirmation`
   - `year`
   - `semester`
3. 点击某一行查看工作量详情弹窗
4. 在详情弹窗中查看：
   - 姓名
   - 工号
   - 总工时
   - 状态
   - 工作量分项拆分
   - 描述
5. 点击 `Confirmed` 确认自己的工作量
6. 选择某条记录，填写 `Application reason`，提交给 Supervisor 审批
7. 打开发消息弹窗，与 Admin 联系
8. 打开 Profile 弹窗，查看个人信息并上传头像
9. `main` 分支里还包含：
   - Visualization 图表页
   - Export Excel 导出页

从前端代码能看出的约束：

- 一次只允许选中一条工作量提交
- `Application reason` 必填
- `Application reason` 最大 `240` 字符

### 建议的后端模型

- `WorkloadSubmission`
- `WorkloadBreakdownItem`
- `WorkloadApprovalRequest`
- `WorkloadReviewAction`
- `Conversation`
- `Message`

### 当前前端伪逻辑与建议改法

- 在 `frontend/src/pages/Academic.tsx` 里，`const user` 和初始工作量列表 `base` 都是硬编码测试数据，正式环境要改成后端查询。
- Academic 提交给 Supervisor 的流转目前通过 `localStorage` 键，如 `SUPERVISOR_DRAFT_KEY`、`ACADEMIC_STATUS_SYNC_KEY`、`ACADEMIC_NOTES_SYNC_KEY`，再配合浏览器事件做假同步。建议改成真实的 `WorkloadApprovalRequest` 和审批动作记录。
- 聊天记录目前只是页面本地状态，建议改成 `Conversation + Message`。
- Visualization 当前使用硬编码的 `mockBySemester` 和 `mockTotalBySemester`，建议改成后端按 period 聚合。
- Excel 导出当前通过浏览器里的 `XLSX.writeFile()` 完成，建议改成后端导出接口或后端返回数据集。

### 7.2 接口一览

| Method   | Path                                  | 作用                               |
| -------- | ------------------------------------- | ---------------------------------- |
| `GET`  | `/academic/workloads/`              | 获取 Academic 自己的工作量列表     |
| `GET`  | `/academic/workloads/{id}/`         | 获取工作量详情                     |
| `POST` | `/academic/workloads/{id}/confirm/` | 确认某条工作量                     |
| `POST` | `/academic/workload-requests/`      | 将某条工作量提交给 Supervisor 审批 |
| `GET`  | `/academic/visualization/`          | 获取 Academic 图表数据             |
| `GET`  | `/academic/export/`                 | 导出 Excel                         |

### 7.3 获取工作量列表

建议查询参数：

```text
status=all|initial|pending|approved|rejected
confirmation=confirmed|unconfirmed
year=2025
semester=S1|S2
page=1
page_size=10
```

响应：

```json
{
  "success": true,
  "message": "Academic workloads loaded",
  "data": {
    "page": 1,
    "page_size": 10,
    "total": 24,
    "items": [
      {
        "id": 101,
        "employee_id": "50123456",
        "name": "Sam Yaka",
        "title": "Professor",
        "description": "Teaching, HDR and service work",
        "status": "pending",
        "confirmation": "unconfirmed",
        "total_hours": 42,
        "pushed_time": "2026-03-11 10:30"
      }
    ]
  }
}
```

### 7.4 获取工作量详情

响应：

```json
{
  "success": true,
  "message": "Workload detail loaded",
  "data": {
    "id": 101,
    "employee_id": "50123456",
    "name": "Sam Yaka",
    "status": "pending",
    "confirmation": "unconfirmed",
    "total_hours": 42,
    "description": "Detailed workload description",
    "supervisor_note": "",
    "breakdown": {
      "Teaching": [
        { "name": "CITS2401", "hours": 15 },
        { "name": "CITS2200", "hours": 5 }
      ],
      "Assigned Roles": [
        { "name": "Program Chair", "hours": 10 }
      ],
      "HDR": [
        { "name": "Student A", "hours": 4 }
      ],
      "Service": [
        { "name": "Committee support", "hours": 8 }
      ]
    }
  }
}
```

### 7.5 确认工作量

请求：

```json
{
  "confirmation": "confirmed"
}
```

响应：

```json
{
  "success": true,
  "message": "Workload confirmed",
  "data": {
    "id": 101,
    "confirmation": "confirmed"
  }
}
```

### 7.6 提交给 Supervisor 审批

请求：

```json
{
  "workload_ids": [101],
  "request_reason": "Please review the updated teaching workload for Semester 1."
}
```

响应：

```json
{
  "success": true,
  "message": "Request submitted to supervisor",
  "data": {
    "created_request_ids": [7001],
    "status": "pending"
  }
}
```

### 7.7 Visualization

建议查询参数：

```text
year_from=2024
year_to=2026
semester=All|S1|S2
```

响应：

```json
{
  "success": true,
  "message": "Visualization loaded",
  "data": {
    "reporting_period_label": "2024-2026 All Semesters",
    "my_vs_department_trend": [
      { "semester": "2024 S1", "my_hours": 12.2, "department_average": 11.4 },
      { "semester": "2024 S2", "my_hours": 12.8, "department_average": 11.7 }
    ],
    "total_hours_trend": [
      { "semester": "2024 S1", "total_hours": 260 },
      { "semester": "2024 S2", "total_hours": 275 }
    ]
  }
}
```

### 7.8 Export Excel

建议查询参数：

```text
year_from=2024
year_to=2026
semester=All|S1|S2
```

响应：

```json
{
  "success": true,
  "message": "Export prepared",
  "data": {
    "file_name": "Academic_Workload.xlsx",
    "download_url": "http://localhost:8000/media/exports/Academic_Workload.xlsx"
  }
}
```

---

## 8. `/supervisor` 页面

> **角色说明**：前端路由 `/supervisor` 对应的角色是 **HoD（Head of Department，系主任）**，在 `/role` 页面显示为 "Head of Department"。

### 状态机重申

HoD 页面只处理 Academic **已提交**的工作量请求，状态流转如下：

```
[Admin 派发] → initial（Academic 尚未提交，HoD 不可见）
                    ↓ Academic 点击 Submit Request
              pending（HoD 可见，待决策）
                    ↓ HoD 操作
         approved / rejected
```

- **`initial`**：工作量刚被派发，Academic 还没有提交，HoD 看不到这条记录
- **`pending`**：Academic 已提交，HoD 收到后尚未决策，这是 HoD 需要处理的核心状态
- **`approved` / `rejected`**：HoD 已决策，历史记录可查

### 8.1 页面工作流

这个页面是 Supervisor / HoD 用来审批 Academic 工作量的主页面。

页面工作流程如下：

1. 打开页面后查看待审批（`pending`）、已审批（`approved`）、已拒绝（`rejected`）的工作量请求
2. 按条件筛选列表：
   - `employee_id`
   - `first_name`
   - `last_name`
   - `title`
   - `year`
   - `semester`
   - `status`
3. 勾选多条记录，执行批量 `Approve` / `Reject`
4. 点击某一行打开详情弹窗
5. 在详情弹窗中查看：
   - 教师信息
   - 描述
   - 申请理由
   - 工作量拆分
6. 在详情弹窗中可以编辑工作量 breakdown
7. 输入审批意见 `note` 后对单条记录进行 `Approve` / `Decline`
8. 查看 Visualization 图表
9. 导出 Supervisor 工作量 Excel
10. 发消息、查看个人资料、上传头像

前端可见约束：

- 单条审批时 `note` 必填
- `note` 最大 `240`
- PR `#23` 版本中详情拆分支持编辑和行增删
- 可视化查询年份范围最多 `3 年`

### 建议的后端模型

- `WorkloadApprovalRequest`
- `WorkloadReviewAction`
- `WorkloadBreakdownItem`
- `StaffProfile`
- `Conversation`
- `Message`

### 当前前端伪逻辑与建议改法

- 在 `frontend/src/pages/Supervisor.tsx` 里，当前用户、聊天记录和 `pending` 审批列表都是 fake data，正式环境应改成后端查询。
- 审批和拒绝目前只是改本地 state，并通过 `setTimeout(300)` 模拟异步。正式实现应把审批动作写入后端。
- 当前页面通过 `localStorage` 和浏览器事件把审批结果回写给 Academic，这个机制后续应删除，改成 Academic 直接查真实后端状态和 note。
- Excel 导出目前是浏览器本地生成，建议改成后端导出接口。
- Visualization 当前是基于本地假数据计算出来的，建议改成后端按真实工作量和 period 聚合。

### 8.2 接口一览

| Method   | Path                                              | 作用                                    |
| -------- | ------------------------------------------------- | --------------------------------------- |
| `GET`  | `/supervisor/workload-requests/`                | 获取审批列表                            |
| `GET`  | `/supervisor/workload-requests/{id}/`           | 获取详情                                |
| `POST` | `/supervisor/workload-requests/batch-decision/` | 批量审批 / 拒绝                         |
| `POST` | `/supervisor/workload-requests/{id}/decision/`  | 单条审批 / 拒绝并附带 note 和 breakdown |
| `GET`  | `/supervisor/visualization/`                    | 获取图表和汇总数据                      |
| `GET`  | `/supervisor/export/`                           | 导出 Excel                              |

### 8.3 获取审批列表

> HoD 只能看到 Academic 已提交的请求（`pending` / `approved` / `rejected`），`initial` 状态的工作量不会出现在此列表中。

建议查询参数：

```text
status=pending|approved|rejected|all
employee_id=50123456
first_name=sam
last_name=yaka
title=professor
year=2025
semester=S1|S2
page=1
page_size=10
```

响应：

```json
{
  "success": true,
  "message": "Supervisor workload requests loaded",
  "data": {
    "summary": {
      "pending": 8,
      "approved": 3,
      "rejected": 1
    },
    "page": 1,
    "page_size": 10,
    "total": 12,
    "items": [
      {
        "id": 7001,
        "employee_id": "50123456",
        "name": "Sam Yaka",
        "title": "Professor",
        "department": "Computer Science & Software Engineering",
        "unit": "CITS2200",
        "description": "Workload submission from academic page",
        "request_reason": "Please review the updated teaching workload.",
        "status": "pending",
        "total_hours": 42,
        "submitted_time": "2026-03-11 10:00",
        "semester_label": "Sem1",
        "period_label": "2025-1"
      }
    ]
  }
}
```

### 8.4 获取详情

响应：

```json
{
  "success": true,
  "message": "Request detail loaded",
  "data": {
    "id": 7001,
    "employee_id": "50123456",
    "name": "Sam Yaka",
    "title": "Professor",
    "department": "Computer Science & Software Engineering",
    "status": "pending",
    "request_reason": "Please review the updated teaching workload.",
    "description": "Detailed workload description",
    "supervisor_note": "",
    "breakdown": {
      "Teaching": [
        { "name": "CITS2401", "hours": 15 },
        { "name": "CITS2200", "hours": 5 }
      ],
      "Assigned Roles": [
        { "name": "Program Chair", "hours": 10 }
      ],
      "HDR": [
        { "name": "Student A", "hours": 4 }
      ],
      "Service": [
        { "name": "Committee support", "hours": 8 }
      ]
    }
  }
}
```

### 8.5 批量审批 / 拒绝

> **前置约束**：只有 `pending` 状态的请求才能被批量审批或拒绝。如果请求列表中包含非 `pending` 状态的记录，后端应返回 400 错误。

请求：

```json
{
  "request_ids": [7001, 7002, 7003],
  "decision": "approved"
}
```

响应：

```json
{
  "success": true,
  "message": "Batch decision completed",
  "data": {
    "updated_count": 3,
    "decision": "approved"
  }
}
```

### 8.6 单条审批 / 拒绝

> **前置约束**：只有 `pending` 状态的请求才能被审批或拒绝。对非 `pending` 状态的请求调用此接口，后端应返回 400 错误。

请求：

```json
{
  "decision": "rejected",
  "note": "Please update the teaching and service hour allocation.",
  "breakdown": {
    "Teaching": [
      { "name": "CITS2401", "hours": 12 },
      { "name": "CITS2200", "hours": 4 }
    ],
    "Assigned Roles": [
      { "name": "Program Chair", "hours": 8 }
    ],
    "HDR": [
      { "name": "Student A", "hours": 3 }
    ],
    "Service": [
      { "name": "Committee support", "hours": 6 }
    ]
  }
}
```

响应：

```json
{
  "success": true,
  "message": "Request updated",
  "data": {
    "id": 7001,
    "status": "rejected",
    "supervisor_note": "Please update the teaching and service hour allocation."
  }
}
```

### 8.7 Visualization

建议查询参数：

```text
year_from=2024
year_to=2026
semester=All|S1|S2
```

响应：

```json
{
  "success": true,
  "message": "Supervisor visualization loaded",
  "data": {
    "reporting_period_label": "2024-2026 All Semesters",
    "summary": {
      "total_academics": 12,
      "total_work_hours": 396,
      "work_hours_per_academic": 33,
      "pending_requests": 8,
      "approved_requests": 3,
      "rejected_requests": 1
    },
    "total_work_hours_trend": [
      { "semester": "2024 S1", "total_hours": 132 },
      { "semester": "2024 S2", "total_hours": 140 }
    ],
    "average_work_hours_by_semester": [
      { "semester": "2024 S1", "average_hours": 31.6 },
      { "semester": "2024 S2", "average_hours": 33.1 }
    ]
  }
}
```

### 8.8 Export Excel

建议查询参数：

```text
year_from=2024
year_to=2026
semester=All|S1|S2
```

响应：

```json
{
  "success": true,
  "message": "Export prepared",
  "data": {
    "file_name": "Supervisor_Workload.xlsx",
    "download_url": "http://localhost:8000/media/exports/Supervisor_Workload.xlsx"
  }
}
```

---

## 9. `/headofschool` 页面

### 9.1 页面工作流

这个页面是 Head of School 的工作台，除了审批工作量，还负责更高层级的权限分配和按学院维度的统计。

页面主要功能包括：

1. 查看和筛选工作量审批列表
2. 按条件搜索：
   - `employee_id`
   - `first_name`
   - `last_name`
   - `title`
   - `department`
   - `year`
   - `semester`
3. 对工作量做批量审批 / 批量拒绝
4. 查看单条详情并填写 note 审批
5. 在详情中编辑工作量 breakdown
6. 进入 `Permission Assignment` 模块
7. 搜索教职工
8. 修改教职工个人信息
9. 下载 Staff 模板
10. 导入 Staff Excel
11. 给某个教职工分配：
    - `HoD`
    - `Admin`
12. 查看历史权限分配记录，并禁用某条权限
13. 查看 Visualization 图表，按 Department 维度观察工作量
14. 导出 Excel
15. 发消息、查看 Profile、上传头像

前端可见约束：

- 员工编辑时：
  - `staff_id` 必须 8 位数字
  - `first_name` 必填
  - `last_name` 必填
  - 邮箱格式合法
  - `department` 必须属于 4 个允许值
  - `active_status` 必须是 `Active` 或 `Inactive`
- 单条审批时 `note` 必填，最大 `240`
- Visualization 年份跨度最多 `3 年`

### 建议的后端模型

- `Department`
- `StaffProfile`
- `StaffRoleAssignment`
- `RoleDefinition`
- `PermissionDefinition`
- `WorkloadApprovalRequest`
- `WorkloadReviewAction`
- `WorkloadBreakdownItem`
- `ImportJob`

### 当前前端伪逻辑与建议改法

- 在 `frontend/src/pages/HeadofSchool.tsx` 里，当前用户、工作量列表、员工列表、聊天记录和部门统计都是测试数据。
- 权限分配目前保存在页面 state 和本地浏览器测试存储里，正式环境应落到 `StaffRoleAssignment` 表。
- Staff 导入现在完全在浏览器里用 `FileReader + XLSX` 解析和校验，然后只改页面 state。正式流程建议改成：上传文件 -> 后端解析 -> 保存 `ImportJob` 和逐行结果 -> 更新真实 `StaffProfile`。
- Staff 模板现在由前端直接生成，演示时可以保留，但正式环境也建议后端提供模板下载接口，方便统一版本管理。
- Visualization 目前使用的是硬编码部门统计，建议改成后端按 `department + reporting period` 聚合。
- Export 区块的 UI 已经有了，但应当真正接到后端导出接口，而不是停留在页面占位阶段。

### 9.2 接口一览

| Method    | Path                                                | 作用               |
| --------- | --------------------------------------------------- | ------------------ |
| `GET`   | `/headofschool/workload-requests/`                | 获取工作量审批列表 |
| `GET`   | `/headofschool/workload-requests/{id}/`           | 获取详情           |
| `POST`  | `/headofschool/workload-requests/batch-decision/` | 批量审批 / 拒绝    |
| `POST`  | `/headofschool/workload-requests/{id}/decision/`  | 单条审批 / 拒绝    |
| `GET`   | `/headofschool/staff/`                            | 获取员工搜索列表   |
| `PATCH` | `/headofschool/staff/{staff_id}/`                 | 更新员工信息       |
| `GET`   | `/headofschool/staff/import-template/`            | 下载员工导入模板   |
| `POST`  | `/headofschool/staff/import/`                     | 导入员工 Excel     |
| `GET`   | `/headofschool/role-assignments/`                 | 获取权限分配记录   |
| `POST`  | `/headofschool/role-assignments/`                 | 新增权限分配       |
| `POST`  | `/headofschool/role-assignments/{id}/disable/`    | 禁用权限分配       |
| `GET`   | `/headofschool/visualization/`                    | 获取图表和汇总数据 |
| `GET`   | `/headofschool/export/`                           | 导出 Excel         |

### 9.3 获取工作量审批列表

建议查询参数：

```text
status=pending|approved|rejected|all
employee_id=50123456
first_name=sam
last_name=yaka
title=professor
department=Physics
year=2025
semester=S1|S2
page=1
page_size=10
```

### 9.4 单条审批 / 拒绝

请求：

```json
{
  "decision": "approved",
  "note": "Approved after reviewing the breakdown.",
  "breakdown": {
    "Teaching": [
      { "name": "CITS2401", "hours": 15 },
      { "name": "CITS2200", "hours": 5 }
    ],
    "Assigned Roles": [
      { "name": "Program Chair", "hours": 10 }
    ],
    "HDR": [
      { "name": "Student A", "hours": 4 }
    ],
    "Service": [
      { "name": "Committee support", "hours": 8 }
    ]
  }
}
```

### 9.5 获取员工列表

建议查询参数：

```text
first_name=ann
last_name=culhane
staff_id=50123451
page=1
page_size=10
```

响应：

```json
{
  "success": true,
  "message": "Staff loaded",
  "data": {
    "items": [
      {
        "staff_id": "50123451",
        "first_name": "Ann",
        "last_name": "Culhane",
        "email": "ann.culhane@uwa.edu.au",
        "title": "Professor",
        "department": "Physics",
        "active_status": "Active"
      }
    ]
  }
}
```

### 9.6 更新员工信息

请求：

```json
{
  "staff_id": "50123451",
  "first_name": "Ann",
  "last_name": "Culhane",
  "email": "ann.culhane@uwa.edu.au",
  "title": "Professor",
  "department": "Physics",
  "active_status": "Active"
}
```

响应：

```json
{
  "success": true,
  "message": "Staff profile updated",
  "data": {
    "staff_id": "50123451",
    "updated_at": "2026-04-30T10:55:00Z"
  }
}
```

### 9.7 下载 Staff 导入模板

模板字段：

```json
[
  "staff_id",
  "first_name",
  "last_name",
  "email",
  "title",
  "department",
  "active_status"
]
```

推荐响应：

```json
{
  "success": true,
  "message": "Template ready",
  "data": {
    "file_name": "Staff_Template.xlsx",
    "download_url": "http://localhost:8000/media/templates/Staff_Template.xlsx"
  }
}
```

### 9.8 导入 Staff Excel

请求：`multipart/form-data`

- field name: `file`

响应：

```json
{
  "success": true,
  "message": "Staff import completed",
  "data": {
    "imported_count": 25,
    "failed_count": 0
  }
}
```

### 9.9 新增权限分配

前端预设权限：

```json
{
  "HoD": ["View Workload", "Approve Workload", "Update Workload"],
  "Admin": ["Distribute Workload to Departments", "Edit Employee Information"]
}
```

请求：

```json
{
  "staff_id": "50123451",
  "role": "HoD",
  "department": "Physics",
  "permissions": ["View Workload", "Approve Workload", "Update Workload"]
}
```

响应：

```json
{
  "success": true,
  "message": "Role assigned",
  "data": {
    "id": 9001,
    "staff_id": "50123451",
    "role": "HoD",
    "department": "Physics",
    "status": "active"
  }
}
```

### 9.10 禁用权限分配

请求：

```json
{
  "reason": "Permission no longer required"
}
```

响应：

```json
{
  "success": true,
  "message": "Role assignment disabled",
  "data": {
    "id": 9001,
    "status": "disabled"
  }
}
```

### 9.11 Visualization

建议查询参数：

```text
from_year=2024
to_year=2026
semester=All|S1|S2
department=All Departments|Physics|Mathematics & Statistics|Computer Science & Software Engineering
```

响应：

```json
{
  "success": true,
  "message": "Visualization loaded",
  "data": {
    "reporting_period_label": "2024-2026 All Semesters",
    "scope_label": "All Departments",
    "summary": {
      "total_departments": 3,
      "total_academics": 58,
      "total_work_hours": 921.5,
      "pending_requests": 29,
      "approved_requests": 25,
      "rejected_requests": 4
    },
    "department_stats": [
      {
        "department": "Computer Science & Software Engineering",
        "academics": 27,
        "total_hours": 430,
        "pending": 17,
        "approved": 8,
        "rejected": 2
      }
    ],
    "workload_trend": [
      {
        "semester": "2024 S1",
        "Computer Science & Software Engineering": 178,
        "Mathematics & Statistics": 128,
        "Physics": 104
      }
    ]
  }
}
```

### 9.12 Export Excel

建议查询参数：

```text
from_year=2024
to_year=2026
semester=All|S1|S2
department=All Departments|Physics|Mathematics & Statistics|Computer Science & Software Engineering
```

响应：

```json
{
  "success": true,
  "message": "Export prepared",
  "data": {
    "file_name": "HeadOfSchool_Workload.xlsx",
    "download_url": "http://localhost:8000/media/exports/HeadOfSchool_Workload.xlsx"
  }
}
```

---

## 10. `/admin` 页面

### 10.1 页面工作流

这个页面是 Admin 的工作台，功能最完整，既处理工作量，也处理员工资料、导入模板、权限分配和可视化。

页面工作流程如下：

1. 在 `Workload Management` 模块里查看工作量记录
2. 按条件筛选工作量：
   - `employee_id`
   - `first_name`
   - `last_name`
   - `title`
   - `department`
   - `year`
   - `semester`
   - `status`
3. 批量审批 / 批量拒绝工作量
4. 查看单条详情并填写 note 审批
5. 点击 `Distribute Workload`
6. 输入 `year + semester` 将工作量下发
7. 下载 `Workload Template`
8. 上传 `Workload Template` Excel
9. 进入 `Employee Management` 模块
10. 下载 `Staff Template`
11. 上传 `Staff Template` Excel
12. 搜索员工
13. 修改员工资料
14. 分配 HoD / Admin 权限
15. 查看并禁用已有权限
16. 查看 Visualization 图表
17. 导出 Excel
18. 发消息、查看 Profile、上传头像

前端可见约束：

- 工作量下发时：
  - `year` 必须是有效年份
  - 范围建议在 `2000 - 2100`
  - `semester` 只能是 `S1` / `S2`
- 权限分配中，如果角色是 `Admin`，前端逻辑会把 `department` 绑定为 `Senior School Coordinator`
- 员工资料校验与 HoS 页面一致

### 建议的后端模型

- `Department`
- `StaffProfile`
- `StaffRoleAssignment`
- `WorkloadSubmission`
- `WorkloadApprovalRequest`
- `WorkloadReviewAction`
- `WorkloadBreakdownItem`
- `ImportJob`
- 建议增加 `WorkloadDistributionJob`

### 当前前端伪逻辑与建议改法

- 在 `frontend/src/pages/Admin.tsx` 里，当前用户、工作量列表、员工列表、部门统计和聊天记录都是 fake data。
- 工作量下发当前只是弹出成功提示，没有真实落库。建议后端建立真实的下发动作记录，或者使用 `WorkloadDistributionJob` 保存 year / semester / 执行结果。
- 工作量导入当前只检查文件类型并提示上传成功，但并没有真正把数据写入数据库。建议改成后端导入接口，并返回逐行校验结果。
- Staff 导入目前仍然在浏览器里解析并只更新前端状态，建议整体迁移到后端。
- 权限分配当前也只是页面状态，正式环境应落库。
- Export 区块 UI 已存在，但还需要真正调用后端下载 / 导出接口。

### 10.2 接口一览

| Method    | Path                                         | 作用               |
| --------- | -------------------------------------------- | ------------------ |
| `GET`   | `/admin/workload-requests/`                | 获取工作量列表     |
| `GET`   | `/admin/workload-requests/{id}/`           | 获取详情           |
| `POST`  | `/admin/workload-requests/batch-decision/` | 批量审批 / 拒绝    |
| `POST`  | `/admin/workload-requests/{id}/decision/`  | 单条审批 / 拒绝    |
| `POST`  | `/admin/workloads/distribute/`             | 下发工作量         |
| `GET`   | `/admin/workloads/import-template/`        | 下载工作量导入模板 |
| `POST`  | `/admin/workloads/import/`                 | 上传工作量 Excel   |
| `GET`   | `/admin/staff/`                            | 获取员工列表       |
| `PATCH` | `/admin/staff/{staff_id}/`                 | 更新员工资料       |
| `GET`   | `/admin/staff/import-template/`            | 下载员工导入模板   |
| `POST`  | `/admin/staff/import/`                     | 导入员工 Excel     |
| `GET`   | `/admin/role-assignments/`                 | 获取权限分配记录   |
| `POST`  | `/admin/role-assignments/`                 | 新增权限分配       |
| `POST`  | `/admin/role-assignments/{id}/disable/`    | 禁用权限分配       |
| `GET`   | `/admin/visualization/`                    | 获取图表数据       |
| `GET`   | `/admin/export/`                           | 导出 Excel         |

### 10.3 下发工作量

请求：

```json
{
  "year": 2026,
  "semester": "S1"
}
```

响应：

```json
{
  "success": true,
  "message": "Workload distributed successfully",
  "data": {
    "year": 2026,
    "semester": "S1",
    "job_id": 3001
  }
}
```

### 10.4 下载工作量导入模板

模板字段：

```json
[
  "employee_id",
  "name",
  "description",
  "total_work_hours",
  "status"
]
```

推荐响应：

```json
{
  "success": true,
  "message": "Template ready",
  "data": {
    "file_name": "Workload_Template.xlsx",
    "download_url": "http://localhost:8000/media/templates/Workload_Template.xlsx"
  }
}
```

### 10.5 导入工作量 Excel

请求：`multipart/form-data`

- field name: `file`

响应：

```json
{
  "success": true,
  "message": "Workload import completed",
  "data": {
    "imported_count": 40,
    "failed_count": 1,
    "errors": [
      {
        "row": 7,
        "field": "employee_id",
        "message": "Employee not found"
      }
    ]
  }
}
```

### 10.6 更新员工资料

请求：

```json
{
  "staff_id": "50123451",
  "first_name": "Ann",
  "last_name": "Culhane",
  "email": "ann.culhane@uwa.edu.au",
  "title": "Professor",
  "department": "Physics",
  "active_status": "Active"
}
```

### 10.7 新增权限分配

请求：

```json
{
  "staff_id": "50123462",
  "role": "Admin",
  "department": "Senior School Coordinator",
  "permissions": ["Distribute Workload to Departments", "Edit Employee Information"]
}
```

响应：

```json
{
  "success": true,
  "message": "Role assigned",
  "data": {
    "id": 9002,
    "staff_id": "50123462",
    "role": "Admin",
    "department": "Senior School Coordinator",
    "status": "active"
  }
}
```

### 10.8 Visualization

建议查询参数：

```text
from_year=2024
to_year=2026
semester=All|S1|S2
department=All Departments|Physics|Mathematics & Statistics|Computer Science & Software Engineering
```

响应格式可复用 HoS 页面结构。

### 10.9 Export Excel

建议查询参数：

```text
from_year=2024
to_year=2026
semester=All|S1|S2
department=All Departments|Physics|Mathematics & Statistics|Computer Science & Software Engineering
```

响应：

```json
{
  "success": true,
  "message": "Export prepared",
  "data": {
    "file_name": "Admin_Workload.xlsx",
    "download_url": "http://localhost:8000/media/exports/Admin_Workload.xlsx"
  }
}
```

---

## 11. 页面共用接口

下面这些接口会被多个业务页面共用，主要是消息、头像和个人资料。

### 建议的后端模型

- `StaffProfile`
- `Conversation`
- `Message`
- 可选的 `MediaAsset` 或头像文件表

### 当前前端伪逻辑与建议改法

- 多个页面里的头像上传目前只是 `FileReader` 本地预览，还没有真正上传到后端和持久化。
- 聊天记录目前保存在各页面本地状态里，建议改成真实的 `Conversation + Message`。
- 当前消息面板是前端按日期过滤，如果保留这个功能，建议后端支持日期筛选、分页和未读状态。

### 11.1 接口一览

| Method   | Path                 | 作用             |
| -------- | -------------------- | ---------------- |
| `GET`  | `/profile/me/`     | 获取当前用户信息 |
| `POST` | `/profile/avatar/` | 上传头像         |
| `GET`  | `/messages/`       | 获取消息列表     |
| `POST` | `/messages/`       | 发送消息         |

### 11.2 获取当前用户资料

响应：

```json
{
  "success": true,
  "message": "Profile loaded",
  "data": {
    "surname": "Yaka",
    "first_name": "Sam",
    "employee_id": "50123456",
    "title": "Professor",
    "department": "Computer Science & Software Engineering",
    "avatar_url": "http://localhost:8000/media/avatars/50123456.png"
  }
}
```

### 11.3 上传头像

请求：`multipart/form-data`

- field name: `avatar`

响应：

```json
{
  "success": true,
  "message": "Avatar uploaded successfully",
  "data": {
    "avatar_url": "http://localhost:8000/media/avatars/50123456.png"
  }
}
```

### 11.4 获取消息列表

建议查询参数：

```text
date=2026-04-23
conversation_with=admin
```

响应：

```json
{
  "success": true,
  "message": "Messages loaded",
  "data": {
    "items": [
      {
        "id": 1,
        "sender": "Sam",
        "message": "Could you review my latest workload draft?",
        "time": "10:03",
        "date": "2026-04-22"
      },
      {
        "id": 2,
        "sender": "Admin",
        "message": "Sure, please ensure all teaching units are listed.",
        "time": "10:11",
        "date": "2026-04-22"
      }
    ]
  }
}
```

### 11.5 发送消息

请求：

```json
{
  "receiver_role": "admin",
  "message": "I have updated my workload draft."
}
```

响应：

```json
{
  "success": true,
  "message": "Message sent",
  "data": {
    "id": 88,
    "sender": "Sam",
    "message": "I have updated my workload draft.",
    "time": "10:45",
    "date": "2026-04-30"
  }
}
```

---

## 12. 后端实现优先级建议

如果后端想先把最关键流程跑通，建议按下面顺序做：

### P0：最优先

1. `POST /login/`
2. `GET /role-options/`
3. `GET /academic/workloads/`
4. `GET /academic/workloads/{id}/`
5. `POST /academic/workload-requests/`
6. `GET /supervisor/workload-requests/`
7. `POST /supervisor/workload-requests/{id}/decision/`
8. `POST /supervisor/workload-requests/batch-decision/`

### P1：管理和审批核心能力

1. `GET /headofschool/workload-requests/`
2. `POST /headofschool/workload-requests/{id}/decision/`
3. `GET /admin/workload-requests/`
4. `POST /admin/workloads/distribute/`
5. `GET /admin/staff/`
6. `PATCH /admin/staff/{staff_id}/`
7. `POST /admin/role-assignments/`

### P2：增强能力

1. 所有 visualization 接口
2. 所有 export 接口
3. `/admin/workloads/import/`
4. `/admin/staff/import/`
5. `/headofschool/staff/import/`
6. profile / messages 相关接口

---

## 13. 说明

这份文档的特点是“以前端页面为中心”，不是以后端数据库或 Django model 为中心。

也就是说，它更适合直接拿去做这几件事：

1. 给后端对接口
2. 按页面拆开发开发任务
3. 后续继续转成 Postman Collection
4. 后续继续转成 OpenAPI / Swagger
