import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DashboardHeader from "../components/common/DashboardHeader";
import PaginationControls from "../components/common/PaginationControls";
import ProfileModal from "../components/common/ProfileModal";
import ReportingFilterIntro from "../components/common/ReportingFilterIntro";
import ReportingPeriodBar from "../components/common/ReportingPeriodBar";
import SearchButton from "../components/common/SearchButton";
import SectionTabs from "../components/common/SectionTabs";
import StatusPill from "../components/common/StatusPill";
import YearRangeSemesterActionRow from "../components/common/YearRangeSemesterActionRow";
import ThemedNoticeModal, { SUPERSEDED_RECORD_MESSAGE } from "../components/common/ThemedNoticeModal";
import WorkHoursBadge from "../components/common/WorkHoursBadge";
import WorkloadDetailModal, { type WorkloadDetailField, type WorkloadDetailNoteSection } from "../components/common/WorkloadDetailModal";
import { apiJson, clearLocalStorageKeys, downloadApiFile, isAbortError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { profileFromAuth } from "../auth/profileFromAuth";

type AcademicItem = {
  id: number;
  /** Original UUID from backend — used for all API calls. */
  backendId: string;
  name: string;
  employeeId: string;
  department?: string;
  /** Job title returned by the backend. */
  title?: string;
  notes: string;
  hours: number;
  /** Expected teaching hours; if the teaching subtotal in the breakdown is lower, self-confirm is blocked as abnormal. */
  teachingTargetHours?: number;
  /** Target teaching share of total workload (0–100), e.g. staff sheet "Target Teaching %". */
  targetTeachingRatio?: number;
  status: "initial" | "pending" | "approved" | "rejected" | "";
  confirmation: "confirmed" | "unconfirmed";
  /** When confirmation is confirmed, time the workload was confirmed (empty in list when unconfirmed). */
  confirmationTime?: string;
  supervisorNote?: string;
  /** Admin (or delegate) who assigned this workload task to the staff member. */
  assignedBy?: string;
  pushedAt?: string;
  academicYear?: number;
  semester?: string;
  /** Display-only field for Academic detail modal (mirrors School Ops detail layout). */
  employmentType?: "Full-time" | "Part-time" | string;
  /** Display-only field for Academic detail modal (mirrors School Ops detail layout). */
  newStaff?: "Yes" | "No" | string;
  /** Display-only field for Academic detail modal (mirrors School Ops detail layout). */
  hodReview?: "Yes" | "No" | string;
  /** When true (from API), row is read-only and detail is blocked — superseded by a newer version. */
  cancelled?: boolean;
  detailSnapshot?: WorkloadDetailSnapshot;
};

type BreakdownEntry = {
  name: string;
  hours: number;
  excludeFromWorkloadTotal?: boolean;
};

type BreakdownCategory = "Teaching" | "Assigned Roles" | "HDR" | "Service" | "Research (residual)";

type BreakdownData = Record<BreakdownCategory, BreakdownEntry[]>;

type WorkloadDetailSnapshot = {
  breakdown: BreakdownData;
  actualTeachingRatioDisplay: string;
  actualTeachingRatioOutOfRange: boolean;
  showActualTeachingRatioBandWarning: boolean;
  actualRatioHoverText: string;
  totalHoursDisplay: string;
  adminModalHoursAbnormal: boolean;
  totalHoursTooltipText: string;
  employmentType: string;
};

const BREAKDOWN_TABS: BreakdownCategory[] = [
  "Teaching",
  "HDR",
  "Service",
  "Assigned Roles",
  "Research (residual)",
];

function totalBreakdownHours(breakdown: BreakdownData): number {
  return BREAKDOWN_TABS.reduce(
    (sum, tab) => sum + breakdown[tab].reduce((s, row) => s + (row.excludeFromWorkloadTotal ? 0 : row.hours), 0),
    0
  );
}

function teachingHoursFromBreakdown(breakdown: BreakdownData): number {
  return breakdown.Teaching.reduce((s, row) => s + row.hours, 0);
}

function actualTeachingRatioPercent(breakdown: BreakdownData): number {
  const totalH = totalBreakdownHours(breakdown);
  if (totalH <= 0) return 0;
  const teachingH = teachingHoursFromBreakdown(breakdown);
  return Math.round((teachingH / totalH) * 1000) / 10;
}


const SUPERVISOR_DRAFT_KEY = "academic_to_supervisor_requests_v1";
const ACADEMIC_STATUS_SYNC_KEY = "academic_status_sync_v1";
const ACADEMIC_NOTES_SYNC_KEY = "academic_notes_sync_v1";
const OPS_ACADEMIC_NOTIFICATION_KEY = "ops_to_academic_notifications_v1";
const OPS_ACADEMIC_DISTRIBUTED_KEY = "ops_academic_distributed_workloads_v1";
const REQUEST_REASON_MAX_LENGTH = 240;
const LEGACY_ACADEMIC_STORAGE_KEYS = [
  SUPERVISOR_DRAFT_KEY,
  ACADEMIC_STATUS_SYNC_KEY,
  ACADEMIC_NOTES_SYNC_KEY,
  OPS_ACADEMIC_NOTIFICATION_KEY,
  OPS_ACADEMIC_DISTRIBUTED_KEY,
] as const;
type AcademicNotification = {
  id: string;
  recipientStaffId: string;
  recipientName: string;
  recipientEmail: string;
  fromName?: string;
  fromEmail?: string;
  subject: string;
  body: string;
  sentAt: string;
  readAt?: string;
};

type AcademicWorkloadRowResponse = {
  id: string;
  name: string;
  employeeId: string;
  department?: string | null;
  title?: string | null;
  notes?: string | null;
  hours: number;
  targetTeachingRatio?: number | null;
  teachingTargetHours?: number | null;
  status: "initial" | "pending" | "approved" | "rejected" | "";
  confirmation: "confirmed" | "unconfirmed";
  confirmationTime?: string | null;
  supervisorNote?: string | null;
  assignedBy?: string | null;
  pushedAt?: string | null;
  academicYear?: number | null;
  semester?: string | null;
  cancelled?: boolean;
};

type AcademicWorkloadListResponse = {
  items: AcademicWorkloadRowResponse[];
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

type AcademicSearchFilters = {
  status: "all" | "pending" | "approved" | "rejected";
  confirmation: "" | "confirmed" | "unconfirmed";
  year: string;
  semester: "" | "S1" | "S2";
};

type AcademicWorkloadDetailResponse = AcademicWorkloadRowResponse & {
  actualTeachingRatio?: number | null;
  employmentType?: string | null;
  isNewStaff?: boolean | null;
  hodReviewRequired?: boolean | null;
  schoolOperationsNotes?: string | null;
  applicationReason?: string | null;
  breakdown?: Partial<Record<BreakdownCategory, BreakdownEntry[]>>;
  validation?: {
    isAbnormal?: boolean;
    reason?: string;
    teachingRatioOutOfRange?: boolean;
    bandMismatch?: boolean;
    hoursOutOfRange?: boolean;
    expectedMinHours?: number;
    expectedMaxHours?: number;
  };
};

type AcademicVisualizationResponse = {
  reportingPeriodLabel?: string;
  totalHoursTrend?: Array<{ semester: string; totalHours: number | null }>;
  myVsDepartmentTrend?: Array<{ semester: string; myHours: number | null; departmentAverage: number | null }>;
};

function normalizeAcademicBreakdown(
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

function mapAcademicRowToItem(row: AcademicWorkloadRowResponse, userDepartment = ""): AcademicItem {
  return {
    id: Date.now() + Math.random(),
    backendId: row.id,
    name: row.name,
    employeeId: row.employeeId,
    department: row.department ?? (userDepartment || undefined),
    title: row.title ?? undefined,
    notes: row.notes ?? "",
    hours: Number(row.hours ?? 0),
    targetTeachingRatio: row.targetTeachingRatio ?? undefined,
    teachingTargetHours: row.teachingTargetHours ?? undefined,
    status: row.status === "initial" ? "" : row.status || "",
    confirmation: row.confirmation || "unconfirmed",
    confirmationTime: row.confirmationTime ?? undefined,
    supervisorNote: row.supervisorNote ?? "",
    assignedBy: row.assignedBy ?? "",
    pushedAt: row.pushedAt ?? "",
    academicYear: row.academicYear ?? undefined,
    semester: row.semester ?? undefined,
    cancelled: Boolean(row.cancelled),
  };
}

function mapAcademicDetailToItem(detail: AcademicWorkloadDetailResponse, userDepartment = ""): AcademicItem {
  const base = mapAcademicRowToItem(detail, userDepartment);
  const normalizedBreakdown = normalizeAcademicBreakdown(detail.breakdown);
  const actualTeachingRatio = typeof detail.actualTeachingRatio === "number" ? detail.actualTeachingRatio : null;
  const v = detail.validation;
  const teachingRatioOutOfRange = v?.teachingRatioOutOfRange ?? Boolean(v?.isAbnormal);
  const hoursOutOfRange = v?.hoursOutOfRange ?? false;
  const bandMismatch = v?.bandMismatch ?? false;
  const hoursHint =
    v?.expectedMinHours != null && v?.expectedMaxHours != null
      ? `Expected ${v.expectedMinHours}–${v.expectedMaxHours} h`
      : v?.reason || "";
  return {
    ...base,
    department: detail.department ?? base.department,
    notes: detail.schoolOperationsNotes ?? detail.notes ?? "",
    newStaff: typeof detail.isNewStaff === "boolean" ? (detail.isNewStaff ? "Yes" : "No") : "—",
    hodReview: typeof detail.hodReviewRequired === "boolean" ? (detail.hodReviewRequired ? "Yes" : "No") : "—",
    employmentType: detail.employmentType ?? undefined,
    detailSnapshot: {
      breakdown: normalizedBreakdown,
      actualTeachingRatioDisplay:
        actualTeachingRatio == null ? "—" : `${(Math.round(actualTeachingRatio * 10) / 10).toFixed(1)}%`,
      actualTeachingRatioOutOfRange: teachingRatioOutOfRange,
      showActualTeachingRatioBandWarning: bandMismatch && !teachingRatioOutOfRange,
      actualRatioHoverText: v?.reason || "",
      totalHoursDisplay: (() => {
        const hrs = detail.hours ?? base.hours;
        const hrsDisplay = (Math.round(hrs * 10) / 10).toFixed(1);
        if (v?.expectedMinHours != null && v?.expectedMaxHours != null) {
          const minDays = Math.ceil(v.expectedMinHours / 8);
          const maxDays = Math.ceil(v.expectedMaxHours / 8);
          return `${hrsDisplay} (>${minDays} & <=${maxDays} working days)`;
        }
        return hrsDisplay;
      })(),
      adminModalHoursAbnormal: hoursOutOfRange,
      totalHoursTooltipText: hoursOutOfRange ? hoursHint : "",
      employmentType: detail.employmentType ?? "—",
    },
  };
}

function academicPushedAt(item: AcademicItem): string {
  return item.pushedAt?.trim() || "";
}

function formatLocalDateTime(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function academicConfirmationTimeCell(item: AcademicItem): string {
  if (item.confirmation !== "confirmed") return "";
  const raw = item.confirmationTime?.trim();
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : formatLocalDateTime(d);
}

function academicAssignedBy(item: AcademicItem) {
  return item.assignedBy ?? "—";
}

function parseDateTime(value: string) {
  return new Date(value.replace(" ", "T"));
}

function yearSemesterByItem(item: AcademicItem) {
  if (item.academicYear && item.semester) {
    return { year: item.academicYear, semester: item.semester as "S1" | "S2" | "" };
  }
  const pushedAt = academicPushedAt(item);
  const dt = pushedAt ? parseDateTime(pushedAt) : new Date("");
  if (Number.isNaN(dt.getTime())) return { year: NaN, semester: "" as "" | "S1" | "S2" };
  return { year: dt.getFullYear(), semester: dt.getMonth() < 6 ? ("S1" as const) : ("S2" as const) };
}

function computeYAxisDomain(values: Array<number | null>) {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return [0, 10] as [number, number];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return [Math.max(0, min - 2), max + 2] as [number, number];
  const span = max - min;
  const pad = Math.max(1, Math.ceil(span * 0.15));
  return [Math.max(0, min - pad), max + pad] as [number, number];
}


function confirmationPillClass(confirmation: AcademicItem["confirmation"]) {
  if (confirmation === "confirmed") return "text-[#15803d]";
  return "text-[#c2410c]";
}

function confirmationLabel(confirmation: AcademicItem["confirmation"]) {
  return confirmation === "confirmed" ? "Confirmed" : "Unconfirmed";
}

function ConfirmationIndicator({ confirmation }: { confirmation: AcademicItem["confirmation"] }) {
  const confirmed = confirmation === "confirmed";
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-semibold ${confirmationPillClass(confirmation)}`}>
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] leading-none ${
          confirmed ? "border-[#15803d] bg-[#15803d] text-white" : "border-[#c2410c] bg-white text-[#c2410c]"
        }`}
      >
        {confirmed ? "✓" : "○"}
      </span>
      {confirmationLabel(confirmation)}
    </span>
  );
}

function AcademicDetailModal({
  item,
  onClose,
  onConfirm,
}: {
  item: AcademicItem;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const breakdown = useMemo(
    () => item.detailSnapshot?.breakdown ?? normalizeAcademicBreakdown(),
    [item.detailSnapshot]
  );
  const hasHodReviewContent = useMemo(() => {
    const note = item.supervisorNote?.trim() ?? "";
    return Boolean(note) || item.status === "approved" || item.status === "rejected";
  }, [item.status, item.supervisorNote]);

  const displayTargetTeachingRatio =
    item.targetTeachingRatio != null ? `${(Math.round(item.targetTeachingRatio * 10) / 10).toFixed(1)}%` : "-";
  const displayActualTeachingRatio =
    item.detailSnapshot?.actualTeachingRatioDisplay ?? `${actualTeachingRatioPercent(breakdown)}%`;

  const canonicalHoursText = (Math.round(item.hours * 10) / 10).toFixed(1);
  const snapshotDisplay = item.detailSnapshot?.totalHoursDisplay?.trim() ?? "";
  const snapshotMatch = snapshotDisplay.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
  const snapshotLeadingHours = snapshotMatch?.[1] ?? "";
  const snapshotSuffix = snapshotMatch?.[2]?.trim() ?? "";
  const snapshotHoursMismatch =
    Boolean(snapshotDisplay) && snapshotLeadingHours !== canonicalHoursText;
  const displayTotalWorkHours =
    !snapshotHoursMismatch && snapshotSuffix
      ? `${canonicalHoursText} ${snapshotSuffix}`
      : canonicalHoursText;

  const actualRatioInputClassName = item.detailSnapshot?.actualTeachingRatioOutOfRange
    ? "border-red-500 ring-1 ring-red-300 bg-red-50/60 text-red-900"
    : item.detailSnapshot?.showActualTeachingRatioBandWarning
      ? "border-yellow-500 ring-1 ring-yellow-300 bg-yellow-50/60 text-amber-900"
      : "";
  const actualRatioTooltipClassName = item.detailSnapshot?.actualTeachingRatioOutOfRange
    ? "border-red-300 bg-red-50 text-red-900"
    : "border-yellow-300 bg-yellow-50 text-amber-900";
  const totalHoursInputClassName = !snapshotHoursMismatch && item.detailSnapshot?.adminModalHoursAbnormal
    ? "border-red-500 ring-1 ring-red-300 bg-red-50/40 text-red-900 text-xs sm:text-sm"
    : "text-xs sm:text-sm";
  const hodReviewRequiresSubmission = String(item.hodReview ?? "")
    .trim()
    .toLowerCase() === "yes";
  // Blocks confirm only while waiting for HoD — once approved the academic can self-confirm.
  const hodReviewBlocksConfirm = hodReviewRequiresSubmission && item.status !== "approved";

  const fields: WorkloadDetailField[] = [
    { label: "Name", value: item.name },
    { label: "Staff ID", value: item.employeeId },
    { label: "Target teaching ratio", value: displayTargetTeachingRatio },
    {
      label: "Actual teaching ratio",
      value: displayActualTeachingRatio,
      className: "tabular-nums font-sans",
      inputClassName: actualRatioInputClassName,
      tooltipText: item.detailSnapshot?.actualRatioHoverText || "",
      tooltipClassName: actualRatioTooltipClassName,
    },
    {
      label: "Total work hours",
      value: displayTotalWorkHours,
      className: "tabular-nums font-sans",
      inputClassName: totalHoursInputClassName,
      tooltipText: !snapshotHoursMismatch ? item.detailSnapshot?.totalHoursTooltipText || "" : "",
    },
    { label: "Employment type", value: item.detailSnapshot?.employmentType || item.employmentType || "-" },
    { label: "New Staff", value: item.newStaff || "-" },
    {
      label: "HoD Review",
      value: item.hodReview || "-",
      inputClassName: hodReviewBlocksConfirm
        ? "border-red-400 bg-red-100 font-semibold text-red-800"
        : hodReviewRequiresSubmission
          ? "border-green-400 bg-green-100 font-semibold text-green-800"
          : "",
    },
  ];

  const notesSections: WorkloadDetailNoteSection[] = [
    {
      label: "School of Operations notes",
      value: item.notes,
      rows: 4,
      collapsible: true,
      defaultExpanded: true,
    },
    {
      label: "Head of Department notes",
      value: item.supervisorNote?.trim() ? item.supervisorNote : "- no notes yet -",
      rows: 3,
      collapsible: true,
      defaultExpanded: hasHodReviewContent,
    },
  ];

  return (
    <WorkloadDetailModal
      title={`${yearSemesterByItem(item).year}-${yearSemesterByItem(item).semester}-${item.department || "Department N/A"}-Academic`}
      fields={fields}
      breakdown={breakdown}
      tabs={BREAKDOWN_TABS}
      rowKeyPrefix={item.id}
      onClose={onClose}
      notesSections={notesSections}
      footer={
        <div className="flex flex-col items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onConfirm}
            disabled={item.status === "pending" || item.status === "rejected" || hodReviewBlocksConfirm}
            className={`rounded-md px-6 py-2 text-sm font-semibold ${
              item.confirmation === "confirmed"
                ? "bg-[#16a34a] text-white"
                : item.status === "pending" || item.status === "rejected" || hodReviewBlocksConfirm
                  ? "cursor-not-allowed bg-slate-400 text-white"
                  : "bg-[#2f4d9c] text-white hover:bg-[#29458c]"
            }`}
          >
            Confirmed
          </button>
        </div>
      }
    />
  );
}

export default function Academic() {
  const { profile: authProfile } = useAuth();
  const user = profileFromAuth(authProfile);

  const [items, setItems] = useState<AcademicItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [pageError, setPageError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [confirmWorkloadOpen, setConfirmWorkloadOpen] = useState(false);
  const [supersededNoticeOpen, setSupersededNoticeOpen] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [requestReasonError, setRequestReasonError] = useState("");
  const [requestInfo, setRequestInfo] = useState("");
  const [confirmationFilter, setConfirmationFilter] = useState<"" | "confirmed" | "unconfirmed">("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [notifications] = useState<AcademicNotification[]>([]);
  const [notificationPage, setNotificationPage] = useState(1);
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null);
  const [notificationDetailOpen, setNotificationDetailOpen] = useState(false);
  const [hasNewMessage] = useState(false);
  const [messagePanelOpen, setMessagePanelOpen] = useState(false);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const currentSemester = useMemo<"S1" | "S2">(() => {
    const month = new Date().getMonth() + 1;
    return month <= 6 ? "S1" : "S2";
  }, []);
  const currentSemesterKey = useMemo(
    () => `${currentYear}-${currentSemester}`,
    [currentYear, currentSemester]
  );
  const [searchYearInput, setSearchYearInput] = useState("");
  const [searchSemesterInput, setSearchSemesterInput] = useState<"" | "S1" | "S2">("");
  const [searchFilters, setSearchFilters] = useState<AcademicSearchFilters>({
    status: "all",
    confirmation: "",
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
  const [, setAppliedVisualFilters] = useState({
    yearFrom: "",
    yearTo: "",
    semester: "All" as "All" | "S1" | "S2",
  });
  const [visualizationData, setVisualizationData] = useState<AcademicVisualizationResponse>({
    reportingPeriodLabel: "N/A",
    totalHoursTrend: [],
    myVsDepartmentTrend: [],
  });
  const [exportYearFromInput, setExportYearFromInput] = useState("");
  const [exportYearToInput, setExportYearToInput] = useState("");
  const [exportSemesterInput, setExportSemesterInput] = useState<"All" | "S1" | "S2">("All");
  const [exportMessage, setExportMessage] = useState("");
  const notificationPageSize = 10;
  const notificationTotalPages = Math.max(1, Math.ceil(notifications.length / notificationPageSize));
  const pagedNotifications = useMemo(() => {
    const start = (notificationPage - 1) * notificationPageSize;
    return notifications.slice(start, start + notificationPageSize);
  }, [notifications, notificationPage]);
  const activeNotification = useMemo(
    () => notifications.find((n) => n.id === activeNotificationId) ?? null,
    [notifications, activeNotificationId]
  );
const selectedYear = Number(searchYearInput) || currentYear;
  const yearOptions = useMemo(
    () => Array.from({ length: 11 }, (_, i) => String(selectedYear - 5 + i)),
    [selectedYear]
  );

  const loadAcademicWorkloads = useCallback(async (options?: { silent?: boolean; filters?: AcademicSearchFilters }) => {
    if (!options?.silent) setLoadingItems(true);
    setPageError("");
    try {
      const params = new URLSearchParams({ page_size: "100" });
      const filters = options?.filters;
      if (filters?.status && filters.status !== "all") params.set("status", filters.status);
      if (filters?.confirmation) params.set("confirmation", filters.confirmation);
      if (filters?.year) params.set("year", filters.year);
      if (filters?.semester) params.set("semester", filters.semester);
      const response = await apiJson<AcademicWorkloadListResponse>(`/api/academic/workloads/?${params.toString()}`);
      setItems((response.items ?? []).map((row) => mapAcademicRowToItem(row, user.department)));
    } catch (error) {
      if (!isAbortError(error)) {
        setItems([]);
        setPageError(error instanceof Error ? error.message : "Failed to load workloads.");
      }
    } finally {
      if (!options?.silent) setLoadingItems(false);
    }
  }, [user.department]);

  async function loadAcademicVisualization(yearFrom: string, yearTo: string, semester: "All" | "S1" | "S2") {
    setVisualizationLoading(true);
    setVisualError("");
    try {
      const params = new URLSearchParams();
      if (yearFrom) params.set("year_from", yearFrom);
      if (yearTo) params.set("year_to", yearTo);
      params.set("semester", semester);
      const response = await apiJson<AcademicVisualizationResponse>(
        `/api/academic/visualization/?${params.toString()}`
      );
      setVisualizationData({
        reportingPeriodLabel: response.reportingPeriodLabel || "N/A",
        totalHoursTrend: response.totalHoursTrend ?? [],
        myVsDepartmentTrend: response.myVsDepartmentTrend ?? [],
      });
    } catch (error) {
      if (!isAbortError(error)) {
        setVisualizationData({
          reportingPeriodLabel: "N/A",
          totalHoursTrend: [],
          myVsDepartmentTrend: [],
        });
        setVisualError(error instanceof Error ? error.message : "Failed to load visualization.");
      }
    } finally {
      setVisualizationLoading(false);
    }
  }

  async function loadAcademicWorkloadDetail(id: number, backendId: string) {
    const detail = await apiJson<AcademicWorkloadDetailResponse>(`/api/academic/workloads/${backendId}/`);
    const mapped = mapAcademicDetailToItem(detail);
    // Preserve the original local `id` so detailId still resolves after the spread.
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...mapped, id } : item)));
    return mapped;
  }

  useEffect(() => {
    clearLocalStorageKeys([...LEGACY_ACADEMIC_STORAGE_KEYS]);
    const defaultFrom = String(currentYear - 2);
    const defaultTo = String(currentYear);
    setVisualYearFromInput(defaultFrom);
    setVisualYearToInput(defaultTo);
    setAppliedVisualFilters({
      yearFrom: defaultFrom,
      yearTo: defaultTo,
      semester: "All",
    });
    void loadAcademicWorkloads();
    void loadAcademicVisualization(defaultFrom, defaultTo, "All");
  }, [currentYear, loadAcademicWorkloads]);

  useEffect(() => {
    const refreshLatestWorkloads = () => {
      if (document.visibilityState === "visible") {
        void loadAcademicWorkloads({ silent: true, filters: searchFilters });
      }
    };

    window.addEventListener("focus", refreshLatestWorkloads);
    document.addEventListener("visibilitychange", refreshLatestWorkloads);
    const intervalId = window.setInterval(refreshLatestWorkloads, 10000);
    return () => {
      window.removeEventListener("focus", refreshLatestWorkloads);
      document.removeEventListener("visibilitychange", refreshLatestWorkloads);
      window.clearInterval(intervalId);
    };
  }, [loadAcademicWorkloads, searchFilters]);

  const filteredItems = items;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page]);

  const detailItem = useMemo(() => items.find((x) => x.id === detailId) || null, [items, detailId]);
  const myVsDepartmentTrendData = useMemo(
    () => (visualizationData.myVsDepartmentTrend ?? []).slice(-6),
    [visualizationData]
  );
  const trendChartData = useMemo(
    () => (visualizationData.totalHoursTrend ?? []).slice(-6),
    [visualizationData]
  );
  const compareTrendDomain = useMemo(
    () =>
      computeYAxisDomain(
        myVsDepartmentTrendData.flatMap((item) => [item.myHours, item.departmentAverage])
      ),
    [myVsDepartmentTrendData]
  );
  const totalHoursDomain = useMemo(
    () => computeYAxisDomain(trendChartData.map((item) => item.totalHours)),
    [trendChartData]
  );

  const reportingPeriodLabel = useMemo(
    () => visualizationData.reportingPeriodLabel || "N/A",
    [visualizationData]
  );

  // Dynamic title driven by the first loaded item's year/semester (or current date fallback).
  const workloadReportTitle = useMemo(() => {
    const first = items[0];
    if (first?.academicYear && first?.semester) {
      return `Workload Report ${first.academicYear}-${first.semester}`;
    }
    const y = new Date().getFullYear();
    const sem = new Date().getMonth() < 6 ? "S1" : "S2";
    return `Workload Report ${y}-${sem}`;
  }, [items]);

  function toggleRow(backendId: string) {
    setSelectedIds((prev) => {
      if (prev.has(backendId)) return new Set();
      return new Set([backendId]);
    });
  }

  async function submitRequestToSupervisor(reason: string) {
    const backendIds = items.filter((x) => selectedIds.has(x.backendId)).map((x) => x.backendId);
    if (!backendIds.length) {
      setRequestInfo("No matching workload found. Please re-select and try again.");
      return;
    }
    try {
      await apiJson<{ submittedCount?: number }>("/api/academic/workload-requests/", {
        method: "POST",
        body: JSON.stringify({
          workloadIds: backendIds,
          applicationReason: reason,
        }),
      });
      setSelectedIds(new Set());
      await loadAcademicWorkloads();
      setRequestInfo(`${backendIds.length} request(s) have been submitted to HoD.`);
    } catch (error) {
      setRequestInfo(error instanceof Error ? error.message : "Failed to submit request.");
    }
  }

  function openRequestModal() {
    setRequestInfo("");
    if (selectedIds.size === 0) {
      setRequestInfo("Please select at least one row before submitting.");
      return;
    }

    setRequestReason("");
    setRequestReasonError("");
    setRequestModalOpen(true);
  }

  async function handleRequestSubmit() {
    const trimmed = requestReason.trim();
    if (!trimmed) {
      setRequestReasonError("Application reason is required.");
      return;
    }
    if (trimmed.length > REQUEST_REASON_MAX_LENGTH) {
      setRequestReasonError(`Application reason must be ${REQUEST_REASON_MAX_LENGTH} characters or less.`);
      return;
    }
    await submitRequestToSupervisor(trimmed);
    setRequestModalOpen(false);
  }

  function handleAvatarUpload(event: React.ChangeEvent<HTMLInputElement>) {
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

  async function handleConfirmFromDetail(id: number, backendId: string) {
    try {
      const response = await apiJson<{ confirmation: "confirmed"; confirmationTime?: string }>(
        `/api/academic/workloads/${backendId}/confirm/`,
        { method: "POST" }
      );
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                confirmation: response.confirmation,
                confirmationTime: response.confirmationTime || item.confirmationTime,
              }
            : item
        )
      );
    } catch (error) {
      setRequestInfo(error instanceof Error ? error.message : "Failed to confirm workload.");
    }
  }

  function openMessagePanel() {
    setNotificationPage(1);
    setActiveNotificationId(null);
    setNotificationDetailOpen(false);
    setMessagePanelOpen(true);
  }

  function handleOpenNotification(item: AcademicNotification) {
    setActiveNotificationId(item.id);
    setNotificationDetailOpen(true);
  }

  function handleSearch() {
    const nextFilters: AcademicSearchFilters = {
      status: filter,
      confirmation: confirmationFilter,
      year: searchYearInput,
      semester: searchSemesterInput,
    };
    setSearchFilters(nextFilters);
    setPage(1);
    void loadAcademicWorkloads({ filters: nextFilters });
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
    setAppliedVisualFilters({
      yearFrom: String(startYear),
      yearTo: String(endYear),
      semester: visualSemesterInput,
    });
    await loadAcademicVisualization(String(startYear), String(endYear), visualSemesterInput);
  }

  async function handleExportExcel() {
    setExportMessage("");
    try {
      const params = new URLSearchParams();
      if (exportYearFromInput) params.set("year_from", exportYearFromInput);
      if (exportYearToInput) params.set("year_to", exportYearToInput);
      params.set("semester", exportSemesterInput);
      await downloadApiFile(`/api/academic/export/?${params.toString()}`, "Academic_Workload.xlsx");
      setExportMessage("Academic workload export downloaded.");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Failed to export workload.");
    }
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] font-serif">
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-8">
        <DashboardHeader
          title="Academic Dashboard"
          hasNewMessage={hasNewMessage}
          onMessageClick={openMessagePanel}
          greetingName={user.surname}
          onAvatarClick={() => setProfileOpen(true)}
          avatarSrc={avatarSrc}
        />

        {messagePanelOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
            onClick={() => setMessagePanelOpen(false)}
          >
            <div
              className="w-full max-w-3xl rounded-2xl border-2 border-[#2f4d9c] bg-slate-50 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between rounded-t-2xl bg-[#2f4d9c] px-6 py-4 text-white">
                <div className="text-3xl font-semibold">Workload Email Notifications</div>
                <button
                  type="button"
                  aria-label="Close"
                  className="rounded p-1 text-white/90 hover:bg-white/20"
                  onClick={() => setMessagePanelOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div className="space-y-3">
                {notifications.length === 0 ? (
                  <div className="rounded-md border border-[#2f4d9c]/40 bg-[#eef3ff] px-4 py-5 text-sm text-slate-700">
                    No notifications yet.
                  </div>
                ) : (
                  <>
                    <div className="max-h-80 overflow-y-auto rounded-md border border-[#2f4d9c]/40 bg-white">
                      {pagedNotifications.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleOpenNotification(item)}
                          className={`flex w-full items-center justify-between gap-4 border-b border-[#2f4d9c]/10 px-4 py-3 text-left hover:bg-[#f3f7ff] ${
                            activeNotificationId === item.id ? "bg-[#e8efff]" : ""
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{item.subject}</span>
                          {!item.readAt ? (
                            <span className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                              New
                            </span>
                          ) : null}
                          <span className="shrink-0 text-xs text-slate-500">{item.sentAt ? formatLocalDateTime(new Date(item.sentAt)) : "N/A"}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between px-1 text-sm">
                      <button
                        type="button"
                        onClick={() => setNotificationPage((p) => Math.max(1, p - 1))}
                        disabled={notificationPage <= 1}
                        className="rounded border border-[#2f4d9c]/35 bg-[#eef3ff] px-3 py-1 font-semibold text-[#2f4d9c] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="text-slate-600">
                        Page {notificationPage} / {notificationTotalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setNotificationPage((p) => Math.min(notificationTotalPages, p + 1))}
                        disabled={notificationPage >= notificationTotalPages}
                        className="rounded border border-[#2f4d9c]/35 bg-[#eef3ff] px-3 py-1 font-semibold text-[#2f4d9c] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {notificationDetailOpen && activeNotification && (
              <div
                className="fixed inset-0 z-[75] flex items-center justify-center bg-black/25 p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="w-full max-w-2xl overflow-hidden rounded-xl border-2 border-[#2f4d9c] bg-white shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between bg-[#2f4d9c] px-5 py-3 text-white">
                    <div className="text-xl font-semibold">Email Detail</div>
                    <button
                      type="button"
                      aria-label="Close detail"
                      className="rounded p-1 text-white/90 hover:bg-white/20"
                      onClick={() => setNotificationDetailOpen(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="space-y-3 bg-slate-50 px-4 py-4">
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        Subject
                      </div>
                      <div className="px-3 py-2 text-sm font-semibold text-slate-900">{activeNotification.subject}</div>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        Sender
                      </div>
                      <div className="px-3 py-2 text-sm text-slate-700">
                        {activeNotification.fromName || "School Operations"}
                        {activeNotification.fromEmail ? ` (${activeNotification.fromEmail})` : ""}
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        Message
                      </div>
                      <div className="max-h-72 overflow-y-auto whitespace-pre-line px-3 py-2 text-sm leading-relaxed text-slate-700">
                        {activeNotification.body}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          avatarSrc={avatarSrc}
          onAvatarUpload={handleAvatarUpload}
          user={user}
        />

        <div className="mt-6 rounded-md bg-white p-8 shadow-sm">
          <SectionTabs
            tabs={[...sectionTabs]}
            activeKey={activeSection}
            onChange={(key) => setActiveSection(key as (typeof sectionTabs)[number]["key"])}
          />
          <div className={activeSection === "approval" ? "" : "hidden"}>
          <div className="mt-2 grid grid-cols-3 gap-6">
            <div className="flex flex-col gap-1">
              <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Status</div>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as "all" | "pending" | "approved" | "rejected")}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Confirmation</div>
              <select
                value={confirmationFilter}
                onChange={(e) => setConfirmationFilter(e.target.value as "" | "confirmed" | "unconfirmed")}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All</option>
                <option value="confirmed">Yes</option>
                <option value="unconfirmed">No</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Year & Semester</div>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={searchYearInput}
                  onChange={(e) => setSearchYearInput(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Year</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <select
                  value={searchSemesterInput}
                  onChange={(e) => setSearchSemesterInput(e.target.value as "" | "S1" | "S2")}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Semester</option>
                  <option value="S1">S1</option>
                  <option value="S2">S2</option>
                </select>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-center">
            <SearchButton onClick={handleSearch} />
          </div>

          <div className="mt-10 text-4xl font-semibold text-slate-700">{workloadReportTitle}</div>

          <div className="mt-6 rounded-md bg-[#eef3fb] p-4 ring-1 ring-slate-200">
            <div className="overflow-x-auto">
              <div className="max-h-[520px] overflow-y-auto">
                <table className="min-w-full border-separate border-spacing-y-0">
                <thead>
                  <tr className="text-left text-sm font-bold uppercase text-slate-500">
                    <th className="w-10 px-2 py-2"></th>
                    <th className="w-10 px-2 py-2">#</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap min-w-[170px]">Total Work Hours</th>
                    <th className="px-3 py-2 whitespace-nowrap">Confirmation</th>
                    <th className="px-3 py-2 whitespace-nowrap text-right">Confirmation time</th>
                    <th className="px-3 py-2 whitespace-nowrap">Assigned by</th>
                    <th className="px-3 py-2 whitespace-nowrap text-right">Push time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-[#eef3fb]">
                  {pageItems.map((item, idx) => {
                    const selected = selectedIds.has(item.backendId);
                    const rowCancelled = Boolean(item.cancelled);
                    const confirmationTimeCell = academicConfirmationTimeCell(item);
                    return (
                      <tr
                        key={item.id}
                        onClick={() => {
                          if (rowCancelled) {
                            setSupersededNoticeOpen(true);
                            return;
                          }
                          void loadAcademicWorkloadDetail(item.id, item.backendId)
                            .then(() => setDetailId(item.id))
                            .catch((error) => {
                              setRequestInfo(error instanceof Error ? error.message : "Failed to load workload detail.");
                            });
                        }}
                        className={`text-sm ${
                          rowCancelled
                            ? "cursor-not-allowed border-y border-slate-300/80 bg-slate-200 text-slate-500"
                            : `cursor-pointer ${selected ? "border-l-4 border-[#2f4d9c] bg-[#eef2ff]" : "bg-white"}`
                        }`}
                      >
                        <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRow(item.backendId)}
                            className={`h-4 w-4 accent-[#2f4d9c] ${rowCancelled ? "opacity-50" : ""}`}
                          />
                        </td>
                        <td
                          className={`px-2 py-3 text-center tabular-nums font-sans ${
                            rowCancelled ? "text-slate-500" : "text-slate-600"
                          }`}
                        >
                          {(page - 1) * pageSize + idx + 1}
                        </td>
                        <td
                          className={`px-3 py-3 font-medium ${
                            rowCancelled ? "text-slate-500" : "text-slate-700"
                          }`}
                        >
                          <div>{item.name}</div>
                          <div className="text-xs text-slate-400">{item.employeeId}</div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {item.status ? (
                            <span
                              className={`inline-flex justify-center ${rowCancelled ? "grayscale opacity-70" : ""}`}
                            >
                              <StatusPill status={item.status as "pending" | "approved" | "rejected"} variant="academic" />
                            </span>
                          ) : (
                            <span className="text-sm font-semibold text-slate-500">-</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex justify-center ${rowCancelled ? "grayscale opacity-70" : ""}`}>
                            <WorkHoursBadge hours={item.hours} />
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex ${rowCancelled ? "grayscale opacity-70" : ""}`}>
                            <ConfirmationIndicator confirmation={item.confirmation} />
                          </span>
                        </td>
                        <td
                          className={`px-3 py-3 text-right text-sm font-sans ${
                            rowCancelled ? "text-slate-500" : "text-slate-800"
                          }`}
                        >
                          {confirmationTimeCell ? (
                            <span className="font-semibold tabular-nums">{confirmationTimeCell}</span>
                          ) : null}
                        </td>
                        <td className={`px-3 py-3 ${rowCancelled ? "text-slate-500" : "text-slate-700"}`}>
                          {academicAssignedBy(item)}
                        </td>
                        <td
                          className={`px-3 py-3 text-right text-sm tabular-nums font-sans font-semibold ${
                            rowCancelled ? "text-slate-500" : "text-slate-800"
                          }`}
                        >
                          {(() => {
                            const raw = academicPushedAt(item);
                            if (!raw) return "—";
                            const d = parseDateTime(raw);
                            return Number.isNaN(d.getTime()) ? raw : formatLocalDateTime(d);
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                  {loadingItems && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!loadingItems && pageError && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-sm font-semibold text-[#dc2626]">
                        {pageError}
                      </td>
                    </tr>
                  )}
                  {!loadingItems && !pageError && pageItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                        No items found
                      </td>
                    </tr>
                  )}
                </tbody>
                </table>
              </div>
            </div>
            <PaginationControls
              page={page}
              totalPages={totalPages}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              disablePrev={page <= 1}
              disableNext={page >= totalPages}
            />
          </div>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={openRequestModal}
              className="flex items-center gap-2 rounded bg-[#2f4d9c] px-10 py-2 text-sm font-bold text-white shadow"
            >
              <span className="text-base">✓</span>
              Submit Request
            </button>
            <p className="max-w-2xl px-4 text-center text-xs leading-relaxed text-slate-500">
              You can self-confirm workload from the row detail view. Use <span className="font-semibold text-slate-600">Submit Request</span>{" "}
              only when you or the system still have doubts and cannot self-confirm—the request is sent to your Head of Department for
              review.
            </p>
          </div>
          {requestInfo && <div className="mt-3 text-center text-sm font-semibold text-[#2f4d9c]">{requestInfo}</div>}
          </div>

          {activeSection === "visualization" && (
            <div className="space-y-5">
              <div>
                <div className="text-2xl font-semibold text-slate-800">Visualization</div>
                <div className="text-sm text-slate-500">Use filters to view workload status and work-hour trends.</div>
              </div>
              <div className="rounded-md bg-[#f4f7ff] p-4">
                <ReportingFilterIntro
                  title="Reporting Filter"
                  description="Select year and semester to update the reporting window for all charts."
                />
                <YearRangeSemesterActionRow
                  yearFrom={visualYearFromInput}
                  yearTo={visualYearToInput}
                  semester={visualSemesterInput}
                  onYearFromChange={setVisualYearFromInput}
                  onYearToChange={setVisualYearToInput}
                  onSemesterChange={setVisualSemesterInput}
                  actionLabel="Search"
                  onActionClick={handleApplyVisualizationFilter}
                  yearFromPlaceholder="e.g. 2024"
                  yearToPlaceholder="e.g. 2026"
                />
                {visualError && <div className="mt-3 text-sm font-semibold text-[#dc2626]">{visualError}</div>}
                <div className="mt-2 text-sm font-semibold text-[#2f4d9c]">
                  For readability, the chart displays the latest 6 semesters in the selected range.
                </div>
              </div>
              <ReportingPeriodBar periodLabel={reportingPeriodLabel} />
              {visualizationLoading && (
                <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                  Loading visualization...
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="mb-2 text-base font-semibold text-slate-700">Total Work Hours Trend</div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="semester" />
                        <YAxis allowDecimals={false} domain={totalHoursDomain} />
                        <Tooltip />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="totalHours"
                          stroke="#2f4d9c"
                          name="Total Hours"
                          dot={(props: any) => {
                            const isCurrent = props?.payload?.semester === currentSemesterKey.replace("-", " ");
                            return (
                              <circle
                                cx={props.cx}
                                cy={props.cy}
                                r={isCurrent ? 5 : 3}
                                fill={isCurrent ? "#2f4d9c" : "#ffffff"}
                                stroke="#2f4d9c"
                                strokeWidth={isCurrent ? 2 : 1.5}
                              />
                            );
                          }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="mb-2 text-base font-semibold text-slate-700">
                    My Hours vs Department Average Trend
                  </div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={myVsDepartmentTrendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="semester" />
                        <YAxis allowDecimals={false} domain={compareTrendDomain} />
                        <Tooltip />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="myHours"
                          stroke="#2f4d9c"
                          name="My Work Hours"
                          dot={(props: any) => {
                            const isCurrent = props?.payload?.semester === currentSemesterKey.replace("-", " ");
                            return (
                              <circle
                                cx={props.cx}
                                cy={props.cy}
                                r={isCurrent ? 5 : 3}
                                fill={isCurrent ? "#1e3a8a" : "#ffffff"}
                                stroke="#2f4d9c"
                                strokeWidth={isCurrent ? 2 : 1.5}
                              />
                            );
                          }}
                          activeDot={{ r: 6 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="departmentAverage"
                          stroke="#4f75cf"
                          name="Department Average"
                          dot={(props: any) => {
                            const isCurrent = props?.payload?.semester === currentSemesterKey.replace("-", " ");
                            return (
                              <circle
                                cx={props.cx}
                                cy={props.cy}
                                r={isCurrent ? 5 : 3}
                                fill={isCurrent ? "#93c5fd" : "#ffffff"}
                                stroke="#4f75cf"
                                strokeWidth={isCurrent ? 2 : 1.5}
                              />
                            );
                          }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === "export" && (
            <div className="space-y-5">
              <div>
                <div className="text-2xl font-semibold text-slate-800">Export Excel</div>
                <div className="text-sm text-slate-500">
                  Configure optional filters and export academic workload data.
                </div>
              </div>
              <div className="rounded-md bg-[#f4f7ff] p-4">
                <YearRangeSemesterActionRow
                  yearFrom={exportYearFromInput}
                  yearTo={exportYearToInput}
                  semester={exportSemesterInput}
                  onYearFromChange={setExportYearFromInput}
                  onYearToChange={setExportYearToInput}
                  onSemesterChange={setExportSemesterInput}
                  actionLabel="Export Excel"
                  onActionClick={handleExportExcel}
                  yearFromPlaceholder="Optional"
                  yearToPlaceholder="Optional"
                />
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

      {detailItem && (
        <AcademicDetailModal
          item={detailItem}
          onClose={() => setDetailId(null)}
          onConfirm={() => { if (detailItem.confirmation !== "confirmed") setConfirmWorkloadOpen(true); }}
        />
      )}

      {confirmWorkloadOpen && detailItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-md bg-white shadow-lg">
            <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
              <div className="text-base font-bold">Confirm Workload</div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded bg-white/10 text-lg hover:bg-white/20"
                onClick={() => setConfirmWorkloadOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="px-5 py-5 text-sm text-slate-700">
              Are you sure you want to confirm this workload? This action cannot be undone.
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setConfirmWorkloadOpen(false)}
              >
                No
              </button>
              <button
                type="button"
                className="rounded-md bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#29458c]"
                onClick={async () => {
                  setConfirmWorkloadOpen(false);
                  await handleConfirmFromDetail(detailItem.id, detailItem.backendId);
                  setDetailId(null);
                }}
              >
                Yes, Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {requestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-md bg-white shadow-lg">
            <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
              <div className="text-base font-bold">Submit Application</div>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded bg-white/10 text-lg hover:bg-white/20"
                onClick={() => setRequestModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="text-sm font-semibold text-slate-700">Application reason (required)</div>
              <textarea
                value={requestReason}
                onChange={(e) => {
                  setRequestReason(e.target.value);
                  if (requestReasonError) setRequestReasonError("");
                }}
                maxLength={REQUEST_REASON_MAX_LENGTH}
                placeholder="Please write the reason for this submission."
                className="h-28 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2f4d9c]"
              />
              <div className="text-right text-xs text-slate-500">{requestReason.length}/{REQUEST_REASON_MAX_LENGTH}</div>
              {requestReasonError && <div className="text-sm font-semibold text-[#dc2626]">{requestReasonError}</div>}
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setRequestModalOpen(false)}
                  className="rounded bg-slate-200 px-6 py-2 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRequestSubmit}
                  className="rounded bg-[#2f4d9c] px-6 py-2 text-sm font-semibold text-white"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  }
