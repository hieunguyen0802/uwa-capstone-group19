import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import DashboardHeader from "../components/common/DashboardHeader";
import FilterFormRow from "../components/common/FilterFormRow";
import PaginationControls from "../components/common/PaginationControls";
import ProfileModal from "../components/common/ProfileModal";
import SearchButton from "../components/common/SearchButton";
import { MOCK_DASHBOARD_USER } from "../data/mockDashboardUser";
import SectionTabs from "../components/common/SectionTabs";
import SectionTitleBlock from "../components/common/SectionTitleBlock";
import StaffProfileModal, { type StaffProfileDraft } from "../components/common/StaffProfileModal";
import StatusPill from "../components/common/StatusPill";
import TemplateImportExportActions from "../components/common/TemplateImportExportActions";
import ThemedNoticeModal, { SUPERSEDED_RECORD_MESSAGE } from "../components/common/ThemedNoticeModal";
import WorkHoursBadge from "../components/common/WorkHoursBadge";

type MockRequest = {
  id: number;
  studentId: string;
  semesterLabel: string;
  periodLabel: string;
  name: string;
  unit: string;
  notes?: string;
  description?: string;
  requestReason?: string;
  title: string;
  department: string;
  rate: number;
  status: "pending" | "approved" | "rejected";
  hours: number;
  supervisorNote?: string;
  /** When true (from API), row is read-only and detail is blocked — superseded by a newer version. */
  cancelled?: boolean;
};

type BreakdownCategory = "Teaching" | "Assigned Roles" | "HDR" | "Service" | "Research (residual)";
type BreakdownEntry = { name: string; hours: number };
type BreakdownData = Record<BreakdownCategory, BreakdownEntry[]>;

const SUPERVISOR_DRAFT_KEY = "academic_to_supervisor_requests_v1";
const SUPERVISOR_STATE_KEY = "supervisor_requests_state_v1";
const HOD_ASSIGNMENTS_KEY = "hod_role_assignments_v1";
const ACADEMIC_STATUS_SYNC_KEY = "academic_status_sync_v1";
const ACADEMIC_NOTES_SYNC_KEY = "academic_notes_sync_v1";
const SUPERVISOR_SYNC_EVENT = "supervisor-status-updated";
const ACADEMIC_DRAFT_EVENT = "academic-drafts-updated";
const HOS_SEMESTER_REPORTS_KEY = "hos_semester_report_inbox_v1";

type HosSemesterReportItem = {
  id: string;
  year: number;
  semester: "S1" | "S2";
  title: string;
  createdAt: string;
  readAt?: string;
  isDemo?: boolean;
  rows: Record<string, string | number>[];
};

function readHosSemesterReports(): HosSemesterReportItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HOS_SEMESTER_REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HosSemesterReportItem[];
  } catch {
    return [];
  }
}

function writeHosSemesterReports(items: HosSemesterReportItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HOS_SEMESTER_REPORTS_KEY, JSON.stringify(items));
}

function displayNameWithoutComma(raw: string): string {
  return raw.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

function reportStatusText(status: MockRequest["status"]) {
  return status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";
}

function submittedTimeById(id: number) {
  const day = ((id - 1) % 28) + 1;
  const hour = 8 + (id % 9);
  return `2026-03-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00`;
}

function readAcademicDrafts(): MockRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUPERVISOR_DRAFT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as MockRequest[];
  } catch {
    return [];
  }
}

function consumeAcademicDrafts(): MockRequest[] {
  if (typeof window === "undefined") return [];
  const drafts = readAcademicDrafts();
  window.localStorage.removeItem(SUPERVISOR_DRAFT_KEY);
  return drafts;
}

function readSupervisorState(): MockRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUPERVISOR_STATE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as MockRequest[];
  } catch {
    return [];
  }
}

function mergeDraftsIntoRequests(current: MockRequest[], drafts: MockRequest[]) {
  if (!drafts.length) return current;
  const existingIds = new Set(current.map((row) => row.id));
  const incoming = drafts.filter((row) => !existingIds.has(row.id));
  if (!incoming.length) return current;
  return [...incoming, ...current];
}

function breakdownById(id: number): BreakdownData {
  const patterns: BreakdownData[] = [
    {
      Teaching: [
        { name: "CITS2401", hours: 15 },
        { name: "CITS2200", hours: 5 },
      ],
      "Assigned Roles": [
        { name: "Program Chair", hours: 20 },
        { name: "Outreach Chair", hours: 10 },
      ],
      HDR: [
        { name: "Student A", hours: 2 },
        { name: "Student B", hours: 2 },
      ],
      Service: [{ name: "Committee support", hours: 10 }],
      "Research (residual)": [{ name: "Research (residual)", hours: 0 }],
    },
    {
      Teaching: [{ name: "CITS3002", hours: 15 }],
      "Assigned Roles": [{ name: "Industry liaison", hours: 6 }],
      HDR: [
        { name: "Student D", hours: 3 },
        { name: "Student E", hours: 2 },
      ],
      Service: [{ name: "Peer review", hours: 4 }],
      "Research (residual)": [{ name: "Research (residual)", hours: 0 }],
    },
  ];
  return patterns[id % patterns.length];
}

function extractRequestReason(description: string) {
  const marker = "Request reason:";
  const idx = description.indexOf(marker);
  if (idx === -1) return "";
  return description.slice(idx + marker.length).trim();
}

function cleanDescription(description: string) {
  const marker = "Request reason:";
  const idx = description.indexOf(marker);
  if (idx === -1) return description;
  return description.slice(0, idx).trim();
}

function workloadModalNotes(row: Pick<MockRequest, "notes" | "description">) {
  const n = row.notes?.trim();
  if (n) return n;
  return cleanDescription(row.description ?? "");
}

function requestReasonText(row: Pick<MockRequest, "requestReason" | "description">) {
  return row.requestReason?.trim() || extractRequestReason(row.description ?? "").trim();
}

function buildHosSemesterReportRows(rows: MockRequest[]) {
  return rows.map((row) => ({
    "Staff ID": row.studentId,
    Name: displayNameWithoutComma(row.name),
    Department: row.department,
    Title: row.title,
    Status: reportStatusText(row.status),
    "Total Work Hours": row.hours,
    "Submitted Time": submittedTimeById(row.id),
    "Application Reason": requestReasonText(row) || "—",
    "HoS Review Note": row.supervisorNote?.trim() || "—",
  }));
}

function createHosSemesterDemoReport(): HosSemesterReportItem {
  return {
    id: "hos-report-demo-2025-S1",
    year: 2025,
    semester: "S1",
    title: "2025 S1 distribution report generated",
    createdAt: "2025-07-01T09:00:00.000Z",
    readAt: undefined,
    isDemo: true,
    rows: [
      {
        "Staff ID": "12345931",
        Name: "Dias John",
        Department: "Physics",
        Title: "Lecturer",
        Status: "Pending",
        "Total Work Hours": 793.5,
        "Submitted Time": "2025-06-24 10:00",
        "Application Reason": "wrong",
        "HoS Review Note": "—",
      },
    ],
  };
}

/** Last name, first name, or full name (substring or order-independent tokens; commas as spaces). */
function workloadNameSearchMatches(recordName: string, queryRaw: string): boolean {
  const q = queryRaw.trim().toLowerCase();
  if (!q) return true;
  const norm = recordName
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return false;
  if (norm.includes(q)) return true;
  const qTokens = q.split(/\s+/).filter(Boolean);
  const parts = norm.split(" ").filter(Boolean);
  return qTokens.every((t) => parts.some((p) => p.includes(t)));
}

function shortDepartmentName(department: string) {
  if (department === "Computer Science & Software Engineering") return "CS&SE";
  if (department === "Mathematics & Statistics") return "Math&Stats";
  return department;
}

function departmentHighlightClass(department: string, isTop: boolean) {
  if (!isTop) return "bg-white font-semibold text-[#1f3b86]";
  if (department === "Computer Science & Software Engineering") return "bg-[#1f3b86] font-bold text-white";
  if (department === "Mathematics & Statistics") return "bg-[#4f75cf] font-bold text-white";
  return "bg-[#a9c4f7] font-bold text-[#0f172a]";
}

function maxValue(values: number[]) {
  if (values.length === 0) return Number.NEGATIVE_INFINITY;
  return Math.max(...values);
}

/** Workload search filter: school departments (org chart). */
const WORKLOAD_SEARCH_DEPARTMENT_OPTIONS = [
  "Physics",
  "Mathematics & Statistics",
  "Computer Science & Software Engineering",
] as const;

export default function HeadofSchool() {
  type AssignRole = "HoD" | "Admin";
  type AssignDepartment =
    | "Physics"
    | "Mathematics & Statistics"
    | "Computer Science & Software Engineering"
    | "Senior School Coordinator";
  type AssignablePerson = {
    id: number;
    staffId: string;
    firstName: string;
    lastName: string;
    email: string;
    title: string;
    currentDepartment: string;
    isActive: boolean;
    isNewEmployee: boolean;
    notes: string;
  };
  type RoleAssignment = {
    id: number;
    staffId: string;
    email?: string;
    name: string;
    role: AssignRole;
    department: AssignDepartment;
    permissions: string[];
    assignedAt: string;
    status: "active" | "disabled";
  };

  const user = MOCK_DASHBOARD_USER;

  const [hosReportInboxOpen, setHosReportInboxOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [hosSemesterReports, setHosSemesterReports] = useState<HosSemesterReportItem[]>(() =>
    readHosSemesterReports()
  );
  const [hosReportInboxPage, setHosReportInboxPage] = useState(1);
  const [activeSection, setActiveSection] = useState<
    "approval" | "admin" | "visualization" | "export"
  >("approval");
  const sectionTabs = [
    { key: "approval", label: "HoS Workload Approval" },
    { key: "admin", label: "Permission Assignment" },
    { key: "visualization", label: "Visualization" },
    { key: "export", label: "Export Excel" },
  ];
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const [loading] = useState(false);
  const [pending, setPending] = useState<MockRequest[]>([]);

  useEffect(() => {
    function mergeLatestDrafts() {
      const drafts = consumeAcademicDrafts();
      if (!drafts.length) return;
      setPending((prev) => mergeDraftsIntoRequests(prev, drafts));
    }

    function onStorage(e: StorageEvent) {
      if (e.key === SUPERVISOR_DRAFT_KEY) mergeLatestDrafts();
    }

    function onDraftEvent() {
      mergeLatestDrafts();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(ACADEMIC_DRAFT_EVENT, onDraftEvent as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ACADEMIC_DRAFT_EVENT, onDraftEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SUPERVISOR_STATE_KEY, JSON.stringify(pending));
  }, [pending]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync: Record<string, "pending" | "approved" | "rejected"> = {};
    const notesSync: Record<string, string> = {};
    pending.forEach((row) => {
      if (row.studentId) sync[row.studentId] = row.status;
      if (row.studentId && row.supervisorNote) notesSync[row.studentId] = row.supervisorNote;
    });
    window.localStorage.setItem(ACADEMIC_STATUS_SYNC_KEY, JSON.stringify(sync));
    window.localStorage.setItem(ACADEMIC_NOTES_SYNC_KEY, JSON.stringify(notesSync));
    window.dispatchEvent(new Event(SUPERVISOR_SYNC_EVENT));
  }, [pending]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 10; // Items per page
  const [submitting, setSubmitting] = useState(false);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("pending");

  const [popup, setPopup] = useState<{
    open: boolean;
    title: string;
    message: string;
    status: "pending" | "approved" | "rejected";
  }>({
    open: false,
    title: "",
    message: "",
    status: "pending",
  });

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [supersededNoticeOpen, setSupersededNoticeOpen] = useState(false);
  const [detailsItem, setDetailsItem] = useState<MockRequest | null>(null);
  const [detailsBreakdown, setDetailsBreakdown] = useState<BreakdownData | null>(null);
  const [detailsTab, setDetailsTab] = useState<BreakdownCategory>("Teaching");
  const [detailsEditMode, setDetailsEditMode] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState("");
  const [detailsModalError, setDetailsModalError] = useState("");
  const [noteDecision, setNoteDecision] = useState<"approve" | "reject">("approve");
  const [noteTargetId, setNoteTargetId] = useState<number | null>(null);

  const [searchEmployeeIdInput, setSearchEmployeeIdInput] = useState("");
  const [searchNameInput, setSearchNameInput] = useState("");
  const [searchDepartmentInput, setSearchDepartmentInput] = useState("");
  const [searchYearInput, setSearchYearInput] = useState("");
  const [searchSemesterInput, setSearchSemesterInput] = useState<"" | "S1" | "S2">("");
  const [searchFilters, setSearchFilters] = useState({
    employeeId: "",
    name: "",
    department: "",
    year: "",
    semester: "",
  });
  const [adminSearchFirstNameInput, setAdminSearchFirstNameInput] = useState("");
  const [adminSearchLastNameInput, setAdminSearchLastNameInput] = useState("");
  const [adminSearchStaffIdInput, setAdminSearchStaffIdInput] = useState("");
  const [adminSearchFilters, setAdminSearchFilters] = useState({
    firstName: "",
    lastName: "",
    staffId: "",
  });
  const [selectedPerson, setSelectedPerson] = useState<AssignablePerson | null>(null);
  const [assignRole, setAssignRole] = useState<AssignRole>("HoD");
  const [assignDepartment, setAssignDepartment] = useState<AssignDepartment>("Physics");
  const rolePermissionMap: Record<AssignRole, string[]> = {
    HoD: ["View Workload", "Approve Workload", "Update Workload"],
    Admin: ["Distribute Workload to Departments", "Edit Employee Information"],
  };
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(rolePermissionMap.HoD);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);
  const [assignMessage, setAssignMessage] = useState("");
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);
  const [bindingSource, setBindingSource] = useState<"role" | "department" | null>(null);
  const isRoleLocked = bindingSource === "department";
  const isDepartmentLocked = bindingSource === "role";
  const adminBoundDepartment: AssignDepartment = "Senior School Coordinator";
  const currentSemester: "S1" | "S2" = new Date().getMonth() < 6 ? "S1" : "S2";
  const defaultVisualFromYear = currentYear - 2;
  const [visualYearFromInput, setVisualYearFromInput] = useState(String(defaultVisualFromYear));
  const [visualYearToInput, setVisualYearToInput] = useState(String(currentYear));
  const [visualSemesterInput, setVisualSemesterInput] = useState<"All" | "S1" | "S2">("All");
  const [visualDepartmentInput, setVisualDepartmentInput] = useState<string>("All Departments");
  const [visualFilterError, setVisualFilterError] = useState("");
  const [exportYearFromInput, setExportYearFromInput] = useState("");
  const [exportYearToInput, setExportYearToInput] = useState("");
  const [exportSemesterInput, setExportSemesterInput] = useState<"All" | "S1" | "S2">("All");
  const [exportDepartmentInput, setExportDepartmentInput] = useState<string>("All Departments");
  const [visualFilters, setVisualFilters] = useState<{
    fromYear: string;
    toYear: string;
    semester: "All" | "S1" | "S2";
    department: string;
  }>({
    fromYear: String(defaultVisualFromYear),
    toYear: String(currentYear),
    semester: "All",
    department: "All Departments",
  });

  const availableDepartments: AssignDepartment[] = [
    "Physics",
    "Mathematics & Statistics",
    "Computer Science & Software Engineering",
    "Senior School Coordinator",
  ];
  const availablePermissions = rolePermissionMap[assignRole];

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HOD_ASSIGNMENTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setRoleAssignments(parsed);
    } catch {
      // ignore invalid cached assignment data
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(HOD_ASSIGNMENTS_KEY, JSON.stringify(roleAssignments));
  }, [roleAssignments]);

  const initialAssignablePeople: AssignablePerson[] = [];
  const [assignablePeople, setAssignablePeople] = useState<AssignablePerson[]>(initialAssignablePeople);
  const [importMessage, setImportMessage] = useState("");
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffDraft, setStaffDraft] = useState<StaffProfileDraft | null>(null);
  const [staffModalError, setStaffModalError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedYear = Number(searchYearInput) || currentYear;
  const yearOptions = useMemo(
    () => Array.from({ length: 11 }, (_, i) => String(selectedYear - 5 + i)),
    [selectedYear]
  );
  const hosReportsPerPage = 10;
  const hosUnreadReportCount = useMemo(
    () => hosSemesterReports.filter((item) => !item.readAt).length,
    [hosSemesterReports]
  );
  const hosReportTotalPages = Math.max(1, Math.ceil(hosSemesterReports.length / hosReportsPerPage));
  const pagedHosReports = useMemo(() => {
    const start = (hosReportInboxPage - 1) * hosReportsPerPage;
    return hosSemesterReports.slice(start, start + hosReportsPerPage);
  }, [hosSemesterReports, hosReportInboxPage]);

  function semesterReportAvailableOn(year: number, semester: "S1" | "S2"): Date {
    return semester === "S1" ? new Date(year, 6, 1, 0, 0, 0, 0) : new Date(year + 1, 0, 1, 0, 0, 0, 0);
  }

  function handleDownloadHosSemesterReport(report: HosSemesterReportItem) {
    if (!report.rows.length) return;
    const ws = XLSX.utils.json_to_sheet(report.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${report.year}-${report.semester}`);
    XLSX.writeFile(wb, `hos_distribution_report_${report.year}_${report.semester}.xlsx`);
  }

  useEffect(() => {
    setHosSemesterReports((prev) => {
      const base = (prev.length ? prev : readHosSemesterReports()).map((item) => ({
        ...item,
        title: `${item.year} ${item.semester} distribution report generated`,
      }));
      if (base.length) {
        writeHosSemesterReports(base);
        return base;
      }
      const seeded = [createHosSemesterDemoReport()];
      writeHosSemesterReports(seeded);
      return seeded;
    });
  }, []);

  useEffect(() => {
    const now = new Date();
    const existing = readHosSemesterReports();
    const existingByKey = new Map<string, HosSemesterReportItem>(
      existing.map((item) => [`${item.year}-${item.semester}`, item] as const)
    );
    const semesterKeys = new Set<string>();

    pending.forEach((row) => {
      if (row.cancelled) return;
      const matched = row.periodLabel.match(/^(\d{4})-(1|2)$/);
      if (!matched) return;
      const year = Number(matched[1]);
      const semester = matched[2] === "1" ? "S1" : "S2";
      if (now < semesterReportAvailableOn(year, semester)) return;
      semesterKeys.add(`${year}-${semester}`);
    });

    const newReports: HosSemesterReportItem[] = [];
    const replacedDemoKeys = new Set<string>();
    semesterKeys.forEach((key) => {
      const existingItem = existingByKey.get(key);
      if (existingItem && !existingItem.isDemo) return;
      const [yearText, semester] = key.split("-") as [string, "S1" | "S2"];
      const year = Number(yearText);
      const semesterRows = buildHosSemesterReportRows(
        pending.filter((row) => !row.cancelled && row.periodLabel === `${year}-${semester === "S1" ? "1" : "2"}`)
      );
      if (!semesterRows.length) return;
      if (existingItem?.isDemo) replacedDemoKeys.add(key);
      newReports.push({
        id: `hos-report-${year}-${semester}-${Date.now()}`,
        year,
        semester,
        title: `${year} ${semester} distribution report generated`,
        createdAt: new Date().toISOString(),
        rows: semesterRows,
      });
    });

    if (!newReports.length) return;
    const retainedExisting = existing.filter((item) => !replacedDemoKeys.has(`${item.year}-${item.semester}`));
    const next = [...newReports, ...retainedExisting].sort(
      (a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")
    );
    writeHosSemesterReports(next);
    setHosSemesterReports(next);
  }, [pending]);

  useEffect(() => {
    if (!hosReportInboxOpen) return;
    setHosSemesterReports((prev) => {
      const now = new Date().toISOString();
      const next = prev.map((item) => (item.readAt ? item : { ...item, readAt: now }));
      writeHosSemesterReports(next);
      return next;
    });
  }, [hosReportInboxOpen]);

  useEffect(() => {
    const total = Math.max(1, Math.ceil(hosSemesterReports.length / hosReportsPerPage));
    setHosReportInboxPage((prev) => Math.min(Math.max(1, prev), total));
  }, [hosSemesterReports.length]);

  const pendingCount = useMemo(
    () => pending.filter((it) => it.status === "pending").length,
    [pending]
  );

  const itemsForFilter = useMemo(() => {
    const byStatus =
      statusFilter === "all"
        ? pending
        : pending.filter((it) => it.status === statusFilter);

    const hasSearchFilter = Object.values(searchFilters).some((value) => value);
    if (!hasSearchFilter) return byStatus;

    return byStatus.filter((it) => {
      if (
        searchFilters.employeeId &&
        !it.studentId.toLowerCase().includes(searchFilters.employeeId)
      ) {
        return false;
      }

      if (searchFilters.name && !workloadNameSearchMatches(it.name, searchFilters.name)) {
        return false;
      }

      if (searchFilters.department) {
        const departmentText = it.department.toLowerCase();
        const normalizedSearch = searchFilters.department.replace("school", "").trim();
        if (!departmentText.includes(searchFilters.department) && (!normalizedSearch || !departmentText.includes(normalizedSearch))) {
          return false;
        }
      }

      const submittedText = submittedTimeById(it.id);
      const submittedDate = new Date(submittedText.replace(" ", "T"));
      const hasValidSubmittedDate = !Number.isNaN(submittedDate.getTime());
      const selectedYear = Number(searchFilters.year);

      if (searchFilters.year && Number.isFinite(selectedYear) && hasValidSubmittedDate) {
        if (searchFilters.semester === "s1") {
          // S1: [YYYY-01-01, YYYY-07-01)
          const s1Start = new Date(selectedYear, 0, 1);
          const s1End = new Date(selectedYear, 6, 1);
          if (!(submittedDate >= s1Start && submittedDate < s1End)) return false;
        } else if (searchFilters.semester === "s2") {
          // S2: [YYYY-07-01, YYYY+1-01-01)
          const s2Start = new Date(selectedYear, 6, 1);
          const s2End = new Date(selectedYear + 1, 0, 1);
          if (!(submittedDate >= s2Start && submittedDate < s2End)) return false;
        } else if (submittedDate.getFullYear() !== selectedYear) {
          return false;
        }
      }

      return it.name.trim().length > 0;
    });
  }, [pending, statusFilter, searchFilters]);
  const adminSearchResults = useMemo(() => {
    const hasFilter = Object.values(adminSearchFilters).some((value) => value);
    if (!hasFilter) return assignablePeople;
    return assignablePeople.filter((person) => {
      if (
        adminSearchFilters.staffId &&
        !person.staffId.toLowerCase().includes(adminSearchFilters.staffId)
      ) {
        return false;
      }
      if (
        adminSearchFilters.firstName &&
        !person.firstName.toLowerCase().includes(adminSearchFilters.firstName)
      ) {
        return false;
      }
      if (
        adminSearchFilters.lastName &&
        !person.lastName.toLowerCase().includes(adminSearchFilters.lastName)
      ) {
        return false;
      }
      return true;
    });
  }, [adminSearchFilters, assignablePeople]);

  const departmentStats = useMemo(
    () => [
      {
        department: "Computer Science & Software Engineering",
        totalHours: 430,
        academics: 27,
        pending: 17,
        approved: 8,
        rejected: 2,
      },
      {
        department: "Mathematics & Statistics",
        totalHours: 318,
        academics: 19,
        pending: 7,
        approved: 10,
        rejected: 2,
      },
      {
        department: "Physics",
        totalHours: 264,
        academics: 14,
        pending: 5,
        approved: 7,
        rejected: 2,
      },
    ],
    []
  );
  const filteredDepartmentStats = useMemo(() => {
    if (visualFilters.department === "All Departments") return departmentStats;
    return departmentStats.filter((item) => item.department === visualFilters.department);
  }, [departmentStats, visualFilters.department]);

  const totalWorkHoursByDepartment = useMemo(
    () =>
      filteredDepartmentStats.map((item) => ({
        department: item.department,
        departmentShort:
          item.department === "Computer Science & Software Engineering"
            ? "CS&SE"
            : item.department === "Mathematics & Statistics"
              ? "Math&Stats"
              : item.department === "Physics"
                ? "Physics"
                : item.department,
        totalWorkHours: Number(item.totalHours.toFixed(1)),
      })),
    [filteredDepartmentStats]
  );

  const averageWorkHoursByDepartment = useMemo(
    () =>
      filteredDepartmentStats.map((item) => ({
        department: item.department,
        departmentShort:
          item.department === "Computer Science & Software Engineering"
            ? "CS&SE"
            : item.department === "Mathematics & Statistics"
              ? "Math&Stats"
              : item.department === "Physics"
                ? "Physics"
                : item.department,
        averageWorkHours: Number((item.totalHours / Math.max(1, item.academics)).toFixed(1)),
      })),
    [filteredDepartmentStats]
  );

  const approvalStatusByDepartment = useMemo(
    () =>
      filteredDepartmentStats.map((item) => ({
        department: item.department,
        departmentShort:
          item.department === "Computer Science & Software Engineering"
            ? "CS&SE"
            : item.department === "Mathematics & Statistics"
              ? "Math&Stats"
              : item.department === "Physics"
                ? "Physics"
                : item.department,
        pending: item.pending,
        approved: item.approved,
        rejected: item.rejected,
      })),
    [filteredDepartmentStats]
  );

  const workloadTrendBySemester = useMemo(() => {
    const startYear = currentYear - 5;
    const endYear = currentYear + 5;
    const currentMonth = new Date().getMonth();
    const hasReachedS2 = currentMonth >= 6;
    const rows: Array<Record<string, string | number | null>> = [];
    for (let year = startYear; year <= endYear; year += 1) {
      const offset = year - startYear;
      rows.push({
        semester: `${year} S1`,
        "Computer Science & Software Engineering": 178 + offset * 8,
        "Mathematics & Statistics": 128 + offset * 6,
        Physics: 104 + offset * 5,
      });
      rows.push({
        semester: `${year} S2`,
        "Computer Science & Software Engineering":
          year === currentYear && !hasReachedS2 ? null : 186 + offset * 9,
        "Mathematics & Statistics": year === currentYear && !hasReachedS2 ? null : 136 + offset * 7,
        Physics: year === currentYear && !hasReachedS2 ? null : 111 + offset * 6,
      });
    }
    return rows;
  }, [currentYear]);

  const schoolSummary = useMemo(() => {
    const totalAcademics = filteredDepartmentStats.reduce((sum, item) => sum + item.academics, 0);
    const totalWorkHours = filteredDepartmentStats.reduce((sum, item) => sum + item.totalHours, 0);
    const pendingRequests = filteredDepartmentStats.reduce((sum, item) => sum + item.pending, 0);
    const approvedRequests = filteredDepartmentStats.reduce((sum, item) => sum + item.approved, 0);
    const rejectedRequests = filteredDepartmentStats.reduce((sum, item) => sum + item.rejected, 0);
    return {
      totalDepartments: filteredDepartmentStats.length,
      totalAcademics,
      totalWorkHours: Number(totalWorkHours.toFixed(1)),
      pendingRequests,
      approvedRequests,
      rejectedRequests,
    };
  }, [filteredDepartmentStats]);
  const workloadPerAcademicByDepartment = useMemo(
    () =>
      filteredDepartmentStats.map((item) => ({
        department: item.department,
        value: Number((item.totalHours / Math.max(1, item.academics)).toFixed(1)),
      })),
    [filteredDepartmentStats]
  );
  const averageWorkloadPerAcademicOverall = useMemo(() => {
    const totalHours = filteredDepartmentStats.reduce((sum, item) => sum + item.totalHours, 0);
    const totalAcademics = filteredDepartmentStats.reduce((sum, item) => sum + item.academics, 0);
    return Number((totalHours / Math.max(1, totalAcademics)).toFixed(1));
  }, [filteredDepartmentStats]);
  const filteredTrendData = useMemo(() => {
    const from = Number(visualFilters.fromYear);
    const to = Number(visualFilters.toYear);
    const minYear = Number.isFinite(from) && Number.isFinite(to) ? Math.min(from, to) : currentYear;
    const maxYear = Number.isFinite(from) && Number.isFinite(to) ? Math.max(from, to) : currentYear;
    const rows = workloadTrendBySemester.filter((row) => {
      const semesterKey = String(row.semester);
      const [year, sem] = semesterKey.split(" ");
      const yearNumber = Number(year);
      if (yearNumber < minYear || yearNumber > maxYear) return false;
      // Semester filter applies to the whole selected year range.
      if (visualFilters.semester !== "All" && sem !== visualFilters.semester) return false;
      return true;
    });
    const latestRows = rows.slice(-6);
    if (visualFilters.department === "All Departments") return latestRows;
    return latestRows.map((row) => {
      const filteredRow: Record<string, string | number | null> = { semester: String(row.semester) };
      filteredRow[visualFilters.department] = row[visualFilters.department] ?? null;
      return filteredRow;
    });
  }, [workloadTrendBySemester, visualFilters, currentYear]);
  const reportingPeriodLabel = useMemo(() => {
    const yearLabel =
      visualFilters.fromYear === visualFilters.toYear
        ? visualFilters.fromYear
        : `${visualFilters.fromYear}-${visualFilters.toYear}`;
    if (visualFilters.semester === "All") {
      return `${yearLabel} All Semesters`;
    }
    return `${yearLabel} ${visualFilters.semester}`;
  }, [visualFilters]);
  const scopeLabel = useMemo(
    () => (visualFilters.department === "All Departments" ? "All Departments" : visualFilters.department),
    [visualFilters.department]
  );
  const departmentColorMap: Record<string, string> = {
    "Computer Science & Software Engineering": "#1f3b86",
    "Mathematics & Statistics": "#4f75cf",
    Physics: "#a9c4f7",
  };
  const chartTickStyle = { fontFamily: "Inter, Arial, sans-serif", fontSize: 12, fill: "#334155" };
  const axisLabelStyle = {
    fontFamily: "Inter, Arial, sans-serif",
    fontSize: 12,
    fontWeight: 600,
    fill: "#1e293b",
  };
  const currentSemesterLabel = `${currentYear} ${currentSemester}`;

  function handleApplyVisualizationFilter() {
    const fromYear = Number(visualYearFromInput);
    const toYear = Number(visualYearToInput);
    if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) {
      setVisualFilterError("Please enter valid year values.");
      return;
    }
    const startYear = Math.min(fromYear, toYear);
    const endYear = Math.max(fromYear, toYear);
    const yearSpan = endYear - startYear;
    const maxYearSpan = 2;
    if (yearSpan > maxYearSpan) {
      setVisualFilterError("Maximum range is 3 years.");
      return;
    }
    setVisualFilterError("");
    setVisualFilters({
      fromYear: String(startYear),
      toYear: String(endYear),
      semester: visualSemesterInput,
      department: visualDepartmentInput,
    });
  }
  const legendStyle = { fontFamily: "Inter, Arial, sans-serif", fontSize: 12 };

  useEffect(() => {
    setSelectedPermissions(rolePermissionMap[assignRole]);
  }, [assignRole]);

  const totalPages = Math.max(1, Math.ceil(itemsForFilter.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return itemsForFilter.slice(start, start + pageSize);
  }, [itemsForFilter, page]);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canSubmit =
    statusFilter === "pending" && selectedIds.size > 0 && !submitting;

  async function handleDecision(kind: "approve" | "reject") {
    if (!canSubmit) return;
    setSubmitting(true);

    // Fake: update status locally
    const nextStatus: MockRequest["status"] =
      kind === "approve" ? "approved" : "rejected";
    const count = selectedIds.size;
    const next: MockRequest[] = pending.map((it) => {
      if (!selectedIds.has(it.id)) return it;
      return { ...it, status: nextStatus };
    });

    // Small delay to feel like a real request
    await new Promise((r) => setTimeout(r, 300));
    setPending(next);
    setSelectedIds(new Set());
    setSubmitting(false);

    setPopup({
      open: true,
      title: kind === "approve" ? "Approved" : "Rejected",
      message:
        count === 1
          ? `1 request has been marked as ${kind === "approve" ? "Approved" : "Rejected"}.`
          : `${count} requests have been marked as ${
              kind === "approve" ? "Approved" : "Rejected"
            }.`,
      status: kind === "approve" ? "approved" : "rejected",
    });
  }

  async function handleDecisionForId(kind: "approve" | "reject", id: number, note: string) {
    setSubmitting(true);
    try {
      const nextStatus: MockRequest["status"] =
        kind === "approve" ? "approved" : "rejected";
      setPending((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, status: nextStatus, supervisorNote: note.trim() }
            : it
        )
      );
      // Clear selection if it contains the same row.
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } finally {
      setSubmitting(false);
    }

    setPopup({
      open: true,
      title: kind === "approve" ? "Approved" : "Rejected",
      message: `The request has been marked as ${
        kind === "approve" ? "Approved" : "Rejected"
      }.`,
      status: kind === "approve" ? "approved" : "rejected",
    });
  }

  function openNoteModal(kind: "approve" | "reject", id: number) {
    if (detailsBreakdown) {
      const hasEmptyRow = (Object.keys(detailsBreakdown) as BreakdownCategory[]).some((tab) =>
        detailsBreakdown[tab].some((row) => row.name.trim() === "")
      );
      if (hasEmptyRow) {
        setDetailsModalError("Empty breakdown rows must be completed or deleted first.");
        return;
      }
    }
    setNoteDecision(kind);
    setNoteTargetId(id);
    setNoteDraft("");
    setNoteError("");
    setNoteModalOpen(true);
  }

  async function handleFinishNote() {
    const trimmed = noteDraft.trim();
    if (!trimmed) {
      setNoteError("Supervisor note is required.");
      return;
    }
    if (trimmed.length > 240) {
      setNoteError("Supervisor note must be 240 characters or less.");
      return;
    }
    if (noteTargetId === null) return;
    await handleDecisionForId(noteDecision, noteTargetId, trimmed);
    setNoteModalOpen(false);
    closeDetails();
  }

  function handleSearch() {
    setSearchFilters({
      employeeId: searchEmployeeIdInput.trim().toLowerCase(),
      name: searchNameInput.trim().toLowerCase(),
      department: searchDepartmentInput.trim().toLowerCase(),
      year: searchYearInput.trim().toLowerCase(),
      semester: searchSemesterInput.trim().toLowerCase(),
    });
    setPage(1);
    setSelectedIds(new Set());
    setDetailsOpen(false);
    setDetailsItem(null);
    setDetailsBreakdown(null);
  }

  function handleAdminSearch() {
    setAdminSearchFilters({
      firstName: adminSearchFirstNameInput.trim().toLowerCase(),
      lastName: adminSearchLastNameInput.trim().toLowerCase(),
      staffId: adminSearchStaffIdInput.trim().toLowerCase(),
    });
  }

  function handlePersonDepartmentChange(personId: number, nextDepartment: string) {
    setAssignablePeople((prev) =>
      prev.map((person) =>
        person.id === personId
          ? {
              ...person,
              currentDepartment: nextDepartment,
            }
          : person
      )
    );
    if (selectedPerson?.id === personId) {
      setSelectedPerson((prev) => (prev ? { ...prev, currentDepartment: nextDepartment } : prev));
      if (availableDepartments.includes(nextDepartment as AssignDepartment)) {
        setAssignDepartment(nextDepartment as AssignDepartment);
      }
    }
  }

  function openStaffModal(person: AssignablePerson) {
    setStaffDraft({
      id: person.id,
      staffId: person.staffId,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      title: person.title,
      department: person.currentDepartment,
      isActive: person.isActive ? "Active" : "Inactive",
      isNewEmployee: person.isNewEmployee,
      notes: person.notes,
    });
    setStaffModalError("");
    setStaffModalOpen(true);
  }

  function closeStaffModal() {
    setStaffModalOpen(false);
    setStaffDraft(null);
    setStaffModalError("");
  }

  function handleUpdateStaffDraft() {
    if (!staffDraft) return;
    const allowedDepartments = new Set([
      "Physics",
      "Mathematics & Statistics",
      "Computer Science & Software Engineering",
      "Senior School Coordinator",
    ]);
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!/^\d{8}$/.test(staffDraft.staffId.trim())) {
      setStaffModalError("staff_id must be exactly 8 digits.");
      return;
    }
    if (!staffDraft.firstName.trim() || !staffDraft.lastName.trim()) {
      setStaffModalError("first_name and last_name are required.");
      return;
    }
    if (!emailPattern.test(staffDraft.email.trim())) {
      setStaffModalError("email format is invalid.");
      return;
    }
    if (!allowedDepartments.has(staffDraft.department.trim())) {
      setStaffModalError("department must be one of the 4 allowed schools.");
      return;
    }
    if (staffDraft.isActive !== "Active" && staffDraft.isActive !== "Inactive") {
      setStaffModalError("Active Status must be Active or Inactive.");
      return;
    }

    const updatedPerson: AssignablePerson = {
      id: staffDraft.id,
      staffId: staffDraft.staffId.trim(),
      firstName: staffDraft.firstName.trim(),
      lastName: staffDraft.lastName.trim(),
      email: staffDraft.email.trim(),
      title: staffDraft.title.trim(),
      currentDepartment: staffDraft.department.trim(),
      isActive: staffDraft.isActive === "Active",
      isNewEmployee: staffDraft.isNewEmployee,
      notes: staffDraft.notes.trim(),
    };

    setAssignablePeople((prev) => prev.map((person) => (person.id === updatedPerson.id ? updatedPerson : person)));
    if (selectedPerson?.id === updatedPerson.id) {
      setSelectedPerson(updatedPerson);
      if (availableDepartments.includes(updatedPerson.currentDepartment as AssignDepartment)) {
        setAssignDepartment(updatedPerson.currentDepartment as AssignDepartment);
      }
    }
    setImportMessage(`Updated staff profile for ${updatedPerson.firstName} ${updatedPerson.lastName}.`);
    closeStaffModal();
  }

  async function handleDownloadTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("staff_import_template");

    worksheet.columns = [
      { header: "staff_id", key: "staff_id", width: 14 },
      { header: "first_name", key: "first_name", width: 16 },
      { header: "last_name", key: "last_name", width: 16 },
      { header: "email", key: "email", width: 28 },
      { header: "title", key: "title", width: 18 },
      { header: "department", key: "department", width: 40 },
      { header: "active_status", key: "active_status", width: 16 },
      { header: "is_new_employee", key: "is_new_employee", width: 18 },
      { header: "notes", key: "notes", width: 52 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
        bottom: { style: "thin" },
      };
    });

    worksheet.addRow({
      staff_id: "50199999",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane.doe@uwa.edu.au",
      title: "Lecturer",
      department: "Physics",
      active_status: "Active",
      is_new_employee: "false",
      notes: "",
    });

    // Apply data validation to a practical import range.
    for (let row = 2; row <= 1000; row += 1) {
      worksheet.getCell(`A${row}`).dataValidation = {
        type: "custom",
        allowBlank: false,
        formulae: [`AND(ISNUMBER(A${row}),LEN(A${row}&\"\")=8)`],
        showErrorMessage: true,
        errorTitle: "Invalid staff_id",
        error: "staff_id must be exactly 8 digits.",
      };
      worksheet.getCell(`B${row}`).dataValidation = {
        type: "custom",
        allowBlank: false,
        formulae: [`LEN(TRIM(B${row}))>0`],
        showErrorMessage: true,
        errorTitle: "Missing first_name",
        error: "first_name is required.",
      };
      worksheet.getCell(`C${row}`).dataValidation = {
        type: "custom",
        allowBlank: false,
        formulae: [`LEN(TRIM(C${row}))>0`],
        showErrorMessage: true,
        errorTitle: "Missing last_name",
        error: "last_name is required.",
      };
      worksheet.getCell(`D${row}`).dataValidation = {
        type: "custom",
        allowBlank: false,
        formulae: [
          `AND(ISNUMBER(SEARCH("@",D${row})),ISNUMBER(SEARCH(".",D${row})),FIND("@",D${row})>1,FIND("@",D${row})<LEN(D${row}))`,
        ],
        showErrorMessage: true,
        errorTitle: "Invalid email",
        error: "Please enter a valid email format.",
      };
      worksheet.getCell(`F${row}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Physics,Mathematics & Statistics,Computer Science & Software Engineering,Senior School Coordinator"'],
        showErrorMessage: true,
        errorTitle: "Invalid department",
        error:
          "Department must be one of: Physics, Mathematics & Statistics, Computer Science & Software Engineering, Senior School Coordinator.",
      };
      worksheet.getCell(`G${row}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"Active,Inactive"'],
        showErrorMessage: true,
        errorTitle: "Invalid Active Status",
        error: "Active Status must be Active or Inactive.",
      };
      worksheet.getCell(`H${row}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: "Invalid is_new_employee",
        error: "Use true or false — leave blank for false.",
      };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Staff_Template.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleOpenImport() {
    fileInputRef.current?.click();
  }

  function parseActiveStatus(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "active" || normalized === "yes" || normalized === "true") return true;
    if (normalized === "inactive" || normalized === "no" || normalized === "false") return false;
    return null;
  }

  function parseIsNewEmployee(value: unknown): boolean {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return false;
    if (raw === "false" || raw === "no" || raw === "n" || raw === "0") return false;
    return raw === "true" || raw === "yes" || raw === "y" || raw === "1";
  }

  function handleImportTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const allowedDepartments = new Set([
          "Physics",
          "Mathematics & Statistics",
          "Computer Science & Software Engineering",
          "Senior School Coordinator",
        ]);
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const binary = reader.result;
        const workbook = XLSX.read(binary, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });

        if (rows.length === 0) {
          setImportMessage("Import failed: file is empty.");
          return;
        }

        const parsed: AssignablePerson[] = [];
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          const staffId = String(row.staff_id ?? "").trim();
          const firstName = String(row.first_name ?? "").trim();
          const lastName = String(row.last_name ?? "").trim();
          const email = String(row.email ?? "").trim();
          const title = String(row.title ?? "").trim();
          const department = String(row.department ?? "").trim();
          const isActiveRaw = String(row.active_status ?? row.is_active ?? "").trim();
          const isActive = parseActiveStatus(isActiveRaw);
          const isNewEmployee = parseIsNewEmployee(row.is_new_employee ?? row.new_employee);
          const notes = String(row.notes ?? "").trim();
          const rowNumber = i + 2;

          if (!/^\d{8}$/.test(staffId)) {
            setImportMessage(`Import failed: row ${rowNumber} staff_id must be exactly 8 digits.`);
            return;
          }
          if (!firstName) {
            setImportMessage(`Import failed: row ${rowNumber} first_name is required.`);
            return;
          }
          if (!lastName) {
            setImportMessage(`Import failed: row ${rowNumber} last_name is required.`);
            return;
          }
          if (!emailPattern.test(email)) {
            setImportMessage(`Import failed: row ${rowNumber} email format is invalid.`);
            return;
          }
          if (!allowedDepartments.has(department)) {
            setImportMessage(`Import failed: row ${rowNumber} department must be one of the 4 allowed schools.`);
            return;
          }
          if (isActive === null) {
            setImportMessage(`Import failed: row ${rowNumber} Active Status must be Active or Inactive.`);
            return;
          }

          parsed.push({
            id: i + 1,
            staffId,
            firstName,
            lastName,
            email,
            title,
            currentDepartment: department,
            isActive,
            isNewEmployee,
            notes,
          });
        }

        setAssignablePeople(parsed);
        setSelectedPerson(null);
        setImportMessage(`Imported ${parsed.length} staff records from Staff_Template.xlsx.`);
      } catch {
        setImportMessage("Import failed: please upload a valid .xlsx template file.");
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = "";
  }

  function handleAssignRole() {
    if (!selectedPerson) {
      setAssignMessage("Please select a person first.");
      return;
    }
    if (selectedPermissions.length === 0) {
      setAssignMessage("Please select at least one permission.");
      return;
    }
    const now = new Date();
    const assignedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const next: RoleAssignment = {
      id: Date.now(),
      staffId: selectedPerson.staffId,
      email: selectedPerson.email,
      name: `${selectedPerson.firstName} ${selectedPerson.lastName}`,
      role: assignRole,
      department: assignDepartment,
      permissions: selectedPermissions,
      assignedAt,
      status: "active",
    };
    setRoleAssignments((prev) => [next, ...prev]);
    setAssignMessage(`Assigned ${assignRole} role to ${next.name} (${assignDepartment}).`);
  }

  function requestCancelPermission(assignmentId: number) {
    setCancelTargetId(assignmentId);
    setCancelConfirmOpen(true);
  }

  function confirmCancelPermission() {
    if (cancelTargetId === null) return;
    setRoleAssignments((prev) =>
      prev.map((item) => {
        if (item.id !== cancelTargetId) return item;
        setAssignMessage(`Disabled ${item.role} permission for ${item.name}.`);
        return { ...item, status: "disabled" };
      })
    );
    setCancelConfirmOpen(false);
    setCancelTargetId(null);
  }

  function closeCancelConfirm() {
    setCancelConfirmOpen(false);
    setCancelTargetId(null);
  }

  function openDetails(item: MockRequest) {
    if (item.cancelled) {
      setSupersededNoticeOpen(true);
      return;
    }
    setDetailsItem(item);
    setDetailsBreakdown(breakdownById(item.id));
    setDetailsOpen(true);
    setDetailsEditMode(false);
    setDescriptionExpanded(false);
    setDetailsModalError("");
  }

  function requestCloseDetails() {
    if (detailsEditMode && detailsBreakdown) {
      const hasEmptyRow = (Object.keys(detailsBreakdown) as BreakdownCategory[]).some((tab) =>
        detailsBreakdown[tab].some((row) => row.name.trim() === "")
      );
      if (hasEmptyRow) {
        setDetailsModalError("Empty breakdown rows must be completed or deleted before closing.");
        return;
      }
    }
    closeDetails();
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsItem(null);
    setDetailsBreakdown(null);
    setDetailsEditMode(false);
    setDetailsModalError("");
    setNoteModalOpen(false);
    setNoteDraft("");
    setNoteError("");
    setNoteTargetId(null);
  }

  function updateBreakdownRow(tab: BreakdownCategory, idx: number, field: "name" | "hours", value: string) {
    setDetailsModalError("");
    setDetailsBreakdown((prev) => {
      if (!prev) return prev;
      const nextRows = prev[tab].map((row, rowIdx) => {
        if (rowIdx !== idx) return row;
        if (field === "name") return { ...row, name: value };
        const parsedHours = Number.parseFloat(value);
        const normalizedHours = Number.isFinite(parsedHours) ? parsedHours : 0;
        return { ...row, hours: normalizedHours };
      });
      return { ...prev, [tab]: nextRows };
    });
  }

  function addBreakdownRow(tab: BreakdownCategory) {
    setDetailsModalError("");
    setDetailsBreakdown((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [tab]: [...prev[tab], { name: "", hours: 0 }],
      };
    });
  }

  function removeBreakdownRow(tab: BreakdownCategory, idx: number) {
    setDetailsModalError("");
    setDetailsBreakdown((prev) => {
      if (!prev) return prev;
      const currentRows = prev[tab];
      if (currentRows.length <= 1) return prev;
      return {
        ...prev,
        [tab]: currentRows.filter((_, rowIdx) => rowIdx !== idx),
      };
    });
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  }

  function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") setAvatarSrc(result);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] font-serif">
      <div className="mx-auto max-w-7xl px-3 pb-10 pt-8">
        <DashboardHeader
          title="HoS Dashboard"
          hasNewMessage={hosUnreadReportCount > 0}
          onMessageClick={() => setHosReportInboxOpen(true)}
          greetingName={user.surname}
          onAvatarClick={() => setProfileOpen(true)}
          avatarSrc={avatarSrc}
        />

        {hosReportInboxOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
            onClick={() => setHosReportInboxOpen(false)}
          >
            <div
              className="w-full max-w-3xl rounded-2xl border-2 border-[#2f4d9c] bg-slate-50 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between rounded-t-2xl bg-[#2f4d9c] px-6 py-4 text-white">
                <div className="text-2xl font-semibold">Semester Distribution Reports</div>
                <button
                  type="button"
                  aria-label="Close report inbox"
                  className="rounded p-1 text-white/90 hover:bg-white/20"
                  onClick={() => setHosReportInboxOpen(false)}
                >
                  ✕
                </button>
              </div>
              {hosSemesterReports.length === 0 ? (
                <div className="rounded-md border border-[#2f4d9c]/30 bg-white px-4 py-5 text-sm text-slate-700">
                  No semester report generated yet.
                </div>
              ) : (
                <>
                  <div className="max-h-80 overflow-y-auto rounded-md border border-[#2f4d9c]/40 bg-white">
                    {pagedHosReports.map((report) => (
                      <div
                        key={report.id}
                        className="flex items-center justify-between gap-3 border-b border-[#2f4d9c]/10 px-4 py-3"
                      >
                        <div className="text-sm font-semibold text-slate-800">{report.title}</div>
                        <button
                          type="button"
                          onClick={() => handleDownloadHosSemesterReport(report)}
                          className="inline-flex items-center gap-2 rounded border border-[#2f4d9c]/40 bg-[#eef3ff] px-3 py-1 text-xs font-semibold text-[#2f4d9c] hover:bg-[#e0e9ff]"
                        >
                          ⬇ Download
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between px-1 text-sm">
                    <button
                      type="button"
                      onClick={() => setHosReportInboxPage((p) => Math.max(1, p - 1))}
                      disabled={hosReportInboxPage <= 1}
                      className="rounded border border-[#2f4d9c]/35 bg-[#eef3ff] px-3 py-1 font-semibold text-[#2f4d9c] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="text-slate-600">
                      Page {hosReportInboxPage} / {hosReportTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setHosReportInboxPage((p) => Math.min(hosReportTotalPages, p + 1))}
                      disabled={hosReportInboxPage >= hosReportTotalPages}
                      className="rounded border border-[#2f4d9c]/35 bg-[#eef3ff] px-3 py-1 font-semibold text-[#2f4d9c] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          avatarSrc={avatarSrc}
          onAvatarUpload={handleAvatarUpload}
          user={user}
        />

        <div className="mt-6 rounded-md bg-white p-4 shadow-sm">
          <SectionTabs
            tabs={sectionTabs}
            activeKey={activeSection}
            onChange={(key) => setActiveSection(key as "approval" | "admin" | "visualization" | "export")}
          />

          {activeSection === "approval" && (
            <div className="rounded-md bg-white p-4">
              {popup.open && (
                <div
                  className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                  onClick={() => setPopup((p) => ({ ...p, open: false }))}
                >
                  <div
                    className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between bg-[#2f4d9c] px-5 py-3 text-white">
                      <div className="text-lg font-extrabold">{popup.title}</div>
                      <button
                        type="button"
                        aria-label="Close"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20"
                        onClick={() => setPopup((p) => ({ ...p, open: false }))}
                      >
                        <span className="text-xl leading-none">×</span>
                      </button>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-base text-slate-800">{popup.message}</div>
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setStatusFilter("pending");
                            setSelectedIds(new Set());
                            setPage(1);
                            setDetailsOpen(false);
                            setDetailsItem(null);
                            setPopup((p) => ({ ...p, open: false }));
                          }}
                          className={`rounded-md px-5 py-2 text-sm font-semibold text-white hover:brightness-95 ${
                            popup.status === "approved"
                              ? "bg-[#16a34a]"
                              : popup.status === "rejected"
                                ? "bg-[#dc2626]"
                                : "bg-[#d97706]"
                          }`}
                        >
                          {popup.status === "approved"
                            ? "Approval Completed"
                            : popup.status === "rejected"
                              ? "Rejection Completed"
                              : "Back to Pending List"}
                        </button>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-[#2f4d9c]" />
                  </div>
                </div>
              )}

              <div className="rounded-md bg-[#f4f7ff] p-4">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Name</div>
                    <input
                      value={searchNameInput}
                      onChange={(e) => setSearchNameInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      placeholder="Last name, first name, or full name"
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Staff ID</div>
                    <input
                      value={searchEmployeeIdInput}
                      onChange={(e) => setSearchEmployeeIdInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="rounded border border-slate-300 px-3 py-2 text-sm tabular-nums font-sans"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Department</div>
                    <select
                      value={searchDepartmentInput}
                      onChange={(e) => setSearchDepartmentInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">All departments</option>
                      {WORKLOAD_SEARCH_DEPARTMENT_OPTIONS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 items-end gap-6 md:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Year & Semester</div>
                    <div className="flex w-full min-w-0 items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        list="hos-workload-year-options"
                        value={searchYearInput}
                        onChange={(e) => setSearchYearInput(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-2 text-sm"
                        placeholder="Year"
                      />
                      <datalist id="hos-workload-year-options">
                        {yearOptions.map((year) => (
                          <option key={year} value={year} />
                        ))}
                      </datalist>
                      <select
                        value={searchSemesterInput}
                        onChange={(e) => setSearchSemesterInput(e.target.value as "" | "S1" | "S2")}
                        onKeyDown={handleSearchKeyDown}
                        className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-2 text-sm"
                      >
                        <option value="">All semesters</option>
                        <option value="S1">S1</option>
                        <option value="S2">S2</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-end justify-center md:justify-self-center">
                    <SearchButton onClick={handleSearch} />
                  </div>
                  <span className="hidden md:block" aria-hidden />
                </div>
              </div>

              <div className="mt-6 text-lg font-semibold text-slate-700">Workload Report Sem 1 - 2025</div>
              <div className="mt-6 rounded-md bg-[#f4f7ff] p-4">
                <div className="mb-4 flex flex-wrap items-center justify-start gap-5">
                  <div className="text-base font-semibold text-[#2f4d9c]">Status Filter:</div>
                  <div className="flex flex-wrap items-center justify-start gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter("all");
                        setSelectedIds(new Set());
                        setPage(1);
                        setDetailsOpen(false);
                        setDetailsItem(null);
                      }}
                      className={`rounded-md border px-5 py-2 text-base font-semibold ${
                        statusFilter === "all"
                          ? "border-[#2f4d9c] bg-[#2f4d9c] text-white"
                          : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                      }`}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter("pending");
                        setSelectedIds(new Set());
                        setPage(1);
                        setDetailsOpen(false);
                        setDetailsItem(null);
                      }}
                      className={`relative rounded-md border px-5 py-2 text-base font-semibold ${
                        statusFilter === "pending"
                          ? "border-[#d97706] bg-[#d97706] text-white"
                          : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                      }`}
                    >
                      Pending
                      {pendingCount > 0 && (
                        <span className="pointer-events-none absolute -right-2 -top-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#d97706] text-[10px] font-bold leading-none text-white">
                          !
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter("approved");
                        setSelectedIds(new Set());
                        setPage(1);
                        setDetailsOpen(false);
                        setDetailsItem(null);
                      }}
                      className={`rounded-md border px-5 py-2 text-base font-semibold ${
                        statusFilter === "approved"
                          ? "border-[#16a34a] bg-[#16a34a] text-white"
                          : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                      }`}
                    >
                      Approved
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter("rejected");
                        setSelectedIds(new Set());
                        setPage(1);
                        setDetailsOpen(false);
                        setDetailsItem(null);
                      }}
                      className={`rounded-md border px-5 py-2 text-base font-semibold ${
                        statusFilter === "rejected"
                          ? "border-[#dc2626] bg-[#dc2626] text-white"
                          : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                      }`}
                    >
                      Rejected
                    </button>
                  </div>
                </div>

                <div className="max-h-[460px] overflow-x-auto overflow-y-auto pr-1">
                  <table className="min-w-full border-separate border-spacing-y-0">
                    <thead>
                      <tr className="text-left text-sm font-extrabold uppercase tracking-wide text-slate-700">
                        <th className="w-10 px-2 py-2"></th>
                        <th className="w-14 px-2 py-2">Task</th>
                        <th className="px-3 py-2">NAME</th>
                        <th className="px-3 py-2">TITLE</th>
                        <th className="w-[180px] px-3 py-2">REASONS</th>
                        <th className="px-3 py-2">DEPARTMENT</th>
                        <th className="px-3 py-2">STATUS</th>
                        <th className="px-3 py-2 text-center">TOTAL WORK HOURS</th>
                        <th className="px-3 py-2 text-right">SUBMITTED TIME</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {loading && (
                        <tr>
                          <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                            Loading...
                          </td>
                        </tr>
                      )}
                      {!loading && pageItems.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                            {statusFilter === "pending" ? "No pending requests" : "No items found"}
                          </td>
                        </tr>
                      )}
                      {!loading &&
                        pageItems.map((item, idx) => {
                          const isSelected = selectedIds.has(item.id);
                          const rowCancelled = Boolean(item.cancelled);
                          const rowIndex = (page - 1) * pageSize + idx + 1;
                          return (
                            <tr
                              key={item.id}
                              className={`text-sm ${
                                rowCancelled
                                  ? "cursor-not-allowed bg-slate-100 text-slate-400 opacity-80"
                                  : `cursor-pointer hover:bg-slate-50 ${
                                      isSelected ? "border-l-4 border-[#2f4d9c] bg-[#e9f2ff]" : ""
                                    }`
                              }`}
                              onClick={() => openDetails(item)}
                            >
                              <td className="px-2 py-3">
                                {statusFilter === "pending" ? (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleSelected(item.id);
                                    }}
                                    className="h-4 w-4 accent-[#2f4d9c]"
                                  />
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={false}
                                    disabled
                                    className="h-4 w-4 accent-[#2f4d9c] opacity-40"
                                  />
                                )}
                              </td>
                              <td className="px-2 py-3 text-center text-sm tabular-nums font-sans text-slate-600">
                                {rowIndex}
                              </td>
                              <td className="px-3 py-3 font-medium text-slate-700">
                                <div>{item.name}</div>
                                <div className="text-xs text-slate-400">{item.studentId}</div>
                              </td>
                              <td className="px-3 py-3 text-slate-700">{item.title}</td>
                              <td className="px-3 py-3 text-slate-600">
                                <div
                                  className="max-w-[180px] truncate"
                                  title={requestReasonText(item) || "No reason provided"}
                                >
                                  {requestReasonText(item) || "—"}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-slate-600">{item.department || "—"}</td>
                              <td className="px-3 py-3">
                                <StatusPill status={item.status} variant="supervisor" />
                              </td>
                              <td className="px-3 py-3 text-center">
                                <WorkHoursBadge hours={item.hours} />
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums font-sans font-semibold text-slate-800">
                                {submittedTimeById(item.id)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={page}
                  totalPages={totalPages}
                  onPrev={() => setPage((p) => Math.max(1, p - 1))}
                  onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disablePrev={page <= 1 || submitting}
                  disableNext={page >= totalPages || submitting}
                />
              </div>

              {detailsOpen && detailsItem && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                  onClick={requestCloseDetails}
                >
                  <div
                    className="w-full max-w-2xl rounded-sm bg-white p-0 shadow"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="rounded-sm border border-black">
                      <div className="flex items-center justify-between gap-4 border-b border-black/30 bg-white px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="rounded-sm bg-[#2f4d9c] px-4 py-2 text-sm font-bold text-white tabular-nums font-sans">
                            {(() => {
                              const matched = detailsItem.periodLabel.match(/^(\d{4})-(1|2)$/);
                              if (!matched) return `${detailsItem.periodLabel}-${detailsItem.department}`;
                              return `${matched[1]}-${matched[2] === "1" ? "S1" : "S2"}-${detailsItem.department}`;
                            })()}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-sm font-semibold text-slate-800">
                          <button
                            type="button"
                            onClick={requestCloseDetails}
                            className="rounded bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-300"
                          >
                            Close
                          </button>
                        </div>
                      </div>

                      <form className="space-y-4 px-6 py-5" onSubmit={(e) => e.preventDefault()}>
                        <div className="grid grid-cols-2 gap-5">
                          <div className="flex items-center gap-3">
                            <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                              Name
                            </div>
                            <input readOnly value={detailsItem.name} className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base" />
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                              Staff ID
                            </div>
                            <input readOnly value={detailsItem.studentId} className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base" />
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                              Target teaching ratio
                            </div>
                            <input readOnly value="50.0%" className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base" />
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                              Actual teaching ratio
                            </div>
                            {(() => {
                              const source = detailsBreakdown ?? breakdownById(detailsItem.id);
                              const teaching = source.Teaching.reduce((sum, row) => sum + row.hours, 0);
                              const total = (["Teaching", "Assigned Roles", "HDR", "Service", "Research (residual)"] as BreakdownCategory[]).reduce(
                                (tabSum, tab) => tabSum + source[tab].reduce((sum, row) => sum + row.hours, 0),
                                0
                              );
                              const ratio = total <= 0 ? "0.0%" : `${((teaching / total) * 100).toFixed(1)}%`;
                              return (
                                <input readOnly value={ratio} className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base tabular-nums font-sans" />
                              );
                            })()}
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                              Total work hours
                            </div>
                            {(() => {
                              const totalHours = detailsBreakdown
                                ? (["Teaching", "Assigned Roles", "HDR", "Service", "Research (residual)"] as BreakdownCategory[]).reduce(
                                    (tabSum, tab) => tabSum + detailsBreakdown[tab].reduce((sum, row) => sum + row.hours, 0),
                                    0
                                  )
                                : detailsItem.hours;
                              return (
                                <input readOnly value={totalHours} className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base tabular-nums font-sans" />
                              );
                            })()}
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                              Employment type
                            </div>
                            {(() => {
                              const totalHours = detailsBreakdown
                                ? (["Teaching", "Assigned Roles", "HDR", "Service", "Research (residual)"] as BreakdownCategory[]).reduce(
                                    (tabSum, tab) => tabSum + detailsBreakdown[tab].reduce((sum, row) => sum + row.hours, 0),
                                    0
                                  )
                                : detailsItem.hours;
                              return (
                                <input readOnly value={totalHours >= 800 ? "Full-time" : "Part-time"} className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base" />
                              );
                            })()}
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                              New Staff
                            </div>
                            <input readOnly value="No" className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base" />
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                              HoD Review
                            </div>
                            <input readOnly value="No" className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base" />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold uppercase text-slate-700">Workload Breakdown</div>
                            <button
                              type="button"
                              onClick={() => {
                                setDetailsEditMode((v) => !v);
                                setDetailsModalError("");
                              }}
                              className="rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white hover:bg-[#264183]"
                            >
                              {detailsEditMode ? "Done" : "Edit"}
                            </button>
                          </div>
                          <div className="mt-2 overflow-hidden rounded-sm border border-slate-300">
                            <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                              {(["Teaching", "Assigned Roles", "HDR", "Service", "Research (residual)"] as BreakdownCategory[]).map((tab) => (
                                <button
                                  key={tab}
                                  type="button"
                                  onClick={() => setDetailsTab(tab)}
                                  className={`rounded px-3 py-1 text-xs font-semibold ${
                                    detailsTab === tab
                                      ? "bg-[#2f4d9c] text-white"
                                      : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
                                  }`}
                                >
                                  {tab}
                                </button>
                              ))}
                            </div>
                            <table className="min-w-full">
                              <thead className="bg-white">
                                <tr className="text-left text-xs font-semibold uppercase text-slate-600">
                                  <th className="px-3 py-2">{detailsTab}</th>
                                  <th className="w-[120px] px-3 py-2 text-right">Hours</th>
                                  {detailsEditMode ? <th className="w-[88px] px-3 py-2 text-center">Action</th> : null}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 bg-white text-sm text-slate-700">
                                {(detailsBreakdown?.[detailsTab] ?? breakdownById(detailsItem.id)[detailsTab]).map((row, idx) => (
                                  <tr key={`${detailsItem.id}-${detailsTab}-${idx}`}>
                                    <td className="px-3 py-2">
                                      {detailsEditMode ? (
                                        <input
                                          value={row.name}
                                          onChange={(e) => updateBreakdownRow(detailsTab, idx, "name", e.target.value)}
                                          maxLength={60}
                                          className="w-[240px] max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-sm"
                                        />
                                      ) : (
                                        <span className="block px-1 py-1">{row.name}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      {detailsEditMode ? (
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          maxLength={8}
                                          value={String(row.hours)}
                                          onChange={(e) => updateBreakdownRow(detailsTab, idx, "hours", e.target.value)}
                                          className="ml-auto w-24 rounded border border-slate-300 px-2 py-1 text-right tabular-nums font-sans text-sm"
                                        />
                                      ) : (
                                        <div className="text-right tabular-nums font-sans">{row.hours}</div>
                                      )}
                                    </td>
                                    {detailsEditMode ? (
                                      <td className="px-3 py-2 text-center">
                                        <button
                                          type="button"
                                          onClick={() => removeBreakdownRow(detailsTab, idx)}
                                          className="rounded bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                                          disabled={(detailsBreakdown?.[detailsTab] ?? []).length <= 1}
                                        >
                                          Delete
                                        </button>
                                      </td>
                                    ) : null}
                                  </tr>
                                ))}
                                {detailsEditMode ? (
                                  <tr>
                                    <td colSpan={3} className="px-3 py-2">
                                      <button
                                        type="button"
                                        onClick={() => addBreakdownRow(detailsTab)}
                                        className="rounded bg-[#2f4d9c] px-3 py-1 text-xs font-semibold text-white hover:bg-[#264183]"
                                      >
                                        + Add Row
                                      </button>
                                    </td>
                                  </tr>
                                ) : null}
                                <tr className="bg-slate-50">
                                  <td className="px-3 py-2 font-semibold">Total</td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums font-sans">
                                    {(detailsBreakdown?.[detailsTab] ?? breakdownById(detailsItem.id)[detailsTab]).reduce(
                                      (sum, row) => sum + row.hours,
                                      0
                                    )}
                                  </td>
                                  {detailsEditMode ? <td /> : null}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div>
                          <button
                            type="button"
                            onClick={() => setDescriptionExpanded((v) => !v)}
                            className="flex w-full items-center justify-between rounded-sm border border-slate-300 bg-slate-50 px-3 py-2 text-left text-sm font-semibold uppercase text-slate-700"
                          >
                            <span>School of Operations notes</span>
                            <span className="text-base leading-none">{descriptionExpanded ? "−" : "+"}</span>
                          </button>
                          {descriptionExpanded && (
                            <textarea
                              readOnly
                              value={workloadModalNotes(detailsItem)}
                              className="mt-2 h-28 w-full resize-none rounded-sm border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
                            />
                          )}
                        </div>

                        <div>
                          <div className="text-sm font-semibold text-slate-700">Application Reason</div>
                          <textarea
                            readOnly
                            value={requestReasonText(detailsItem) || "- no reason provided -"}
                            className="mt-2 h-24 w-full resize-none rounded-sm border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
                          />
                        </div>
                        {detailsModalError && (
                          <div className="text-sm font-semibold text-[#dc2626]">{detailsModalError}</div>
                        )}

                        {detailsItem.status === "pending" && (
                          <div className="flex items-center justify-center gap-24 pt-2">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => openNoteModal("approve", detailsItem.id)}
                              className="w-56 rounded-sm bg-[#4a9a3d] py-3 text-center text-lg font-semibold text-white shadow-sm disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => openNoteModal("reject", detailsItem.id)}
                              className="w-56 rounded-sm bg-[#e53935] py-3 text-center text-lg font-semibold text-white shadow-sm disabled:opacity-60"
                            >
                              Decline
                            </button>
                          </div>
                        )}
                      </form>
                    </div>
                  </div>
                </div>
              )}

              {noteModalOpen && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-lg rounded-md bg-white shadow-lg">
                    <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
                      <div className="text-base font-bold">
                        {noteDecision === "approve" ? "Approved Notes" : "Rejected Notes"}
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-white/10 text-lg hover:bg-white/20"
                        onClick={() => {
                          setNoteModalOpen(false);
                          setNoteError("");
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="space-y-3 p-5">
                      <div className="text-sm font-semibold text-slate-700">Notes for Academic</div>
                      <textarea
                        value={noteDraft}
                        onChange={(e) => {
                          setNoteDraft(e.target.value);
                          if (noteError) setNoteError("");
                        }}
                        maxLength={240}
                        placeholder="Write your feedback..."
                        className="h-32 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2f4d9c]"
                      />
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{noteError ? <span className="text-[#dc2626]">{noteError}</span> : " "}</span>
                        <span>{noteDraft.length}/240</span>
                      </div>
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={handleFinishNote}
                          className="rounded bg-[#2f4d9c] px-6 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                        >
                          Finished
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === "admin" && (
            <div className="rounded-md bg-white p-8">
              <SectionTitleBlock
                title="Permission Assignment"
                description="Search staff members, choose one of three schools, and assign HoD/Admin permissions."
                rightSlot={
                  <TemplateImportExportActions
                    onDownload={handleDownloadTemplate}
                    onOpenImport={handleOpenImport}
                    fileInputRef={fileInputRef}
                    onImportChange={handleImportTemplate}
                  />
                }
              />
              {importMessage && <div className="mt-3 text-sm font-semibold text-[#2f4d9c]">{importMessage}</div>}

              <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4">
                <FilterFormRow
                  fields={[
                    {
                      key: "lastName",
                      label: "Last name",
                      input: (
                        <input
                          value={adminSearchLastNameInput}
                          onChange={(e) => setAdminSearchLastNameInput(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAdminSearch();
                            }
                          }}
                        />
                      ),
                    },
                    {
                      key: "firstName",
                      label: "First name",
                      input: (
                        <input
                          value={adminSearchFirstNameInput}
                          onChange={(e) => setAdminSearchFirstNameInput(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAdminSearch();
                            }
                          }}
                        />
                      ),
                    },
                    {
                      key: "staffId",
                      label: "Staff ID",
                      input: (
                        <input
                          value={adminSearchStaffIdInput}
                          onChange={(e) => setAdminSearchStaffIdInput(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums font-sans"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAdminSearch();
                            }
                          }}
                        />
                      ),
                    },
                  ]}
                  action={
                    <button
                      type="button"
                      onClick={handleAdminSearch}
                      className="w-24 rounded bg-[#2f4d9c] px-5 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                    >
                      Search
                    </button>
                  }
                />

                <div className="mt-4 max-h-52 overflow-y-auto rounded border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left">Staff ID</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Title</th>
                        <th className="px-3 py-2 text-left">Department</th>
                        <th className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminSearchResults.map((person) => (
                        <tr
                          key={person.id}
                          className={`border-t border-slate-100 ${
                            person.isActive ? "cursor-pointer hover:bg-slate-50" : "bg-slate-100/70 text-slate-400"
                          }`}
                          onClick={() => openStaffModal(person)}
                        >
                          <td className="px-3 py-2 tabular-nums font-sans">{person.staffId}</td>
                          <td className="px-3 py-2">
                            {person.firstName} {person.lastName}
                          </td>
                          <td className="px-3 py-2">{person.title || "-"}</td>
                          <td className="px-3 py-2">{person.currentDepartment || "-"}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!person.isActive) return;
                                setSelectedPerson(person);
                                if (availableDepartments.includes(person.currentDepartment as AssignDepartment)) {
                                  setAssignDepartment(person.currentDepartment as AssignDepartment);
                                }
                                setAssignMessage("");
                              }}
                              disabled={!person.isActive}
                              className={`rounded px-3 py-1 text-xs font-semibold ${
                                !person.isActive
                                  ? "cursor-not-allowed bg-slate-200 text-slate-400"
                                  : selectedPerson?.id === person.id
                                  ? "bg-[#2f4d9c] text-white"
                                  : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                              }`}
                            >
                              {selectedPerson?.id === person.id ? "Selected" : "Select"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <StaffProfileModal
                open={staffModalOpen}
                draft={staffDraft}
                departments={availableDepartments}
                error={staffModalError}
                onClose={closeStaffModal}
                onFieldChange={(field, value) => {
                  setStaffDraft((prev) => {
                    if (!prev) return prev;
                    if (field === "id") return prev;
                    return {
                      ...prev,
                      [field]: value,
                    };
                  });
                }}
                onUpdate={handleUpdateStaffDraft}
              />

              <div className="mt-6 rounded-md border border-slate-200 bg-white p-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Selected Person</div>
                    <div className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
                      {selectedPerson
                        ? `${selectedPerson.firstName} ${selectedPerson.lastName} (${selectedPerson.staffId})`
                        : "No person selected"}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Role</div>
                    <select
                      value={assignRole}
                      onChange={(e) => {
                        const nextRole = e.target.value as AssignRole;
                        setAssignRole(nextRole);
                        if (nextRole === "Admin") {
                          setAssignDepartment(adminBoundDepartment);
                          setBindingSource("role");
                        } else {
                          if (bindingSource === "role") setBindingSource(null);
                          if (assignDepartment === adminBoundDepartment) {
                            setAssignDepartment("Physics");
                          }
                        }
                      }}
                      disabled={isRoleLocked}
                      className={`w-full rounded border border-slate-300 px-3 py-2 text-sm ${
                        isRoleLocked ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""
                      }`}
                    >
                      <option value="HoD">HoD</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Department</div>
                    <select
                      value={assignDepartment}
                      onChange={(e) => {
                        const nextDepartment = e.target.value as AssignDepartment;
                        setAssignDepartment(nextDepartment);
                        if (selectedPerson) {
                          handlePersonDepartmentChange(selectedPerson.id, nextDepartment);
                        }
                        if (nextDepartment === adminBoundDepartment) {
                          setAssignRole("Admin");
                          setBindingSource("department");
                        } else {
                          if (bindingSource === "department") setBindingSource(null);
                          if (assignRole === "Admin") {
                            setAssignRole("HoD");
                          }
                        }
                      }}
                      disabled={isDepartmentLocked}
                      className={`w-full rounded border border-slate-300 px-3 py-2 text-sm ${
                        isDepartmentLocked ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""
                      }`}
                    >
                      {availableDepartments.map((department) => (
                        <option key={department} value={department}>
                          {department}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Permissions</div>
                  <div className="flex flex-wrap gap-2">
                    {availablePermissions.map((permission) => (
                      <span
                        key={permission}
                        className="rounded-full bg-[#2f4d9c] px-3 py-1 text-xs font-semibold text-white"
                      >
                        {permission}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-slate-600">{assignMessage || "Ready to assign permissions."}</div>
                  <button
                    type="button"
                    onClick={handleAssignRole}
                    className="rounded bg-[#2f4d9c] px-5 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                  >
                    Assign Permission
                  </button>
                </div>
              </div>

              <div className="mt-6 rounded-md border border-slate-200 bg-white p-4">
                <div className="mb-3 text-sm font-semibold uppercase text-slate-600">Assigned Roles</div>
                <div className="max-h-60 overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left">Staff</th>
                        <th className="px-3 py-2 text-left">Role</th>
                        <th className="px-3 py-2 text-left">Department</th>
                        <th className="px-3 py-2 text-left">Permissions</th>
                        <th className="px-3 py-2 text-center">Action</th>
                        <th className="px-3 py-2 text-right">Assigned At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roleAssignments.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                            No assignments yet.
                          </td>
                        </tr>
                      ) : (
                        roleAssignments.map((assignment) => (
                          <tr key={assignment.id} className="border-t border-slate-100">
                            <td className="px-3 py-2">
                              {assignment.name}
                              <div className="text-xs text-slate-500">{assignment.staffId}</div>
                            </td>
                            <td className="px-3 py-2">{assignment.role}</td>
                            <td className="px-3 py-2">{assignment.department}</td>
                            <td className="px-3 py-2">{assignment.permissions.join(", ")}</td>
                            <td className="px-3 py-2 text-center">
                              {assignment.status === "active" ? (
                                <button
                                  type="button"
                                  onClick={() => requestCancelPermission(assignment.id)}
                                  className="rounded bg-[#16a34a] px-3 py-1 text-xs font-semibold text-white hover:bg-[#15803d]"
                                >
                                  Active
                                </button>
                              ) : (
                                <span className="inline-flex rounded bg-[#dc2626] px-3 py-1 text-xs font-semibold text-white">
                                  Disabled
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-sans">{assignment.assignedAt}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {cancelConfirmOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-md rounded-md bg-white p-5 shadow-lg">
                    <div className="text-base font-semibold text-slate-800">Cancel this role permission?</div>
                    <div className="mt-5 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={closeCancelConfirm}
                        className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={confirmCancelPermission}
                        className="rounded bg-[#dc2626] px-4 py-2 text-sm font-semibold text-white hover:bg-[#b91c1c]"
                      >
                        Yes
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === "visualization" && (
            <div className="rounded-md bg-white p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="pt-3">
                  <div className="text-2xl font-semibold text-slate-800">Visualization</div>
                  <div className="mt-3 text-sm text-slate-600">
                    School-level and department-level workload analytics for HoS.
                  </div>
                </div>
                <div className="w-full max-w-[280px] rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Total Departments</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{schoolSummary.totalDepartments}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {filteredDepartmentStats.map((item) => (
                      <span
                        key={`header-dept-${item.department}`}
                        className={`whitespace-nowrap rounded-md px-2 py-1 font-semibold ${
                          item.department === "Computer Science & Software Engineering"
                            ? "bg-[#1f3b86] text-white"
                            : item.department === "Mathematics & Statistics"
                              ? "bg-[#4f75cf] text-white"
                              : "bg-[#a9c4f7] text-[#0f172a]"
                        }`}
                      >
                        {shortDepartmentName(item.department)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-2xl font-semibold text-[#2f4d9c]">Reporting Filter</div>
                    <div className="mt-3 text-sm text-[#2f4d9c]">
                      Select year and semester to update the reporting window for all charts.
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Year</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={visualYearFromInput}
                        onChange={(e) => setVisualYearFromInput(e.target.value)}
                        className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                        placeholder="From"
                      />
                      <span className="text-sm text-slate-500">to</span>
                      <input
                        type="number"
                        value={visualYearToInput}
                        onChange={(e) => setVisualYearToInput(e.target.value)}
                        className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                        placeholder="To"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Semester</div>
                    <select
                      value={visualSemesterInput}
                      onChange={(e) => setVisualSemesterInput(e.target.value as "All" | "S1" | "S2")}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      <option value="All">All</option>
                      <option value="S1">S1</option>
                      <option value="S2">S2</option>
                    </select>
                  </div>

                  <div>
                    <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                      Department
                    </div>
                    <select
                      value={visualDepartmentInput}
                      onChange={(e) => setVisualDepartmentInput(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      <option value="All Departments">All Departments</option>
                      {departmentStats.map((item) => (
                        <option key={item.department} value={item.department}>
                          {item.department}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleApplyVisualizationFilter}
                      className="w-full rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                    >
                      Apply
                    </button>
                  </div>
                </div>
                <div className="mt-3 text-sm font-semibold text-[#2f4d9c]">
                  For readability, the dashboard displays up to 3 full academic years at a time. You can export more
                  data in the Export Excel tab.
                </div>
                {visualFilterError && (
                  <div className="mt-3 text-sm font-semibold text-[#dc2626]">{visualFilterError}</div>
                )}
              </div>
              <div className="mt-3">
                <div className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-5 py-2 text-base text-slate-800 shadow-sm">
                  <span className="text-[#1e3a8a]">Reporting Period:</span>
                  <span className="rounded-md border border-[#93c5fd] bg-[#eff6ff] px-2.5 py-1 font-bold text-[#1e3a8a]">
                    {reportingPeriodLabel}
                  </span>
                  <span className="text-[#93c5fd]">|</span>
                  <span className="text-[#1e3a8a]">Scope:</span>
                  <span className="rounded-md border border-[#93c5fd] bg-[#eff6ff] px-2.5 py-1 font-bold text-[#1e3a8a]">
                    {scopeLabel}
                  </span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Total Academics</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{schoolSummary.totalAcademics}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.academics));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`acad-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.academics === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.academics}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Total Work Hours</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{schoolSummary.totalWorkHours}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.totalHours));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`hours-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.totalHours === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.totalHours}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Work Hours per Academic</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{averageWorkloadPerAcademicOverall}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(workloadPerAcademicByDepartment.map((item) => item.value));
                      return workloadPerAcademicByDepartment.map((item) => (
                        <span
                          key={`per-capita-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.value === top)}`}
                        >
                          {shortDepartmentName(item.department)}: {item.value}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Pending Requests</div>
                  <div className="mt-1 text-2xl font-bold text-[#d97706]">{schoolSummary.pendingRequests}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.pending));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`pend-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.pending === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.pending}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Approved Requests</div>
                  <div className="mt-1 text-2xl font-bold text-[#16a34a]">{schoolSummary.approvedRequests}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.approved));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`appr-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.approved === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.approved}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-[#1e3a8a]">Rejected Requests</div>
                  <div className="mt-1 text-2xl font-bold text-[#dc2626]">{schoolSummary.rejectedRequests}</div>
                  <div className="mt-2 flex flex-nowrap gap-1.5 text-xs">
                    {(() => {
                      const top = maxValue(filteredDepartmentStats.map((item) => item.rejected));
                      return filteredDepartmentStats.map((item) => (
                        <span
                          key={`rej-${item.department}`}
                          className={`whitespace-nowrap rounded-md px-2 py-1 ${departmentHighlightClass(item.department, item.rejected === top)}`}
                        >
                        {shortDepartmentName(item.department)}: {item.rejected}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
                <div className="h-[380px] rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-700">Department Total Workload</div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={totalWorkHoursByDepartment} margin={{ left: 8, right: 8, top: 8, bottom: 28 }}>
                        <CartesianGrid stroke="#cbd5e1" strokeOpacity={0.45} strokeDasharray="3 3" />
                        <XAxis dataKey="departmentShort" tick={chartTickStyle}>
                          <Label value="Department" offset={-5} position="insideBottomRight" style={axisLabelStyle} />
                        </XAxis>
                        <YAxis tick={chartTickStyle}>
                          <Label
                            value="Total Work Hours"
                            angle={-90}
                            position="insideLeft"
                            style={axisLabelStyle}
                          />
                        </YAxis>
                        <Tooltip
                          formatter={(value: number) => [`${value} hours`, ""]}
                          labelFormatter={(label: string) => label}
                          contentStyle={{ fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}
                          itemStyle={{ color: "#1e293b" }}
                        />
                        <Bar dataKey="totalWorkHours" radius={[4, 4, 0, 0]} barSize={30}>
                          {totalWorkHoursByDepartment.map((item) => (
                            <Cell
                              key={`total-${item.department}`}
                              fill={departmentColorMap[item.department] || "#1e3a8a"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="h-[380px] rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-700">Average Workload per Department</div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={averageWorkHoursByDepartment} margin={{ left: 24, right: 8, top: 8, bottom: 28 }}>
                        <CartesianGrid stroke="#cbd5e1" strokeOpacity={0.45} strokeDasharray="3 3" />
                        <XAxis dataKey="departmentShort" tick={chartTickStyle}>
                          <Label value="Department" offset={-5} position="insideBottomRight" style={axisLabelStyle} />
                        </XAxis>
                        <YAxis tick={chartTickStyle}>
                          <Label
                            value="Average Hours"
                            angle={-90}
                            position="insideLeft"
                            style={axisLabelStyle}
                          />
                        </YAxis>
                        <Tooltip
                          formatter={(value: number) => [`${value} hours`, ""]}
                          labelFormatter={(label: string) => label}
                          contentStyle={{ fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}
                          itemStyle={{ color: "#1e293b" }}
                        />
                        <Bar dataKey="averageWorkHours" radius={[4, 4, 0, 0]} barSize={30}>
                          {averageWorkHoursByDepartment.map((item) => (
                            <Cell
                              key={`avg-${item.department}`}
                              fill={departmentColorMap[item.department] || "#3b82f6"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="h-[380px] rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-700">Approval Progress by Department</div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={approvalStatusByDepartment} margin={{ left: 40, right: 8, top: 8, bottom: 28 }}>
                        <CartesianGrid stroke="#cbd5e1" strokeOpacity={0.45} strokeDasharray="3 3" />
                        <XAxis dataKey="departmentShort" tick={chartTickStyle}>
                          <Label value="Department" offset={-5} position="insideBottomRight" style={axisLabelStyle} />
                        </XAxis>
                        <YAxis tick={chartTickStyle}>
                          <Label
                            value="Records"
                            angle={-90}
                            position="insideLeft"
                            offset={12}
                            style={axisLabelStyle}
                          />
                        </YAxis>
                        <Tooltip
                          labelFormatter={(label: string) => label}
                          contentStyle={{ fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}
                        />
                        <Legend verticalAlign="top" align="right" wrapperStyle={legendStyle} />
                        <Bar dataKey="pending" name="Pending" stackId="status" fill="#f59e0b" barSize={30} />
                        <Bar dataKey="approved" name="Approved" stackId="status" fill="#22c55e" barSize={30} />
                        <Bar dataKey="rejected" name="Rejected" stackId="status" fill="#ef4444" barSize={30} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="h-[380px] rounded-md border border-slate-200 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-700">Department Workload Trend</div>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={filteredTrendData} margin={{ left: 8, right: 8, top: 8, bottom: 28 }}>
                        <CartesianGrid stroke="#cbd5e1" strokeOpacity={0.45} strokeDasharray="3 3" />
                        <XAxis dataKey="semester" tick={chartTickStyle}>
                          <Label value="Semester" offset={-5} position="insideBottomRight" style={axisLabelStyle} />
                        </XAxis>
                        <YAxis tick={chartTickStyle}>
                          <Label
                            value="Total Work Hours"
                            angle={-90}
                            position="insideLeft"
                            style={axisLabelStyle}
                          />
                        </YAxis>
                        <Tooltip
                          formatter={(value: number, name: string) => [`${value} hours`, name]}
                          contentStyle={{ fontSize: 12, fontFamily: "Inter, Arial, sans-serif" }}
                        />
                        <ReferenceLine
                          x={currentSemesterLabel}
                          stroke="#0f172a"
                          strokeOpacity={0.35}
                          strokeDasharray="4 4"
                          ifOverflow="extendDomain"
                        />
                        <Legend
                          verticalAlign="top"
                          align="right"
                          wrapperStyle={legendStyle}
                          formatter={(value: string) => {
                            if (value === "Computer Science & Software Engineering") return "CS&SE";
                            if (value === "Mathematics & Statistics") return "Math&Stats";
                            return value;
                          }}
                        />
                        {filteredDepartmentStats.map((item) => (
                          <Line
                            key={item.department}
                            type="monotone"
                            dataKey={item.department}
                            stroke={departmentColorMap[item.department] || "#1e3a8a"}
                            strokeWidth={2}
                            dot={(props: any) => {
                              const isCurrentSemester = props?.payload?.semester === currentSemesterLabel;
                              return (
                                <circle
                                  cx={props.cx}
                                  cy={props.cy}
                                  r={isCurrentSemester ? 6 : 3}
                                  fill={departmentColorMap[item.department] || "#1e3a8a"}
                                  stroke="#ffffff"
                                  strokeWidth={isCurrentSemester ? 2 : 1}
                                />
                              );
                            }}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "export" && (
            <div className="rounded-md bg-white p-8">
              <div className="text-2xl font-semibold text-slate-800">Export Excel</div>
              <div className="mt-3 text-sm text-slate-600">
                Configure optional filters to export more complete historical workload data to Excel.
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Year</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={exportYearFromInput}
                      onChange={(e) => setExportYearFromInput(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      placeholder="From"
                    />
                    <span className="text-sm text-slate-500">to</span>
                    <input
                      type="number"
                      value={exportYearToInput}
                      onChange={(e) => setExportYearToInput(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                      placeholder="To"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Semester</div>
                  <select
                    value={exportSemesterInput}
                    onChange={(e) => setExportSemesterInput(e.target.value as "All" | "S1" | "S2")}
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                  >
                    <option value="All">All</option>
                    <option value="S1">S1</option>
                    <option value="S2">S2</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                    Department
                  </div>
                  <select
                    value={exportDepartmentInput}
                    onChange={(e) => setExportDepartmentInput(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                  >
                    <option value="All Departments">All Departments</option>
                    {departmentStats.map((item) => (
                      <option key={`export-dept-${item.department}`} value={item.department}>
                        {item.department}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    type="button"
                    className="w-full rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                  >
                    Export Excel
                  </button>
                </div>
              </div>
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                If both years are blank, export all years. If only <span className="font-semibold">From</span> is
                blank, export from the earliest available year to <span className="font-semibold">To</span>. If only{" "}
                <span className="font-semibold">To</span> is blank, export from <span className="font-semibold">From</span>{" "}
                to the latest available year.
              </div>
            </div>
          )}
        </div>
      </div>

      <ThemedNoticeModal
        open={supersededNoticeOpen}
        onClose={() => setSupersededNoticeOpen(false)}
        message={SUPERSEDED_RECORD_MESSAGE}
      />
    </div>
  );
}
