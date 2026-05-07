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
import StatusPill from "../components/common/StatusPill";
import YearRangeSemesterActionRow from "../components/common/YearRangeSemesterActionRow";
import ThemedNoticeModal, { SUPERSEDED_RECORD_MESSAGE } from "../components/common/ThemedNoticeModal";
import WorkHoursBadge from "../components/common/WorkHoursBadge";
import type { ProfileModalUser } from "../components/common/ProfileModalFieldGrid";

type AcademicItem = {
  id: number;
  name: string;
  employeeId: string;
  department?: string;
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

function workloadBreakdownTotalLabel(tab: BreakdownCategory): string {
  switch (tab) {
    case "Teaching":
      return "Teaching Total";
    case "HDR":
      return "HDR Total";
    case "Service":
      return "Service Total";
    case "Assigned Roles":
      return "Assigned Roles Total";
    case "Research (residual)":
      return "Research Total";
    default:
      return "Total";
  }
}

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
  sourceWorkloadId?: number;
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
  detailSnapshot?: WorkloadDetailSnapshot;
};

const SUPERVISOR_DRAFT_KEY = "academic_to_supervisor_requests_v1";
const ACADEMIC_STATUS_SYNC_KEY = "academic_status_sync_v1";
const ACADEMIC_NOTES_SYNC_KEY = "academic_notes_sync_v1";
const SUPERVISOR_SYNC_EVENT = "supervisor-status-updated";
const ACADEMIC_DRAFT_EVENT = "academic-drafts-updated";
const OPS_ACADEMIC_NOTIFICATION_KEY = "ops_to_academic_notifications_v1";
const OPS_ACADEMIC_DISTRIBUTED_KEY = "ops_academic_distributed_workloads_v1";
const REQUEST_REASON_MAX_LENGTH = 240;
const ACADEMIC_DASHBOARD_USER: ProfileModalUser = {
  surname: "Dias",
  firstName: "John",
  employeeId: "12345931",
  title: "Lecturer",
  department: "Physics",
  email: "john.dias@uwa.edu.au",
};

type SupervisorStateRow = {
  id?: number;
  studentId?: string;
  name?: string;
  title?: string;
  department?: string;
  status?: string;
  cancelled?: boolean;
  operatedBy?: string;
  hours?: number;
  notes?: string;
  description?: string;
  targetTeachingRatio?: number;
  teachingTargetHours?: number;
  workloadNewStaff?: boolean;
  hodReview?: string;
  detailSnapshot?: WorkloadDetailSnapshot;
};

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
    const syncedStatus = synced[String(item.id)];
    const syncedNote = noteMap[String(item.id)];
    if (!syncedStatus && !syncedNote) return item;
    // Keep "-" as initialization when no synced status; otherwise follow HoD sync.
    const nextStatus: AcademicItem["status"] = syncedStatus || item.status;
    return {
      ...item,
      status: nextStatus,
      supervisorNote: syncedNote || item.supervisorNote || "",
    };
  });
}

function readDistributedItemsForAcademic(employeeId: string): AcademicItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OPS_ACADEMIC_DISTRIBUTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const rows = parsed as SupervisorStateRow[];
    const filtered = rows.filter((row) => {
      const sid = String(row.studentId ?? "").trim();
      return sid === employeeId && row.cancelled !== true && row.status === "approved";
    });
    return filtered.map((row, idx) => {
      const sid = String(row.studentId ?? "").trim();
      const rawHodReview = String(row.hodReview ?? "").trim().toLowerCase();
      return {
        id: Number.isFinite(row.id) ? Number(row.id) : idx + 1,
        name: String(row.name ?? "").trim() || `Staff ${sid}`,
        employeeId: sid,
        department: String(row.department ?? "").trim() || ACADEMIC_DASHBOARD_USER.department,
        title: String(row.title ?? "").trim() || undefined,
        notes: String(row.notes ?? row.description ?? "").trim(),
        hours: typeof row.hours === "number" && Number.isFinite(row.hours) ? row.hours : 0,
        status: "",
        confirmation: "unconfirmed",
        assignedBy: String(row.operatedBy ?? "").trim() || "School Operations",
        targetTeachingRatio:
          typeof row.targetTeachingRatio === "number" && Number.isFinite(row.targetTeachingRatio)
            ? row.targetTeachingRatio
            : undefined,
        teachingTargetHours:
          typeof row.teachingTargetHours === "number" && Number.isFinite(row.teachingTargetHours)
            ? row.teachingTargetHours
            : undefined,
        newStaff: row.workloadNewStaff ? "Yes" : "No",
        hodReview: rawHodReview === "yes" ? "Yes" : "No",
        detailSnapshot: row.detailSnapshot,
      };
    });
  } catch {
    return [];
  }
}

function readAcademicNotifications(employeeId: string): AcademicNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OPS_ACADEMIC_NOTIFICATION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as AcademicNotification[])
      .filter((n) => String(n.recipientStaffId ?? "").trim() === employeeId)
      .sort((a, b) => {
        const ta = Date.parse(a.sentAt ?? "");
        const tb = Date.parse(b.sentAt ?? "");
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });
  } catch {
    return [];
  }
}

function markAcademicNotificationRead(employeeId: string, notificationId: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(OPS_ACADEMIC_NOTIFICATION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const now = new Date().toISOString();
    const next = (parsed as AcademicNotification[]).map((n) => {
      if (String(n.recipientStaffId ?? "").trim() !== employeeId) return n;
      if (n.id !== notificationId) return n;
      return n.readAt ? n : { ...n, readAt: now };
    });
    window.localStorage.setItem(OPS_ACADEMIC_NOTIFICATION_KEY, JSON.stringify(next));
  } catch {
    // no-op for local mock state
  }
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
    "Research (residual)": [{ name: "Research (residual)", hours: 0 }],
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
  const [hodNotesExpanded, setHodNotesExpanded] = useState(false);
  const breakdown = useMemo(
    () => item.detailSnapshot?.breakdown ?? breakdownById(item.id, item.hours),
    [item.detailSnapshot, item.id, item.hours]
  );
  const hasHodReviewContent = useMemo(() => {
    const note = item.supervisorNote?.trim() ?? "";
    return Boolean(note) || item.status === "approved" || item.status === "rejected";
  }, [item.status, item.supervisorNote]);

  useEffect(() => {
    setHodNotesExpanded(hasHodReviewContent);
  }, [item.id, hasHodReviewContent]);
  const displayTargetTeachingRatio =
    item.targetTeachingRatio != null ? `${(Math.round(item.targetTeachingRatio * 10) / 10).toFixed(1)}%` : "—";
  const displayActualTeachingRatio =
    item.detailSnapshot?.actualTeachingRatioDisplay ?? `${actualTeachingRatioPercent(breakdown)}%`;
  // Keep modal and table on the same source of truth (`item.hours`), while
  // still showing Ops-provided range hint suffix when it matches.
  const canonicalHoursText = String(item.hours);
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
  const tabRows = breakdown[activeTab];
  const tabTotal = tabRows.reduce((sum, row) => sum + (row.excludeFromWorkloadTotal ? 0 : row.hours), 0);
  const hodReviewRequiresSubmission = String(item.hodReview ?? "")
    .trim()
    .toLowerCase() === "yes";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-md bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
          <div className="flex items-center gap-3">
            <div className="text-lg font-bold">Academic Workload Detail</div>
            <div className="rounded bg-white/15 px-3 py-1 text-xs font-semibold">
              {item.department || "Department N/A"}
            </div>
          </div>
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
            <InfoField label="Staff ID" value={item.employeeId} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Target teaching ratio" value={displayTargetTeachingRatio} />
            <InfoField
              label="Actual teaching ratio"
              value={displayActualTeachingRatio}
              className="tabular-nums font-sans"
              inputClassName={actualRatioInputClassName}
              tooltipText={item.detailSnapshot?.actualRatioHoverText || ""}
              tooltipClassName={actualRatioTooltipClassName}
            />
            <InfoField
              label="Total work hours"
              value={displayTotalWorkHours}
              className="tabular-nums font-sans"
              inputClassName={totalHoursInputClassName}
              tooltipText={!snapshotHoursMismatch ? item.detailSnapshot?.totalHoursTooltipText || "" : ""}
            />
            <InfoField label="Employment type" value={item.detailSnapshot?.employmentType || item.employmentType || "—"} />
            <InfoField label="New Staff" value={item.newStaff || "—"} />
            <InfoField
              label="HoD Review"
              value={item.hodReview || "—"}
              inputClassName={
                hodReviewRequiresSubmission
                  ? "border-red-400 bg-red-100 font-semibold text-red-800"
                  : ""
              }
            />
          </div>
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
                    <td className="px-3 py-2 font-semibold">{workloadBreakdownTotalLabel(activeTab)}</td>
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
          <div>
            <button
              type="button"
              onClick={() => setHodNotesExpanded((v) => !v)}
              className="flex w-full items-center justify-between rounded border border-slate-300 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500"
            >
              <span>Head of Department notes</span>
              <span className="text-base leading-none">{hodNotesExpanded ? "−" : "+"}</span>
            </button>
            {hodNotesExpanded ? (
              <textarea
                readOnly
                value={item.supervisorNote?.trim() ? item.supervisorNote : "- no notes yet -"}
                className="mt-1 h-20 w-full resize-none rounded border border-slate-300 px-3 py-2 text-sm"
              />
            ) : null}
          </div>
          <div className="flex flex-col items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                onConfirm();
              }}
              disabled={hodReviewRequiresSubmission}
              className={`rounded-md px-6 py-2 text-sm font-semibold ${
                item.confirmation === "confirmed"
                  ? "bg-[#16a34a] text-white"
                  : hodReviewRequiresSubmission
                    ? "cursor-not-allowed bg-slate-400 text-white"
                    : "bg-[#2f4d9c] text-white hover:bg-[#29458c]"
              }`}
            >
              Confirmed
            </button>
            {hodReviewRequiresSubmission && (
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
  const user = ACADEMIC_DASHBOARD_USER;

  const [items, setItems] = useState<AcademicItem[]>(() => {
    const base = readDistributedItemsForAcademic(ACADEMIC_DASHBOARD_USER.employeeId);
    const synced = readAcademicStatusSync();
    const syncedNotes = readAcademicNotesSync();
    return applySyncedStatus(base, synced, syncedNotes);
  });

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
  const [notifications, setNotifications] = useState<AcademicNotification[]>(() =>
    readAcademicNotifications(ACADEMIC_DASHBOARD_USER.employeeId)
  );
  const [notificationPage, setNotificationPage] = useState(1);
  const [activeNotificationId, setActiveNotificationId] = useState<string | null>(null);
  const [notificationDetailOpen, setNotificationDetailOpen] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(() =>
    readAcademicNotifications(ACADEMIC_DASHBOARD_USER.employeeId).some((item) => !item.readAt)
  );
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
  const notificationRecipientLabel = useMemo(() => {
    const first = notifications[0];
    if (!first) return `${user.firstName} ${user.surname}`;
    return `${first.recipientName}${first.recipientEmail ? ` (${first.recipientEmail})` : ""}`;
  }, [notifications, user.firstName, user.surname]);
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

  useEffect(() => {
    // Safety cleanup: remove legacy blocked message from earlier client-only logic.
    if (requestInfo.toLowerCase().startsWith("submit blocked:")) {
      setRequestInfo("");
    }
  }, [requestInfo]);
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
      const distributed = readDistributedItemsForAcademic(user.employeeId);
      const synced = readAcademicStatusSync();
      const syncedNotes = readAcademicNotesSync();
      setItems(applySyncedStatus(distributed, synced, syncedNotes));
      const nextNotifications = readAcademicNotifications(user.employeeId);
      setNotifications(nextNotifications);
      setHasNewMessage(nextNotifications.some((item) => !item.readAt));
      setNotificationPage((prev) => Math.min(Math.max(1, prev), Math.max(1, Math.ceil(nextNotifications.length / 10))));
      setActiveNotificationId((prev) => (prev && nextNotifications.some((item) => item.id === prev) ? prev : null));
    }

    function onStorage(e: StorageEvent) {
      if (
        e.key === OPS_ACADEMIC_DISTRIBUTED_KEY ||
        e.key === ACADEMIC_STATUS_SYNC_KEY ||
        e.key === ACADEMIC_NOTES_SYNC_KEY ||
        e.key === OPS_ACADEMIC_NOTIFICATION_KEY
      ) {
        syncFromSupervisor();
      }
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
      sourceWorkloadId: row.id,
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
      detailSnapshot: row.detailSnapshot,
    }));

    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(SUPERVISOR_DRAFT_KEY);
      const existing = raw ? (JSON.parse(raw) as SupervisorDraftRequest[]) : [];
      window.localStorage.setItem(SUPERVISOR_DRAFT_KEY, JSON.stringify([...drafts, ...existing]));

      // Persist pending status immediately so Academic table won't fall back to "-"
      // when other localStorage sync flows refresh rows from distributed snapshots.
      const statusRaw = window.localStorage.getItem(ACADEMIC_STATUS_SYNC_KEY);
      const statusMap =
        statusRaw && typeof statusRaw === "string"
          ? (JSON.parse(statusRaw) as Record<string, "pending" | "approved" | "rejected">)
          : {};
      rows.forEach((row) => {
        statusMap[String(row.id)] = "pending";
      });
      window.localStorage.setItem(ACADEMIC_STATUS_SYNC_KEY, JSON.stringify(statusMap));
      window.dispatchEvent(new Event(SUPERVISOR_SYNC_EVENT));
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
    setRequestInfo("");
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
    const nextNotifications = readAcademicNotifications(user.employeeId);
    setNotifications(nextNotifications);
    setNotificationPage(1);
    setActiveNotificationId(nextNotifications[0]?.id ?? null);
    setNotificationDetailOpen(false);
    setMessagePanelOpen(true);
    setHasNewMessage(nextNotifications.some((item) => !item.readAt));
  }

  function handleOpenNotification(item: AcademicNotification) {
    setActiveNotificationId(item.id);
    setNotificationDetailOpen(true);
    if (!item.readAt) {
      markAcademicNotificationRead(user.employeeId, item.id);
      const nextNotifications = readAcademicNotifications(user.employeeId);
      setNotifications(nextNotifications);
      setHasNewMessage(nextNotifications.some((next) => !next.readAt));
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

          <div className="mt-10 text-4xl font-semibold text-slate-700">Workload Report Sem 1 - 2025</div>

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
                            : `cursor-pointer ${selected ? "border-l-4 border-[#2f4d9c] bg-[#eef2ff]" : "bg-white"}`
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
                  {pageItems.length === 0 && (
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