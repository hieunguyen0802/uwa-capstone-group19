import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
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
import InfoField from "../components/common/InfoField";
import PaginationControls from "../components/common/PaginationControls";
import ProfileModal from "../components/common/ProfileModal";
import ReportingFilterIntro from "../components/common/ReportingFilterIntro";
import ReportingPeriodBar from "../components/common/ReportingPeriodBar";
import SearchButton from "../components/common/SearchButton";
import SectionTabs from "../components/common/SectionTabs";
import { MOCK_DASHBOARD_USER } from "../data/mockDashboardUser";
import StatusPill from "../components/common/StatusPill";
import YearRangeSemesterActionRow from "../components/common/YearRangeSemesterActionRow";
import ThemedNoticeModal, { SUPERSEDED_RECORD_MESSAGE } from "../components/common/ThemedNoticeModal";
import WorkHoursBadge from "../components/common/WorkHoursBadge";
import { submitContactSchoolOfOperations } from "../api/contactSchoolOfOperations";

type AcademicItem = {
  id: number;
  name: string;
  employeeId: string;
  /** Job title (shown in detail modal; optional — falls back to generated title by id). */
  title?: string;
  notes: string;
  hours: number;
  /** Expected teaching hours; if the teaching subtotal in the breakdown is lower, self-confirm is blocked as abnormal. */
  teachingTargetHours?: number;
  /** Target teaching share of total workload (0–100), e.g. staff sheet "Target Teaching %". */
  targetTeachingRatio?: number;
  status: "pending" | "approved" | "rejected" | "";
  confirmation: "confirmed" | "unconfirmed";
  /** When confirmation is confirmed, time the workload was confirmed (empty in list when unconfirmed). */
  confirmationTime?: string;
  supervisorNote?: string;
  /** Admin (or delegate) who assigned this workload task to the staff member. */
  assignedBy?: string;
  /** When true (from API), row is read-only and detail is blocked — superseded by a newer version. */
  cancelled?: boolean;
};

type BreakdownEntry = {
  name: string;
  hours: number;
};

type BreakdownCategory = "Teaching" | "Assigned Roles" | "HDR" | "Service";

type BreakdownData = Record<BreakdownCategory, BreakdownEntry[]>;

const BREAKDOWN_TABS: BreakdownCategory[] = ["Teaching", "Assigned Roles", "HDR", "Service"];

function totalBreakdownHours(breakdown: BreakdownData): number {
  return BREAKDOWN_TABS.reduce(
    (sum, tab) => sum + breakdown[tab].reduce((s, row) => s + row.hours, 0),
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

function isDetailHoursAbnormal(item: AcademicItem, breakdown: BreakdownData): boolean {
  const actualRatioPct = actualTeachingRatioPercent(breakdown);
  const targetRatio = item.targetTeachingRatio;
  if (targetRatio != null) {
    if (actualRatioPct + 0.05 < targetRatio) return true;
  }
  const teachingTarget = item.teachingTargetHours;
  if (teachingTarget != null) {
    const teachingActual = teachingHoursFromBreakdown(breakdown);
    if (teachingActual + 0.001 < teachingTarget) return true;
  }
  return false;
}

type SupervisorDraftRequest = {
  id: number;
  studentId: string;
  semesterLabel: string;
  periodLabel: string;
  name: string;
  unit: string;
  notes?: string;
  /** Legacy drafts from localStorage may still use this key. */
  description?: string;
  requestReason?: string;
  title: string;
  department: string;
  rate: number;
  status: "pending";
  hours: number;
  targetTeachingRatio?: number;
  teachingTargetHours?: number;
};

const SUPERVISOR_DRAFT_KEY = "academic_to_supervisor_requests_v1";
const ACADEMIC_STATUS_SYNC_KEY = "academic_status_sync_v1";
const ACADEMIC_NOTES_SYNC_KEY = "academic_notes_sync_v1";
const SUPERVISOR_SYNC_EVENT = "supervisor-status-updated";
const ACADEMIC_DRAFT_EVENT = "academic-drafts-updated";
const REQUEST_REASON_MAX_LENGTH = 240;

function readAcademicStatusSync(): Record<string, "pending" | "approved" | "rejected"> {
  if (typeof window === "undefined") return {};

  try {
    const storedAcademicStatusJson = window.localStorage.getItem(ACADEMIC_STATUS_SYNC_KEY);

    if (!storedAcademicStatusJson) return {};

    const academicStatusMap = JSON.parse(storedAcademicStatusJson);

    if (!academicStatusMap || typeof academicStatusMap !== "object") return {};

    return academicStatusMap as Record<string, "pending" | "approved" | "rejected">;
  } catch {
    return {};
  }
}

function readAcademicNotesSync(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const storedAcademicNotesJson = window.localStorage.getItem(ACADEMIC_NOTES_SYNC_KEY);
    if (!storedAcademicNotesJson) return {};
    const academicNotesMap = JSON.parse(storedAcademicNotesJson);
    if (!academicNotesMap || typeof academicNotesMap !== "object") return {};
    return academicNotesMap as Record<string, string>;
  } catch {
    return {};
  }
}

function applySyncedStatus(
  rows: AcademicItem[],
  synced: Record<string, "pending" | "approved" | "rejected">,
  noteMap: Record<string, string>
) {
  return rows.map((item) => {
    const syncedStatus = synced[item.employeeId];
    const syncedNote = noteMap[item.employeeId];
    if (!syncedStatus && !syncedNote) return item;
    return {
      ...item,
      status: syncedStatus || item.status,
      supervisorNote: syncedNote || item.supervisorNote || "",
    };
  });
}

function pushedTimeById(id: number) {
  const day = ((id - 1) % 28) + 1;
  const hour = 9 + (id % 8);
  return `2026-03-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:30`;
}

function formatLocalDateTime(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function titleById(id: number) {
  const titles = ["Professor", "Associate Professor", "Senior Lecturer", "Lecturer"];
  return titles[id % titles.length];
}

function academicItemTitle(item: AcademicItem) {
  return item.title ?? titleById(item.id);
}

function academicConfirmationTimeCell(item: AcademicItem): string {
  if (item.confirmation !== "confirmed") return "";
  return item.confirmationTime ?? pushedTimeById(item.id);
}

function academicAssignedBy(item: AcademicItem) {
  return item.assignedBy ?? "—";
}

function parseDateTime(value: string) {
  return new Date(value.replace(" ", "T"));
}

function yearSemesterById(id: number) {
  const dt = parseDateTime(pushedTimeById(id));
  if (Number.isNaN(dt.getTime())) return { year: NaN, semester: "" as "" | "S1" | "S2" };
  return { year: dt.getFullYear(), semester: dt.getMonth() < 6 ? ("S1" as const) : ("S2" as const) };
}

type SemesterSlot = { key: string; label: string };

function buildSemesterSlots(yearFrom: number, yearTo: number, semesterFilter: "All" | "S1" | "S2") {
  const slots: SemesterSlot[] = [];
  for (let year = yearFrom; year <= yearTo; year += 1) {
    if (semesterFilter === "All" || semesterFilter === "S1") slots.push({ key: `${year}-S1`, label: `${year} S1` });
    if (semesterFilter === "All" || semesterFilter === "S2") slots.push({ key: `${year}-S2`, label: `${year} S2` });
  }
  return slots;
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
  };
}

function statusLabel(status: AcademicItem["status"]) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "") return "";
  return "Pending";
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
  const [activeTab, setActiveTab] = useState<BreakdownCategory>("Teaching");
  const [descriptionExpanded, setDescriptionExpanded] = useState(true);
  const breakdown = useMemo(() => breakdownById(item.id, item.hours), [item.id, item.hours]);
  const hoursAbnormal = useMemo(() => isDetailHoursAbnormal(item, breakdown), [item, breakdown]);
  const displayTargetTeachingRatio =
    item.targetTeachingRatio != null ? `${item.targetTeachingRatio}%` : "—";
  const displayActualTeachingRatio = `${actualTeachingRatioPercent(breakdown)}%`;
  const tabRows = breakdown[activeTab];
  const tabTotal = tabRows.reduce((sum, row) => sum + row.hours, 0);
  const confirmDisabled = hoursAbnormal && item.confirmation !== "confirmed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-md bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
          <div className="text-lg font-bold">Academic Workload Detail</div>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/10 hover:bg-white/20"
            onClick={onClose}
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Name" value={item.name} />
            <InfoField label="Employee ID" value={item.employeeId} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Target teaching ratio" value={displayTargetTeachingRatio} />
            <InfoField label="Total work hours" value={String(item.hours)} />
            <InfoField label="Actual teaching ratio" value={displayActualTeachingRatio} />
            <div className="flex flex-col gap-1">
              <div className="w-fit rounded bg-[#2f4d9c] px-3 py-1 text-xs font-bold text-white">Validation</div>
              <div
                className={`flex min-h-[38px] items-center rounded border px-3 py-2 text-sm font-bold ${
                  hoursAbnormal
                    ? "border-red-400 bg-red-50 text-red-700"
                    : "border-emerald-300 bg-emerald-50 text-emerald-800"
                }`}
              >
                {hoursAbnormal ? "Abnormal" : "Normal"}
              </div>
            </div>
          </div>
          {hoursAbnormal && (
            <p className="text-sm font-medium leading-relaxed text-red-700">
              After calculating hours by workload category, the gap from your teaching targets is too large.
            </p>
          )}
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Workload Breakdown</div>
            <div className="mt-1 overflow-hidden rounded border border-slate-300">
              <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                {BREAKDOWN_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`rounded px-3 py-1 text-xs font-semibold ${
                      activeTab === tab
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
                    <th className="px-3 py-2">{activeTab}</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white text-sm text-slate-700">
                  {tabRows.map((row, idx) => (
                    <tr key={`${item.id}-${activeTab}-${idx}`}>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-sans">{row.hours}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50">
                    <td className="px-3 py-2 font-semibold">Total</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums font-sans">{tabTotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setDescriptionExpanded((v) => !v)}
              className="flex w-full items-center justify-between rounded border border-slate-300 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500"
            >
              <span>School of Operations notes</span>
              <span className="text-base leading-none">{descriptionExpanded ? "−" : "+"}</span>
            </button>
            {descriptionExpanded && (
              <textarea
                readOnly
                value={item.notes}
                className="mt-1 h-24 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm"
              />
            )}
          </div>
          {item.status ? (
            <div>
              <div className="text-xs font-semibold text-slate-500">Head of Department notes</div>
              <textarea
                readOnly
                value={item.supervisorNote || "- no notes yet -"}
                className="mt-1 h-20 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          ) : null}
          <div className="flex flex-col items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                if (!hoursAbnormal) onConfirm();
              }}
              disabled={confirmDisabled}
              className={`rounded-md px-6 py-2 text-sm font-semibold ${
                item.confirmation === "confirmed"
                  ? "bg-[#16a34a] text-white"
                  : hoursAbnormal
                    ? "cursor-not-allowed bg-slate-400 text-white"
                    : "bg-[#2f4d9c] text-white hover:bg-[#29458c]"
              }`}
            >
              Confirmed
            </button>
            {hoursAbnormal && (
              <p className="max-w-md text-center text-xs font-bold leading-relaxed text-red-700">
                Please submit to your Head of Department for adjustment review.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Academic() {
  const user = MOCK_DASHBOARD_USER;

  const [items, setItems] = useState<AcademicItem[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set([1]));
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [supersededNoticeOpen, setSupersededNoticeOpen] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [requestReasonError, setRequestReasonError] = useState("");
  const [requestInfo, setRequestInfo] = useState("");
  const [confirmationFilter, setConfirmationFilter] = useState<"" | "confirmed" | "unconfirmed">("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [hasNewMessage, setHasNewMessage] = useState(true);
  const [messagePanelOpen, setMessagePanelOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [contactSendError, setContactSendError] = useState("");
  const [contactSending, setContactSending] = useState(false);
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
  const [searchFilters, setSearchFilters] = useState<{
    status: "all" | "pending" | "approved" | "rejected";
    confirmation: "" | "confirmed" | "unconfirmed";
    year: string;
    semester: "" | "S1" | "S2";
  }>({
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
  const [appliedVisualFilters, setAppliedVisualFilters] = useState({
    yearFrom: "",
    yearTo: "",
    semester: "All" as "All" | "S1" | "S2",
  });
  const [exportYearFromInput, setExportYearFromInput] = useState("");
  const [exportYearToInput, setExportYearToInput] = useState("");
  const [exportSemesterInput, setExportSemesterInput] = useState<"All" | "S1" | "S2">("All");
  const [exportMessage, setExportMessage] = useState("");
  const selectedYear = Number(searchYearInput) || currentYear;
  const yearOptions = useMemo(
    () => Array.from({ length: 11 }, (_, i) => String(selectedYear - 5 + i)),
    [selectedYear]
  );

  const filteredItems = useMemo(() => {
    let next = searchFilters.status === "all" ? items : items.filter((x) => x.status === searchFilters.status);

    if (searchFilters.confirmation) {
      next = next.filter((x) => x.confirmation === searchFilters.confirmation);
    }

    const selectedYearNumber = Number(searchFilters.year);
    if (searchFilters.year && Number.isFinite(selectedYearNumber)) {
      next = next.filter((x) => {
        const submitted = parseDateTime(pushedTimeById(x.id));
        if (Number.isNaN(submitted.getTime())) return false;

        if (searchFilters.semester === "S1") {
          const s1Start = new Date(selectedYearNumber, 0, 1);
          const s1End = new Date(selectedYearNumber, 6, 1);
          return submitted >= s1Start && submitted < s1End;
        }

        if (searchFilters.semester === "S2") {
          const s2Start = new Date(selectedYearNumber, 6, 1);
          const s2End = new Date(selectedYearNumber + 1, 0, 1);
          return submitted >= s2Start && submitted < s2End;
        }

        return submitted.getFullYear() === selectedYearNumber;
      });
    }

    return next;
  }, [items, searchFilters]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page]);

  const detailItem = useMemo(() => items.find((x) => x.id === detailId) || null, [items, detailId]);
  const filteredVisualizationItems = useMemo(() => {
    return items.filter((item) => {
      const { year, semester } = yearSemesterById(item.id);
      if (appliedVisualFilters.semester !== "All" && semester !== appliedVisualFilters.semester) return false;
      if (appliedVisualFilters.yearFrom && Number.isFinite(year) && year < Number(appliedVisualFilters.yearFrom)) {
        return false;
      }
      if (appliedVisualFilters.yearTo && Number.isFinite(year) && year > Number(appliedVisualFilters.yearTo)) {
        return false;
      }
      return true;
    });
  }, [items, appliedVisualFilters]);
  const visualizationSemesterSlots = useMemo(() => {
    const years = filteredVisualizationItems
      .map((item) => yearSemesterById(item.id).year)
      .filter((year) => Number.isFinite(year));
    const maxYear = years.length ? Math.max(...years) : currentYear;
    const from = appliedVisualFilters.yearFrom ? Number(appliedVisualFilters.yearFrom) : maxYear - 2;
    const to = appliedVisualFilters.yearTo ? Number(appliedVisualFilters.yearTo) : maxYear;
    return buildSemesterSlots(Math.min(from, to), Math.max(from, to), appliedVisualFilters.semester);
  }, [filteredVisualizationItems, appliedVisualFilters, currentYear]);
  const myVsDepartmentTrendData = useMemo(() => {
    // Mock comparative trend data by semester for clearer personal-vs-department insights.
    const mockBySemester: Record<string, { myHours: number; departmentAverage: number }> = {
      "2024-S1": { myHours: 12.2, departmentAverage: 11.4 },
      "2024-S2": { myHours: 12.8, departmentAverage: 11.7 },
      "2025-S1": { myHours: 13.9, departmentAverage: 12.1 },
      "2025-S2": { myHours: 12.4, departmentAverage: 11.8 },
      "2026-S1": { myHours: 14.3, departmentAverage: 12.6 },
      "2026-S2": { myHours: 13.6, departmentAverage: 12.4 },
    };
    return visualizationSemesterSlots.map((slot) => {
      const mock = mockBySemester[slot.key];
      const [slotYearRaw, slotSemester] = slot.key.split("-");
      const slotYear = Number(slotYearRaw);
      const isFutureSemester =
        Number.isFinite(slotYear) &&
        (slotYear > currentYear || (slotYear === currentYear && currentSemester === "S1" && slotSemester === "S2"));
      return {
        semester: slot.label,
        myHours: isFutureSemester ? null : (mock?.myHours ?? null),
        departmentAverage: isFutureSemester ? null : (mock?.departmentAverage ?? null),
      };
    });
  }, [visualizationSemesterSlots, currentYear, currentSemester]);
  const trendChartData = useMemo(() => {
    const mockTotalBySemester: Record<string, number> = {
      "2024-S1": 260,
      "2024-S2": 275,
      "2025-S1": 289,
      "2025-S2": 255,
      "2026-S1": 291,
      "2026-S2": 284,
    };
    return visualizationSemesterSlots.map((slot) => ({
      semester: slot.label,
      totalHours: (() => {
        const [slotYearRaw, slotSemester] = slot.key.split("-");
        const slotYear = Number(slotYearRaw);
        const isFutureSemester =
          Number.isFinite(slotYear) &&
          (slotYear > currentYear || (slotYear === currentYear && currentSemester === "S1" && slotSemester === "S2"));
        return isFutureSemester ? null : (mockTotalBySemester[slot.key] ?? null);
      })(),
    }));
  }, [visualizationSemesterSlots, currentYear, currentSemester]);
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
  const reportingPeriodLabel = useMemo(() => {
    if (!visualizationSemesterSlots.length) return "N/A";
    const firstYear = Number(visualizationSemesterSlots[0].key.split("-")[0]);
    const lastYear = Number(visualizationSemesterSlots[visualizationSemesterSlots.length - 1].key.split("-")[0]);
    if (!Number.isFinite(firstYear) || !Number.isFinite(lastYear)) return "N/A";
    if (firstYear === lastYear) {
      return `${firstYear} ${appliedVisualFilters.semester === "All" ? "All Semesters" : appliedVisualFilters.semester}`;
    }
    return `${firstYear}-${lastYear} ${
      appliedVisualFilters.semester === "All" ? "All Semesters" : appliedVisualFilters.semester
    }`;
  }, [visualizationSemesterSlots, appliedVisualFilters.semester]);

  useEffect(() => {
    function syncFromSupervisor() {
      const synced = readAcademicStatusSync();
      const syncedNotes = readAcademicNotesSync();
      setItems((prev) => applySyncedStatus(prev, synced, syncedNotes));
    }

    function onStorage(e: StorageEvent) {
      if (e.key === ACADEMIC_STATUS_SYNC_KEY || e.key === ACADEMIC_NOTES_SYNC_KEY) syncFromSupervisor();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(SUPERVISOR_SYNC_EVENT, syncFromSupervisor as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SUPERVISOR_SYNC_EVENT, syncFromSupervisor as EventListener);
    };
  }, []);

  function toggleRow(id: number) {
    setSelectedIds((prev) => {
      if (prev.has(id)) return new Set();
      return new Set([id]);
    });
  }

  function submitRequestToSupervisor(reason: string) {
    const rows = items.filter((x) => selectedIds.has(x.id));
    if (!rows.length) return;

    const drafts: SupervisorDraftRequest[] = rows.map((row, idx) => ({
      id: Date.now() + idx,
      studentId: row.employeeId,
      semesterLabel: "Sem1",
      periodLabel: "2025-1",
      name: row.name,
      unit: "CITS 2200",
      notes: row.notes,
      requestReason: reason,
      title: user.title,
      department: user.department,
      rate: 70,
      status: "pending",
      hours: row.hours,
      targetTeachingRatio: row.targetTeachingRatio,
      teachingTargetHours: row.teachingTargetHours,
    }));

    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(SUPERVISOR_DRAFT_KEY);
      const existing = raw ? (JSON.parse(raw) as SupervisorDraftRequest[]) : [];
      window.localStorage.setItem(SUPERVISOR_DRAFT_KEY, JSON.stringify([...drafts, ...existing]));
      window.dispatchEvent(new Event(ACADEMIC_DRAFT_EVENT));
    }

    setSelectedIds(new Set());
    setItems((prev) =>
      prev.map((x) =>
        rows.some((r) => r.id === x.id) ? { ...x, status: "pending" } : x
      )
    );
    setRequestInfo(`${rows.length} request(s) have been submitted to Supervisor.`);
  }

  function openRequestModal() {
    if (selectedIds.size === 0) {
      setRequestInfo("Please select at least one row before submitting.");
      return;
    }
    setRequestReason("");
    setRequestReasonError("");
    setRequestModalOpen(true);
  }

  function handleRequestSubmit() {
    const trimmed = requestReason.trim();
    if (!trimmed) {
      setRequestReasonError("Application reason is required.");
      return;
    }
    if (trimmed.length > REQUEST_REASON_MAX_LENGTH) {
      setRequestReasonError(`Application reason must be ${REQUEST_REASON_MAX_LENGTH} characters or less.`);
      return;
    }
    submitRequestToSupervisor(trimmed);
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

  function handleConfirmFromDetail(id: number) {
    const now = formatLocalDateTime(new Date());
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              confirmation: "confirmed",
              confirmationTime: item.confirmationTime ?? now,
            }
          : item
      )
    );
  }

  function openMessagePanel() {
    setMessagePanelOpen(true);
    setHasNewMessage(false);
    setContactSendError("");
  }

  async function handleSendMessage() {
    const trimmed = chatInput.trim();
    if (!trimmed || contactSending) return;
    setContactSendError("");
    setContactSending(true);
    try {
      await submitContactSchoolOfOperations({
        messageBody: trimmed,
        sender: {
          employeeId: user.employeeId,
          surname: user.surname,
          firstName: user.firstName,
          email: user.email,
        },
      });
      setChatInput("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send message. Please try again.";
      setContactSendError(msg);
    } finally {
      setContactSending(false);
    }
  }

  function handleSearch() {
    setSearchFilters({
      status: filter,
      confirmation: confirmationFilter,
      year: searchYearInput,
      semester: searchSemesterInput,
    });
    setPage(1);
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
    const rows = items
      .filter((item) => {
        const { year, semester } = yearSemesterById(item.id);
        if (exportSemesterInput !== "All" && semester !== exportSemesterInput) return false;
        if (exportYearFromInput && Number.isFinite(year) && year < Number(exportYearFromInput)) return false;
        if (exportYearToInput && Number.isFinite(year) && year > Number(exportYearToInput)) return false;
        return true;
      })
      .map((item) => ({
        Name: item.name,
        EmployeeID: item.employeeId,
        Title: academicItemTitle(item),
        Notes: item.notes,
        Status: statusLabel(item.status) || "-",
        Confirmation: confirmationLabel(item.confirmation),
        ConfirmationTime: academicConfirmationTimeCell(item) || "-",
        TotalHours: item.hours,
        PushTime: pushedTimeById(item.id),
        AssignedBy: academicAssignedBy(item),
      }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Academic Workload");
    XLSX.writeFile(workbook, "Academic_Workload.xlsx");
    setExportMessage(`Exported ${rows.length} records to Academic_Workload.xlsx.`);
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] font-serif">
      <div className="mx-auto max-w-7xl px-4 pb-10 pt-8">
        <DashboardHeader
          title="Academic Dashboard"
          hasNewMessage={hasNewMessage}
          onMessageClick={openMessagePanel}
          onAvatarClick={() => setProfileOpen(true)}
          avatarSrc={avatarSrc}
        />

        {messagePanelOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
            onClick={() => setMessagePanelOpen(false)}
          >
            <div
              className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="text-3xl font-semibold text-slate-800">Contact School of Operations</div>
                <button
                  type="button"
                  aria-label="Close"
                  className="rounded p-1 text-slate-500 hover:bg-slate-200"
                  onClick={() => setMessagePanelOpen(false)}
                >
                  ✕
                </button>
              </div>

              {contactSendError ? (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {contactSendError}
                </div>
              ) : null}

              <div className="flex items-end gap-3">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Write your message..."
                  className="h-24 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 outline-none focus:border-[#2f4d9c]"
                />
                <button
                  type="button"
                  onClick={() => void handleSendMessage()}
                  disabled={contactSending}
                  className="rounded-lg bg-[#2f4d9c] px-5 py-2 text-sm font-semibold text-white hover:bg-[#264183] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {contactSending ? "Sending…" : "Send"}
                </button>
              </div>
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

          <div className="mt-10 text-4xl font-semibold text-slate-700">Workload Report Sem 1 - 2025</div>

          <div className="mt-6 rounded-md bg-white p-4 ring-1 ring-slate-200">
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
                <tbody className="divide-y divide-slate-200 bg-white">
                  {pageItems.map((item, idx) => {
                    const selected = selectedIds.has(item.id);
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
                          setDetailId(item.id);
                        }}
                        className={`text-sm ${
                          rowCancelled
                            ? "cursor-not-allowed border-y border-slate-300/80 bg-slate-200 text-slate-500"
                            : `cursor-pointer ${selected ? "border-l-4 border-[#2f4d9c] bg-[#eef2ff]" : ""}`
                        }`}
                      >
                        <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRow(item.id)}
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
                              <StatusPill status={item.status} variant="academic" />
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
                          {pushedTimeById(item.id)}
                        </td>
                      </tr>
                    );
                  })}
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
                  For readability, Visualization supports up to 3 years. Export more data in Export Excel.
                </div>
              </div>
              <ReportingPeriodBar periodLabel={reportingPeriodLabel} />
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
          onConfirm={() => {
            handleConfirmFromDetail(detailItem.id);
            setDetailId(null);
          }}
        />
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