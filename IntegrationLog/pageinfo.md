# Jaffrey-pageinfo — 页面共用接口（§11）学习与质量记录

**分支：** `Jaffrey-pageinfo`  
**文档依据：** `IntegrationLog/cai-academic_api_contract_cn.md` §11.1–11.5  
**日期：** 2026-05-04

---

## 1. 建议的 PR 标题与 commit 风格（对齐你以往习惯）

你之前的 PR 常用 **Conventional Commits**：`feat(范围): 简述`。

本次建议：

- **PR Title：** `feat(api): shared profile, avatar upload & messages (contract §11)`
- **Commit subject（示例）：** `feat(api): add pageinfo profile/messages APIs`

说明：仓库全局 URL 前缀是 **`/api/`**（见 `config/urls.py`），因此实际路径为：

| 契约路径 | 实现路径 |
|----------|----------|
| `GET /profile/me/` | `GET /api/profile/me/` |
| `POST /profile/avatar/` | `POST /api/profile/avatar/` |
| `GET/POST /messages/` | `GET/POST /api/messages/` |

前端基地址若为 `http://localhost:8000`，请求应写 **`/api/profile/me/`** 等。

---

## 2. 实现了什么（与契约字段对应）

### 2.1 模型（`api/models.py`）

| 变更 | 作用 |
|------|------|
| `Staff.academic_title` | 对应资料里的职称（契约里的 `title`，如 Professor）。 |
| `Staff.avatar` | `ImageField`，`FileExtensionValidator` 限制扩展名；`upload_to` 生成稳定路径 `avatars/<staff_number>.<ext>`。 |
| `Message` | `thread_key` + `sender` + `body` + `created_at`；索引 `(thread_key, created_at)` 便于按会话分页查询。 |

**数据流（面试常问）：**

1. 用户登录 → JWT（`rest_framework_simplejwt`）→ `request.user`。
2. `Staff` 与 `User` 为 **OneToOne**；视图里用 `get_object_or_404(Staff, user=request.user)` 得到当前业务身份 `request.user` → `Staff`。
3. 资料接口：读 `User` 的 `first_name` / `last_name` 映射为契约的 `first_name` / `surname`（姓在 Django 里通常放在 `last_name`）。
4. 消息：不按「会话表」拆表，用 **`thread_key` 字符串** 聚合（实现简单、与契约一致）；键格式为 **`<8位工号>:<peer_slug>`**，例如 `50123456:admin`。

### 2.2 视图（`api/view/pageinfo_views.py`）

- **统一成功/失败信封**：`{ success, message, data? }` / `{ success, message, errors? }`，与契约 §2.4–2.5 对齐；与旧有 `/api/workloads/my/` 等「裸列表」响应不同，**前端对接本模块时需按信封解析**。
- **`GET /api/profile/me/`**：`IsAuthenticated`；`Cache-Control: private, max-age=60`（个人数据仅短缓存，避免敏感资料被共享缓存层错误复用）。
- **`POST /api/profile/avatar/`**：字段名 **`avatar`**；校验大小 **≤2MB**、MIME **jpeg/png/webp**；替换头像前 **`delete(save=False)`** 旧文件，减少磁盘垃圾。
- **`GET /api/messages/`**：必带 `conversation_with`（`admin|hod|hos`）；可选 `date=YYYY-MM-DD`、`limit`（默认 50，最大 200）、`offset`。**`Cache-Control: private, no-store`**，避免聊天内容被中间缓存。
- **`POST /api/messages/`**：体字段 `receiver_role`、`message`；对 **SCHOOL_OPS / HOS** 读「某教职工与 admin 的会话」、以及 **HOD** 读「某教职工与 hod 的会话」等，增加 **`with_staff_number`**（8 位工号）以定位 `thread_key`（契约未写死此参数，属**实现扩展**，便于运营/校长查看具体线程）。

### 2.3 安全与权限（OWASP 视角摘要）

| 关注点 | 做法 |
|--------|------|
| **A01 访问控制** | `_assert_can_read_thread`：本人只能读自己的 `工号:*` 线程；`admin` 线程可由 `SCHOOL_OPS`/`HOS` 读；`hod` 线程仅 **同系** HOD 可读；`hos` 线程可由 `HOS` 读。 |
| **A04 设计内安全** | `receiver_role` / `conversation_with` 使用 **允许列表**（`admin|hod|hos`），避免任意字符串拼进键导致逻辑混乱。 |
| **A05 配置错误** | `DEBUG` 下用 `static()` 暴露 `MEDIA`；生产应改由 **nginx 或对象存储** 提供媒体 URL，且关闭 DEBUG。 |
| **A07 认证** | 全部接口 `IsAuthenticated` + 必须存在 `Staff` 行（与现有 `@require_role` 视图一致：无 Staff 则 404）。 |
| **A10 SSRF / 滥用** | 发帖 **`MessageWriteThrottle`**：`POST` 限 **60/分钟/用户**（`GET` 在 `allow_request` 中放行，避免拖慢正常拉历史）。 |
| **上传** | 扩展名 + MIME 双校验；大小上限；仍建议生产加 **病毒扫描 / 异步转码**（未在本分支实现）。 |

### 2.4 性能与缓存

- 消息列表查询：`select_related('sender', 'sender__user')` 减少 N+1。
- 索引：`Message(thread_key, created_at)` 支持按会话顺序分页。
- 未做 Redis 缓存：聊天对实时性要求高，优先 **no-store**；若将来要做「未读数」等，可单独做短 TTL 键，不要缓存整条消息列表。

---

## 3. 代码质量连招执行记录（backend-quality-combo）

执行范围：`Jaffrey-pageinfo` 相对 `main` 的后端改动。

| 步骤 | 命令 | 结果 | 说明 |
|------|------|------|------|
| 1 | `python -m ruff check api/view/pageinfo_views.py api/models.py api/urls.py api/tests.py` | **通过** | 全量 `api` 目录仍有历史 `F401`（如 `admin.py`），未在本次需求内清理。 |
| 2 | `python -m flake8 …` | **部分未过** | `pageinfo_views` 与既有 `models.py` 大量 **E501 行宽**；项目若未统一 Black/行宽，可后续用配置或 `# noqa` 策略处理。 |
| 3 | `python -m mypy api/view/pageinfo_views.py --ignore-missing-imports` | **通过** | |
| 4 | `python -m bandit -r api/view/pageinfo_views.py -ll` | **通过** | |
| 5 | `python -m pip_audit -r requirements.txt` | **未通过** | **Django 5.2.2**、**DRF 3.15.1**、**simplejwt 5.4.0**、**Pillow** 等均有已知 CVE；本次将 Pillow 提到 **11.3.0** 缓解部分问题；**全面升级需单独 PR**（避免与功能耦合）。 |
| 6 | `python manage.py check --deploy` | **有警告** | `SECRET_KEY`、`DEBUG`、`ALLOWED_HOSTS`、HSTS/SSL cookie 等为开发默认；与既有项目状态一致。 |
| 7 | `python manage.py test` | **失败（环境）** | 设置里 `HOST=db` 为 Docker 主机名，本机无该 DNS → 无法创建测试库。在 **docker compose** 或把测试库指向本机 PostgreSQL/SQLite 后再跑。 |

---

## 4. 具体修复：URL 重复导入（严重逻辑错误）

### 现象

`api/urls.py` 中从 `supervisor_views` 与 `academic_views` **同名导入** `get_my_workloads`，后者覆盖前者。

### 后果

`path('supervisor/list/', get_my_workloads)` 实际绑到了 **学术** 的 `get_my_workloads`，HOD 访问 `/api/supervisor/list/` 会得到 **403**（角色不符），属于隐蔽生产 bug。

### 修改

为两个视图使用 **别名导入**：

- `get_my_workloads as supervisor_list_workloads` → `supervisor/list/`
- `get_my_workloads as academic_my_workloads` → `workloads/my/`

### 为什么这样改

Python 同名导入后者覆盖前者；显式别名让 **路由与视图一一对应**，避免再犯。

---

## 5. 建议你回头复习的「要记住的点」

1. **Git 分支名 ≠ PR 标题**：分支可用 `Jaffrey-pageinfo`；PR 仍建议 `feat(api): …` 方便 changelog。
2. **契约里的路径相对根**：本项目根路由挂了 `api/`，对接时务必 **加 `/api` 前缀**（或与前端 axios `baseURL` 对齐）。
3. **JWT → Staff**：业务权限以 `Staff` 为准；`User` 只管认证账号。
4. **文件上传**：`multipart` 字段名要与前端一致；**服务端**必须校验类型与大小；`ImageField` 依赖 **Pillow**。
5. **多租户消息**：任何列表接口都要问：**「这条数据属于谁？」** —— 用 `thread_key` + 角色规则写清楚，比「相信前端传的 ID」更安全。

---

## 6. 下一步（最多 5 条）

1. 在 Docker 或可达数据库上执行 **`python manage.py migrate`** 与 **`python manage.py test`**。  
2. 按团队流程开 **`[FE] Jaffrey-pageinfo API contract`** GitHub Issue（契约字段、信封格式、`with_staff_number` 扩展、完整 URL）。  
3. 规划依赖升级 PR：Django ≥ 修复版、DRF ≥ 3.15.2、simplejwt ≥ 5.5.1 等（以 `pip-audit` 为准）。  
4. 生产：**MEDIA** 走 CDN/对象存储；**关闭 DEBUG**；配置 **ALLOWED_HOSTS**、HTTPS、安全 cookie。  
5. 若消息量增大：考虑 **游标分页**、归档表、或引入真实 `Conversation` 模型（当前实现刻意保持最小表结构）。
