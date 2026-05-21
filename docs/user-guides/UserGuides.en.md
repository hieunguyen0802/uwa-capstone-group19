# Workload Verification System User Guide

| Item | Details |
| --- | --- |
| System Name | Workload Verification System |
| School | UWA School of Physics, Mathematics and Computing |
| Document Version | v1.1 |
| Last Updated | 2026-05-21 |
| Intended Users | Academic Staff, Head of Department, School Operations, Head of School |

## 1. Product Overview

The Workload Verification System supports school-level workload import, distribution, confirmation, review, analytics, and export across academic years and semesters. It is designed for four main user groups:

- **Academic Staff** view their own workload, confirm it when it is correct, or submit a review request when they have concerns.
- **Heads of Department (HoDs)** review workload requests submitted by Academic Staff within their assigned department.
- **School Operations (Ops)** import workload spreadsheets, distribute workloads, maintain Academic staff information, review analytics, and export data.
- **Head of School (HoS)** reviews HoD self-submitted workload requests, manages HoD/Ops permissions, reviews school-level analytics, and exports school-level data.

The system uses backend role-based access control. Users only see the pages and actions allowed by their current role and permissions.

## 2. Login and Navigation

### 2.1 Email Verification Code Login

1. Open the frontend page: `http://localhost:3000`.
2. Go to `/login`.
3. Enter your registered UWA email address in **Email Address**.
4. Click **Send Code**.
5. Check your email for the 6-digit verification code.
6. Enter the code in **Verification Code**.
7. Click **Sign In**.

Important notes:

- The verification code must be 6 digits.
- The code expires; request a new one if it no longer works.
- Do not forward your verification code to anyone else.
- If login fails, common causes include an unregistered email, wrong code, expired code, or inactive account.

### 2.2 Default Route After Login

| Current Role | Default Route |
| --- | --- |
| Academic | `/workload-platform` |
| HoD | `/role`, then choose department review or personal workload |
| School Operations | `/school-operations` |
| HoS | `/school-head` |

### 2.3 Main Pages

| Page | Route | Purpose |
| --- | --- | --- |
| Login | `/login` | Email verification-code login |
| Role Selection | `/role` | HoD chooses department review or personal workload |
| Academic Dashboard | `/workload-platform` | Academic workload view, confirmation, and submission |
| HoD Dashboard | `/department-head` | HoD department-level workload review |
| School Operations Dashboard | `/school-operations` | Ops workload import, distribution, staff management, analytics, and export |
| HoS Dashboard | `/school-head` | HoS approval, permission assignment, analytics, and export |

## 3. Roles and Permissions

### 3.1 Academic

Academic users can only access their own workload records. They can:

- View their personal workload list and details.
- Filter records by Status, Confirmation, Year, and Semester.
- Confirm workload from the detail view.
- Submit a request with a reason when the workload cannot be confirmed.
- View personal workload trends.
- Export personal workload data to Excel.

### 3.2 HoD

A HoD may also have an Academic workload. After login, the HoD enters `/role` and chooses one of two tasks:

- **Review Department Workloads** opens `/department-head` for department-level review.
- **Review My Workload** opens `/workload-platform` for the HoD's own personal workload.

The HoD department scope is assigned by HoS or system administration. A HoD cannot view or approve records outside their assigned department.

### 3.3 School Operations

School Operations handles school-wide data operations. Ops can:

- Import workload Excel files.
- View pending, distributed, failed, and superseded workload records.
- Distribute workloads to Academic users.
- Redistribute a single workload record when required.
- Maintain Academic staff profile information.
- View school-level and department-level analytics.
- Export current and historical workload data.
- Export audit-related data.

Some backend routes and older code still use the name `admin`. In this system, Admin has the same business meaning as School Operations.

### 3.4 HoS

The HoS role works at school level. HoS can:

- Review workload requests that require school-level approval, including HoD self-submissions.
- Search staff and assign HoD or Admin/Ops permissions.
- Disable assigned role permissions.
- Import staff-directory templates.
- View school-level analytics.
- Export school-level workload data.

## 4. Common Interface Notes

### 4.1 Header Area

Each dashboard usually includes:

- Dashboard title.
- Current user information and profile/avatar entry.
- Message or semester report entry.
- Logout or sign-out action.

Clicking the avatar opens the profile modal. Some pages support avatar upload.

### 4.2 Dashboard Tabs

| Role | Common Tabs |
| --- | --- |
| Academic | Workload Approval, Visualization, Export Excel |
| HoD | Workload Approval, Visualization, Export Excel |
| School Operations | Workload Management, Employee Management, Visualization, Export Excel |
| HoS | HoS Workload Approval, Permission Assignment, Visualization, Export Excel |

### 4.3 Status Meanings

| Status | Meaning |
| --- | --- |
| Initial | Workload has been imported but has not entered the approval workflow |
| Pending | A request has been submitted and is waiting for HoD or HoS review |
| Approved | The request has been approved |
| Rejected | The request has been rejected and should be handled according to the note |
| Confirmed | The Academic has confirmed their own workload |
| Unconfirmed | The Academic has not confirmed their workload yet |
| Distributed | Ops has distributed the workload to the Academic user |
| Failed | Import or distribution produced failed records |
| Superseded | An older version has been replaced by a newer re-imported version |
| Active | The permission or record is currently valid |
| Disabled | The permission or record has been disabled |

### 4.4 Workload Detail View

The workload detail modal usually includes:

- Staff ID
- Name
- Department
- Title
- Total Work Hours
- Target Teaching Ratio
- Actual Teaching Ratio
- Employment Type
- New Staff
- HoD Review
- School Operations Notes
- Application Reason
- Workload Breakdown

The workload breakdown normally includes:

- Teaching
- HDR
- Service
- Assigned Roles
- Research (residual)

`Research (residual)` is calculated by the system from the remaining workload balance. It is not maintained as a separate Excel workload category.

## 5. Academic Guide

### 5.1 View Personal Workload

1. Log in and enter `/workload-platform`.
2. Open **Workload Approval**.
3. Use **Status**, **Confirmation**, **Year**, and **Semester** filters.
4. Click **Search**.
5. Click a target record to view details.

Academic users only see their own records. Other staff records are not exposed in the Academic list.

### 5.2 Confirm Workload

When the workload is correct:

1. Open the workload detail.
2. Check Teaching, HDR, Service, Assigned Roles, and Research (residual).
3. Click the confirmation action in the detail view.
4. In **Confirm Workload**, click **Yes, Confirm**.

The system records the confirmation status and confirmation time. Confirmation should only be used after checking the data carefully.

If the system detects an anomaly, such as a department conflict or teaching-ratio issue, confirmation may be blocked.

### 5.3 Submit a Request

When the workload is incorrect or needs review:

1. Select the target record in **Workload Approval**.
2. Click **Submit Request**.
3. Enter the reason in **Application reason**.
4. Click **Submit**.

Rules:

- A normal Academic request goes to the HoD approval queue.
- If the user is also a HoD, their personal workload request goes to the HoS approval queue.
- A request cannot be submitted again while the same record is already under review.

### 5.4 View Personal Analytics

1. Open **Visualization**.
2. Enter Year From and Year To.
3. Select Semester: All, S1, or S2.
4. Click **Search**.

The page shows:

- Total Work Hours Trend.
- My Hours vs Department Average Trend.

For readability, the charts usually display the latest 6 semesters in the selected range.

### 5.5 Export Personal Workload

1. Open **Export Excel**.
2. Fill Year From, Year To, and Semester as needed.
3. Click **Export Excel**.

If the year fields are blank, the system exports the available data range where possible. If only one side is filled, the other side is inferred from the available range.

## 6. HoD Guide

### 6.1 Choose HoD Work or Personal Workload

After login, a HoD enters `/role`.

- To review department staff requests, choose **Review Department Workloads**.
- To handle personal workload, choose **Review My Workload**.

A HoD should not approve their own workload in the HoD review page. Their personal workload should be submitted through the Academic-style personal workflow and reviewed by HoS.

### 6.2 Review Department Workload Requests

1. Enter `/department-head`.
2. Open **Workload Approval**.
3. Filter by Name, Staff ID, Year, Semester, and Status Filter.
4. Click a record to view details.
5. Check the workload breakdown, School Operations notes, and Application Reason.
6. Approve or reject pending records.
7. Enter a review note and submit the decision.

HoDs only see records within their own department scope. Cross-department access is blocked by the backend.

### 6.3 HoD Visualization

1. Open **Visualization**.
2. Enter Year From and Year To.
3. Select Semester.
4. Click **Search**.

The page shows:

- Number of Academics in the department.
- Total workload.
- Pending, Approved, and Rejected counts.
- Total Work Hours Trend.
- Average Work Hours by Semester.

### 6.4 HoD Export

1. Open **Export Excel**.
2. Select the year range and Semester.
3. Click **Export Excel**.

The exported data is limited to the department scope the HoD is allowed to view.

### 6.5 HoD Semester Reports

The top message entry lets HoDs view department-scoped semester reports. Reports can be downloaded as Excel files. If no report has been generated, the page shows an empty report message.

## 7. School Operations Guide

The School Operations page is available at `/school-operations`. It uses the system's Admin/Ops management interface.

### 7.1 Workload Management

This tab manages workload import, filtering, detail review, distribution, and redistribution.

Common filters include:

- Staff ID
- Name
- Department
- Year
- Semester
- Status

Common list states include:

- Pending Distribution
- Distributed
- Failed
- Superseded

### 7.2 Download the Workload Template

1. Open **Workload Management**.
2. Click **Download Template**.
3. The system downloads `Workload_Template.xlsx`.

The template includes Excel validations such as:

- Staff Name cannot be blank.
- Staff Number must be exactly 8 digits.
- When HoD Review is Yes, Notes must be filled in.

### 7.3 Import Workload

1. Open **Workload Management**.
2. Click the import button and select an Excel file.
3. The system parses the workbook and displays the import summary.
4. Review the Valid and Invalid counts.
5. If invalid records exist, click **View Invalid Records** to see row, column, field, error type, and message.
6. Correct the Excel file and import again.
7. If the result is acceptable, click **Enter Pending List**.

The system checks:

- Whether Staff ID exists and the staff member is active.
- Duplicate teaching unit entries.
- Whether Teaching WL Pts equals the teaching component columns O, Q, S, U, and W.
- Conflicting Assigned Roles with the same role name but different hours.
- HDR field conflicts.
- Service points conflicts.
- Whether Target Band matches the calculated teaching/research ratio.
- Whether Notes is filled in when HoD Review is Yes.

### 7.4 Distribute Workload

1. In **Workload Management**, filter pending records.
2. Select the records that need distribution.
3. Click **Distribute Workload**.
4. Confirm Academic Year and Semester.
5. Confirm distribution.

During distribution, the page displays progress. After completion:

- Successful records move to Distributed.
- Failed records move to Failed.
- The system records distributed time and operator.
- If distribution may overwrite an existing workflow, the system shows an extra confirmation to avoid accidental overwrites.

### 7.5 Redistribute a Single Record

If one record needs to be sent again to an Academic:

1. Open the workload detail.
2. Use the redistribute action.
3. The system calls the single-record redistribution endpoint.
4. The distributed time is updated after success.

### 7.6 Employee Management

This tab maintains Academic staff profile information.

Supported actions:

- Search by Last name, First name, and Staff ID.
- Download the Academic staff import template.
- Import Academic staff profiles.
- Click a staff row to open **Staff Profile**.
- Update Staff ID, First Name, Last Name, Email, Title, Department, Active Status, New Employee, and Notes.

Staff profile rules:

- Staff ID must be exactly 8 digits.
- First name and last name are required.
- Email must be valid.
- Academic department should be Physics, Mathematics & Statistics, or Computer Science & Software Engineering.
- When a staff member is inactive, historical workload records are still preserved.

### 7.7 School Operations Visualization

1. Open **Visualization**.
2. Select the Year range.
3. Select Semester.
4. Select Department or All Departments.
5. Click **Apply**.

The page shows:

- Total Departments.
- Total Academics.
- Total Work Hours.
- Pending, Approved, and Rejected distribution.
- Department workload comparison.
- The latest 6-semester trend.

### 7.8 School Operations Export

1. Open **Export Excel**.
2. Set Year, Semester, and Department.
3. Click **Export Excel**.

If the year fields are blank, the system exports using the available data range. The output can be used for reporting, audit, or offline checking.

### 7.9 Semester Reports and Audit Data

The top message entry is used for semester reports. Ops can also export current or historical workload data. The backend records audit events for imports, distribution, re-imports, staff profile updates, approvals, and permission changes.

## 8. HoS Guide

### 8.1 HoS Workload Approval

HoS reviews school-level requests and HoD self-submitted workload requests.

1. Enter `/school-head`.
2. Open **HoS Workload Approval**.
3. Filter by Name, Staff ID, Department, Year, Semester, and Status Filter.
4. Click a record to view details.
5. Check the workload breakdown and application reason.
6. Approve or reject pending records.
7. Enter a review note and submit the decision.

Normal Academic requests are usually reviewed by HoD. HoD self-submissions enter the HoS queue.

### 8.2 Permission Assignment

HoS uses this tab to assign HoD or Admin/Ops permissions.

#### Search Staff

1. Open **Permission Assignment**.
2. Search by Last name, First name, or Staff ID.
3. Click **Select** in the result table.

You can also click a staff row to view or edit **Staff Profile**.

#### Assign HoD

1. Select a staff member.
2. Set Role to **HoD**.
3. Select the academic department they are responsible for.
4. Confirm the permission chips:
   - View Workload
   - Approve Workload
   - Update Workload
5. Click **Assign Permission**.

After assignment, the user can enter `/department-head` and review data within the assigned department.

#### Assign Admin/Ops

1. Select a staff member.
2. Set Role to **Admin**.
3. Department is bound to **Senior School Coordinator**.
4. Confirm the permission chips:
   - Distribute Workload to Departments
   - Edit Employee Information
5. Click **Assign Permission**.

Admin in this page means School Operations.

### 8.3 Disable Permissions

1. Find the target record in Assigned Roles.
2. Click the active status or disable action.
3. Confirm in the modal.

After disabling:

- The corresponding role permission becomes invalid.
- Other active roles should not be removed by mistake.
- If a staff member changes from HoD to Admin/Ops, the old active assignment is disabled and the new assignment becomes the current valid permission.

### 8.4 Import Staff Directory

1. In **Permission Assignment**, download the template.
2. Fill in staff_id, first_name, last_name, email, title, department, and active_status.
3. Import the `.xlsx` file.
4. If any row fails validation, the system returns the reason and does not partially save a failed import.

### 8.5 HoS Visualization and Export

HoS **Visualization** supports school-level analytics filtered by Year, Semester, and Department.

HoS **Export Excel** exports school-level workload data filtered by:

- Year From
- Year To
- Semester
- Department

## 9. Workload Lifecycle

### 9.1 Normal Academic Flow

```text
Ops imports workload
-> Ops places records into Pending Distribution
-> Ops distributes workload to Academic
-> Academic views details
-> Academic confirms workload or submits a request
-> HoD reviews the pending request
-> Approved or Rejected
```

### 9.2 HoD Personal Workload Flow

```text
Ops imports and distributes the HoD's own workload
-> HoD chooses Review My Workload from /role
-> HoD views and confirms it through the personal workload page
-> HoD submits a personal request
-> HoS reviews it
-> Approved or Rejected
```

### 9.3 Re-Import Flow

```text
Ops corrects the Excel file
-> Ops re-imports the workload
-> The system creates a new version
-> The old version is marked as Superseded
-> Audit history keeps the old-version actions
-> Users view the current valid version
```

Records that have already been confirmed, approved, or protected are not simply overwritten. The system preserves history and audit traceability.

## 10. Data Import Rules

### 10.1 Staff ID

- Staff ID must be exactly 8 digits.
- Staff ID is the key field used to match Excel workload rows with system staff records.
- Before import, ensure the Staff ID exists in the staff directory and the staff member is active.

### 10.2 Department

Academic departments include:

- Physics
- Mathematics & Statistics
- Computer Science & Software Engineering

`Senior School Coordinator` is an Admin/Ops position label, not an academic workload department.

### 10.3 Key Workload Template Columns

| Column | Meaning |
| --- | --- |
| B | Staff Name |
| C | Staff Number |
| D | New Staff |
| E | Notes |
| F | HoD Review |
| G | FTE |
| I | Target Band |
| J | Target Teaching % |
| K | Teaching Unit |
| X | Total Teaching WL Pts |
| Y-AA | HDR student/proportion fields |
| AC-AD | HDR hours/points |
| AE | Service points |
| AF onwards | Assigned Roles points |

Do not delete, rename, or merge key columns. Before import, check Staff ID, year, semester, department, HoD Review, and Notes.

## 11. Frequently Asked Questions

### 11.1 What if I cannot see the HoD or Ops page after login?

Confirm whether HoS has assigned the required permission in Permission Assignment. If the permission was just assigned, log out and log in again.

### 11.2 Why is the Academic route not `/academic`?

The current frontend route for Academic Dashboard is `/workload-platform`. Older documents or API notes may still mention `/academic` as a historical name.

### 11.3 Can a HoD approve their own workload?

No. A HoD's own workload should be submitted from `/role` through **Review My Workload** and then reviewed by HoS.

### 11.4 Why are some imported records invalid?

Common causes include missing Staff ID, inactive staff, duplicate teaching units, teaching point totals that do not match component columns, Assigned Roles/HDR/Service conflicts, HoD Review set to Yes with empty Notes, and Target Band mismatches.

### 11.5 What should I do after Rejected?

Read the review note. If the data is wrong, Ops should correct the Excel file and re-import. If the explanation is insufficient, update the reason and resubmit. The exact action depends on the review note.

### 11.6 Can I still operate on Superseded records?

Superseded records are old versions. They are usually only for history and audit review, not for further approval or confirmation. Use the current valid version instead.

### 11.7 Why does the exported Excel have no data?

Check whether the filters are too narrow, such as Year, Semester, Department, or Status. Clear some filters and export again if needed.

## 12. Demo Checklist

Before the formal demo, check the following:

1. Log in with a HoS account and confirm `/school-head` is accessible.
2. Assign a HoD in Permission Assignment.
3. Log in with the HoD account and confirm `/role` is accessible.
4. Enter both **Review Department Workloads** and **Review My Workload**.
5. Assign an Admin/Ops user from HoS.
6. Log in with the Ops account and confirm `/school-operations` is accessible.
7. Ops downloads the workload template.
8. Ops imports a workload Excel file and checks the valid/invalid summary.
9. Ops enters valid records into the pending list.
10. Ops distributes workloads.
11. Academic views and confirms workload.
12. Academic submits a request.
13. HoD reviews a normal Academic request.
14. HoD submits their own personal workload request.
15. HoS reviews the HoD self-submission.
16. Check Visualization filters.
17. Check Export Excel downloads.
18. Disable a role permission and confirm the page is no longer accessible.

## 13. Data Security and Audit

The system records key operations, including:

- Login and authentication-related events.
- Workload import.
- Workload re-import.
- Workload distribution.
- Academic confirmation.
- Academic or HoD request submission.
- HoD or HoS approval decisions.
- Staff profile updates.
- Permission assignment and disabling.
- Record replacement by newer versions.

Users should:

- Never share verification codes.
- Never operate the system using another user's account.
- Never export data unrelated to their work.
- Keep review notes professional, accurate, and traceable.
- Contact HoS or the system administrator if a permission issue is found.

## 14. Resources and Links

- GitHub repository: https://github.com/hieunguyen0802/uwa-capstone-group19
- Closed pull requests: https://github.com/hieunguyen0802/uwa-capstone-group19/pulls?q=is%3Apr+is%3Aclosed
- Running and developer guide: [README.md](../../README.md)
- English user guide: [docs/user-guides/UserGuides.en.md](UserGuides.en.md)
- Backend test suite: [backend/api/tests.py](../../backend/api/tests.py)
- Live-stack smoke tests: [backend/tests_smoke/test_smoke_e2e.py](../../backend/tests_smoke/test_smoke_e2e.py)
- Browser E2E tests: [e2e/test_workload_workflow.py](../../e2e/test_workload_workflow.py)

## 15. Glossary

| Term | Description |
| --- | --- |
| Academic | Academic staff member who views and confirms personal workload |
| HoD | Head of Department, responsible for department-level review |
| Ops | School Operations, responsible for import, distribution, staff data, and export |
| Admin | Historical UI/backend name used for Ops in parts of the system |
| HoS | Head of School, responsible for school-level review and permission assignment |
| Workload Report | One staff member's workload record for a semester |
| Workload Breakdown | Teaching, HDR, Service, Assigned Roles, and Research (residual) details |
| Confirmation | Academic confirmation of personal workload |
| Approval | HoD or HoS decision on a submitted request |
| Re-import | Importing a corrected Excel workload file again |
| Superseded | An old record version replaced by a newer version |
| Permission Assignment | HoS function for assigning or disabling HoD/Admin permissions |
| Senior School Coordinator | Admin/Ops position label, not an academic department |
