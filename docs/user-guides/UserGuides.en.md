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

- **Academic Staff** use the workload submission platform to view their own workload, confirm it when it is correct, or submit a review request to their HoD when they have concerns.
- **Heads of Department (HoDs)** choose between the workload approval platform and the workload submission platform after login. The approval platform is used to review Academic Staff requests within the HoD's assigned school or department; the submission platform is the same personal workload platform used by Academic Staff, but HoD personal requests are reviewed by HoS.
- **School Operations (Ops)** import workload spreadsheets, distribute workloads to Academic and HoD users, maintain Academic staff information, review analytics, and export data.
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
| HoD | `/role`, then choose workload approval or workload submission |
| School Operations | `/school-operations` |
| HoS | `/school-head` |

### 2.3 Main Pages

| Page | Route | Purpose |
| --- | --- | --- |
| Login | `/login` | Email verification-code login |
| Role Selection | `/role` | HoD chooses **Workload Approval Platform** or **Workload Submission Platform** |
| Workload Submission Platform | `/workload-platform` | Personal workload view, confirmation, and submission for Academic and HoD users |
| Workload Approval Platform | `/department-head` | HoD department-level workload review |
| School Operations Dashboard | `/school-operations` | Ops workload import, distribution, staff management, analytics, and export |
| HoS Dashboard | `/school-head` | HoS approval, permission assignment, analytics, and export |

## 3. Roles and Permissions

### 3.1 Academic

Academic users access the workload submission platform at `/workload-platform`. They can only access their own workload records. They can:

- View their personal workload list and details.
- Filter records by Status, Confirmation, Year, and Semester.
- Confirm workload from the detail view.
- Submit a request with a reason when the workload cannot be confirmed.
- View personal workload trends.
- Export personal workload data to Excel.

### 3.2 HoD

A HoD may also have a personal workload record. After login, the HoD enters `/role` and chooses one of two platforms:

- **Workload Approval Platform** opens `/department-head` for department-level Academic request review.
- **Workload Submission Platform** opens `/workload-platform` for the HoD's own personal workload. This is the same submission platform used by Academic users.

The HoD department scope is assigned by HoS or system administration. A HoD cannot view or approve records outside their assigned department, and a HoD cannot approve their own personal workload request. Academic personal requests report to HoD; HoD personal requests report to HoS.

### 3.3 School Operations

School Operations handles school-wide data operations. Ops can:

- Import workload Excel files.
- View pending, distributed, failed, and superseded workload records.
- Distribute workloads to Academic and HoD users.
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
| Confirmed | The Academic or HoD has confirmed their own personal workload |
| Unconfirmed | The Academic or HoD has not confirmed their personal workload yet |
| Distributed | Ops has distributed the workload to the Academic or HoD user |
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

### 4.5 Semester History Reports and Workload Refresh Rules

This rule applies to all roles and is handled by semester.

- S1 runs from 1 January to 30 June each year. On 1 July, the system automatically generates the S1 history report.
- S2 runs from 1 July to 31 December each year. On 1 January of the following year, the system automatically generates the S2 history report.
- Automatically generated history reports are placed in the mailbox or message entry at the top-left of the page. Users can view the reports allowed by their role and permission scope.
- When one semester ends and the next semester starts, the current workload list is refreshed and the active workflow view for the previous semester is cleared. Workloads that are refreshed, overwritten, or moved to an older-version state are still counted in history and preserved in history reports and audit records.

## 5. Workload Submission Platform Guide

The workload submission platform at `/workload-platform` is shared by Academic
and HoD users for personal workload confirmation and submission. The approval
target is different: Academic requests report to the assigned HoD, while HoD
personal requests report to HoS.

### 5.1 View Personal Workload

1. Log in and enter `/workload-platform`.
2. Open the personal workload list.
3. Use **Status**, **Confirmation**, **Year**, and **Semester** filters.
4. Click **Search**.
5. Click a target record to view details.

Users on the workload submission platform only see their own personal workload records. Other staff records are not exposed in this list.

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

1. Select the target record in the personal workload list.
2. Click **Submit Request**.
3. Enter the reason in **Application reason**.
4. Click **Submit**.

Rules:

- A normal Academic request goes to the HoD approval queue.
- If the user is a HoD using the same workload submission platform for their own personal workload, the request goes to the HoS approval queue.
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

### 6.1 Choose Workload Approval or Workload Submission

After login, a HoD enters `/role`.

- To review Academic requests within the HoD's assigned school or department, choose **Workload Approval Platform**.
- To submit or handle the HoD's own personal workload, choose **Workload Submission Platform**. This is the same personal workload platform used by Academic users, but HoD submissions report to HoS.

A HoD should not approve their own workload in the HoD approval platform. Their personal workload should be submitted through the workload submission platform and reviewed by HoS.

### 6.2 Review Academic Workload Requests

1. Enter `/department-head`.
2. Open the workload approval list.
3. Filter by Name, Staff ID, Year, Semester, and Status Filter.
4. Click a record to view details.
5. Check the workload breakdown, School Operations notes, and Application Reason.
6. Edit specific workload items if an adjustment is required.
7. Approve or reject pending records.
8. Enter a review note and submit the decision.

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

The backend importer remains the authoritative source for accepted workload
columns and import rules:
[`backend/api/services/importer_service.py`](../../backend/api/services/importer_service.py).

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
- Whether the total teaching workload points match the sum of the teaching component workload-point fields.
- Conflicting Assigned Roles with the same role name but different hours.
- HDR field conflicts.
- Service points conflicts.
- Whether Target Band matches the calculated teaching/research ratio.

### 7.4 Distribute Workload

1. In **Workload Management**, filter pending records.
2. Select the records that need distribution.
3. Click **Distribute Workload** to send the selected records to the relevant Academic or HoD users.
4. Confirm Academic Year and Semester.
5. Confirm distribution.

During distribution, the page displays progress. After completion:

- Successful records move to Distributed.
- Failed records move to Failed.
- The system records distributed time and operator.
- If distribution may overwrite an existing workflow, the system shows an extra confirmation to avoid accidental overwrites.

### 7.5 Redistribute a Single Record

If one record needs to be sent again to an Academic or HoD:

1. Open the workload detail.
2. Use the redistribute action.
3. The system calls the single-record redistribution endpoint.
4. The distributed time is updated after success.

### 7.6 View History and Change History

School Operations can use **View history** in **Workload Management** to view historical workloads. Historical records include workloads that were re-imported, redistributed, overwritten, or moved to an older-version state.

School Operations can also view the modification history for each workload:

1. In the **Distributed** workload list, click a target record to open the detail view.
2. Click **Change History** in the detail view.
3. Review the workload's modification records, overwrite records, status changes, operator, and timestamp.

These history records are not lost when the workload list is refreshed for a new semester. They remain part of the semester history report and audit trail.

### 7.7 Employee Management

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

### 7.8 School Operations Visualization

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

### 7.9 School Operations Export

1. Open **Export Excel**.
2. Set Year, Semester, and Department.
3. Click **Export Excel**.

If the year fields are blank, the system exports using the available data range. The output can be used for reporting, audit, or offline checking.

### 7.10 Semester Reports and Audit Data

The top message entry is used for semester reports. Ops can also export current or historical workload data. The backend records audit events for imports, distribution, re-imports, staff profile updates, approvals, and permission changes.

## 8. HoS Guide

### 8.1 HoS Workload Approval

HoS reviews school-level requests and HoD self-submitted workload requests.

1. Enter `/school-head`.
2. Open **HoS Workload Approval**.
3. Filter by Name, Staff ID, Department, Year, Semester, and Status Filter.
4. Click a record to view details.
5. Check the workload breakdown and application reason.
6. Edit specific workload items if an adjustment is required.
7. Approve or reject pending records.
8. Enter a review note and submit the decision.

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
-> Academic opens the Workload Submission Platform
-> Academic views details and confirms workload or submits a request
-> HoD reviews the pending request
-> Approved or Rejected
```

### 9.2 HoD Personal Workload Flow

```text
Ops imports and distributes the HoD's own workload
-> HoD chooses Workload Submission Platform from /role
-> HoD views details and confirms workload or submits a personal request
-> HoS reviews it
-> Approved or Rejected
```

Academic and HoD users use the same workload submission platform for personal
workload actions. The difference is the reporting path: Academic requests go to
HoD, while HoD personal requests go to HoS.

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

Do not delete, rename, or merge key columns in the workload template. The
authoritative column layout is maintained in
[`backend/api/services/importer_service.py`](../../backend/api/services/importer_service.py),
because the backend importer is the source of truth for which fields are read,
ignored, recalculated, or validated.

Before import, check that the workbook has the required staff identifiers,
academic year, semester, department, role, FTE, target band, teaching workload,
HDR, service, and assigned-role information.

## 11. Frequently Asked Questions

### 11.1 What if I cannot see the HoD or Ops page after login?

Confirm whether HoS has assigned the required permission in Permission Assignment. If the permission was just assigned, log out and log in again.

### 11.2 Can a HoD approve their own workload?

No. A HoD's own workload should be submitted from `/role` through **Workload Submission Platform** and then reviewed by HoS.

### 11.3 Why are some imported records invalid?

Common causes include missing Staff ID, inactive staff, duplicate teaching units, teaching point totals that do not match component fields, Assigned Roles/HDR/Service conflicts, and Target Band mismatches.

### 11.4 What should I do after Rejected?

Read the review note. If the data is wrong, Ops should correct the Excel file and re-import. If the explanation is insufficient, update the reason and resubmit. The exact action depends on the review note.

### 11.5 Can I still operate on Superseded records?

Superseded records are old versions. They are usually only for history and audit review, not for further approval or confirmation. Use the current valid version instead.

### 11.6 Why does the exported Excel have no data?

Check whether the filters are too narrow, such as Year, Semester, Department, or Status. Clear some filters and export again if needed.

## 12. Demo Checklist

Before the formal demo, check the following:

1. Log in with a HoS account and confirm `/school-head` is accessible.
2. Assign a HoD in Permission Assignment.
3. Log in with the HoD account and confirm `/role` is accessible.
4. Enter both **Workload Approval Platform** and **Workload Submission Platform**.
5. Assign an Admin/Ops user from HoS.
6. Log in with the Ops account and confirm `/school-operations` is accessible.
7. Ops downloads the workload template.
8. Ops imports a workload Excel file and checks the valid/invalid summary.
9. Ops enters valid records into the pending list.
10. Ops distributes workloads to Academic users and HoD users when applicable.
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
- Personal workload confirmation by Academic or HoD users.
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
| Academic | Academic staff member who uses the workload submission platform to view, confirm, or submit personal workload requests to HoD |
| HoD | Head of Department, responsible for department-level approval and also able to use the same workload submission platform for personal workload requests to HoS |
| Ops | School Operations, responsible for import, distribution, staff data, and export |
| Admin | Historical UI/backend name used for Ops in parts of the system |
| HoS | Head of School, responsible for school-level review and permission assignment |
| Workload Report | One staff member's workload record for a semester |
| Workload Breakdown | Teaching, HDR, Service, Assigned Roles, and Research (residual) details |
| Confirmation | Academic or HoD confirmation of personal workload |
| Approval | HoD or HoS decision on a submitted request |
| Re-import | Importing a corrected Excel workload file again |
| Superseded | An old record version replaced by a newer version |
| Permission Assignment | HoS function for assigning or disabling HoD/Admin permissions |
| Senior School Coordinator | Admin/Ops position label, not an academic department |
