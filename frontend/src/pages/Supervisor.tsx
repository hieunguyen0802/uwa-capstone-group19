import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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
import { apiJson, clearLocalStorageKeys, downloadApiFile, isAbortError } from "../api/client";

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
  submittedAt?: string;
  version?: string;
  targetTeachingRatio?: number;
  employmentType?: string;
  newStaff?: "Yes" | "No";
  hodReviewRequired?: boolean;
  actualTeachingRatio?: number;
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
const HOD_ANNUAL_REPORTS_KEY = "hod_annual_report_inbox_v1";
const LEGACY_HOD_STORAGE_KEYS = [
  SUPERVISOR_DRAFT_KEY,
  SUPERVISOR_STATE_KEY,
  OPS_ACADEMIC_DISTRIBUTED_KEY,
  ACADEMIC_STATUS_SYNC_KEY,
  ACADEMIC_NOTES_SYNC_KEY,
  HOD_ANNUAL_REPORTS_KEY,
] as const;

type HodAnnualReportItem = {
  id: string;
  title: string;
  createdAt: string;
  readAt?: string;
  downloadUrl?: string;
};

type HodWorkloadRowResponse = {
  id: string;
  employee_id: string;
  name: string;
  title: string;
  department: string;
  request_reason?: string;
  status: "pending" | "approved" | "rejected";
  total_hours: number;
  submitted_time?: string | null;
  semester_label?: string;
  period_label: string;
  is_anomaly?: boolean;
};

type HodWorkloadListResponse = {
  success?: boolean;
  message?: string;
  data?: {
    items?: HodWorkloadRowResponse[];
    page?: number;
    page_size?: number;
    total?: number;
    summary?: {
      pending?: number;
      approved?: number;
      rejected?: number;
    };
  };
};

type HodWorkloadDetailPayload = {
  id: string;
  employee_id: string;
  name: string;
  title: string;
  department: string;
  total_hours: number;
  request_reason?: string | null;
  description?: string | null;
  supervisor_note?: string | null;
  status: "pending" | "approved" | "rejected";
  breakdown: Partial<Record<BreakdownCategory, BreakdownEntry[]>>;
  is_anomaly?: boolean;
};

type HodWorkloadDetailResponse = {
  success?: boolean;
  message?: string;
  data?: HodWorkloadDetailPayload;
};

type HodVisualizationResponse = {
  success?: boolean;
  data?: {
    reporting_period_label?: string;
    summary?: {
      total_academics?: number;
      total_work_hours?: number;
      pending_requests?: number;
      approved_requests?: number;
      rejected_requests?: number;
      work_hours_per_academic?: number;
    };
    total_work_hours_trend?: Array<{ semester: string; total_hours: number }>;
    average_work_hours_by_semester?: Array<{ semester: string; average_hours: number }>;
  };
};

type HodVisualizationState = {
  reportingPeriodLabel: string;
  summary: {
    totalAcademics: number;
    totalWorkHours: number;
    pendingRequests: number;
    approvedRequests: number;
    rejectedRequests: number;
    workHoursPerAcademic: number;
  };
  totalWorkHoursTrend: Array<{ period: string; totalWorkHours: number }>;
  averageWorkHoursBySemester: Array<{ period: string; averageWorkHours: number }>;
};

type HodTrendPoint = {
  semester: string;
  total_hours: number;
};

type HodAverageHoursPoint = {
  semester: string;
  average_hours: number;
};

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

function normalizeHodBreakdown(
  breakdown?: Partial<Record<BreakdownCategory, BreakdownEntry[]>>
): BreakdownData {
  const source = breakdown ?? {};
  return {
    Teaching: Array.isArray(source.Teaching) ? source.Teaching : [],
    "Assigned Roles": Array.isArray(source["Assigned Roles"]) ? source["Assigned Roles"] ?? [] : [],
    HDR: Array.isArray(source.HDR) ? source.HDR : [],
    Service: Array.isArray(source.Service) ? source.Service : [],
    "Research (residual)": Array.isArray(source["Research (residual)"])
      ? source["Research (residual)"] ?? []
      : [],
  };
}

function mapHodRowToRequest(row: HodWorkloadRowResponse): MockRequest {
  const numericId = Number.parseInt(String(row.id), 10);
  return {
    id: Number.isFinite(numericId) ? numericId : Date.now(),
    studentId: row.employee_id,
    semesterLabel: row.semester_label || row.period_label,
    periodLabel: row.period_label,
    name: row.name,
    unit: "",
    notes: "",
    requestReason: row.request_reason || "",
    title: row.title || "",
    department: row.department || "",
    rate: 0,
    status: row.status,
    hours: Number(row.total_hours ?? 0),
    submittedAt: row.submitted_time ?? "",
    cancelled: false,
  };
}

function mapHodDetailToRequest(detail: HodWorkloadDetailPayload): MockRequest {
  const base = mapHodRowToRequest({
    id: detail.id,
    employee_id: detail.employee_id,
    name: detail.name,
    title: detail.title,
    department: detail.department,
    request_reason: detail.request_reason || "",
    status: detail.status,
    total_hours: detail.total_hours,
    submitted_time: "",
    semester_label: "",
    period_label: "",
  });
  return {
    ...base,
    notes: detail.description ?? "",
    supervisorNote: detail.supervisor_note ?? "",
    detailSnapshot: {
      breakdown: normalizeHodBreakdown(detail.breakdown),
    },
    cancelled: false,
  };
}

function submittedAtDisplay(item: Pick<MockRequest, "submittedAt">): string {
  return item.submittedAt?.trim() || "—";
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
  const [hodAnnualReports, setHodAnnualReports] = useState<HodAnnualReportItem[]>([]);
  const [hodReportInboxPage, setHodReportInboxPage] = useState(1);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const currentSemesterLabel = useMemo(() => {
    const month = new Date().getMonth() + 1;
    return `${currentYear} ${month <= 6 ? "S1" : "S2"}`;
  }, [currentYear]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [pending, setPending] = useState<MockRequest[]>([]);
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
  const [visualizationLoading, setVisualizationLoading] = useState(false);
  const [appliedVisualFilters, setAppliedVisualFilters] = useState({
    yearFrom: "",
    yearTo: "",
    semester: "All" as "All" | "S1" | "S2",
  });
  const [visualizationData, setVisualizationData] = useState<HodVisualizationState>({
    reportingPeriodLabel: "N/A",
    summary: {
      totalAcademics: 0,
      totalWorkHours: 0,
      pendingRequests: 0,
      approvedRequests: 0,
      rejectedRequests: 0,
      workHoursPerAcademic: 0,
    },
    totalWorkHoursTrend: [],
    averageWorkHoursBySemester: [],
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

  async function loadHodRequests() {
    setLoading(true);
    setPageError("");
    try {
      const response = await apiJson<HodWorkloadListResponse>("/api/supervisor/workload-requests/?page=1&page_size=200");
      setPending((response.data?.items ?? []).map(mapHodRowToRequest));
    } catch (error) {
      if (!isAbortError(error)) {
        setPending([]);
        setPageError(error instanceof Error ? error.message : "Failed to load HoD requests.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadHodReports() {
    setHodAnnualReports([]);
  }

  async function loadHodVisualization(yearFrom: string, yearTo: string, semester: "All" | "S1" | "S2") {
    setVisualizationLoading(true);
    setVisualError("");
    try {
      const params = new URLSearchParams();
      if (yearFrom) params.set("year_from", yearFrom);
      if (yearTo) params.set("year_to", yearTo);
      params.set("semester", semester);
      const response = await apiJson<HodVisualizationResponse>(`/api/supervisor/visualization/?${params.toString()}`);
      setVisualizationData({
        reportingPeriodLabel: response.data?.reporting_period_label ?? "N/A",
        summary: {
          totalAcademics: response.data?.summary?.total_academics ?? 0,
          totalWorkHours: response.data?.summary?.total_work_hours ?? 0,
          pendingRequests: response.data?.summary?.pending_requests ?? 0,
          approvedRequests: response.data?.summary?.approved_requests ?? 0,
          rejectedRequests: response.data?.summary?.rejected_requests ?? 0,
          workHoursPerAcademic: response.data?.summary?.work_hours_per_academic ?? 0,
        },
        totalWorkHoursTrend: (response.data?.total_work_hours_trend ?? []).map((item: HodTrendPoint) => ({
          period: item.semester,
          totalWorkHours: item.total_hours,
        })),
        averageWorkHoursBySemester: (response.data?.average_work_hours_by_semester ?? []).map(
          (item: HodAverageHoursPoint) => ({
          period: item.semester,
          averageWorkHours: item.average_hours,
          })
        ),
      });
    } catch (error) {
      if (!isAbortError(error)) {
        setVisualizationData({
          reportingPeriodLabel: "N/A",
          summary: {
            totalAcademics: 0,
            totalWorkHours: 0,
            pendingRequests: 0,
            approvedRequests: 0,
            rejectedRequests: 0,
            workHoursPerAcademic: 0,
          },
          totalWorkHoursTrend: [],
          averageWorkHoursBySemester: [],
        });
        setVisualError(error instanceof Error ? error.message : "Failed to load visualization.");
      }
    } finally {
      setVisualizationLoading(false);
    }
  }

  async function loadHodDetail(id: number) {
    const response = await apiJson<HodWorkloadDetailResponse>(`/api/supervisor/workload-requests/${id}/`);
    const mapped = mapHodDetailToRequest(response.data as HodWorkloadDetailPayload);
    const existing = pending.find((row) => row.id === id);
    const merged = existing
      ? {
          ...existing,
          ...mapped,
          semesterLabel: existing.semesterLabel,
          periodLabel: existing.periodLabel,
          submittedAt: existing.submittedAt,
        }
      : mapped;
    setPending((prev) => prev.map((row) => (row.id === id ? { ...row, ...merged } : row)));
    return merged;
  }

  useEffect(() => {
    clearLocalStorageKeys([...LEGACY_HOD_STORAGE_KEYS]);
    const defaultFrom = String(currentYear - 2);
    const defaultTo = String(currentYear);
    setVisualYearFromInput(defaultFrom);
    setVisualYearToInput(defaultTo);
    setAppliedVisualFilters({
      yearFrom: defaultFrom,
      yearTo: defaultTo,
      semester: "All",
    });
    void loadHodRequests();
    void loadHodReports();
    void loadHodVisualization(defaultFrom, defaultTo, "All");
  }, [currentYear]);

  async function handleDownloadHodAnnualReport(report: HodAnnualReportItem) {
    if (!report.downloadUrl) return;
    await downloadApiFile(report.downloadUrl, `${report.id}.xlsx`);
  }

  const pendingCount = useMemo(
    () => pending.filter((it) => it.status === "pending").length,
    [pending]
  );

  useEffect(() => {
    if (!hodReportInboxOpen) return;
    setHodAnnualReports((prev) => prev.map((item) => (item.readAt ? item : { ...item, readAt: new Date().toISOString() })));
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

      const submittedText = submittedAtDisplay(it);
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
  const averageWorkHoursBySemesterData = useMemo(
    () =>
      (visualizationData.averageWorkHoursBySemester ?? []).map((item) => ({
        semester: item.period,
        averageHours: item.averageWorkHours,
      })),
    [visualizationData]
  );
  const trendChartData = useMemo(
    () =>
      (visualizationData.totalWorkHoursTrend ?? []).map((item) => ({
        semester: item.period,
        totalHours: item.totalWorkHours,
      })),
    [visualizationData]
  );
  const averageHoursDomain = useMemo(
    () => computeYAxisDomain(averageWorkHoursBySemesterData.map((item) => item.averageHours)),
    [averageWorkHoursBySemesterData]
  );
  const totalHoursDomain = useMemo(
    () => computeYAxisDomain(trendChartData.map((item) => item.totalHours)),
    [trendChartData]
  );
  const visualizationSummary = useMemo(
    () => ({
      totalAcademics: visualizationData.summary?.totalAcademics ?? 0,
      totalWorkHours: visualizationData.summary?.totalWorkHours ?? 0,
      pendingRequests: visualizationData.summary?.pendingRequests ?? 0,
      approvedRequests: visualizationData.summary?.approvedRequests ?? 0,
      rejectedRequests: visualizationData.summary?.rejectedRequests ?? 0,
      workHoursPerAcademic: visualizationData.summary?.workHoursPerAcademic ?? 0,
    }),
    [visualizationData]
  );
  const reportingPeriodLabel = useMemo(
    () => visualizationData.reportingPeriodLabel || "N/A",
    [visualizationData]
  );

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

  async function handleApplyVisualizationFilter() {
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
    await loadHodVisualization(String(startYear), String(endYear), visualSemesterInput);
  }

  async function handleExportExcel() {
    setExportMessage("");
    try {
      const params = new URLSearchParams();
      if (exportYearFromInput) params.set("year_from", exportYearFromInput);
      if (exportYearToInput) params.set("year_to", exportYearToInput);
      params.set("semester", exportSemesterInput);
      await downloadApiFile(`/api/supervisor/export/?${params.toString()}`, "HoD_Workloads.xlsx");
      setExportMessage("HoD workload export downloaded.");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Failed to export workloads.");
    }
  }

  const canSubmit =
    statusFilter === "pending" && selectedIds.size > 0 && !submitting;

  async function handleDecision(kind: "approve" | "reject") {
    if (!canSubmit) return;
    setSubmitting(true);
    const count = selectedIds.size;
    try {
      await apiJson("/api/supervisor/workload-requests/batch-decision/", {
        method: "POST",
        body: JSON.stringify({
          request_ids: Array.from(selectedIds).map(String),
          decision: kind === "approve" ? "approved" : "rejected",
        }),
      });
      setSelectedIds(new Set());
      await loadHodRequests();
    } catch (error) {
      setPopup({
        open: true,
        title: "Request Failed",
        message: error instanceof Error ? error.message : "Failed to update HoD decisions.",
        status: "pending",
      });
      setSubmitting(false);
      return;
    } finally {
      setSubmitting(false);
    }

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
      await apiJson(`/api/supervisor/workload-requests/${id}/decision/`, {
        method: "POST",
        body: JSON.stringify({
          decision: kind === "approve" ? "approved" : "rejected",
          note: note.trim(),
          breakdown: detailsBreakdown,
        }),
      });
      await loadHodRequests();
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (detailsItem) {
        const refreshed = await loadHodDetail(id);
        setDetailsItem(refreshed);
        setDetailsBreakdown(refreshed.detailSnapshot?.breakdown ?? normalizeHodBreakdown());
      }
    } catch (error) {
      setPopup({
        open: true,
        title: "Request Failed",
        message: error instanceof Error ? error.message : "Failed to update HoD decision.",
        status: "pending",
      });
      return;
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

  async function openDetails(item: MockRequest) {
    if (item.cancelled) {
      setSupersededNoticeOpen(true);
      return;
    }
    try {
      const detail = await loadHodDetail(item.id);
      setDetailsItem(detail);
      setDetailsBreakdown(detail.detailSnapshot?.breakdown ?? normalizeHodBreakdown());
      setDetailsOpen(true);
      setDetailsEditMode(false);
      setDescriptionExpanded(false);
      setDetailsModalError("");
    } catch (error) {
      setPopup({
        open: true,
        title: "Load Failed",
        message: error instanceof Error ? error.message : "Failed to load HoD request detail.",
        status: "pending",
      });
    }
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
                <div className="text-2xl font-semibold">Semester Department Reports</div>
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
                  No semester department report generated yet.
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

                  {!loading && pageError && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-sm font-semibold text-[#dc2626]">
                        {pageError}
                      </td>
                    </tr>
                  )}

                  {!loading && !pageError && pageItems.length === 0 && (
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
                            {submittedAtDisplay(item)}
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
                    <div className="flex items-center justify-between rounded-t-sm bg-[#2f4d9c] px-5 py-3 text-white">
                      <div className="text-lg font-bold">
                        {(() => {
                          const matched = detailsItem.periodLabel.match(/^(\d{4})-(1|2)$/);
                          const period = matched ? `${matched[1]}-${matched[2] === "1" ? "S1" : "S2"}` : detailsItem.semesterLabel;
                          return `${period}-${detailsItem.department}-Academic`;
                        })()}
                      </div>
                      <button
                        type="button"
                        onClick={requestCloseDetails}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/10 hover:bg-white/20"
                      >
                        <span className="text-xl leading-none">×</span>
                      </button>
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
                          <input
                            readOnly
                            value={
                              typeof detailsItem.targetTeachingRatio === "number"
                                ? `${detailsItem.targetTeachingRatio.toFixed(1)}%`
                                : "—"
                            }
                            className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                            Actual teaching ratio
                          </div>
                          {(() => {
                            const source = detailsBreakdown ?? detailsItem.detailSnapshot?.breakdown ?? normalizeHodBreakdown();
                            const teaching = source.Teaching.reduce((sum, row) => sum + row.hours, 0);
                            const total = (["Teaching", "Assigned Roles", "HDR", "Service", "Research (residual)"] as BreakdownCategory[]).reduce(
                              (tabSum, tab) => tabSum + source[tab].reduce((sum, row) => sum + row.hours, 0),
                              0
                            );
                            const ratio =
                              typeof detailsItem.actualTeachingRatio === "number" && !detailsEditMode
                                ? `${detailsItem.actualTeachingRatio.toFixed(1)}%`
                                : total <= 0
                                  ? "0.0%"
                                  : `${((teaching / total) * 100).toFixed(1)}%`;
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
                              <input
                                readOnly
                                value={detailsItem.employmentType || "—"}
                                className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base"
                              />
                            );
                          })()}
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                            New Staff
                          </div>
                          <input readOnly value={detailsItem.newStaff || "—"} className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base" />
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-32 rounded-sm bg-[#2f4d9c] px-3 py-2 text-center text-base font-semibold text-white">
                            HoD Review
                          </div>
                          <input
                            readOnly
                            value={typeof detailsItem.hodReviewRequired === "boolean" ? (detailsItem.hodReviewRequired ? "Yes" : "No") : "—"}
                            className="w-full flex-1 rounded-sm border border-[#2f4d9c] px-3 py-2 text-base"
                          />
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
                              {(detailsBreakdown?.[detailsTab] ?? detailsItem.detailSnapshot?.breakdown?.[detailsTab] ?? []).map((row, idx) => (
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
                                  {(detailsBreakdown?.[detailsTab] ?? detailsItem.detailSnapshot?.breakdown?.[detailsTab] ?? []).reduce(
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
              {visualizationLoading && (
                <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                  Loading visualization...
                </div>
              )}
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
