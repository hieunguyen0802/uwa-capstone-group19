import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import DashboardHeader from "../components/common/DashboardHeader";
import LineMetricChartCard from "../components/common/LineMetricChartCard";
import PaginationControls from "../components/common/PaginationControls";
import ProfileModal from "../components/common/ProfileModal";
import ReportingFilterIntro from "../components/common/ReportingFilterIntro";
import ReportingPeriodBar from "../components/common/ReportingPeriodBar";
import SearchButton from "../components/common/SearchButton";
import SectionTabs from "../components/common/SectionTabs";
import StatusPill from "../components/common/StatusPill";
import VisualizationSummaryCards from "../components/common/VisualizationSummaryCards";
import ThemedNoticeModal, { SUPERSEDED_RECORD_MESSAGE } from "../components/common/ThemedNoticeModal";
import WorkHoursBadge from "../components/common/WorkHoursBadge";

type MockRequest = {
  id: number;
  sourceWorkloadId?: number;
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
  detailSnapshot?: {
    breakdown: BreakdownData;
  };
  supervisorNote?: string;
  /** When true (from API), row is read-only and detail is blocked — superseded by a newer version. */
  cancelled?: boolean;
};

type BreakdownCategory = "Teaching" | "Assigned Roles" | "HDR" | "Service" | "Research (residual)";
type BreakdownEntry = { name: string; hours: number };
type BreakdownData = Record<BreakdownCategory, BreakdownEntry[]>;

const SUPERVISOR_DRAFT_KEY = "academic_to_supervisor_requests_v1";
const SUPERVISOR_STATE_KEY = "supervisor_requests_state_v1";
const OPS_ACADEMIC_DISTRIBUTED_KEY = "ops_academic_distributed_workloads_v1";
const ACADEMIC_STATUS_SYNC_KEY = "academic_status_sync_v1";
const ACADEMIC_NOTES_SYNC_KEY = "academic_notes_sync_v1";
const SUPERVISOR_SYNC_EVENT = "supervisor-status-updated";
const ACADEMIC_DRAFT_EVENT = "academic-drafts-updated";
const HOD_ANNUAL_REPORTS_KEY = "hod_annual_report_inbox_v1";

type HodAnnualReportItem = {
  id: string;
  year: number;
  department: string;
  title: string;
  createdAt: string;
  readAt?: string;
  isDemo?: boolean;
  rows: Record<string, string | number>[];
};

function readHodAnnualReports(): HodAnnualReportItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HOD_ANNUAL_REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HodAnnualReportItem[];
  } catch {
    return [];
  }
}

function writeHodAnnualReports(items: HodAnnualReportItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HOD_ANNUAL_REPORTS_KEY, JSON.stringify(items));
}

function submittedTimeById(id: number) {
  const day = ((id - 1) % 28) + 1;
  const hour = 8 + (id % 9);
  return `2026-03-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00`;
}

function displayNameWithoutComma(raw: string) {
  return raw.replace(/,/g, " ").replace(/\s+/g, " ").trim();
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
  const merged = [...drafts, ...current];
  if (!merged.length) return merged;
  const seen = new Set<string>();
  const next: MockRequest[] = [];
  for (const row of merged) {
    const sourceId = Number(row.sourceWorkloadId);
    const key = Number.isFinite(sourceId)
      ? `src:${sourceId}`
      : `legacy:${String(row.studentId).trim()}|${String(row.periodLabel).trim()}|${String(row.requestReason ?? "").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(row);
  }
  return next;
}

function breakdownById(id: number, totalHours: number): BreakdownData {
  const safeTotal = Math.max(0, Math.round(totalHours));
  const teaching1 = Math.max(0, Math.floor(safeTotal * 0.3));
  const teaching2 = Math.max(0, Math.floor(safeTotal * 0.15));
  const role1 = Math.max(0, Math.floor(safeTotal * 0.2));
  const role2 = Math.max(0, Math.floor(safeTotal * 0.1));
  const hdr1 = Math.max(0, Math.floor(safeTotal * 0.1));
  const hdr2 = Math.max(0, Math.floor(safeTotal * 0.05));
  const used = teaching1 + teaching2 + role1 + role2 + hdr1 + hdr2;
  const service = Math.max(0, safeTotal - used);

  const teachingUnits = [
    ["CITS2401", "CITS2200"],
    ["CITS3002", "CITS1401"],
    ["CITS1001", "CITS2005"],
  ] as const;
  const hdrStudents = [
    ["Student A", "Student B"],
    ["Student C", "Student D"],
    ["Student E", "Student F"],
  ] as const;
  const [unitA, unitB] = teachingUnits[id % teachingUnits.length];
  const [studentA, studentB] = hdrStudents[id % hdrStudents.length];

  return {
    Teaching: [
      { name: unitA, hours: teaching1 },
      { name: unitB, hours: teaching2 },
    ],
    "Assigned Roles": [
      { name: "Program Chair", hours: role1 },
      { name: "Outreach Chair", hours: role2 },
    ],
    HDR: [
      { name: studentA, hours: hdr1 },
      { name: studentB, hours: hdr2 },
    ],
    Service: [{ name: "Committee support", hours: service }],
    "Research (residual)": [{ name: "Research (residual)", hours: 0 }],
  };
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

function reportStatusText(status: MockRequest["status"]) {
  return status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending";
}

function parsePeriod(periodLabel: string) {
  const matched = periodLabel.match(/(\d{4})-(1|2)/);
  if (!matched) return { year: NaN, semester: "" as "" | "S1" | "S2" };
  return {
    year: Number(matched[1]),
    semester: matched[2] === "1" ? ("S1" as const) : ("S2" as const),
  };
}

type SemesterSlot = { key: string; year: number; semester: "S1" | "S2"; label: string };

function buildSemesterSlots(yearFrom: number, yearTo: number, semesterFilter: "All" | "S1" | "S2") {
  const slots: SemesterSlot[] = [];
  for (let year = yearFrom; year <= yearTo; year += 1) {
    if (semesterFilter === "All" || semesterFilter === "S1") {
      slots.push({ key: `${year}-S1`, year, semester: "S1", label: `${year} S1` });
    }
    if (semesterFilter === "All" || semesterFilter === "S2") {
      slots.push({ key: `${year}-S2`, year, semester: "S2", label: `${year} S2` });
    }
  }
  return slots;
}

function computeYAxisDomain(values: Array<number | null>) {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return [0, 10] as [number, number];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) {
    const padded = Math.max(1, Math.ceil(max * 0.2));
    return [Math.max(0, min - padded), max + padded] as [number, number];
  }
  const span = max - min;
  const pad = Math.max(1, Math.ceil(span * 0.15));
  return [Math.max(0, min - pad), max + pad] as [number, number];
}

function reseedSemestersIfNeeded(items: MockRequest[]) {
  const uniquePeriods = new Set(items.map((item) => item.periodLabel));
  // Old cached data often has only one semester; reseed it for visualization readability.
  if (uniquePeriods.size >= 5) return items;
  const semesterPool = ["2024-1", "2024-2", "2025-1", "2025-2", "2026-1"] as const;
  return items.map((item, idx) => {
    const periodLabel = semesterPool[idx % semesterPool.length];
    return {
      ...item,
      periodLabel,
      semesterLabel: periodLabel.endsWith("-2") ? "Sem2" : "Sem1",
    };
  });
}

function annualReportAvailableOn(year: number) {
  return new Date(year + 1, 0, 1, 0, 0, 0, 0);
}

function buildHodAnnualReportRows(rows: MockRequest[], department: string) {
  return rows
    .filter((row) => !row.cancelled && row.department === department)
    .sort((a, b) => a.periodLabel.localeCompare(b.periodLabel) || a.name.localeCompare(b.name))
    .map((row) => {
      const parsed = parsePeriod(row.periodLabel);
      return {
        "Staff ID": row.studentId,
        Name: displayNameWithoutComma(row.name),
        Department: row.department,
        Title: row.title,
        Semester: parsed.semester || row.semesterLabel || row.periodLabel,
        Status: reportStatusText(row.status),
        "Total Work Hours": row.hours,
        "Submitted Time": submittedTimeById(row.id),
        "Application Reason": requestReasonText(row) || "—",
        "HoD Review Note": row.supervisorNote?.trim() || "—",
      };
    });
}

function createHodAnnualDemoReport(department: string): HodAnnualReportItem {
  return {
    id: `hod-report-demo-2025-${department.replace(/\s+/g, "-").toLowerCase()}`,
    year: 2025,
    department,
    title: `2025 ${department} annual report generated`,
    createdAt: "2026-01-01T09:00:00.000Z",
    readAt: undefined,
    isDemo: true,
    rows: [
      {
        "Staff ID": "12345931",
        Name: "Dias John",
        Department: department,
        Title: "Lecturer",
        Semester: "S1",
        Status: "Pending",
        "Total Work Hours": 793.5,
        "Submitted Time": "2025-11-28 09:30",
        "Application Reason": "wrong",
        "HoD Review Note": "—",
      },
    ],
  };
}

export default function Supervisor() {
  const user = {
    surname: "Rachel",
    firstName: "Rachel",
    employeeId: "12345931",
    title: "Lecturer",
    department: "Physics",
    email: "rachel.rachel@uwa.edu.au",
  };

  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [hodReportInboxOpen, setHodReportInboxOpen] = useState(false);
  const [hodAnnualReports, setHodAnnualReports] = useState<HodAnnualReportItem[]>(() => readHodAnnualReports());
  const [hodReportInboxPage, setHodReportInboxPage] = useState(1);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const currentSemester = useMemo<"S1" | "S2">(() => {
    const month = new Date().getMonth() + 1;
    return month <= 6 ? "S1" : "S2";
  }, []);
  const currentSemesterLabel = useMemo(
    () => `${currentYear} ${currentSemester}`,
    [currentYear, currentSemester]
  );

  const [loading] = useState(false);
  const [pending, setPending] = useState<MockRequest[]>(() => mergeDraftsIntoRequests(readSupervisorState(), []));

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

    // Sync existing Academic submissions when HoD page is opened after submit.
    mergeLatestDrafts();
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
    let latestDistributedIdByStaffId: Record<string, number> = {};
    try {
      const raw = window.localStorage.getItem(OPS_ACADEMIC_DISTRIBUTED_KEY);
      const parsed = raw ? (JSON.parse(raw) as MockRequest[]) : [];
      if (Array.isArray(parsed)) {
        parsed.forEach((row) => {
          const sid = String(row.studentId ?? "").trim();
          const id = Number(row.id);
          if (!sid || !Number.isFinite(id)) return;
          if (row.cancelled || row.status !== "approved") return;
          latestDistributedIdByStaffId[sid] = id;
        });
      }
    } catch {
      latestDistributedIdByStaffId = {};
    }
    pending.forEach((row) => {
      const sourceId = Number(row.sourceWorkloadId);
      const fallbackId = latestDistributedIdByStaffId[String(row.studentId ?? "").trim()];
      const effectiveSourceId = Number.isFinite(sourceId) ? sourceId : fallbackId;
      if (Number.isFinite(effectiveSourceId)) sync[String(effectiveSourceId)] = row.status;
      if (Number.isFinite(effectiveSourceId) && row.supervisorNote) {
        notesSync[String(effectiveSourceId)] = row.supervisorNote;
      }
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
  const [searchYearInput, setSearchYearInput] = useState("");
  const [searchSemesterInput, setSearchSemesterInput] = useState<"" | "S1" | "S2">("");
  const [searchFilters, setSearchFilters] = useState({
    employeeId: "",
    name: "",
    year: "",
    semester: "",
  });
  const sectionTabs = [
    { key: "approval", label: "Workload Approval" },
    { key: "visualization", label: "Visualization" },
    { key: "export", label: "Export Excel" },
  ] as const;
  const [activeSection, setActiveSection] = useState<(typeof sectionTabs)[number]["key"]>("approval");
  const [visualYearFromInput, setVisualYearFromInput] = useState("");
  const [visualYearToInput, setVisualYearToInput] = useState("");
  const [visualSemesterInput, setVisualSemesterInput] = useState<"All" | "S1" | "S2">("All");
  const [visualError, setVisualError] = useState("");
  const [appliedVisualFilters, setAppliedVisualFilters] = useState({
    yearFrom: "",
    yearTo: "",
    semester: "All" as "All" | "S1" | "S2",
  });
  const [exportYearFromInput, setExportYearFromInput] = useState("");
  const [exportYearToInput, setExportYearToInput] = useState("");
  const [exportSemesterInput, setExportSemesterInput] = useState<"All" | "S1" | "S2">("All");
  const [exportMessage, setExportMessage] = useState("");
  const hodReportsPerPage = 10;
  const hodUnreadReportCount = useMemo(
    () => hodAnnualReports.filter((item) => !item.readAt).length,
    [hodAnnualReports]
  );
  const hodReportTotalPages = Math.max(1, Math.ceil(hodAnnualReports.length / hodReportsPerPage));
  const pagedHodAnnualReports = useMemo(() => {
    const start = (hodReportInboxPage - 1) * hodReportsPerPage;
    return hodAnnualReports.slice(start, start + hodReportsPerPage);
  }, [hodAnnualReports, hodReportInboxPage]);

  function handleDownloadHodAnnualReport(report: HodAnnualReportItem) {
    if (!report.rows.length) return;
    const ws = XLSX.utils.json_to_sheet(report.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${report.year}`);
    XLSX.writeFile(
      wb,
      `hod_${report.department.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_annual_report_${report.year}.xlsx`
    );
  }

  const pendingCount = useMemo(
    () => pending.filter((it) => it.status === "pending").length,
    [pending]
  );

  useEffect(() => {
    setHodAnnualReports((prev) => {
      const base = (prev.length ? prev : readHodAnnualReports()).map((item) => ({
        ...item,
        title: `${item.year} ${item.department} annual report generated`,
      }));
      if (base.length) {
        writeHodAnnualReports(base);
        return base;
      }
      const seeded = [createHodAnnualDemoReport(user.department)];
      writeHodAnnualReports(seeded);
      return seeded;
    });
  }, [user.department]);

  useEffect(() => {
    const now = new Date();
    const existing = readHodAnnualReports();
    const existingByKey = new Map<string, HodAnnualReportItem>(
      existing.map((item) => [`${item.year}-${item.department}`, item] as const)
    );
    const availableYears = new Set<number>();

    pending.forEach((row) => {
      if (row.cancelled || row.department !== user.department) return;
      const parsed = parsePeriod(row.periodLabel);
      if (!Number.isFinite(parsed.year)) return;
      if (now < annualReportAvailableOn(parsed.year)) return;
      availableYears.add(parsed.year);
    });

    const newReports: HodAnnualReportItem[] = [];
    const replacedDemoKeys = new Set<string>();
    availableYears.forEach((year) => {
      const key = `${year}-${user.department}`;
      const existingItem = existingByKey.get(key);
      if (existingItem && !existingItem.isDemo) return;
      const yearRows = buildHodAnnualReportRows(
        pending.filter((row) => parsePeriod(row.periodLabel).year === year),
        user.department
      );
      if (!yearRows.length) return;
      if (existingItem?.isDemo) replacedDemoKeys.add(key);
      newReports.push({
        id: `hod-report-${year}-${user.department.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}`,
        year,
        department: user.department,
        title: `${year} ${user.department} annual report generated`,
        createdAt: new Date().toISOString(),
        rows: yearRows,
      });
    });

    if (!newReports.length) return;
    const retainedExisting = existing.filter((item) => !replacedDemoKeys.has(`${item.year}-${item.department}`));
    const next = [...newReports, ...retainedExisting].sort(
      (a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")
    );
    writeHodAnnualReports(next);
    setHodAnnualReports(next);
  }, [pending, user.department]);

  useEffect(() => {
    if (!hodReportInboxOpen) return;
    setHodAnnualReports((prev) => {
      const now = new Date().toISOString();
      const next = prev.map((item) => (item.readAt ? item : { ...item, readAt: now }));
      writeHodAnnualReports(next);
      return next;
    });
  }, [hodReportInboxOpen]);

  useEffect(() => {
    const total = Math.max(1, Math.ceil(hodAnnualReports.length / hodReportsPerPage));
    setHodReportInboxPage((prev) => Math.min(Math.max(1, prev), total));
  }, [hodAnnualReports.length]);

  const itemsForFilter = useMemo(() => {
    const byStatus =
      statusFilter === "all"
        ? pending
        : pending.filter((it) => it.status === statusFilter);

    const hasSearchFilter = Object.values(searchFilters).some((value) => value);
    if (!hasSearchFilter) return byStatus;

    return byStatus.filter((it) => {
      const fullName = it.name.toLowerCase();
      const nameParts = it.name.trim().toLowerCase().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts[nameParts.length - 1] || "";

      if (
        searchFilters.employeeId &&
        !it.studentId.toLowerCase().includes(searchFilters.employeeId)
      ) {
        return false;
      }

      if (searchFilters.name) {
        const q = searchFilters.name;
        const matchByFull = fullName.includes(q);
        const matchByFirst = firstName.includes(q);
        const matchByLast = lastName.includes(q);
        const matchByReversed = `${lastName} ${firstName}`.includes(q);
        if (!(matchByFull || matchByFirst || matchByLast || matchByReversed)) return false;
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

      return fullName.length > 0;
    });
  }, [pending, statusFilter, searchFilters]);

  const totalPages = Math.max(1, Math.ceil(itemsForFilter.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return itemsForFilter.slice(start, start + pageSize);
  }, [itemsForFilter, page]);
  const filteredVisualizationItems = useMemo(() => {
    return pending.filter((item) => {
      const { year, semester } = parsePeriod(item.periodLabel);
      if (appliedVisualFilters.semester !== "All" && semester !== appliedVisualFilters.semester) {
        return false;
      }
      if (appliedVisualFilters.yearFrom && Number.isFinite(year) && year < Number(appliedVisualFilters.yearFrom)) {
        return false;
      }
      if (appliedVisualFilters.yearTo && Number.isFinite(year) && year > Number(appliedVisualFilters.yearTo)) {
        return false;
      }
      return true;
    });
  }, [pending, appliedVisualFilters]);
  const visualizationSemesterSlots = useMemo(() => {
    const parsedYears = filteredVisualizationItems
      .map((item) => parsePeriod(item.periodLabel).year)
      .filter((year) => Number.isFinite(year));
    const dataMaxYear = parsedYears.length > 0 ? Math.max(...parsedYears) : currentYear;
    const defaultTo = dataMaxYear;
    const defaultFrom = dataMaxYear - 2;
    const from = appliedVisualFilters.yearFrom ? Number(appliedVisualFilters.yearFrom) : defaultFrom;
    const to = appliedVisualFilters.yearTo ? Number(appliedVisualFilters.yearTo) : defaultTo;
    const safeFrom = Number.isFinite(from) ? from : defaultFrom;
    const safeTo = Number.isFinite(to) ? to : defaultTo;
    return buildSemesterSlots(Math.min(safeFrom, safeTo), Math.max(safeFrom, safeTo), appliedVisualFilters.semester);
  }, [appliedVisualFilters, currentYear, filteredVisualizationItems]);
  const averageWorkHoursBySemesterData = useMemo(() => {
    const bucket = new Map<string, { totalHours: number; records: number }>();
    filteredVisualizationItems.forEach((item) => {
      const { year, semester } = parsePeriod(item.periodLabel);
      if (!Number.isFinite(year) || !semester) return;
      const key = `${year}-${semester}`;
      const existing = bucket.get(key) ?? { totalHours: 0, records: 0 };
      existing.totalHours += item.hours;
      existing.records += 1;
      bucket.set(key, existing);
    });
    return visualizationSemesterSlots.map((slot) => {
      const value = bucket.get(slot.key);
      return {
        semester: slot.label,
        averageHours: value && value.records > 0 ? Number((value.totalHours / value.records).toFixed(2)) : null,
      };
    });
  }, [filteredVisualizationItems, visualizationSemesterSlots]);
  const trendChartData = useMemo(() => {
    const bucket = new Map<string, { totalHours: number }>();
    filteredVisualizationItems.forEach((item) => {
      const { year, semester } = parsePeriod(item.periodLabel);
      if (!Number.isFinite(year) || !semester) return;
      const key = `${year}-${semester}`;
      const existing = bucket.get(key) ?? { totalHours: 0 };
      existing.totalHours += item.hours;
      bucket.set(key, existing);
    });
    return visualizationSemesterSlots.map((slot) => ({
      semester: slot.label,
      totalHours: bucket.get(slot.key)?.totalHours ?? null,
    }));
  }, [filteredVisualizationItems, visualizationSemesterSlots]);
  const averageHoursDomain = useMemo(
    () => computeYAxisDomain(averageWorkHoursBySemesterData.map((item) => item.averageHours)),
    [averageWorkHoursBySemesterData]
  );
  const totalHoursDomain = useMemo(
    () => computeYAxisDomain(trendChartData.map((item) => item.totalHours)),
    [trendChartData]
  );
  const visualizationSummary = useMemo(() => {
    const totalAcademics = filteredVisualizationItems.length;
    const totalWorkHours = filteredVisualizationItems.reduce((sum, item) => sum + item.hours, 0);
    const pendingRequests = filteredVisualizationItems.filter((item) => item.status === "pending").length;
    const approvedRequests = filteredVisualizationItems.filter((item) => item.status === "approved").length;
    const rejectedRequests = filteredVisualizationItems.filter((item) => item.status === "rejected").length;
    const workHoursPerAcademic =
      totalAcademics > 0 ? Number((totalWorkHours / totalAcademics).toFixed(1)) : 0;
    return {
      totalAcademics,
      totalWorkHours,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      workHoursPerAcademic,
    };
  }, [filteredVisualizationItems]);
  const reportingPeriodLabel = useMemo(() => {
    if (visualizationSemesterSlots.length === 0) return "N/A";
    const first = visualizationSemesterSlots[0];
    const last = visualizationSemesterSlots[visualizationSemesterSlots.length - 1];
    if (first.year === last.year) {
      return `${first.year} ${appliedVisualFilters.semester === "All" ? "All Semesters" : appliedVisualFilters.semester}`;
    }
    return `${first.year}-${last.year} ${
      appliedVisualFilters.semester === "All" ? "All Semesters" : appliedVisualFilters.semester
    }`;
  }, [visualizationSemesterSlots, appliedVisualFilters.semester]);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function statusLabel(status: string) {
    if (status === "pending") return "Pending";
    if (status === "approved") return "Approved";
    if (status === "rejected") return "Rejected";
    return status;
  }

  function handleApplyVisualizationFilter() {
    setVisualError("");
    const fromYear = Number(visualYearFromInput);
    const toYear = Number(visualYearToInput);
    if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) {
      setVisualError("Please enter valid year values.");
      return;
    }
    const startYear = Math.min(fromYear, toYear);
    const endYear = Math.max(fromYear, toYear);
    if (endYear - startYear > 2) {
      setVisualError("Maximum range is 3 years.");
      return;
    }
    setAppliedVisualFilters({
      yearFrom: String(startYear),
      yearTo: String(endYear),
      semester: visualSemesterInput,
    });
  }

  function handleExportExcel() {
    setExportMessage("");
    const rows = pending
      .filter((item) => {
        const { year, semester } = parsePeriod(item.periodLabel);
        if (exportSemesterInput !== "All" && semester !== exportSemesterInput) return false;
        if (exportYearFromInput && Number.isFinite(year) && year < Number(exportYearFromInput)) return false;
        if (exportYearToInput && Number.isFinite(year) && year > Number(exportYearToInput)) return false;
        return true;
      })
      .map((item) => ({
        Name: item.name,
        StaffID: item.studentId,
        Title: item.title,
        Department: item.department,
        YearSemester: item.periodLabel,
        Status: statusLabel(item.status),
        TotalHours: item.hours,
        SubmittedTime: submittedTimeById(item.id),
      }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Supervisor Workload");
    XLSX.writeFile(workbook, "Supervisor_Workload.xlsx");
    setExportMessage(`Exported ${rows.length} records to Supervisor_Workload.xlsx.`);
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
      year: searchYearInput.trim().toLowerCase(),
      semester: searchSemesterInput.trim().toLowerCase(),
    });
    setPage(1);
    setSelectedIds(new Set());
    setDetailsOpen(false);
    setDetailsItem(null);
    setDetailsBreakdown(null);
  }

  function openDetails(item: MockRequest) {
    if (item.cancelled) {
      setSupersededNoticeOpen(true);
      return;
    }
    setDetailsItem(item);
    setDetailsBreakdown(item.detailSnapshot?.breakdown ?? breakdownById(item.id, item.hours));
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
          title="HoD Dashboard"
          hasNewMessage={hodUnreadReportCount > 0}
          onMessageClick={() => setHodReportInboxOpen(true)}
          greetingName={user.surname}
          onAvatarClick={() => setProfileOpen(true)}
          avatarSrc={avatarSrc}
        />

        {hodReportInboxOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
            onClick={() => setHodReportInboxOpen(false)}
          >
            <div
              className="w-full max-w-3xl rounded-2xl border-2 border-[#2f4d9c] bg-slate-50 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between rounded-t-2xl bg-[#2f4d9c] px-6 py-4 text-white">
                <div className="text-2xl font-semibold">Annual Department Reports</div>
                <button
                  type="button"
                  aria-label="Close report inbox"
                  className="rounded p-1 text-white/90 hover:bg-white/20"
                  onClick={() => setHodReportInboxOpen(false)}
                >
                  ✕
                </button>
              </div>
              {hodAnnualReports.length === 0 ? (
                <div className="rounded-md border border-[#2f4d9c]/30 bg-white px-4 py-5 text-sm text-slate-700">
                  No annual department report generated yet.
                </div>
              ) : (
                <>
                  <div className="max-h-80 overflow-y-auto rounded-md border border-[#2f4d9c]/40 bg-white">
                    {pagedHodAnnualReports.map((report) => (
                      <div
                        key={report.id}
                        className="flex items-center justify-between gap-3 border-b border-[#2f4d9c]/10 px-4 py-3"
                      >
                        <div className="text-sm font-semibold text-slate-800">{report.title}</div>
                        <button
                          type="button"
                          onClick={() => handleDownloadHodAnnualReport(report)}
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
                      onClick={() => setHodReportInboxPage((p) => Math.max(1, p - 1))}
                      disabled={hodReportInboxPage <= 1}
                      className="rounded border border-[#2f4d9c]/35 bg-[#eef3ff] px-3 py-1 font-semibold text-[#2f4d9c] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="text-slate-600">
                      Page {hodReportInboxPage} / {hodReportTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setHodReportInboxPage((p) => Math.min(hodReportTotalPages, p + 1))}
                      disabled={hodReportInboxPage >= hodReportTotalPages}
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

        {/* Body Card */}
        <div className="mt-6 rounded-md bg-white p-8 shadow-sm">
          {popup.open && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
              onClick={() => setPopup((p) => ({ ...p, open: false }))}
            >
              <div
                className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
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

                {/* Body */}
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

                {/* Status color bar */}
                <div className="h-1.5 w-full bg-[#2f4d9c]" />
              </div>
            </div>
          )}

          <SectionTabs tabs={[...sectionTabs]} activeKey={activeSection} onChange={(key) => setActiveSection(key as (typeof sectionTabs)[number]["key"])} />

          {activeSection === "approval" && (
            <section>
          {/* Search Fields */}
          <div className="flex items-end gap-4">
            <div className="grid flex-1 grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                Name
              </div>
              <input
                value={searchNameInput}
                onChange={(e) => setSearchNameInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="First, last, or full name"
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                Staff ID
              </div>
              <input
                value={searchEmployeeIdInput}
                onChange={(e) => setSearchEmployeeIdInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="rounded border border-slate-300 px-3 py-2 text-sm tabular-nums font-sans"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">
                Year & Semester
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={searchYearInput}
                  onChange={(e) => setSearchYearInput(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Year"
                  maxLength={4}
                  inputMode="numeric"
                  className="w-1/2 min-w-[88px] rounded border border-slate-300 px-2 py-2 text-sm"
                />
                <select
                  value={searchSemesterInput}
                  onChange={(e) => setSearchSemesterInput(e.target.value as "" | "S1" | "S2")}
                  onKeyDown={handleSearchKeyDown}
                  className="w-1/2 min-w-[104px] rounded border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="">Semester</option>
                  <option value="S1">S1</option>
                  <option value="S2">S2</option>
                </select>
              </div>
            </div>
            </div>
            <div className="pb-[1px]">
              <SearchButton onClick={handleSearch} />
            </div>
          </div>

          {/* Report title */}
          <div className="mt-6 text-lg font-semibold text-slate-700">
            Workload Report Sem 1 - 2025
          </div>

          {/* Table */}
          <div className="mt-6 rounded-md bg-[#f4f7ff] p-4">
            {/* Status Filter (integrated with list) */}
              <div className="mb-4 flex flex-wrap items-center justify-start gap-5">
              <div className="text-base font-semibold text-[#2f4d9c]">
                Status Filter:
              </div>

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
                        {statusFilter === "pending"
                          ? "No pending requests"
                          : "No items found"}
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
                          onClick={() => {
                            openDetails(item);
                          }}
                        >
                          <td className="px-2 py-3">
                            {statusFilter === "pending" ? (
          <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  // Prevent row click from opening details
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

            {/* Pagination */}
            <PaginationControls
              page={page}
              totalPages={totalPages}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              disablePrev={page <= 1 || submitting}
              disableNext={page >= totalPages || submitting}
            />

            {/* Details Modal (placeholder format for now) */}
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
                    {/* Header */}
                    <div className="flex items-center justify-between gap-4 border-b border-black/30 bg-white px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="rounded-sm bg-[#2f4d9c] px-4 py-2 text-sm font-bold text-white tabular-nums font-sans">
                          2025-S1-Physics
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

                    {/* Form body */}
                    <form
                      className="space-y-4 px-6 py-5"
                      onSubmit={(e) => e.preventDefault()}
                    >
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
                            const source = detailsBreakdown ?? breakdownById(detailsItem.id, detailsItem.hours);
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
                              {(detailsBreakdown?.[detailsTab] ?? breakdownById(detailsItem.id, detailsItem.hours)[detailsTab]).map((row, idx) => (
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
                                  {(detailsBreakdown?.[detailsTab] ?? breakdownById(detailsItem.id, detailsItem.hours)[detailsTab]).reduce(
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
            </section>
          )}

          {activeSection === "visualization" && (
            <div className="space-y-5">
              <div>
                <div className="text-2xl font-semibold text-slate-800">Visualization</div>
                <div className="text-sm text-slate-500">
                  Use filters to view workload status and work-hour trends.
                </div>
              </div>

              <div className="rounded-md bg-[#f4f7ff] p-4">
                <ReportingFilterIntro
                  title="Reporting Filter"
                  description="Select year and semester to update the reporting window for all charts."
                />
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[260px_260px_280px_auto]">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-[#2f4d9c]">Year From</span>
                    <input
                      value={visualYearFromInput}
                      onChange={(e) => setVisualYearFromInput(e.target.value)}
                      placeholder="e.g. 2024"
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-[#2f4d9c]">Year To</span>
                    <input
                      value={visualYearToInput}
                      onChange={(e) => setVisualYearToInput(e.target.value)}
                      placeholder="e.g. 2026"
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-[#2f4d9c]">Semester</span>
          <select
                      value={visualSemesterInput}
                      onChange={(e) => setVisualSemesterInput(e.target.value as "All" | "S1" | "S2")}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="All">All</option>
            <option value="S1">S1</option>
            <option value="S2">S2</option>
          </select>
                  </label>
                  <div className="flex flex-col gap-1">
                    <span className="select-none text-xs font-semibold uppercase text-transparent">Action</span>
                    <button
                      type="button"
                      onClick={handleApplyVisualizationFilter}
                      className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                    >
                      Search
                    </button>
                  </div>
                </div>
                {visualError && <div className="mt-3 text-sm font-semibold text-[#dc2626]">{visualError}</div>}
                <div className="mt-2 text-sm font-semibold text-[#2f4d9c]">
                  For readability, Visualization supports up to 3 years. Export more data in Export Excel.
                </div>
              </div>

              <ReportingPeriodBar periodLabel={reportingPeriodLabel} />
              <VisualizationSummaryCards summary={visualizationSummary} />

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <LineMetricChartCard
                  title="Total Work Hours Trend"
                  data={trendChartData}
                  dataKey="totalHours"
                  legendName="Total Hours"
                  yDomain={totalHoursDomain}
                  currentSemesterLabel={currentSemesterLabel}
                />
                <LineMetricChartCard
                  title="Average Work Hours by Semester"
                  data={averageWorkHoursBySemesterData}
                  dataKey="averageHours"
                  legendName="Average Hours"
                  yDomain={averageHoursDomain}
                  currentSemesterLabel={currentSemesterLabel}
                />
              </div>
            </div>
          )}

          {activeSection === "export" && (
            <div className="space-y-5">
              <div>
                <div className="text-2xl font-semibold text-slate-800">Export Excel</div>
                <div className="text-sm text-slate-500">
                  Configure optional filters and export supervisor workload data.
                </div>
              </div>

              <div className="rounded-md bg-[#f4f7ff] p-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_260px_280px_auto]">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-[#2f4d9c]">Year From</span>
                    <input
                      value={exportYearFromInput}
                      onChange={(e) => setExportYearFromInput(e.target.value)}
                      placeholder="Optional"
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-[#2f4d9c]">Year To</span>
                    <input
                      value={exportYearToInput}
                      onChange={(e) => setExportYearToInput(e.target.value)}
                      placeholder="Optional"
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-[#2f4d9c]">Semester</span>
                    <select
                      value={exportSemesterInput}
                      onChange={(e) => setExportSemesterInput(e.target.value as "All" | "S1" | "S2")}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="All">All</option>
                      <option value="S1">S1</option>
                      <option value="S2">S2</option>
                    </select>
                  </label>
                  <div className="flex flex-col gap-1">
                    <span className="select-none text-xs font-semibold uppercase text-transparent">Action</span>
                    <button
                      type="button"
                      onClick={handleExportExcel}
                      className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                    >
                      Export Excel
                    </button>
            </div>
                </div>
                {exportMessage && <div className="mt-3 text-sm font-semibold text-[#2f4d9c]">{exportMessage}</div>}
                <div className="mt-2 text-sm text-slate-600">
                  If years are blank, export all years. If only one side is blank, export from/to the available range.
                </div>
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
