# Academic 模块学习路径

> 目标读者：有业务理解、Java 初学者背景、通过 AI 辅助完成了 v3 开发的你。
> 目标结果：能从空白文件独立写出一个 Django REST API 端点，并知道为什么这样写。

---

## 第零章：你现在在哪里

在开始之前，先诚实地定位自己。

你已经有的：
- 完整的业务理解（工作量审批流程、角色、状态机）
- 一份跑通了 79 个测试的真实代码
- 前后端协作的实战经验

你还没有的：
- 为什么 Django 要这样组织代码
- 一个 API 端点从请求到响应的完整链路
- 数据库表设计在哪个环节做、怎么做
- 可复用代码怎么抽取
- 前后端联调的高效方式

这份文档的目标是：**让你能解释自己写的每一行代码，而不只是让它跑起来。**

---

## 第一章：软件开发流程中，数据库表在哪个环节设计？

### 标准答案

```
需求分析 → 领域建模 → 数据库设计 → API 设计 → 编码 → 测试 → 联调
              ↑
         这里就要设计表了
```

数据库表设计发生在**领域建模之后、API 设计之前**。

### 为什么是这个顺序？

领域建模回答的是：**这个系统里有哪些"东西"，它们之间是什么关系？**

比如你的系统：
- 有 Staff（员工）
- 有 WorkloadReport（工作量报告）
- 一个 Staff 可以有多个 WorkloadReport
- 一个 WorkloadReport 有多个 WorkloadItem

这些关系确定了，数据库表的结构就基本确定了。

API 设计回答的是：**前端需要什么数据，后端怎么提供？**

API 依赖数据库，所以 API 设计在数据库之后。

### 你们项目的实际情况

你们的项目是**反过来做的**——先有了 AI 生成的代码，再有了表结构。这在 AI 辅助开发中很常见，但有一个风险：**你不知道为什么表是这样设计的**。

后面我们会专门看你们的 `models.py`，让你能解释每一个字段存在的理由。

### 思考题（先想，再往下看）

> 为什么 `WorkloadReport` 里有 `snapshot_fte` 和 `snapshot_department`，而不是直接用 `staff.fte` 和 `staff.department`？

---

## 第二章：Django 的代码组织方式

### 2.1 一个请求的完整旅程

当前端发出 `GET /api/academic/workloads/` 时，发生了什么？

```
HTTP 请求
    ↓
urls.py          → 路由：这个 URL 交给哪个函数处理？
    ↓
decorators.py    → 守卫：这个用户有权限吗？
    ↓
academic_views.py → 视图：取数据、处理逻辑、组装响应
    ↓
workload_service.py → 服务层：复杂的业务逻辑放这里
    ↓
models.py        → ORM：和数据库对话
    ↓
HTTP 响应
```

这个分层不是 Django 强制的，是工程师约定的。**约定的目的是：每一层只做一件事，方便测试和修改。**

### 2.2 你们项目的实际分层

打开这几个文件，对照上面的图：

| 文件 | 职责 |
|------|------|
| `backend/api/urls.py` | 路由注册 |
| `backend/api/decorators.py` | 角色权限守卫 |
| `backend/api/view/academic_views.py` | 视图函数 |
| `backend/api/services/workload_service.py` | 业务逻辑服务 |
| `backend/api/models.py` | 数据模型 |

### 2.3 和 Java Spring 的对比（给你的背景）

| Java Spring | Django |
|-------------|--------|
| `@RestController` | `@api_view(['GET'])` |
| `@GetMapping("/path")` | `path('path/', view_func)` in urls.py |
| `@PreAuthorize("hasRole('X')")` | `@require_role('X')` |
| `@Service` | `services/` 目录下的普通函数 |
| `JpaRepository` | `Model.objects.filter(...)` |
| `@Entity` | `class Model(models.Model)` |

### 思考题

> 打开 `academic_views.py` 第 144 行的 `academic_workloads` 函数。
> 它做了哪几件事？能不能用 3 句话概括？

---

## 第三章：从零写一个 API 端点

这是核心章节。我们用 `GET /api/academic/workloads/` 作为例子，**倒推**它是怎么写出来的。

### 3.1 第一步：明确这个端点要做什么

在写任何代码之前，先回答这三个问题：

1. **输入是什么？** 谁在调用？带什么参数？
2. **输出是什么？** 返回什么结构？
3. **权限是什么？** 谁能调用？

对于 `GET /api/academic/workloads/`：

1. 输入：已登录的 ACADEMIC 用户，可选参数 `status`、`year`、`semester`、`confirmation`、`page`、`page_size`
2. 输出：`{ items: [...], pagination: {...} }`
3. 权限：只有 ACADEMIC 角色可以调用，且只能看自己的数据

### 3.2 第二步：写路由

```python
# urls.py
path('academic/workloads/', academic_workloads),
```

这一行做的事：把 URL `academic/workloads/` 和函数 `academic_workloads` 绑定。

注意：Django 的 URL 前面不加 `/`，因为 `include()` 会处理前缀。

### 3.3 第三步：写视图函数骨架

```python
@api_view(['GET'])           # 只接受 GET 请求
@permission_classes([IsAuthenticated])  # 必须登录
@require_role('ACADEMIC')    # 必须是 ACADEMIC 角色
def academic_workloads(request):
    # 1. 读取查询参数
    # 2. 查询数据库
    # 3. 组装响应
    pass
```

**为什么用装饰器？**

装饰器是"在函数执行前先做某件事"的语法糖。`@require_role('ACADEMIC')` 的意思是：在执行 `academic_workloads` 之前，先检查用户角色，不对就返回 403。

这样视图函数本身不需要写权限检查代码，职责更单一。

### 3.4 第四步：查询数据库

```python
# 获取当前用户的 Staff 对象（由 decorators.py 注入到 request.staff）
qs = get_workload_queryset(request.staff)
```

`get_workload_queryset` 在 `workload_service.py` 里，它做的事是：

```python
def get_workload_queryset(staff):
    qs = WorkloadReport.objects.filter(is_current=True).select_related(...)
    if staff.role == 'ACADEMIC':
        return qs.filter(staff=staff)  # 只看自己的
    ...
```

**为什么把这个逻辑放在 service 层而不是 view 层？**

因为 supervisor 也需要查询 WorkloadReport，如果每个 view 都写一遍过滤逻辑，改一个地方就要改多处。放在 service 层，所有 view 共用一个函数。

这就是**可复用代码的第一个来源：多个地方用到同一段逻辑，就抽成函数。**

### 3.5 第五步：处理过滤参数

```python
status_filter = (request.GET.get('status') or 'all').lower()
if status_filter != 'all':
    qs = qs.filter(status=status_filter.upper())
```

`request.GET.get('status')` 读取 URL 参数 `?status=pending`。

`qs.filter(status='PENDING')` 是 Django ORM 的链式过滤，等价于 SQL 的 `WHERE status = 'PENDING'`。

**注意这里的防御性写法：**
- `or 'all'`：如果参数不存在，默认值是 'all'
- `.lower()`：统一转小写，避免大小写问题
- `.upper()`：数据库里存的是大写，查询时转回去

### 3.6 第六步：分页

```python
paginator = Paginator(items, page_size)
current_page = paginator.get_page(page)

return Response({
    'items': list(current_page.object_list),
    'pagination': {
        'page': current_page.number,
        'pageSize': page_size,
        'totalItems': paginator.count,
        'totalPages': paginator.num_pages,
    },
})
```

`Paginator` 是 Django 内置的分页工具。你给它一个列表和每页大小，它帮你切片。

### 3.7 完整流程图

```
request 进来
    ↓
@api_view(['GET'])          检查：是 GET 请求吗？
    ↓
@permission_classes         检查：有 JWT token 吗？
    ↓
@require_role('ACADEMIC')   检查：是 ACADEMIC 角色吗？
    ↓
get_workload_queryset()     查询：这个用户能看哪些报告？
    ↓
qs.filter(...)              过滤：按参数缩小范围
    ↓
_serialize_workload_row()   序列化：把 ORM 对象转成字典
    ↓
Paginator                   分页：切出当前页
    ↓
Response({...})             返回：JSON 响应
```

---

## 第四章：可复用代码怎么抽取

### 4.1 三个信号告诉你该抽了

1. **复制粘贴了同一段代码两次以上**
2. **一个函数超过 40 行**
3. **改一个业务规则需要改多个文件**

### 4.2 你们项目里的实际例子

**例子 1：`_get_confirmation_map`**

```python
def _get_confirmation_map(report_ids):
    ...
```

这个函数被 `academic_workloads`（列表）和 `academic_submit_workload_requests`（提交）都用到了。如果不抽出来，两处都要写同样的 AuditLog 查询逻辑。

**例子 2：`get_workload_queryset` 在 service 层**

academic view 用它，supervisor view 也用它。放在 service 层，两边共享。

**例子 3：`_serialize_workload_row`**

列表和详情都需要序列化 WorkloadReport，但详情多了几个字段。所以列表调用这个函数，详情直接写（因为字段差异太大，强行复用反而复杂）。

### 4.3 抽取的原则

```
不要为了抽而抽。
三次重复才考虑抽取。
抽取后的函数必须比原来更容易理解，不是更难。
```

---

## 第五章：前后端联调效率最高的方式

### 5.1 你们现在的问题

根据项目现状，前后端联调的主要摩擦点是：

1. **字段名不一致**：前端用 `employeeId`，后端返回 `employee_id`，对不上
2. **状态值不一致**：前端传 `"Pending"`，后端期望 `"PENDING"`
3. **错误响应格式不统一**：有时返回 `{detail: "..."}` 有时返回 `{errors: {...}}`
4. **接口文档滞后**：后端改了字段，前端不知道

### 5.2 高效联调的三个工具

**工具 1：接口契约文档（你们已经在做）**

`IntegrationLog/接口文档/` 里的 markdown 文件就是契约。关键是：**后端改了就立刻更新文档，不能滞后。**

**工具 2：后端本地跑起来，前端直接调**

```bash
# 后端
cd backend && python manage.py runserver

# 前端
# 把 API_BASE_URL 指向 http://localhost:8000/api
```

这比看文档猜要快 10 倍。

**工具 3：用 curl 或 Postman 验证后端**

在前端接入之前，先用 curl 验证后端返回的格式是否正确：

```bash
curl -X GET http://localhost:8000/api/academic/workloads/ \
  -H "Authorization: Bearer <your_token>"
```

如果 curl 能拿到正确数据，前端接不上就是前端的问题；curl 拿不到，就是后端的问题。**这样能快速定位问题在哪一侧。**

### 5.3 联调的标准流程

```
1. 后端写完端点，先用 curl 自测
2. 更新接口文档（字段名、类型、示例值）
3. 前端按文档接入
4. 出问题先看网络请求（浏览器 DevTools → Network）
5. 对比实际响应和文档，找差异
```

---

## 第六章：数据库表设计实战

### 6.1 你们的表结构

打开 `backend/api/models.py`，你会看到这些表：

```
Department          部门
Staff               员工（扩展 Django User）
WorkloadReport      工作量报告（核心表）
WorkloadItem        工作量明细（报告的子项）
AuditLog            审计日志
SystemConfig        系统配置
OTPToken            一次性密码
```

### 6.2 为什么这样设计？

**问题：为什么 WorkloadReport 里有 `snapshot_fte` 和 `snapshot_department`？**

答案：**历史快照**。

如果直接存 FK 指向 Staff，那么当 Staff 的 FTE 或部门变了，历史报告的数据也会跟着变。这是错的——历史报告应该反映**当时**的状态。

所以在创建报告时，把当时的 FTE 和部门**复制一份**存进去。这叫"快照模式"，是数据库设计中处理历史数据的标准做法。

**问题：为什么 WorkloadReport 有 `is_current` 字段？**

答案：**软删除 + 版本控制**。

Daniela 可能重新上传 Excel，这时旧报告不能删（有审计日志关联），只能标记为 `is_current=False`，新报告标记为 `is_current=True`。

**问题：为什么 AuditLog 用 `changes` JSONField 而不是固定字段？**

答案：**灵活性**。

不同操作的 changes 结构不同：
- CONFIRMATION 的 changes 是 `{"kind": "CONFIRMATION", "confirmation": "confirmed"}`
- WORKLOAD_REQUEST 的 changes 是 `{"kind": "WORKLOAD_REQUEST", "status": "pending"}`

如果用固定字段，要么字段很多（大部分为空），要么要建多张表。JSONField 更灵活，代价是查询时需要用 `changes__kind='CONFIRMATION'` 这种语法。

### 6.3 表设计的核心原则

1. **每张表只存一类"东西"**（单一职责）
2. **用 FK 表达关系，不要冗余存储**（除非是快照）
3. **能用 NULL 的地方，想清楚为什么**
4. **加索引的字段：经常出现在 WHERE 条件里的**

---

## 第七章：实战练习

现在你来做，我来看。

### 练习 1：解释一段代码

打开 `academic_views.py`，找到 `_get_confirmation_map` 函数（第 40 行）。

用自己的话回答：
1. 这个函数的输入是什么？输出是什么？
2. 为什么要 `.order_by('-created_at')`？
3. 为什么要检查 `if rid in confirmation_map: continue`？
4. 如果去掉这个检查，会发生什么？

#### 答案与解析

**1. 输入/输出**

- 输入：`report_ids`，一个 report_id 的列表（字符串）
- 输出：一个字典，key 是 report_id，value 是该报告的确认状态（`'confirmed'` 或 `'unconfirmed'`）

例如：`{'abc-123': 'confirmed', 'def-456': 'unconfirmed'}`

为什么要这个函数？因为列表页要显示几十个报告，如果每个报告都单独查一次数据库，就是 N 次查询（N+1 问题）。这个函数一次性查出所有报告的确认状态，只用 1 次数据库查询。

**2. 为什么 `.order_by('-created_at')`**

`-created_at` 表示按时间**降序**排列，最新的记录排在最前面。

这样在后面的循环里，第一次遇到某个 report_id 时，拿到的就是最新的那条记录。

**3 & 4. `if rid in confirmation_map: continue` 的作用**

这是**防御性编程**。

你的业务设计是"确认只能操作一次"，所以正常情况下同一个报告只有一条 CONFIRMATION 日志。但这个函数不知道、也不应该假设外部的写入逻辑一定正确。

它的逻辑是：
- 循环从最新到最旧遍历
- 第一次遇到某个 report_id → 写入 map（这是最新的状态）
- 第二次遇到同一个 report_id → 跳过（不覆盖已有的最新状态）

如果去掉这行，循环会继续覆盖，最终 map 里存的是**最旧**的那条记录，而不是最新的。

**关键认知：防御性编程**

> 业务层面的保证（"只能确认一次"）和代码层面的健壮性是两件事。
> 读取函数不应该依赖写入函数的正确性。
> 加这行检查的代价几乎为零，但能防止未来业务规则变化时出现隐蔽的 bug。

---

### 练习 2：从签名写实现

给你这个函数签名和要求，你来实现：

```python
def _get_latest_request_reason(report) -> str:
    """
    返回这个报告最新一次 WORKLOAD_REQUEST 的原因（comment 字段）。
    如果没有，返回空字符串。
    """
    pass
```

提示：
- 查 AuditLog 表
- 过滤条件：`report=report` 且 `changes__kind='WORKLOAD_REQUEST'`
- 取最新一条：`.order_by('-created_at').first()`
- 注意 None 的处理

#### 答案与解析

```python
def _get_latest_request_reason(report) -> str:
    log = AuditLog.objects.filter(
        report=report,
        changes__kind='WORKLOAD_REQUEST',
    ).order_by('-created_at').first()
    return log.comment if log else ''
```

**逐行解析：**

```python
AuditLog.objects.filter(
    report=report,              # 只查这个报告的日志
    changes__kind='WORKLOAD_REQUEST',  # 只要提交审核的操作
)
```

`changes__kind` 是 Django JSONField 的 key lookup，等价于 SQL 的 `WHERE changes->>'kind' = 'WORKLOAD_REQUEST'`。

```python
.order_by('-created_at').first()
```

取最新一条。`.first()` 在没有结果时返回 `None`，不会抛异常。

```python
return log.comment if log else ''
```

这是防御性写法。如果 `log` 是 `None`（没有提交记录），直接访问 `log.comment` 会报 `AttributeError`。用三元表达式处理 None 是 Python 的标准写法。

**对比不好的写法：**

```python
# 危险：log 可能是 None
return AuditLog.objects.filter(...).first().comment

# 啰嗦：不必要的 if/else
log = AuditLog.objects.filter(...).first()
if log is not None:
    return log.comment
else:
    return ''
```

---

### 练习 3：设计一个新端点

假设需要新增一个端点：

```
GET /api/academic/workloads/{id}/history/
```

返回这个报告的所有 AuditLog 记录，按时间倒序。

你来回答：
1. 这个端点的输入/输出/权限是什么？
2. 需要查哪张表？
3. 返回的 JSON 结构长什么样？
4. 写出函数骨架（不用实现，只写结构）

#### 答案与解析

**1. 输入/输出/权限**

- 输入：URL 路径参数 `id`（report_id）
- 输出：该报告的所有操作历史，按时间倒序
- 权限：ACADEMIC 角色，且只能查自己的报告

**2. 查哪张表**

`AuditLog`，通过 `report_id` 关联到 `WorkloadReport`。

**3. 返回结构**

```json
{
  "history": [
    {
      "actionType": "COMMENT",
      "actionBy": "Jane Doe",
      "comment": "Academic confirmed workload.",
      "changes": {"kind": "CONFIRMATION", "confirmation": "confirmed"},
      "createdAt": "2026-05-05 14:22"
    }
  ]
}
```

**4. 函数骨架**

```python
@api_view(['GET'])
@permission_classes([IsAuthenticated])
@require_role('ACADEMIC')
def academic_workload_history(request, id):
    """GET /api/academic/workloads/{id}/history/"""
    # 1. 确认这个报告属于当前用户（复用 get_workload_queryset 做权限隔离）
    qs = get_workload_queryset(request.staff)
    report = get_object_or_404(qs, report_id=id)

    # 2. 查这个报告的所有审计日志
    logs = AuditLog.objects.filter(
        report=report,
    ).select_related('action_by__user').order_by('-created_at')

    # 3. 序列化
    history = [
        {
            'actionType': log.action_type,
            'actionBy': log.action_by.user.get_full_name() if log.action_by else 'System',
            'comment': log.comment or '',
            'changes': log.changes,
            'createdAt': log.created_at.strftime('%Y-%m-%d %H:%M'),
        }
        for log in logs
    ]

    return Response({'history': history})
```

**设计要点解析：**

- `get_object_or_404(qs, report_id=id)`：`qs` 已经被 `get_workload_queryset` 过滤为"只有自己的报告"，所以如果 id 不属于当前用户，会返回 404 而不是 403。这是正确的——不暴露"这个报告存在但你没权限"的信息。
- `.select_related('action_by__user')`：避免 N+1。每条日志都要访问 `action_by.user.get_full_name()`，如果不预加载，每条日志都会触发一次额外的数据库查询。
- `log.action_by.user.get_full_name() if log.action_by else 'System'`：`action_by` 可以是 NULL（系统操作），必须处理。

---

## 第八章：下一步

完成上面三个练习之后，你应该能：
- 解释 `academic_views.py` 里任意一个函数的逻辑
- 独立写出一个简单的 GET 端点
- 知道什么时候该抽函数

下一个学习目标（你来选）：
- A：深入 Django ORM，学会写复杂查询（`annotate`、`aggregate`、`prefetch_related`）
- B：学习如何写测试，理解 `tests.py` 里每个测试的设计思路
- C：学习数据库迁移（migration）的原理和操作
- D：学习 JWT 认证的完整流程（从 OTP 到 token 到请求验证）

---

## 附录：常用 Django ORM 速查

```python
# 查所有
WorkloadReport.objects.all()

# 条件过滤（WHERE）
WorkloadReport.objects.filter(status='PENDING')

# 多条件（AND）
WorkloadReport.objects.filter(status='PENDING', academic_year=2025)

# 排除（NOT）
WorkloadReport.objects.exclude(status='APPROVED')

# 取第一条
WorkloadReport.objects.filter(...).first()

# 取一条（不存在则 404）
get_object_or_404(WorkloadReport, report_id=id)

# 关联查询（JOIN，避免 N+1）
WorkloadReport.objects.select_related('staff__user', 'snapshot_department')

# 预加载多对多/反向 FK（避免 N+1）
WorkloadReport.objects.prefetch_related('items')

# 排序
WorkloadReport.objects.order_by('-created_at')  # 降序
WorkloadReport.objects.order_by('academic_year', 'semester')  # 多字段

# 聚合
from django.db.models import Sum, Count
WorkloadReport.objects.aggregate(total=Sum('snapshot_fte'))

# 创建
WorkloadReport.objects.create(staff=staff, academic_year=2025, ...)

# 更新（只更新指定字段，性能更好）
report.status = 'APPROVED'
report.save(update_fields=['status', 'updated_at'])

# 批量更新
WorkloadReport.objects.filter(status='PENDING').update(status='APPROVED')

# 事务（要么全成功，要么全回滚）
from django.db import transaction
with transaction.atomic():
    report.save()
    AuditLog.objects.create(...)
```
