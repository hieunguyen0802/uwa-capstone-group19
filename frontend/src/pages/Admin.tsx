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
import InfoField from "../components/common/InfoField";
import PaginationControls from "../components/common/PaginationControls";
import ProfileModal from "../components/common/ProfileModal";
import SearchButton from "../components/common/SearchButton";
import SectionTabs from "../components/common/SectionTabs";
import SectionTitleBlock from "../components/common/SectionTitleBlock";
import StaffProfileModal, {
  STAFF_PROFILE_NOTES_PLACEHOLDER,
  type StaffProfileDraft,
} from "../components/common/StaffProfileModal";
import StatusPill from "../components/common/StatusPill";
import { postWorkloadSpreadsheetImport } from "../api/workloadSpreadsheetImport";
import {
  WORKLOAD_TEMPLATE_FILENAME,
  fetchTrimmedWorkloadTemplateBlob,
} from "../workload/downloadWorkloadTemplate";
import {
  applyDuplicateTeachingUnitFlagsToLines,
  parseWorkloadWorkbookArrayBuffer,
  type WorkloadImportParseResult,
} from "../workload/parseWorkloadWorkbook";
import {
  HOD_REVIEW_COL,
  NOTES_COL,
  TEACHING_HOURS_FACTOR,
  NEW_STAFF_COL,
  TARGET_BAND_COL,
  TARGET_TEACHING_PCT_COL,
  TEACHING_UNIT_COL,
} from "../workload/workloadSpreadsheetRules";
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
  /** School Ops / academic workload notes (replaces legacy `description` in UI). */
  notes?: string;
  /** Legacy field; still read from older localStorage / drafts. */
  description?: string;
  requestReason?: string;
  title: string;
  department: string;
  rate: number;
  status: "pending" | "approved" | "rejected";
  hours: number;
  supervisorNote?: string;
  /** School Ops user shown in DISTRIBUTED BY (approve, reject, distribute, etc.). */
  operatedBy?: string;
  /** Target teaching share of total workload (0–100), for validation in the detail modal. */
  targetTeachingRatio?: number;
  /** Minimum teaching hours expected in the breakdown (optional). */
  teachingTargetHours?: number;
  /** When true (from API), row is read-only and detail is blocked — superseded by a newer version. */
  cancelled?: boolean;
  /** Imported from workload template: list shows status as "-" and confirmation as Unconfirmed by default. */
  importedFromTemplate?: boolean;
  /** Target contract band from Excel column I. */
  targetBand?: string;
  /** Workload template column D — New Staff (true/false). */
  workloadNewStaff?: boolean;
  /** Workload template column F — HoD Review (yes/no). */
  hodReview?: "yes" | "no";
  /** Snapshot copied to Academic detail modal (keeps Ops/Academic detail consistent). */
  detailSnapshot?: WorkloadDetailSnapshot;
};

type BreakdownCategory = "Teaching" | "Assigned Roles" | "HDR" | "Service" | "Research (residual)";
type BreakdownEntry = {
  name: string;
  hours: number;
  /** If true (e.g. HDR “FT students” row), count is shown but excluded from summed workload hours. */
  excludeFromWorkloadTotal?: boolean;
  /** Imported template: same role name + different hours on another row for this staff. */
  roleHourConflict?: boolean;
  /** Imported template: same Unit Code / course appears on more than one row for this staff. */
  teachingDuplicateUnit?: boolean;
};
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

/** HDR tab: imported summary row label (must match merged HDR breakdown). */
const HDR_TOTAL_ROW_LABEL = "HDR Total";

function workloadBreakdownTotalLabel(tab: BreakdownCategory): string {
  switch (tab) {
    case "Teaching":
      return "Teaching Total";
    case "HDR":
      return HDR_TOTAL_ROW_LABEL;
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

const ADMIN_WORKLOAD_BREAKDOWN_TABS: BreakdownCategory[] = [
  "Teaching",
  "HDR",
  "Service",
  "Assigned Roles",
  "Research (residual)",
];

const OPS_ACADEMIC_NOTIFICATION_KEY = "ops_to_academic_notifications_v1";
const OPS_ACADEMIC_DISTRIBUTED_KEY = "ops_academic_distributed_workloads_v1";
const OPS_SEMESTER_REPORTS_KEY = "ops_semester_report_inbox_v1";
const ACADEMIC_STATUS_SYNC_KEY = "academic_status_sync_v1";
const ACADEMIC_NOTES_SYNC_KEY = "academic_notes_sync_v1";
const SUPERVISOR_SYNC_EVENT = "supervisor-status-updated";
const SEMESTER_EXPECTED_MIN_HOURS = 856;
const SEMESTER_EXPECTED_MAX_HOURS = 864;
const WORKLOAD_REPORT_SEMESTER_LABEL = "2025-S1";
/** Workload search filter: school departments (org chart). */
const WORKLOAD_SEARCH_DEPARTMENT_OPTIONS = [
  "Physics",
  "Mathematics & Statistics",
  "Computer Science & Software Engineering",
] as const;
const BAND_THRESHOLDS_TOOLTIP =
  "Band thresholds: (Calculated T:R <= 0.20 is Research Focused); (Calculated T:R > 0.20 and <= 0.79 is Balanced Teaching & Research); (Calculated T:R > 0.79 and <= 1.00 is Teaching Focused)";

type AcademicNotification = {
  id: string;
  recipientStaffId: string;
  recipientName: string;
  recipientEmail: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  sentAt: string;
  readAt?: string;
};

type OpsSemesterReportItem = {
  id: string;
  year: number;
  semester: "S1" | "S2";
  title: string;
  createdAt: string;
  readAt?: string;
  rows: Record<string, string | number>[];
};

function readOpsSemesterReports(): OpsSemesterReportItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OPS_SEMESTER_REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as OpsSemesterReportItem[];
  } catch {
    return [];
  }
}

function writeOpsSemesterReports(items: OpsSemesterReportItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OPS_SEMESTER_REPORTS_KEY, JSON.stringify(items));
}

function readAcademicStatusSync(): Record<string, "pending" | "approved" | "rejected"> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACADEMIC_STATUS_SYNC_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, "pending" | "approved" | "rejected">;
  } catch {
    return {};
  }
}

function formatOpsDistributionDdl(semester: "S1" | "S2") {
  if (semester === "S1") return "S1 (1 January - 30 June)";
  return "S2 (1 July - 31 December)";
}

function createOpsDistributionMailBody(year: number, semester: "S1" | "S2") {
  const ddlLabel = formatOpsDistributionDdl(semester);
  return `Your workload for ${year} ${semester} has been distributed. Please complete confirmation by the DDL (${ddlLabel}).

If there are work-hour issues or you cannot self-confirm, please submit to your leader for manual modification review, then complete confirmation.

For other questions, please contact yaka.bronte@uwa.edu.au.`;
}

function appendAcademicNotifications(nextNotifications: AcademicNotification[]) {
  if (typeof window === "undefined" || nextNotifications.length === 0) return;
  try {
    const raw = window.localStorage.getItem(OPS_ACADEMIC_NOTIFICATION_KEY);
    const existing = raw ? (JSON.parse(raw) as AcademicNotification[]) : [];
    window.localStorage.setItem(OPS_ACADEMIC_NOTIFICATION_KEY, JSON.stringify([...nextNotifications, ...existing]));
  } catch {
    window.localStorage.setItem(OPS_ACADEMIC_NOTIFICATION_KEY, JSON.stringify(nextNotifications));
  }
}

function submittedTimeById(id: number) {
  const day = ((id - 1) % 28) + 1;
  const hour = 8 + (id % 9);
  return `2026-03-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00`;
}

function modifiedTimeById(id: number) {
  const day = ((id + 1) % 28) + 1;
  const hour = 9 + (id % 8);
  return `2026-03-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:30`;
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

function workloadHoursForBreakdownRow(row: BreakdownEntry): number {
  return row.excludeFromWorkloadTotal ? 0 : row.hours;
}

function sumAdminBreakdownHours(breakdown: BreakdownData): number {
  return ADMIN_WORKLOAD_BREAKDOWN_TABS.reduce(
    (sum, tab) => sum + breakdown[tab].reduce((s, row) => s + workloadHoursForBreakdownRow(row), 0),
    0
  );
}

function teachingHoursFromAdminBreakdown(breakdown: BreakdownData): number {
  return breakdown.Teaching.reduce((s, row) => s + row.hours, 0);
}

function adminActualTeachingRatioPercent(breakdown: BreakdownData): number {
  const totalH = sumAdminBreakdownHours(breakdown);
  if (totalH <= 0) return 0;
  const teachingH = teachingHoursFromAdminBreakdown(breakdown);
  return Math.round((teachingH / totalH) * 1000) / 10;
}

function isWorkloadTeachingGapAbnormal(item: MockRequest, breakdown: BreakdownData): boolean {
  const actualRatioPct = adminActualTeachingRatioPercent(breakdown);
  const targetRatio = item.targetTeachingRatio;
  if (targetRatio != null) {
    if (actualRatioPct + 0.05 < targetRatio) return true;
  }
  const teachingTarget = item.teachingTargetHours;
  if (teachingTarget != null) {
    const teachingActual = teachingHoursFromAdminBreakdown(breakdown);
    if (teachingActual + 0.001 < teachingTarget) return true;
  }
  return false;
}

function cleanDescription(description: string) {
  const marker = "Request reason:";
  const idx = description.indexOf(marker);
  if (idx === -1) return description;
  return description.slice(0, idx).trim();
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatOneDecimal(value: number): string {
  return roundToOneDecimal(value).toFixed(1);
}

function displayNameWithoutComma(raw: string): string {
  return raw.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeBandLabel(raw?: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t.includes("research focused")) return "Research Focused";
  if (t.includes("balanced")) return "Balanced Teaching & Research";
  if (t.includes("teaching focused")) return "Teaching Focused";
  return raw.trim();
}

function parseWorkloadTemplateNewStaff(value: unknown): boolean | undefined {
  if (value === true || value === false) return value;
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return undefined;
}

function parseWorkloadTemplateHodReview(value: unknown): "yes" | "no" | undefined {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "yes") return "yes";
  if (s === "no") return "no";
  return undefined;
}

function expectedRangeForBand(band?: string | null): string {
  const n = normalizeBandLabel(band);
  if (n === "Research Focused") return "<= 20.0%";
  if (n === "Balanced Teaching & Research") return "> 20.0% and <= 79.0%";
  if (n === "Teaching Focused") return "> 79.0% and <= 100.0%";
  return "unknown";
}

function isPlaceholderNotesText(text: string) {
  const t = text.trim();
  if (!t) return true;
  if (/^lorem ipsum\b/i.test(t)) return true;
  return false;
}

function workloadModalNotes(row: Pick<MockRequest, "notes" | "description">) {
  const n = row.notes?.trim();
  const fromNotes = n ? n : "";
  const fromDescription = !fromNotes ? cleanDescription(row.description ?? "") : "";
  const combined = fromNotes || fromDescription;
  if (isPlaceholderNotesText(combined)) return "";
  return combined;
}

/** Workload detail modal header: reporting period only, e.g. "2026-S1" (no staff id). */
function workloadDetailReportingPeriodLabel(row: MockRequest): string {
  const period = row.periodLabel.trim();
  const yearMatch = period.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());

  const semFromPeriod = period.match(/-([12])\s*$/);
  if (semFromPeriod) {
    return `${year}-${semFromPeriod[1] === "2" ? "S2" : "S1"}`;
  }

  const sem = row.semesterLabel.toLowerCase();
  if (sem.includes("sem2") || sem.includes("s2")) {
    return `${year}-S2`;
  }
  return `${year}-S1`;
}

function expectedHoursRangeForFte(fte: number | null) {
  const normalizedFte = typeof fte === "number" && Number.isFinite(fte) && fte > 0 ? fte : 1;
  return {
    min: SEMESTER_EXPECTED_MIN_HOURS * normalizedFte,
    max: SEMESTER_EXPECTED_MAX_HOURS * normalizedFte,
  };
}

/** Modal badge / employment display — from imported FTE (column G): < 1 → Part-time, otherwise Full-time (= 1). */
function employmentTypeLabelFromFte(fte: number | null): string {
  if (typeof fte !== "number" || !Number.isFinite(fte)) return "—";
  return fte < 1 ? "Part-time" : "Full-time";
}

/** Template column D — shown when row was imported from workload spreadsheet. */
function templateNewStaffDisplay(value: boolean | undefined): string {
  if (value === undefined) return "—";
  return value ? "Yes" : "No";
}

/** Template column F — yes/no from spreadsheet. */
function templateHodReviewDisplay(value: "yes" | "no" | undefined): string {
  if (value === undefined) return "—";
  return value === "yes" ? "Yes" : "No";
}

function mergeAdminBreakdownWithImportedData(
  item: Pick<MockRequest, "id" | "studentId" | "hours">,
  teachingLinesByStaffId: Record<
    string,
    { unit?: string; hours?: number | null; duplicateUnitConflict?: boolean; excludeFromWorkloadTotal?: boolean }[] | undefined
  >,
  hdrImportByStaffId: Record<
    string,
    | {
        ftStudents?: number | null;
        ptStudents?: number | null;
        ftHours?: number | null;
        ptHours?: number | null;
        totalHrs?: number | null;
        derivedHrs?: number | null;
        hdrPoints?: number | null;
        hasHdrFieldConflict?: boolean;
        ftStudentsConflict?: boolean;
        totalHrsConflict?: boolean;
        hdrPointsConflict?: boolean;
        hdrExtraLines?: Array<{ name: string; hours: number }>;
      }
    | undefined
  >,
  serviceImportByStaffId: Record<
    string,
    | {
        servicePoints?: number | null;
        hasServicePointsConflict?: boolean;
        servicePointsConflict?: boolean;
        serviceExtraLines?: Array<{ hours: number }>;
      }
    | undefined
  >,
  roleImportByStaffId: Record<
    string,
    | {
        roles: Array<{ name: string; hours: number; excludeFromWorkloadTotal?: boolean; hourConflict?: boolean }>;
        totalHours: number | null;
      }
    | undefined
  >,
  anomalyByStaffId: Record<string, { researchResidualPoints: number | null } | undefined>
): BreakdownData {
  const sid = item.studentId.trim();
  let next: BreakdownData = breakdownById(item.id, item.hours);

  const lines = teachingLinesByStaffId[sid];
  if (lines?.length) {
    const teachingImported = lines
      .filter((row) => String(row.unit ?? "").trim())
      .map((row) => ({
        name: String(row.unit).trim(),
        hours:
          typeof row.hours === "number" && Number.isFinite(row.hours) ? Math.round(row.hours * 1000) / 1000 : 0,
        teachingDuplicateUnit: row.duplicateUnitConflict,
        excludeFromWorkloadTotal: row.excludeFromWorkloadTotal,
      }));
    if (teachingImported.length) next = { ...next, Teaching: teachingImported };
  }

  const hdrImported = hdrImportByStaffId[sid];
  if (
    hdrImported &&
    (hdrImported.ftStudents != null ||
      hdrImported.ptStudents != null ||
      hdrImported.ftHours != null ||
      hdrImported.ptHours != null ||
      hdrImported.totalHrs != null ||
      hdrImported.derivedHrs != null ||
      hdrImported.hdrPoints != null ||
      hdrImported.hasHdrFieldConflict)
  ) {
    const ftCount =
      hdrImported.ftStudents != null && Number.isFinite(hdrImported.ftStudents) ? hdrImported.ftStudents : 0;
    const ptCount =
      hdrImported.ptStudents != null && Number.isFinite(hdrImported.ptStudents) ? hdrImported.ptStudents : 0;
    const ftCountLabel = Number.isInteger(ftCount) ? String(ftCount) : formatOneDecimal(ftCount);
    const ptCountLabel = Number.isInteger(ptCount) ? String(ptCount) : formatOneDecimal(ptCount);
    const ftHours =
      hdrImported.ftHours != null && Number.isFinite(hdrImported.ftHours)
        ? Math.round(hdrImported.ftHours * 1000) / 1000
        : 0;
    const ptHours =
      hdrImported.ptHours != null && Number.isFinite(hdrImported.ptHours)
        ? Math.round(hdrImported.ptHours * 1000) / 1000
        : 0;
    const hdrTotalHours = Math.round((ftHours + ptHours) * 1000) / 1000;
    const hdrRows: BreakdownEntry[] = [
      {
        name: `Full time students (${ftCountLabel})`,
        hours: ftHours,
        excludeFromWorkloadTotal: true,
        roleHourConflict: Boolean(hdrImported.ftStudentsConflict),
      },
      {
        name: `Part time students (${ptCountLabel})`,
        hours: ptHours,
        excludeFromWorkloadTotal: true,
      },
      {
        name: HDR_TOTAL_ROW_LABEL,
        hours: hdrTotalHours,
        roleHourConflict: Boolean(hdrImported.totalHrsConflict || hdrImported.hdrPointsConflict),
      },
    ];
    hdrImported.hdrExtraLines?.forEach((ex) => {
      hdrRows.push({
        name: ex.name,
        hours: ex.hours,
        excludeFromWorkloadTotal: true,
        roleHourConflict: true,
      });
    });
    next = { ...next, HDR: hdrRows };
  }

  const serviceImported = serviceImportByStaffId[sid];
  if (serviceImported && (serviceImported.servicePoints != null || serviceImported.hasServicePointsConflict)) {
    const canonicalHrs =
      serviceImported.servicePoints != null && Number.isFinite(serviceImported.servicePoints)
        ? Math.round(serviceImported.servicePoints * TEACHING_HOURS_FACTOR * 1000) / 1000
        : 0;
    const svcRows: BreakdownEntry[] = [
      {
        name: "Self-Directed Svc Pts",
        hours: canonicalHrs,
        roleHourConflict: Boolean(serviceImported.servicePointsConflict),
      },
    ];
    serviceImported.serviceExtraLines?.forEach((ex) => {
      svcRows.push({
        name: "Self-Directed Svc Pts",
        hours: ex.hours,
        excludeFromWorkloadTotal: true,
        roleHourConflict: true,
      });
    });
    next = { ...next, Service: svcRows };
  }

  const roleImported = roleImportByStaffId[sid];
  if (roleImported && (roleImported.roles.length > 0 || roleImported.totalHours != null)) {
    const rows =
      roleImported.roles.length > 0
        ? roleImported.roles.map((r) => ({
            name: r.name,
            hours: Math.round(r.hours * 1000) / 1000,
            excludeFromWorkloadTotal: r.excludeFromWorkloadTotal,
            roleHourConflict: r.hourConflict,
          }))
        : [{ name: "Assigned Roles Total", hours: Math.round((roleImported.totalHours ?? 0) * 1000) / 1000 }];
    next = { ...next, "Assigned Roles": rows };
  }

  const anomalyImported = anomalyByStaffId[sid];
  if (anomalyImported && anomalyImported.researchResidualPoints != null) {
    next = {
      ...next,
      "Research (residual)": [
        {
          name: "Research (residual)",
          hours: Math.round(anomalyImported.researchResidualPoints * TEACHING_HOURS_FACTOR * 1000) / 1000,
        },
      ],
    };
  }

  return next;
}

function buildWorkloadDetailSnapshot(
  item: Pick<MockRequest, "id" | "studentId" | "hours" | "targetTeachingRatio">,
  teachingLinesByStaffId: Record<
    string,
    { unit?: string; hours?: number | null; duplicateUnitConflict?: boolean; excludeFromWorkloadTotal?: boolean }[] | undefined
  >,
  hdrImportByStaffId: Record<
    string,
    | {
        ftStudents?: number | null;
        ptStudents?: number | null;
        ftHours?: number | null;
        ptHours?: number | null;
        totalHrs?: number | null;
        derivedHrs?: number | null;
        hdrPoints?: number | null;
        hasHdrFieldConflict?: boolean;
        ftStudentsConflict?: boolean;
        totalHrsConflict?: boolean;
        hdrPointsConflict?: boolean;
        hdrExtraLines?: Array<{ name: string; hours: number }>;
      }
    | undefined
  >,
  serviceImportByStaffId: Record<
    string,
    | {
        servicePoints?: number | null;
        hasServicePointsConflict?: boolean;
        servicePointsConflict?: boolean;
        serviceExtraLines?: Array<{ hours: number }>;
      }
    | undefined
  >,
  roleImportByStaffId: Record<
    string,
    | {
        roles: Array<{ name: string; hours: number; excludeFromWorkloadTotal?: boolean; hourConflict?: boolean }>;
        totalHours: number | null;
      }
    | undefined
  >,
  anomalyByStaffId: Record<
    string,
    | {
        targetBand: string | null;
        calculatedBand: string | null;
        calculatedTeachingRatio: number | null;
        researchResidualPoints: number | null;
        totalHoursFromPoints: number | null;
        fte: number | null;
      }
    | undefined
  >
): WorkloadDetailSnapshot {
  const breakdown = mergeAdminBreakdownWithImportedData(
    item,
    teachingLinesByStaffId,
    hdrImportByStaffId,
    serviceImportByStaffId,
    roleImportByStaffId,
    anomalyByStaffId
  );
  const detailsComputedTotalHours = sumAdminBreakdownHours(breakdown);
  const actualTeachingRatioPct = adminActualTeachingRatioPercent(breakdown);
  const actualTeachingRatioDisplay = `${formatOneDecimal(actualTeachingRatioPct)}%`;
  const actualTeachingRatioOutOfRange = actualTeachingRatioPct < 0 || actualTeachingRatioPct > 100;

  const detailAnomaly = anomalyByStaffId[item.studentId.trim()];
  let anomalyHoverText = "";
  if (detailAnomaly?.targetBand && detailAnomaly.calculatedBand) {
    const expected = expectedRangeForBand(detailAnomaly.targetBand);
    const actual =
      detailAnomaly.calculatedTeachingRatio != null && Number.isFinite(detailAnomaly.calculatedTeachingRatio)
        ? `${formatOneDecimal(detailAnomaly.calculatedTeachingRatio * 100)}%`
        : actualTeachingRatioDisplay;
    if (normalizeBandLabel(detailAnomaly.targetBand) !== normalizeBandLabel(detailAnomaly.calculatedBand)) {
      anomalyHoverText = `Calculated T:R is ${actual}, expected range for contract band "${detailAnomaly.targetBand}" is (${expected}). Calculated band is "${detailAnomaly.calculatedBand}", which does not match the contract band. After workload is distributed, Academic cannot self-confirm and must submit to HoD for modification review.`;
    }
  }
  const showActualTeachingRatioBandWarning = Boolean(anomalyHoverText);
  const actualRatioHoverText = actualTeachingRatioOutOfRange
    ? `Error: Calculated T:R is ${actualTeachingRatioDisplay}. Valid range is 0.0% to 100.0%. Please correct the imported workload components and re-import.`
    : anomalyHoverText
      ? `Warning: ${anomalyHoverText}\n${BAND_THRESHOLDS_TOOLTIP}`
      : "";

  const expectedRange = expectedHoursRangeForFte(detailAnomaly?.fte ?? null);
  const adminModalHoursAbnormal =
    detailsComputedTotalHours <= expectedRange.min || detailsComputedTotalHours > expectedRange.max;
  const totalHoursTooltipText = adminModalHoursAbnormal
    ? `Error: ${formatOneDecimal(expectedRange.min)} < expected working time <= ${formatOneDecimal(
        expectedRange.max
      )} working hours each semester.`
    : "";
  const minDays = Math.ceil(expectedRange.min / 8);
  const maxDays = Math.ceil(expectedRange.max / 8);
  const totalHoursDisplay = `${formatOneDecimal(detailsComputedTotalHours)} (>${minDays} & <=${maxDays} working days)`;

  return {
    breakdown,
    actualTeachingRatioDisplay,
    actualTeachingRatioOutOfRange,
    showActualTeachingRatioBandWarning,
    actualRatioHoverText,
    totalHoursDisplay,
    adminModalHoursAbnormal,
    totalHoursTooltipText,
    employmentType: employmentTypeLabelFromFte(detailAnomaly?.fte ?? null),
  };
}

function importHoursFailStatus(
  totalHours: number,
  fte: number | null
): "pending" | "rejected" {
  const { min, max } = expectedHoursRangeForFte(fte);
  if (typeof totalHours !== "number" || !Number.isFinite(totalHours)) return "pending";
  return totalHours <= min || totalHours > max ? "rejected" : "pending";
}

function fteForStaffFromParsed(parsed: WorkloadImportParseResult, staffId: string): number | null {
  for (const sh of parsed.sheets) {
    const am = sh.anomalyMetricsByStaffId[staffId];
    if (am?.fte != null && typeof am.fte === "number" && Number.isFinite(am.fte)) return am.fte;
  }
  return null;
}

/** Imported-row “Blocked” parity with workload modal: total hours vs FTE-scaled semester band. */
function isImportedRowHoursOutOfBand(
  row: Pick<MockRequest, "hours" | "studentId" | "importedFromTemplate">,
  anomalyByStaffId: Record<string, { fte: number | null } | undefined>
): boolean {
  if (!row.importedFromTemplate) return false;
  const sid = row.studentId.trim();
  const { min, max } = expectedHoursRangeForFte(anomalyByStaffId[sid]?.fte ?? null);
  const h = row.hours;
  return typeof h === "number" && Number.isFinite(h) && (h <= min || h > max);
}

/** Mirrors School Ops «Failed» filter: rejected, hours band, teaching/HDR/service/role import conflicts. */
function rowMatchesWorkloadFailedTab(
  it: MockRequest,
  anomalyByStaffId: Record<string, { fte: number | null } | undefined>,
  roleImportByStaffId: Record<string, { hasAssignedRoleHourConflict?: boolean } | undefined>,
  teachingLinesByStaffId: Record<string, { duplicateUnitConflict?: boolean }[] | undefined>,
  hdrImportByStaffId: Record<string, { hasHdrFieldConflict?: boolean } | undefined>,
  serviceImportByStaffId: Record<string, { hasServicePointsConflict?: boolean } | undefined>
): boolean {
  if (it.cancelled) return false;
  if (it.status === "rejected") return true;
  const sid = it.studentId.trim();
  if (it.importedFromTemplate && it.status === "pending") {
    if (isImportedRowHoursOutOfBand(it, anomalyByStaffId)) return true;
    if (roleImportByStaffId[sid]?.hasAssignedRoleHourConflict) return true;
    if ((teachingLinesByStaffId[sid] ?? []).some((line) => line.duplicateUnitConflict)) return true;
    if (hdrImportByStaffId[sid]?.hasHdrFieldConflict) return true;
    if (serviceImportByStaffId[sid]?.hasServicePointsConflict) return true;
  }
  return false;
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

export default function SchoolofOperations() {
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
    name: string;
    role: AssignRole;
    department: AssignDepartment;
    permissions: string[];
    assignedAt: string;
    status: "active" | "disabled";
  };

  const user = {
    surname: "Bronte",
    firstName: "Yaka",
    employeeId: "2345678",
    title: "Professor",
    department: "Senior School",
    email: "yaka.bronte@uwa.edu.au",
  };

  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [opsReportInboxOpen, setOpsReportInboxOpen] = useState(false);
  const [opsReportInboxPage, setOpsReportInboxPage] = useState(1);
  const [opsSemesterReports, setOpsSemesterReports] = useState<OpsSemesterReportItem[]>(() =>
    readOpsSemesterReports()
  );
  const [academicStatusSyncMap, setAcademicStatusSyncMap] = useState<
    Record<string, "pending" | "approved" | "rejected">
  >(() => readAcademicStatusSync());
  const [activeSection, setActiveSection] = useState<
    "approval" | "admin" | "visualization" | "export"
  >("approval");
  const sectionTabs = [
    { key: "approval", label: "Workload Management" },
    { key: "admin", label: "Employee Management" },
    { key: "visualization", label: "Visualization" },
    { key: "export", label: "Export Excel" },
  ];
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const [loading] = useState(false);
  const [pending, setPending] = useState<MockRequest[]>([]);

  useEffect(() => {
    const now = new Date();
    const existing = readOpsSemesterReports();
    const existingKeys = new Set(existing.map((item) => `${item.year}-${item.semester}`));
    const semesterKeys = new Set<string>();

    pending.forEach((row) => {
      if (row.cancelled) return;
      const matched = row.periodLabel.match(/^(\d{4})-(1|2)$/);
      if (!matched) return;
      const year = Number(matched[1]);
      const semester = matched[2] === "1" ? "S1" : "S2";
      if (now <= semesterEndDate(year, semester)) return;
      semesterKeys.add(`${year}-${semester}`);
    });

    const newReports: OpsSemesterReportItem[] = [];
    semesterKeys.forEach((key) => {
      if (existingKeys.has(key)) return;
      const [yearText, semester] = key.split("-") as [string, "S1" | "S2"];
      const year = Number(yearText);
      const semesterRows = pending
        .filter((row) => !row.cancelled && row.periodLabel === `${year}-${semester === "S1" ? "1" : "2"}`)
        .map((row) => ({
          "Staff ID": row.studentId,
          Name: displayNameWithoutComma(row.name),
          Status:
            row.importedFromTemplate
              ? "-"
              : row.status === "approved"
                ? "Approved"
                : row.status === "rejected"
                  ? "Rejected"
                  : "Pending",
          "Total Work Hours": roundToOneDecimal(row.hours),
          Confirmation: !row.importedFromTemplate && row.status === "approved" ? "Confirmed" : "Unconfirmed",
          "Distributed Time": submittedTimeById(row.id),
          "Distributed By": row.operatedBy?.trim() || "—",
          Department: row.department,
          Title: row.title,
          "Target Teaching Ratio": row.targetTeachingRatio != null ? `${roundToOneDecimal(row.targetTeachingRatio)}%` : "50.0%",
          "Actual Teaching Ratio": row.detailSnapshot?.actualTeachingRatioDisplay ?? "-",
          "Employment Type": row.detailSnapshot?.employmentType ?? (row.hours >= 800 ? "Full-time" : "Part-time"),
          "New Staff": row.workloadNewStaff ? "Yes" : "No",
          "HoD Review": row.hodReview === "yes" ? "Yes" : "No",
          "School of Operations Notes": workloadModalNotes(row),
        }));
      if (!semesterRows.length) return;
      newReports.push({
        id: `ops-report-${year}-${semester}-${Date.now()}`,
        year,
        semester,
        title: `${year} ${semester} distribution report generated`,
        createdAt: new Date().toISOString(),
        rows: semesterRows,
      });
    });

    if (!newReports.length) return;
    const next = [...newReports, ...existing].sort(
      (a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")
    );
    writeOpsSemesterReports(next);
    setOpsSemesterReports(next);
  }, [pending]);

  useEffect(() => {
    if (!opsReportInboxOpen) return;
    setOpsSemesterReports((prev) => {
      const now = new Date().toISOString();
      const next = prev.map((item) => (item.readAt ? item : { ...item, readAt: now }));
      writeOpsSemesterReports(next);
      return next;
    });
  }, [opsReportInboxOpen]);

  useEffect(() => {
    // Test helper: keep at least 2 inbox rows for UI verification.
    setOpsSemesterReports((prev) => {
      if (prev.length !== 1) return prev;
      if (prev.some((item) => item.id.includes("-demo-copy"))) return prev;
      const base = prev[0];
      const copied: OpsSemesterReportItem = {
        ...base,
        id: `${base.id}-demo-copy`,
        title: `${base.year} ${base.semester} distribution report generated (copy)`,
        createdAt: new Date(Date.parse(base.createdAt || "") - 60_000).toISOString(),
        readAt: undefined,
      };
      const next = [base, copied].sort(
        (a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")
      );
      writeOpsSemesterReports(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const total = Math.max(1, Math.ceil(opsSemesterReports.length / 10));
    setOpsReportInboxPage((prev) => Math.min(Math.max(1, prev), total));
  }, [opsSemesterReports.length]);

  useEffect(() => {
    function syncFromSupervisor() {
      setAcademicStatusSyncMap(readAcademicStatusSync());
    }
    function onStorage(e: StorageEvent) {
      if (e.key === ACADEMIC_STATUS_SYNC_KEY) syncFromSupervisor();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(SUPERVISOR_SYNC_EVENT, syncFromSupervisor as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SUPERVISOR_SYNC_EVENT, syncFromSupervisor as EventListener);
    };
  }, []);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 10; // Items per page
  const [submitting, setSubmitting] = useState(false);

  const [statusFilter, setStatusFilter] = useState<
    "all" | "distributed" | "failed" | "superseded"
  >("all");

  const [popup, setPopup] = useState<{
    open: boolean;
    title: string;
    message: string;
    status: "pending" | "approved" | "rejected";
    importSummary?: {
      total: number;
      success: number;
      failed: number;
      failedRows?: number[];
    };
  }>({
    open: false,
    title: "",
    message: "",
    status: "pending",
    importSummary: undefined,
  });
  const [popupDragOffset, setPopupDragOffset] = useState({ x: 0, y: 0 });
  const popupDragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      if (!popupDragRef.current.dragging) return;
      const dx = event.clientX - popupDragRef.current.startX;
      const dy = event.clientY - popupDragRef.current.startY;
      setPopupDragOffset({
        x: popupDragRef.current.originX + dx,
        y: popupDragRef.current.originY + dy,
      });
    }

    function onMouseUp() {
      popupDragRef.current.dragging = false;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!popup.open) {
      setPopupDragOffset({ x: 0, y: 0 });
      popupDragRef.current.dragging = false;
    }
  }, [popup.open]);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [supersededNoticeOpen, setSupersededNoticeOpen] = useState(false);
  const [detailsItem, setDetailsItem] = useState<MockRequest | null>(null);
  const [detailsBreakdown, setDetailsBreakdown] = useState<BreakdownData | null>(null);
  const [detailsTab, setDetailsTab] = useState<BreakdownCategory>("Teaching");
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState("");
  const [noteDecision, setNoteDecision] = useState<"approve" | "reject">("approve");
  const [noteTargetId, setNoteTargetId] = useState<number | null>(null);
  const [distributeModalOpen, setDistributeModalOpen] = useState(false);
  const [distributeYearInput, setDistributeYearInput] = useState(String(currentYear));
  const [distributeSemesterInput, setDistributeSemesterInput] = useState<"S1" | "S2">("S1");
  const [distributeError, setDistributeError] = useState("");

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
  const [adminPage, setAdminPage] = useState(1);
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
  const initialAssignablePeople: AssignablePerson[] = [
    {
      id: 1,
      staffId: "12345678",
      firstName: "John",
      lastName: "Doe",
      email: "john.doe@uwa.edu.au",
      title: "Lecturer",
      currentDepartment: "Computer Science & Software Engineering",
      isActive: true,
      isNewEmployee: false,
      notes: "",
    },
    {
      id: 2,
      staffId: "12345745",
      firstName: "Marcelina",
      lastName: "Amina",
      email: "marcelina.amina@uwa.edu.au",
      title: "Senior Lecturer",
      currentDepartment: "Computer Science & Software Engineering",
      isActive: false,
      isNewEmployee: false,
      notes: "",
    },
    {
      id: 4,
      staffId: "12345931",
      firstName: "John",
      lastName: "Dias",
      email: "john.dias@uwa.edu.au",
      title: "Lecturer",
      currentDepartment: "Physics",
      isActive: true,
      isNewEmployee: false,
      notes: "",
    },
    {
      id: 5,
      staffId: "12346060",
      firstName: "Lina",
      lastName: "Patel",
      email: "lina.patel@uwa.edu.au",
      title: "Lecturer",
      currentDepartment: "Computer Science & Software Engineering",
      isActive: true,
      isNewEmployee: false,
      notes: "",
    },
  ];
  const [assignablePeople, setAssignablePeople] = useState<AssignablePerson[]>(initialAssignablePeople);
  const [importMessage, setImportMessage] = useState("");
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffDraft, setStaffDraft] = useState<StaffProfileDraft | null>(null);
  const [staffModalError, setStaffModalError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workloadImportInputRef = useRef<HTMLInputElement | null>(null);
  const selectAllPendingRef = useRef<HTMLInputElement | null>(null);
  const [workloadTeachingImportLinesByStaffId, setWorkloadTeachingImportLinesByStaffId] = useState<
    Record<
      string,
      { unit: string; hours: number | null; duplicateUnitConflict?: boolean; excludeFromWorkloadTotal?: boolean }[]
    >
  >({});
  const [workloadHdrImportByStaffId, setWorkloadHdrImportByStaffId] = useState<
    Record<
      string,
      {
        ftStudents: number | null;
        ptStudents?: number | null;
        ftHours?: number | null;
        ptHours?: number | null;
        totalHrs: number | null;
        derivedHrs?: number | null;
        hdrPoints: number | null;
        hasHdrFieldConflict?: boolean;
        ftStudentsConflict?: boolean;
        totalHrsConflict?: boolean;
        hdrPointsConflict?: boolean;
        hdrExtraLines?: { name: string; hours: number }[];
      }
    >
  >({});
  const [workloadServiceImportByStaffId, setWorkloadServiceImportByStaffId] = useState<
    Record<
      string,
      {
        servicePoints: number | null;
        hasServicePointsConflict?: boolean;
        servicePointsConflict?: boolean;
        serviceExtraLines?: { hours: number }[];
      }
    >
  >({});
  const [workloadAssignedRoleImportByStaffId, setWorkloadAssignedRoleImportByStaffId] = useState<
    Record<
      string,
      {
        roles: {
          name: string;
          points: number;
          hours: number;
          hourConflict?: boolean;
          excludeFromWorkloadTotal?: boolean;
        }[];
        totalPoints: number | null;
        totalHours: number | null;
        hasAssignedRoleHourConflict?: boolean;
      }
    >
  >({});
  const [workloadAnomalyImportByStaffId, setWorkloadAnomalyImportByStaffId] = useState<
    Record<
      string,
      {
        targetBand: string | null;
        calculatedBand: string | null;
        calculatedTeachingRatio: number | null;
        researchResidualPoints: number | null;
        totalHoursFromPoints: number | null;
        fte: number | null;
      }
    >
  >({});
  const selectedYear = Number(searchYearInput) || currentYear;
  const yearOptions = useMemo(
    () => Array.from({ length: 11 }, (_, i) => String(selectedYear - 5 + i)),
    [selectedYear]
  );
  const opsReportsPerPage = 10;
  const opsUnreadReportCount = useMemo(
    () => opsSemesterReports.filter((item) => !item.readAt).length,
    [opsSemesterReports]
  );
  const opsReportTotalPages = Math.max(1, Math.ceil(opsSemesterReports.length / opsReportsPerPage));
  const pagedOpsReports = useMemo(() => {
    const start = (opsReportInboxPage - 1) * opsReportsPerPage;
    return opsSemesterReports.slice(start, start + opsReportsPerPage);
  }, [opsSemesterReports, opsReportInboxPage]);

  function semesterEndDate(year: number, semester: "S1" | "S2"): Date {
    return semester === "S1" ? new Date(year, 5, 30, 23, 59, 59, 999) : new Date(year, 11, 31, 23, 59, 59, 999);
  }

  function handleDownloadOpsSemesterReport(report: OpsSemesterReportItem) {
    if (!report.rows.length) return;
    const ws = XLSX.utils.json_to_sheet(report.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${report.year}-${report.semester}`);
    XLSX.writeFile(wb, `workload_report_${report.year}_${report.semester}.xlsx`);
  }

  const adminModalBreakdown = useMemo(() => {
    if (!detailsItem) return null;
    return detailsBreakdown ?? breakdownById(detailsItem.id, detailsItem.hours);
  }, [detailsItem, detailsBreakdown]);

  const adminModalBreakdownMerged = useMemo(() => {
    if (!detailsItem || !adminModalBreakdown) return adminModalBreakdown;
    const sid = detailsItem.studentId.trim();
    let next: BreakdownData = adminModalBreakdown;

    const lines = workloadTeachingImportLinesByStaffId[sid];
    if (lines?.length) {
      const teachingImported = lines
        .filter((row) => String(row.unit ?? "").trim())
        .map((row) => {
          const hrs =
            typeof row.hours === "number" && Number.isFinite(row.hours)
              ? Math.round(row.hours * 1000) / 1000
              : 0;
          return {
            name: String(row.unit).trim(),
            hours: hrs,
            teachingDuplicateUnit: row.duplicateUnitConflict,
            excludeFromWorkloadTotal: row.excludeFromWorkloadTotal,
          };
        });
      if (teachingImported.length) next = { ...next, Teaching: teachingImported };
    }

    const hdrImported = workloadHdrImportByStaffId[sid];
    if (
      hdrImported &&
      (hdrImported.ftStudents != null ||
        hdrImported.ptStudents != null ||
        hdrImported.ftHours != null ||
        hdrImported.ptHours != null ||
        hdrImported.totalHrs != null ||
        hdrImported.derivedHrs != null ||
        hdrImported.hdrPoints != null ||
        hdrImported.hasHdrFieldConflict)
    ) {
      const ftCount =
        hdrImported.ftStudents != null && Number.isFinite(hdrImported.ftStudents)
          ? hdrImported.ftStudents
          : 0;
      const ptCount =
        hdrImported.ptStudents != null && Number.isFinite(hdrImported.ptStudents)
          ? hdrImported.ptStudents
          : 0;
      const ftCountLabel = Number.isInteger(ftCount) ? String(ftCount) : formatOneDecimal(ftCount);
      const ptCountLabel = Number.isInteger(ptCount) ? String(ptCount) : formatOneDecimal(ptCount);
      const ftHours =
        hdrImported.ftHours != null && Number.isFinite(hdrImported.ftHours)
          ? Math.round(hdrImported.ftHours * 1000) / 1000
          : 0;
      const ptHours =
        hdrImported.ptHours != null && Number.isFinite(hdrImported.ptHours)
          ? Math.round(hdrImported.ptHours * 1000) / 1000
          : 0;
      const hdrTotalHours = Math.round((ftHours + ptHours) * 1000) / 1000;

      const hdrRows: BreakdownEntry[] = [
        {
          name: `Full time students (${ftCountLabel})`,
          hours: ftHours,
          excludeFromWorkloadTotal: true,
          roleHourConflict: Boolean(hdrImported.ftStudentsConflict),
        },
        {
          name: `Part time students (${ptCountLabel})`,
          hours: ptHours,
          excludeFromWorkloadTotal: true,
        },
        {
          name: HDR_TOTAL_ROW_LABEL,
          hours: hdrTotalHours,
          roleHourConflict: Boolean(hdrImported.totalHrsConflict || hdrImported.hdrPointsConflict),
        },
      ];
      hdrImported.hdrExtraLines?.forEach((ex) => {
        hdrRows.push({
          name: ex.name,
          hours: ex.hours,
          excludeFromWorkloadTotal: true,
          roleHourConflict: true,
        });
      });
      next = { ...next, HDR: hdrRows };
    }
    const serviceImported = workloadServiceImportByStaffId[sid];
    if (serviceImported && (serviceImported.servicePoints != null || serviceImported.hasServicePointsConflict)) {
      const canonicalHrs =
        serviceImported.servicePoints != null && Number.isFinite(serviceImported.servicePoints)
          ? Math.round(serviceImported.servicePoints * TEACHING_HOURS_FACTOR * 1000) / 1000
          : 0;
      const svcRows: BreakdownEntry[] = [
        {
          name: "Self-Directed Svc Pts",
          hours: canonicalHrs,
          roleHourConflict: Boolean(serviceImported.servicePointsConflict),
        },
      ];
      serviceImported.serviceExtraLines?.forEach((ex) => {
        svcRows.push({
          name: "Self-Directed Svc Pts",
          hours: ex.hours,
          excludeFromWorkloadTotal: true,
          roleHourConflict: true,
        });
      });
      next = { ...next, Service: svcRows };
    }
    const roleImported = workloadAssignedRoleImportByStaffId[sid];
    if (roleImported && (roleImported.roles.length > 0 || roleImported.totalHours != null)) {
      const rows =
        roleImported.roles.length > 0
          ? roleImported.roles.map((r) => ({
              name: r.name,
              hours: Math.round(r.hours * 1000) / 1000,
              excludeFromWorkloadTotal: r.excludeFromWorkloadTotal,
              roleHourConflict: r.hourConflict,
            }))
          : [
              {
                name: "Assigned Roles Total",
                hours: Math.round((roleImported.totalHours ?? 0) * 1000) / 1000,
              },
            ];
      next = {
        ...next,
        "Assigned Roles": rows,
      };
    }
    const anomalyImported = workloadAnomalyImportByStaffId[sid];
    if (anomalyImported && anomalyImported.researchResidualPoints != null) {
      next = {
        ...next,
        "Research (residual)": [
          {
            name: "Research (residual)",
            hours: Math.round(anomalyImported.researchResidualPoints * TEACHING_HOURS_FACTOR * 1000) / 1000,
          },
        ],
      };
    }

    return next;
  }, [
    detailsItem,
    adminModalBreakdown,
    workloadTeachingImportLinesByStaffId,
    workloadHdrImportByStaffId,
    workloadServiceImportByStaffId,
    workloadAssignedRoleImportByStaffId,
    workloadAnomalyImportByStaffId,
  ]);

  const detailsComputedTotalHours = useMemo(() => {
    const sid = detailsItem?.studentId.trim();
    const anomalyTotalHours =
      sid && workloadAnomalyImportByStaffId[sid]?.totalHoursFromPoints != null
        ? workloadAnomalyImportByStaffId[sid].totalHoursFromPoints
        : null;
    if (anomalyTotalHours != null) {
      return anomalyTotalHours;
    }
    if (!adminModalBreakdownMerged) return 0;
    return ADMIN_WORKLOAD_BREAKDOWN_TABS.reduce(
      (sum, tab) =>
        sum +
        adminModalBreakdownMerged[tab].reduce(
          (s, row) => s + workloadHoursForBreakdownRow(row),
          0
        ),
      0
    );
  }, [adminModalBreakdownMerged, detailsItem, workloadAnomalyImportByStaffId]);

  const detailsExpectedHoursRange = useMemo(() => {
    const sid = detailsItem?.studentId.trim();
    const fte = sid ? workloadAnomalyImportByStaffId[sid]?.fte ?? null : null;
    return expectedHoursRangeForFte(fte);
  }, [detailsItem, workloadAnomalyImportByStaffId]);

  const adminModalHoursAbnormal = useMemo(() => {
    if (!adminModalBreakdownMerged) return false;
    return (
      detailsComputedTotalHours <= detailsExpectedHoursRange.min ||
      detailsComputedTotalHours > detailsExpectedHoursRange.max
    );
  }, [adminModalBreakdownMerged, detailsComputedTotalHours, detailsExpectedHoursRange]);

  const detailsAnomaly = useMemo(() => {
    if (!detailsItem) return null;
    return workloadAnomalyImportByStaffId[detailsItem.studentId.trim()] ?? null;
  }, [detailsItem, workloadAnomalyImportByStaffId]);

  const actualTeachingRatioPercent = useMemo(() => {
    if (detailsAnomaly?.calculatedTeachingRatio != null) {
      return detailsAnomaly.calculatedTeachingRatio * 100;
    }
    return adminModalBreakdownMerged ? adminActualTeachingRatioPercent(adminModalBreakdownMerged) : 0;
  }, [detailsAnomaly, adminModalBreakdownMerged]);

  const actualTeachingRatioDisplay = useMemo(
    () => `${formatOneDecimal(actualTeachingRatioPercent)}%`,
    [actualTeachingRatioPercent]
  );

  const actualTeachingRatioOutOfRange =
    Number.isFinite(actualTeachingRatioPercent) &&
    (actualTeachingRatioPercent < 0 || actualTeachingRatioPercent > 100);

  const anomalyHoverText = useMemo(() => {
    if (!detailsAnomaly || !detailsAnomaly.targetBand || !detailsAnomaly.calculatedBand) return "";
    const expected = expectedRangeForBand(detailsAnomaly.targetBand);
    const actual = detailsAnomaly.calculatedTeachingRatio != null
      ? `${formatOneDecimal(detailsAnomaly.calculatedTeachingRatio * 100)}%`
      : "N/A";
    if (normalizeBandLabel(detailsAnomaly.targetBand) === normalizeBandLabel(detailsAnomaly.calculatedBand)) {
      return "";
    }
    return `Calculated T:R is ${actual}, expected range for contract band "${detailsAnomaly.targetBand}" is (${expected}). Calculated band is "${detailsAnomaly.calculatedBand}", which does not match the contract band. After workload is distributed, Academic cannot self-confirm and must submit to HoD for modification review.`;
  }, [detailsAnomaly]);

  /** T:R out-of-range should be an Error; otherwise keep existing band mismatch warning. */
  const actualRatioHoverText = useMemo(() => {
    if (actualTeachingRatioOutOfRange) {
      return `Error: Calculated T:R is ${actualTeachingRatioDisplay}. Valid range is 0.0% to 100.0%. Please correct the imported workload components and re-import.`;
    }
    if (!anomalyHoverText) return "";
    return `Warning: ${anomalyHoverText}\n${BAND_THRESHOLDS_TOOLTIP}`;
  }, [actualTeachingRatioOutOfRange, actualTeachingRatioDisplay, anomalyHoverText]);

  const showActualTeachingRatioBandWarning = Boolean(anomalyHoverText);

  const totalHoursTooltipText = useMemo(() => {
    if (!adminModalHoursAbnormal) return "";
    return `Error: ${formatOneDecimal(
      detailsExpectedHoursRange.min
    )} < expected working time <= ${formatOneDecimal(
      detailsExpectedHoursRange.max
    )} working hours each semester.`;
  }, [adminModalHoursAbnormal, detailsExpectedHoursRange]);

  const totalHoursWorkingDaysSuffix = useMemo(() => {
    const dayMin = detailsExpectedHoursRange.min / 8;
    const dayMax = detailsExpectedHoursRange.max / 8;
    const minDays = Math.ceil(dayMin);
    const maxDays = Math.ceil(dayMax);
    return `(>${minDays} & <=${maxDays} working days)`;
  }, [detailsExpectedHoursRange]);

  const totalHoursDisplay = useMemo(
    () => `${formatOneDecimal(detailsComputedTotalHours)} ${totalHoursWorkingDaysSuffix}`,
    [detailsComputedTotalHours, totalHoursWorkingDaysSuffix]
  );

  const itemsForFilter = useMemo(() => {
    const byStatus = pending.filter((it) => {
      if (statusFilter === "all") return !it.cancelled && it.status === "pending";
      if (statusFilter === "superseded") return Boolean(it.cancelled);
      if (statusFilter === "failed")
        return rowMatchesWorkloadFailedTab(
          it,
          workloadAnomalyImportByStaffId,
          workloadAssignedRoleImportByStaffId,
          workloadTeachingImportLinesByStaffId,
          workloadHdrImportByStaffId,
          workloadServiceImportByStaffId
        );
      if (statusFilter === "distributed") {
        return !it.cancelled && it.status === "approved";
      }
      return true;
    });

    const hasSearchFilter = Object.values(searchFilters).some((value) => value);
    if (!hasSearchFilter) return byStatus;

    return byStatus.filter((it) => {
      if (!it.name.trim()) return false;

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

      return true;
    });
  }, [
    pending,
    statusFilter,
    searchFilters,
    workloadAnomalyImportByStaffId,
    workloadAssignedRoleImportByStaffId,
    workloadTeachingImportLinesByStaffId,
    workloadHdrImportByStaffId,
    workloadServiceImportByStaffId,
  ]);

  function displayStatusForOpsRow(row: MockRequest): "pending" | "approved" | "rejected" | "-" {
    if (row.cancelled) return row.status;
    if (row.importedFromTemplate && row.status === "pending") return "-";
    if (row.status !== "approved") return row.status;
    const synced = academicStatusSyncMap[String(row.id)];
    // Distributed to Academic but not submitted yet: keep initialization marker.
    if (!synced) return "-";
    return synced;
  }

  const pendingFilteredIds = useMemo(() => itemsForFilter.map((it) => it.id), [itemsForFilter]);
  const allPendingFilteredSelected =
    pendingFilteredIds.length > 0 && pendingFilteredIds.every((id) => selectedIds.has(id));
  const somePendingFilteredSelected = pendingFilteredIds.some((id) => selectedIds.has(id));
  const hasSelectedPendingForDistribution = useMemo(
    () => pending.some((it) => selectedIds.has(it.id) && !it.cancelled && it.status === "pending"),
    [pending, selectedIds]
  );

  useEffect(() => {
    const el = selectAllPendingRef.current;
    if (!el) return;
    if (statusFilter !== "all") {
      el.indeterminate = false;
      return;
    }
    el.indeterminate = somePendingFilteredSelected && !allPendingFilteredSelected;
  }, [statusFilter, somePendingFilteredSelected, allPendingFilteredSelected]);

  const workloadPendingFilterCount = useMemo(
    () => pending.filter((it) => !it.cancelled && it.status === "pending").length,
    [pending]
  );

  const workloadDistributedFilterCount = useMemo(
    () => pending.filter((it) => !it.cancelled && it.status === "approved").length,
    [pending]
  );

  /** Same predicate as Status Filter «Failed» (rejected, hours band, duplicate teaching unit, or role hour conflict). */
  const workloadFailedFilterCount = useMemo(
    () =>
      pending.filter((it) =>
        rowMatchesWorkloadFailedTab(
          it,
          workloadAnomalyImportByStaffId,
          workloadAssignedRoleImportByStaffId,
          workloadTeachingImportLinesByStaffId,
          workloadHdrImportByStaffId,
          workloadServiceImportByStaffId
        )
      ).length,
    [
      pending,
      workloadAnomalyImportByStaffId,
      workloadAssignedRoleImportByStaffId,
      workloadTeachingImportLinesByStaffId,
      workloadHdrImportByStaffId,
      workloadServiceImportByStaffId,
    ]
  );

  function handleExportFailedWorkload() {
    if (statusFilter !== "failed") return;
    if (itemsForFilter.length === 0) {
      setPopup({
        open: true,
        title: "Nothing to export",
        message: "There are no failed tasks under the current Failed filter.",
        status: "rejected",
      });
      return;
    }
    const rows = itemsForFilter.map((it) => ({
      Name: it.name,
      "Staff Number": it.studentId,
      Status: displayStatusForOpsRow(it),
      "Hours out of band (import)": it.importedFromTemplate
        ? isImportedRowHoursOutOfBand(it, workloadAnomalyImportByStaffId)
          ? "Yes"
          : "No"
        : "—",
      "Role hours conflict (import)": it.importedFromTemplate
        ? workloadAssignedRoleImportByStaffId[it.studentId.trim()]?.hasAssignedRoleHourConflict
          ? "Yes"
          : "No"
        : "—",
      "Duplicate teaching unit (import)": it.importedFromTemplate
        ? (workloadTeachingImportLinesByStaffId[it.studentId.trim()] ?? []).some((l) => l.duplicateUnitConflict)
          ? "Yes"
          : "No"
        : "—",
      "HDR / Service field conflict (import)": it.importedFromTemplate
        ? workloadHdrImportByStaffId[it.studentId.trim()]?.hasHdrFieldConflict ||
          workloadServiceImportByStaffId[it.studentId.trim()]?.hasServicePointsConflict
          ? "Yes"
          : "No"
        : "—",
      "Total work hours": roundToOneDecimal(it.hours),
      Unit: it.unit,
      Department: it.department,
      Notes: (it.notes ?? "").trim(),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Failed");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `failed_workload_tasks_${stamp}.xlsx`);
  }

  function handleExportWorkloadForCurrentFilter() {
    if (statusFilter !== "distributed" && statusFilter !== "superseded") return;
    if (itemsForFilter.length === 0) {
      setPopup({
        open: true,
        title: "Nothing to export",
        message: `There are no rows under the current ${statusFilter} filter.`,
        status: "rejected",
      });
      return;
    }
    const rows = itemsForFilter.map((it) => ({
      Name: it.name,
      "Staff Number": it.studentId,
      Status: displayStatusForOpsRow(it),
      Confirmation: displayStatusForOpsRow(it) === "approved" ? "Confirmed" : "Unconfirmed",
      "Total work hours": roundToOneDecimal(it.hours),
      "Distributed time": submittedTimeById(it.id),
      "Distributed by": it.operatedBy?.trim() ? it.operatedBy : "—",
      Unit: it.unit,
      Department: it.department,
      Notes: (it.notes ?? "").trim(),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    const sheetName = statusFilter === "distributed" ? "Distributed" : "Superseded";
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `workload_${statusFilter}_${stamp}.xlsx`);
  }

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
  const adminPageSize = 10;
  const adminTotalPages = Math.max(1, Math.ceil(adminSearchResults.length / adminPageSize));
  const adminPageItems = useMemo(() => {
    const start = (adminPage - 1) * adminPageSize;
    return adminSearchResults.slice(start, start + adminPageSize);
  }, [adminPage, adminSearchResults]);
  useEffect(() => {
    if (adminPage > adminTotalPages) {
      setAdminPage(adminTotalPages);
    }
  }, [adminPage, adminTotalPages]);

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
    statusFilter === "all" && selectedIds.size > 0 && !submitting;

  async function handleDecision(kind: "approve" | "reject") {
    if (!canSubmit) return;
    setSubmitting(true);

    // Fake: update status locally
    const nextStatus: MockRequest["status"] =
      kind === "approve" ? "approved" : "rejected";
    const count = selectedIds.size;
    const operatorLabel = `${user.firstName} ${user.surname}`.trim();
    const next: MockRequest[] = pending.map((it) => {
      if (!selectedIds.has(it.id)) return it;
      return { ...it, status: nextStatus, operatedBy: operatorLabel || "—" };
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
      const operatorLabel = `${user.firstName} ${user.surname}`.trim();
      setPending((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                status: nextStatus,
                supervisorNote: note.trim(),
                operatedBy: operatorLabel || "—",
              }
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

  function openDistributeModal() {
    if (!hasSelectedPendingForDistribution) return;
    setDistributeYearInput(String(currentYear));
    setDistributeSemesterInput("S1");
    setDistributeError("");
    setDistributeModalOpen(true);
  }

  function closeDistributeModal() {
    setDistributeModalOpen(false);
    setDistributeError("");
  }

  function handleConfirmDistributeWorkload() {
    const parsedYear = Number(distributeYearInput);
    if (!Number.isFinite(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      setDistributeError("Please enter a valid year.");
      return;
    }
    const selectedPendingRows = pending.filter(
      (it) => selectedIds.has(it.id) && !it.cancelled && it.status === "pending"
    );
    if (!selectedPendingRows.length) {
      setDistributeError("Please select at least one pending workload.");
      return;
    }
    const operatorLabel = `${user.firstName} ${user.surname}`.trim() || "—";
    const approvedSelectedIds = new Set<number>();
    const failedSelectedIds = new Set<number>();

    selectedPendingRows.forEach((it) => {
      if (isImportedRowHoursOutOfBand(it, workloadAnomalyImportByStaffId)) failedSelectedIds.add(it.id);
      else approvedSelectedIds.add(it.id);
    });
    const detailSnapshotById = new Map<number, WorkloadDetailSnapshot>();
    selectedPendingRows.forEach((row) => {
      detailSnapshotById.set(
        row.id,
        buildWorkloadDetailSnapshot(
          row,
          workloadTeachingImportLinesByStaffId,
          workloadHdrImportByStaffId,
          workloadServiceImportByStaffId,
          workloadAssignedRoleImportByStaffId,
          workloadAnomalyImportByStaffId
        )
      );
    });

    setPending((prev) => {
      const next = prev.map((it) => {
        if (selectedIds.has(it.id) && !it.cancelled && it.status === "pending") {
          const nextStatus: MockRequest["status"] = failedSelectedIds.has(it.id) ? "rejected" : "approved";
          return {
            ...it,
            status: nextStatus,
            semesterLabel: distributeSemesterInput === "S2" ? "Sem2" : "Sem1",
            periodLabel: `${parsedYear}-${distributeSemesterInput === "S2" ? "2" : "1"}`,
            operatedBy: operatorLabel,
            detailSnapshot: detailSnapshotById.get(it.id) ?? it.detailSnapshot,
          };
        }
        // New distributed version supersedes previous active distributed row of the same staff.
        if (
          !it.cancelled &&
          it.status === "approved" &&
          approvedSelectedIds.size > 0 &&
          selectedPendingRows.some(
            (s) => approvedSelectedIds.has(s.id) && s.studentId.trim() === it.studentId.trim() && s.id !== it.id
          )
        ) {
          return { ...it, cancelled: true };
        }
        return it;
      });
      if (typeof window !== "undefined") {
        window.localStorage.setItem(OPS_ACADEMIC_DISTRIBUTED_KEY, JSON.stringify(next));
        // New distribution should always start from "-" on Academic/OPS until Academic submits.
        const statusRaw = window.localStorage.getItem(ACADEMIC_STATUS_SYNC_KEY);
        const statusMap =
          statusRaw && typeof statusRaw === "string"
            ? (JSON.parse(statusRaw) as Record<string, "pending" | "approved" | "rejected">)
            : {};
        const notesRaw = window.localStorage.getItem(ACADEMIC_NOTES_SYNC_KEY);
        const notesMap =
          notesRaw && typeof notesRaw === "string"
            ? (JSON.parse(notesRaw) as Record<string, string>)
            : {};
        selectedPendingRows.forEach((row) => {
          if (!approvedSelectedIds.has(row.id)) return;
          delete statusMap[String(row.id)];
          if (row.studentId) delete statusMap[row.studentId.trim()];
          delete notesMap[String(row.id)];
          if (row.studentId) delete notesMap[row.studentId.trim()];
        });
        window.localStorage.setItem(ACADEMIC_STATUS_SYNC_KEY, JSON.stringify(statusMap));
        window.localStorage.setItem(ACADEMIC_NOTES_SYNC_KEY, JSON.stringify(notesMap));
        window.dispatchEvent(new Event(SUPERVISOR_SYNC_EVENT));
      }
      return next;
    });

    const mailBody = createOpsDistributionMailBody(parsedYear, distributeSemesterInput);
    const mailedStaffIds = new Set<string>();
    const notifications: AcademicNotification[] = selectedPendingRows
      .filter((row) => approvedSelectedIds.has(row.id))
      .map((row) => {
        const sid = row.studentId.trim();
        if (!sid || mailedStaffIds.has(sid)) return null;
        mailedStaffIds.add(sid);
        const matched = assignablePeople.find((p) => p.staffId.trim() === sid);
        return {
          id: `ops-dist-${Date.now()}-${sid}`,
          recipientStaffId: sid,
          recipientName: matched ? `${matched.firstName} ${matched.lastName}`.trim() : row.name,
          recipientEmail: matched?.email ?? "",
          fromName: `${user.firstName} ${user.surname}`.trim() || "School Operations",
          fromEmail: user.email,
          subject: `Workload distributed for ${parsedYear} ${distributeSemesterInput}`,
          body: mailBody,
          sentAt: new Date().toISOString(),
        };
      })
      .filter((item): item is AcademicNotification => item !== null);
    appendAcademicNotifications(notifications);

    setSelectedIds(new Set());
    setStatusFilter("distributed");
    setDistributeModalOpen(false);
    setPopup({
      open: true,
      title: "Workload Distributed",
      message: `Selected pending workloads were processed for ${parsedYear} ${distributeSemesterInput}. Email notifications were sent to ${notifications.length} academic(s).`,
      status: "approved",
    });
  }

  function handleAdminSearch() {
    setAdminSearchFilters({
      firstName: adminSearchFirstNameInput.trim().toLowerCase(),
      lastName: adminSearchLastNameInput.trim().toLowerCase(),
      staffId: adminSearchStaffIdInput.trim().toLowerCase(),
    });
    setAdminPage(1);
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

  async function handleDownloadWorkloadTemplate() {
    try {
      const prefix = process.env.PUBLIC_URL ?? "";
      const blob = await fetchTrimmedWorkloadTemplateBlob(prefix);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = WORKLOAD_TEMPLATE_FILENAME;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not build workload template download.";
      setPopup({
        open: true,
        title: "Template download failed",
        message: msg,
        status: "rejected",
      });
    }
  }

  function handleOpenWorkloadImport() {
    workloadImportInputRef.current?.click();
  }

  async function handleImportWorkload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const isXlsx =
      file.name.toLowerCase().endsWith(".xlsx") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!isXlsx) {
      setPopup({
        open: true,
        title: "Import Failed",
        message: "Please upload an .xlsx file.",
        status: "rejected",
      });
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkloadWorkbookArrayBuffer({ fileName: file.name, buf });
      await postWorkloadSpreadsheetImport(parsed);
      setWorkloadTeachingImportLinesByStaffId((prev) => {
        const next = { ...prev };
        for (const sh of parsed.sheets) {
          for (const [rawStaffId, lines] of Object.entries(sh.teachingLinesByStaffId)) {
            const key = rawStaffId.startsWith("__row:") ? rawStaffId : rawStaffId.trim();
            const merged = [...(next[key] ?? []), ...lines];
            next[key] = applyDuplicateTeachingUnitFlagsToLines(merged);
          }
        }
        return next;
      });
      setWorkloadHdrImportByStaffId((prev) => {
        const next = { ...prev };
        for (const sh of parsed.sheets) {
          for (const [rawId, hdr] of Object.entries(sh.hdrMetricsByStaffId)) {
            const key = rawId.startsWith("__row:") ? rawId : rawId.trim();
            if (key in next) continue;
            if (
              hdr.ftStudents != null ||
              hdr.ptStudents != null ||
              hdr.ftHours != null ||
              hdr.ptHours != null ||
              hdr.totalHrs != null ||
              hdr.derivedHrs != null ||
              hdr.hdrPoints != null ||
              hdr.hasHdrFieldConflict
            ) {
              next[key] = hdr;
            }
          }
        }
        return next;
      });
      setWorkloadServiceImportByStaffId((prev) => {
        const next = { ...prev };
        for (const sh of parsed.sheets) {
          for (const [rawId, svc] of Object.entries(sh.serviceMetricsByStaffId)) {
            const key = rawId.startsWith("__row:") ? rawId : rawId.trim();
            if (key in next) continue;
            if (svc.servicePoints != null || svc.hasServicePointsConflict) next[key] = svc;
          }
        }
        return next;
      });
      setWorkloadAssignedRoleImportByStaffId((prev) => {
        const next = { ...prev };
        for (const sh of parsed.sheets) {
          for (const [rawId, roleMetrics] of Object.entries(sh.roleMetricsByStaffId)) {
            const key = rawId.startsWith("__row:") ? rawId : rawId.trim();
            if (key in next) continue;
            if (
              roleMetrics.roles.length > 0 ||
              roleMetrics.totalPoints != null ||
              roleMetrics.totalHours != null ||
              roleMetrics.hasAssignedRoleHourConflict
            ) {
              next[key] = roleMetrics;
            }
          }
        }
        return next;
      });
      setWorkloadAnomalyImportByStaffId((prev) => {
        const next = { ...prev };
        for (const sh of parsed.sheets) {
          for (const [rawId, anomaly] of Object.entries(sh.anomalyMetricsByStaffId)) {
            const key = rawId.startsWith("__row:") ? rawId : rawId.trim();
            if (!key || key.startsWith("__row:")) continue;
            next[key] = {
              targetBand: anomaly.targetBand ?? null,
              calculatedBand: anomaly.calculatedBand ?? null,
              calculatedTeachingRatio: anomaly.calculatedTeachingRatio ?? null,
              researchResidualPoints: anomaly.researchResidualPoints ?? null,
              totalHoursFromPoints: anomaly.totalHoursFromPoints ?? null,
              fte: anomaly.fte ?? null,
            };
          }
        }
        return next;
      });
      const importRowsByStaff = new Map<
        string,
        {
          name: string;
          unit: string;
          targetTeachingRatio?: number;
          totalHours: number;
          targetBand?: string;
          notesFromTemplate: string;
          workloadNewStaff?: boolean;
          hodReview?: "yes" | "no";
          rowIndices: number[];
        }
      >();
      for (const sheet of parsed.sheets) {
        for (const row of sheet.rows) {
          const staffIdRaw = row.computed.staffIdGuess ?? row.cellsByColumn.C ?? row.cellsByColumn.A ?? "";
          const staffId = String(staffIdRaw ?? "").trim();
          if (!staffId || staffId.startsWith("__row:")) continue;

          const existing = importRowsByStaff.get(staffId);
          const rowIndex = row.rowIndex;
          if (existing) {
            if (!existing.rowIndices.includes(rowIndex)) existing.rowIndices.push(rowIndex);
            continue;
          }

          const nameRaw = row.cellsByColumn.B ?? row.cellsByColumn.A ?? "";
          const name = displayNameWithoutComma(String(nameRaw ?? "").trim()) || `Staff ${staffId}`;
          const teachingHours = sheet.teachingHoursSumByStaffId[staffId] ?? 0;
          const hdrM = sheet.hdrMetricsByStaffId[staffId];
          const hdrPoints = hdrM?.hdrPoints ?? 0;
          const hdrHoursFromDerived =
            hdrM?.derivedHrs != null && Number.isFinite(hdrM.derivedHrs) ? hdrM.derivedHrs : null;
          const hdrHoursFromComponents =
            (hdrM?.ftHours != null && Number.isFinite(hdrM.ftHours) ? hdrM.ftHours : 0) +
            (hdrM?.ptHours != null && Number.isFinite(hdrM.ptHours) ? hdrM.ptHours : 0);
          const hdrHours =
            hdrHoursFromDerived ??
            (hdrHoursFromComponents > 0 ? hdrHoursFromComponents : null) ??
            (typeof hdrPoints === "number" && Number.isFinite(hdrPoints) ? hdrPoints * TEACHING_HOURS_FACTOR : 0);
          const serviceHours = (sheet.serviceMetricsByStaffId[staffId]?.servicePoints ?? 0) * TEACHING_HOURS_FACTOR;
          const roleHours = sheet.roleMetricsByStaffId[staffId]?.totalHours ?? 0;
          const modelHours = sheet.anomalyMetricsByStaffId[staffId]?.totalHoursFromPoints;
          const totalHours = Math.round(
            (typeof modelHours === "number" && Number.isFinite(modelHours)
              ? modelHours
              : teachingHours + hdrHours + serviceHours + roleHours) * 1000
          ) / 1000;
          const ratioRaw = row.cellsByColumn[TARGET_TEACHING_PCT_COL];
          const parsedRatio = Number.parseFloat(String(ratioRaw ?? "").trim());
          const targetTeachingRatio = Number.isFinite(parsedRatio) ? parsedRatio : undefined;
          const targetBand = normalizeBandLabel(String(row.cellsByColumn[TARGET_BAND_COL] ?? "").trim()) ?? undefined;
          const notesFromTemplate = String(row.cellsByColumn[NOTES_COL] ?? "").trim();
          const workloadNewStaff = parseWorkloadTemplateNewStaff(row.cellsByColumn[NEW_STAFF_COL]);
          const hodReview = parseWorkloadTemplateHodReview(row.cellsByColumn[HOD_REVIEW_COL]);

          importRowsByStaff.set(staffId, {
            name,
            unit: String(row.cellsByColumn[TEACHING_UNIT_COL] ?? "").trim(),
            targetTeachingRatio,
            targetBand,
            totalHours,
            notesFromTemplate,
            workloadNewStaff,
            hodReview,
            rowIndices: [rowIndex],
          });
        }
      }

      const importStatusByStaffId = new Map<string, "pending" | "rejected">();
      const failedRowSet = new Set<number>();
      const employeeByStaffId = new Map(assignablePeople.map((person) => [person.staffId.trim(), person]));
      const ineligibleStaffIds = new Set<string>();
      importRowsByStaff.forEach((imported, staffId) => {
        const matchedEmployee = employeeByStaffId.get(staffId);
        const employeeEligible = Boolean(matchedEmployee && matchedEmployee.isActive);
        if (!employeeEligible) {
          ineligibleStaffIds.add(staffId);
          importStatusByStaffId.set(staffId, "rejected");
          imported.rowIndices.forEach((idx) => failedRowSet.add(idx));
          return;
        }
        const fteVal = fteForStaffFromParsed(parsed, staffId);
        const roleHourConflict = parsed.sheets.some(
          (sh) => sh.roleMetricsByStaffId[staffId]?.hasAssignedRoleHourConflict === true
        );
        const teachingDupUnit = parsed.sheets.some((sh) =>
          (sh.teachingLinesByStaffId[staffId] ?? []).some((line) => line.duplicateUnitConflict)
        );
        const hdrFieldConflict = parsed.sheets.some((sh) => sh.hdrMetricsByStaffId[staffId]?.hasHdrFieldConflict === true);
        const servicePointsConflict = parsed.sheets.some(
          (sh) => sh.serviceMetricsByStaffId[staffId]?.hasServicePointsConflict === true
        );
        const hoursRejected = importHoursFailStatus(imported.totalHours, fteVal) === "rejected";
        const importStatus =
          teachingDupUnit || roleHourConflict || hoursRejected || hdrFieldConflict || servicePointsConflict
            ? "rejected"
            : "pending";
        importStatusByStaffId.set(staffId, importStatus);
        if (importStatus === "rejected") {
          imported.rowIndices.forEach((idx) => failedRowSet.add(idx));
        }
      });
      const importedTotal = importRowsByStaff.size;
      const importedFailed = Array.from(importStatusByStaffId.values()).filter((s) => s === "rejected").length;
      const importedSuccess = Math.max(0, importedTotal - importedFailed);
      const failedRows = Array.from(failedRowSet).sort((a, b) => a - b);

      setPending((prev) => {
        const byStaffId = new Map<string, MockRequest>();
        for (const row of prev) {
          byStaffId.set(row.studentId.trim(), row);
        }
        let nextId = prev.reduce((maxId, row) => Math.max(maxId, row.id), 0) + 1;
        importRowsByStaff.forEach((imported, staffId) => {
          if (ineligibleStaffIds.has(staffId)) return;
          const importStatus = importStatusByStaffId.get(staffId) ?? "pending";
          const existing = byStaffId.get(staffId);
          const matchedEmployee = employeeByStaffId.get(staffId);
          if (existing) {
            byStaffId.set(staffId, {
              ...existing,
              name: imported.name || existing.name,
              unit: imported.unit || existing.unit,
              hours: imported.totalHours,
              targetTeachingRatio: imported.targetTeachingRatio,
              targetBand: imported.targetBand,
              notes: imported.notesFromTemplate || existing.notes || "",
              workloadNewStaff: imported.workloadNewStaff ?? existing.workloadNewStaff,
              hodReview: imported.hodReview ?? existing.hodReview,
              title: matchedEmployee?.title?.trim() || existing.title,
              department: matchedEmployee?.currentDepartment?.trim() || existing.department,
              status: importStatus,
              importedFromTemplate: true,
            });
          } else {
            byStaffId.set(staffId, {
              id: nextId++,
              studentId: staffId,
              semesterLabel: "Sem1",
              periodLabel: `${new Date().getFullYear()}-1`,
              name: imported.name,
              unit: imported.unit,
              notes: imported.notesFromTemplate,
              title: matchedEmployee?.title?.trim() || "",
              department: matchedEmployee?.currentDepartment?.trim() || "",
              rate: 0,
              status: importStatus,
              hours: imported.totalHours,
              operatedBy: "—",
              targetTeachingRatio: imported.targetTeachingRatio,
              targetBand: imported.targetBand,
              workloadNewStaff: imported.workloadNewStaff,
              hodReview: imported.hodReview,
              importedFromTemplate: true,
            });
          }
        });
        return Array.from(byStaffId.values());
      });
      setStatusFilter("all");
      setSelectedIds(new Set());
      setPage(1);
      setDetailsOpen(false);
      setDetailsItem(null);
      setPopup({
        open: true,
        title: "Import Excel",
        message:
          "For failed rows, please check whether the employee is not in the system or is inactive.",
        status: "approved",
        importSummary: {
          total: importedTotal,
          success: importedSuccess,
          failed: importedFailed,
          failedRows,
        },
      });
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : "Could not read this workbook.";
      setPopup({
        open: true,
        title: "Import Failed",
        message: msg,
        status: "rejected",
        importSummary: undefined,
      });
    }
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
        setImportMessage("");
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
    const matchedEmployee = assignablePeople.find((person) => person.staffId.trim() === item.studentId.trim());
    const resolvedDepartment = matchedEmployee?.currentDepartment?.trim() || item.department?.trim() || "";
    const resolvedTitle = matchedEmployee?.title?.trim() || item.title?.trim() || "";
    setDetailsItem({
      ...item,
      department: resolvedDepartment,
      title: resolvedTitle,
    });
    setDetailsBreakdown(breakdownById(item.id, item.hours));
    setDetailsOpen(true);
  }

  function closeDetails() {
    setDetailsOpen(false);
    setDetailsItem(null);
    setDetailsBreakdown(null);
    setNoteModalOpen(false);
    setNoteDraft("");
    setNoteError("");
    setNoteTargetId(null);
  }

  function updateBreakdownRow(tab: BreakdownCategory, idx: number, field: "name" | "hours", value: string) {
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

  function handleYearWheel(event: React.WheelEvent<HTMLSelectElement>) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 1 : -1;
    const nextYear = (Number(searchYearInput) || currentYear) + delta;
    setSearchYearInput(String(nextYear));
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  }

  function handlePopupDragStart(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    popupDragRef.current.dragging = true;
    popupDragRef.current.startX = event.clientX;
    popupDragRef.current.startY = event.clientY;
    popupDragRef.current.originX = popupDragOffset.x;
    popupDragRef.current.originY = popupDragOffset.y;
    event.preventDefault();
  }

  const popupImportRatePercent = popup.importSummary
    ? popup.importSummary.total > 0
      ? Math.round((popup.importSummary.success / popup.importSummary.total) * 100)
      : 0
    : 0;

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
          title="School Operations Dashboard"
          hasNewMessage={opsUnreadReportCount > 0}
          onMessageClick={() => setOpsReportInboxOpen(true)}
          greetingName={user.surname}
          onAvatarClick={() => setProfileOpen(true)}
          avatarSrc={avatarSrc}
        />

        {opsReportInboxOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
            onClick={() => setOpsReportInboxOpen(false)}
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
                  onClick={() => setOpsReportInboxOpen(false)}
                >
                  ✕
                </button>
              </div>
              {opsSemesterReports.length === 0 ? (
                <div className="rounded-md border border-[#2f4d9c]/30 bg-white px-4 py-5 text-sm text-slate-700">
                  No semester report generated yet.
                </div>
              ) : (
                <>
                  <div className="max-h-80 overflow-y-auto rounded-md border border-[#2f4d9c]/40 bg-white">
                    {pagedOpsReports.map((report) => (
                      <div
                        key={report.id}
                        className="flex items-center justify-between gap-3 border-b border-[#2f4d9c]/10 px-4 py-3"
                      >
                        <div className="text-sm font-semibold text-slate-800">{report.title}</div>
                        <button
                          type="button"
                          onClick={() => handleDownloadOpsSemesterReport(report)}
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
                      onClick={() => setOpsReportInboxPage((p) => Math.max(1, p - 1))}
                      disabled={opsReportInboxPage <= 1}
                      className="rounded border border-[#2f4d9c]/35 bg-[#eef3ff] px-3 py-1 font-semibold text-[#2f4d9c] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="text-slate-600">
                      Page {opsReportInboxPage} / {opsReportTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpsReportInboxPage((p) => Math.min(opsReportTotalPages, p + 1))}
                      disabled={opsReportInboxPage >= opsReportTotalPages}
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
                    style={{ transform: `translate(${popupDragOffset.x}px, ${popupDragOffset.y}px)` }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className="flex cursor-move items-center justify-between bg-[#2f4d9c] px-5 py-3 text-white"
                      onMouseDown={handlePopupDragStart}
                    >
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
                      {popup.importSummary ? (
                        <div className="space-y-2 text-base text-slate-800">
                          <div>{`Imported Excel workloads: ${popup.importSummary.total}.`}</div>
                          <div>{`Successful: ${popup.importSummary.success}.`}</div>
                          <div>{`Failed: ${popup.importSummary.failed}${
                            popup.importSummary.failed > 0 && (popup.importSummary.failedRows?.length ?? 0) > 0
                              ? ` (Excel rows: ${popup.importSummary.failedRows?.join(", ")})`
                              : ""
                          }.`}</div>
                          <div className="pt-1">
                            <div className="mb-1.5 text-sm font-semibold text-slate-700">
                              {`Success ratio: ${popup.importSummary.success}/${popup.importSummary.total} (${popupImportRatePercent}%)`}
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-[#2f4d9c] transition-all"
                                style={{ width: `${popupImportRatePercent}%` }}
                              />
                            </div>
                          </div>
                          <div className="pt-1 text-base text-slate-800">{popup.message}</div>
                        </div>
                      ) : (
                        <div className="text-base text-slate-800">{popup.message}</div>
                      )}
                      <div className="mt-4 flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedIds(new Set());
                            setPage(1);
                            setDetailsOpen(false);
                            setDetailsItem(null);
                            setPopup((p) => ({ ...p, open: false }));
                          }}
                          className={`rounded-md px-5 py-2 text-sm font-semibold text-white hover:brightness-95 ${
                            popup.importSummary
                              ? "bg-[#2f4d9c]"
                              : popup.status === "approved"
                              ? "bg-[#16a34a]"
                              : popup.status === "rejected"
                                ? "bg-[#dc2626]"
                                : "bg-[#d97706]"
                          }`}
                        >
                          {popup.importSummary
                            ? "Confirm"
                            : popup.status === "approved"
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

              <div className="mt-4 rounded-md bg-[#f4f7ff] p-4">
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
                        list="workload-year-options"
                        value={searchYearInput}
                        onChange={(e) => setSearchYearInput(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-2 text-sm"
                        placeholder="Year"
                      />
                      <datalist id="workload-year-options">
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

              <div className="mt-6 flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-slate-700">{`Workload Report ${WORKLOAD_REPORT_SEMESTER_LABEL}`}</div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDownloadWorkloadTemplate}
                    className="rounded border border-[#2f4d9c] bg-white px-4 py-2 text-sm font-semibold text-[#2f4d9c] hover:bg-[#eef2ff]"
                  >
                    Download Template
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenWorkloadImport}
                    className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                  >
                    Import Workload
                  </button>
                  <input
                    ref={workloadImportInputRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleImportWorkload}
                    className="hidden"
                  />
                </div>
              </div>
              <div className="mt-6 rounded-md bg-[#f4f7ff] p-4">
                <div className="mb-4 flex w-full min-w-0 items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-5">
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
                        Pending Distribution ({workloadPendingFilterCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter("distributed");
                          setSelectedIds(new Set());
                          setPage(1);
                          setDetailsOpen(false);
                          setDetailsItem(null);
                        }}
                        className={`rounded-md border px-5 py-2 text-base font-semibold ${
                          statusFilter === "distributed"
                            ? "border-[#16a34a] bg-[#16a34a] text-white"
                            : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                        }`}
                      >
                        Distributed ({workloadDistributedFilterCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter("failed");
                          setSelectedIds(new Set());
                          setPage(1);
                          setDetailsOpen(false);
                          setDetailsItem(null);
                        }}
                        className={`rounded-md border px-5 py-2 text-base font-semibold ${
                          statusFilter === "failed"
                            ? "border-[#dc2626] bg-[#dc2626] text-white"
                            : "border-[#2f4d9c] bg-white text-[#2f4d9c]"
                        }`}
                      >
                        Failed ({workloadFailedFilterCount})
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter("superseded");
                      setSelectedIds(new Set());
                      setPage(1);
                      setDetailsOpen(false);
                      setDetailsItem(null);
                    }}
                    className={`shrink-0 rounded-md border px-5 py-2 text-base font-semibold ${
                      statusFilter === "superseded"
                        ? "border-[#2f4d9c] bg-[#2f4d9c] text-white"
                        : "border-[#2f4d9c] bg-white text-[#2f4d9c] hover:bg-[#eef2ff]"
                    }`}
                  >
                    View history
                  </button>
                </div>
                <div className="max-h-[460px] overflow-x-auto overflow-y-auto pr-1">
                  <table className="min-w-full border-separate border-spacing-y-0">
                    <thead>
                      <tr className="text-left text-sm font-extrabold uppercase tracking-wide text-slate-700">
                        <th className="w-10 px-2 py-2"></th>
                        <th className="w-14 px-2 py-2">#</th>
                        <th className="px-3 py-2">NAME</th>
                        <th className="px-3 py-2 text-center">STATUS</th>
                        <th className="px-3 py-2 text-center whitespace-nowrap">TOTAL WORK HOURS</th>
                        <th className="px-3 py-2">CONFIRMATION</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap">DISTRIBUTED TIME</th>
                        <th className="px-3 py-2 text-right whitespace-nowrap">DISTRIBUTED BY</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {loading && (
                        <tr>
                          <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                            Loading...
                          </td>
                        </tr>
                      )}
                      {!loading && pageItems.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                            {statusFilter === "all" ? "No pending items" : "No items found"}
                          </td>
                        </tr>
                      )}
                      {!loading &&
                        pageItems.map((item, idx) => {
                          const isSelected = selectedIds.has(item.id);
                          const rowCancelled = Boolean(item.cancelled);
                          const rowIndex = (page - 1) * pageSize + idx + 1;
                          const opsDisplayStatus = displayStatusForOpsRow(item);
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
                                {statusFilter === "all" ? (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onClick={(e) => e.stopPropagation()}
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
                                <div>{displayNameWithoutComma(item.name)}</div>
                                <div className="text-xs text-slate-400">{item.studentId}</div>
                              </td>
                              <td className="px-3 py-3 text-center">
                                {opsDisplayStatus === "-" ? (
                                  <span className="text-sm font-semibold text-slate-500">-</span>
                                ) : (
                                  <StatusPill status={opsDisplayStatus} variant="supervisor" />
                                )}
                              </td>
                              <td className="px-3 py-3 text-center">
                                <WorkHoursBadge hours={roundToOneDecimal(item.hours)} />
                              </td>
                              <td className="px-3 py-3">
                                {opsDisplayStatus === "approved" ? (
                                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#15803d]">
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#15803d] bg-[#15803d] text-[10px] text-white">
                                      ✓
                                    </span>
                                    Confirmed
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#c2410c]">
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#c2410c] bg-white text-[10px] text-[#c2410c]">
                                      ○
                                    </span>
                                    Unconfirmed
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums font-sans font-semibold text-slate-800">
                                {submittedTimeById(item.id)}
                              </td>
                              <td className="px-3 py-3 text-right text-sm text-slate-700">
                                {item.operatedBy?.trim() ? item.operatedBy : "—"}
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
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  {statusFilter === "failed" ? (
                    <p className="max-w-xl text-sm font-bold leading-relaxed text-[#dc2626]">
                      Export failed records for academics to review and fix, then import again.
                    </p>
                  ) : (
                    <span className="hidden sm:block" aria-hidden />
                  )}
                  <div className="flex shrink-0 justify-end">
                    {statusFilter === "failed" ? (
                      <button
                        type="button"
                        onClick={handleExportFailedWorkload}
                        disabled={submitting || itemsForFilter.length === 0}
                        className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183] disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        Export failed tasks
                      </button>
                    ) : statusFilter === "distributed" || statusFilter === "superseded" ? (
                      <button
                        type="button"
                        onClick={handleExportWorkloadForCurrentFilter}
                        disabled={submitting || itemsForFilter.length === 0}
                        className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183] disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        Export Workload
                      </button>
                    ) : (
                      <div className="flex flex-col items-end gap-2">
                        <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-semibold text-slate-700">
                          <input
                            ref={selectAllPendingRef}
                            type="checkbox"
                            className="h-4 w-4 accent-[#2f4d9c]"
                            checked={allPendingFilteredSelected}
                            disabled={pendingFilteredIds.length === 0 || submitting}
                            onChange={() => {
                              if (allPendingFilteredSelected) {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  pendingFilteredIds.forEach((id) => next.delete(id));
                                  return next;
                                });
                              } else {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  pendingFilteredIds.forEach((id) => next.add(id));
                                  return next;
                                });
                              }
                            }}
                          />
                          <span>Select all pending</span>
                        </label>
                        <button
                          type="button"
                          onClick={openDistributeModal}
                          disabled={!hasSelectedPendingForDistribution}
                          className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183] disabled:cursor-not-allowed disabled:bg-slate-400"
                        >
                          Distribute Workload
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {detailsOpen && detailsItem && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                  onClick={closeDetails}
                >
                  <div
                    className="w-full max-w-2xl rounded-sm bg-white p-0 shadow"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="rounded-sm border border-black">
                      <div className="flex items-center justify-between gap-4 border-b border-black/30 bg-white px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="rounded-sm bg-[#2f4d9c] px-4 py-2 text-sm font-bold text-white tabular-nums font-sans">
                            {workloadDetailReportingPeriodLabel(detailsItem)}
                          </div>
                          <div className="rounded-sm bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                            {detailsItem.department?.trim() || "Department N/A"}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-sm font-semibold text-slate-800">
                          <button
                            type="button"
                            onClick={closeDetails}
                            className="rounded bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-300"
                          >
                            Close
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4 px-5 py-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <InfoField label="Name" value={displayNameWithoutComma(detailsItem.name)} />
                          <InfoField label="Staff ID" value={detailsItem.studentId} />
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <InfoField
                            label="Target teaching ratio"
                            value={
                              detailsItem.targetTeachingRatio != null
                                ? `${formatOneDecimal(detailsItem.targetTeachingRatio)}%`
                                : "—"
                            }
                          />
                          <InfoField
                            label="Actual teaching ratio"
                            value={actualTeachingRatioDisplay}
                            className="tabular-nums font-sans"
                            inputClassName={
                              actualTeachingRatioOutOfRange
                                ? "border-red-500 ring-1 ring-red-300 bg-red-50/60 text-red-900"
                                : showActualTeachingRatioBandWarning
                                  ? "border-yellow-500 ring-1 ring-yellow-300 bg-yellow-50/60 text-amber-900"
                                  : ""
                            }
                            tooltipText={actualRatioHoverText}
                            tooltipClassName={
                              actualTeachingRatioOutOfRange
                                ? "border-red-300 bg-red-50 text-red-900"
                                : "border-yellow-300 bg-yellow-50 text-amber-900"
                            }
                          />
                          <InfoField
                            label="Total work hours"
                            value={totalHoursDisplay}
                            className="tabular-nums font-sans"
                            inputClassName={
                              adminModalHoursAbnormal
                                ? "border-red-500 ring-1 ring-red-300 bg-red-50/40 text-red-900 text-xs sm:text-sm"
                                : "text-xs sm:text-sm"
                            }
                            tooltipText={totalHoursTooltipText}
                          />
                          <InfoField
                            label="Employment type"
                            value={employmentTypeLabelFromFte(detailsAnomaly?.fte ?? null)}
                            className="font-sans"
                            inputClassName="text-slate-800"
                          />
                          <InfoField
                            label="New Staff"
                            value={templateNewStaffDisplay(detailsItem.workloadNewStaff)}
                            className="font-sans"
                            inputClassName="text-slate-800"
                          />
                          <InfoField
                            label="HoD Review"
                            value={templateHodReviewDisplay(detailsItem.hodReview)}
                            className="font-sans"
                            inputClassName="text-slate-800"
                          />
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase text-slate-500">Workload Breakdown</div>
                          <div className="mt-1 overflow-hidden rounded border border-slate-300">
                            <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                              {ADMIN_WORKLOAD_BREAKDOWN_TABS.map((tab) => (
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
                                  <th className="px-3 py-2 text-right">Hours</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 bg-white text-sm text-slate-700">
                                {(adminModalBreakdownMerged?.[detailsTab] ?? []).map((row, idx) => {
                                  const isHdrSummaryRow =
                                    detailsTab === "HDR" && row.name === HDR_TOTAL_ROW_LABEL;
                                  const conflictHighlightRow = Boolean(
                                    row.roleHourConflict || row.teachingDuplicateUnit
                                  );
                                  return (
                                    <tr
                                      key={`${detailsItem.id}-${detailsTab}-${idx}`}
                                      className={
                                        conflictHighlightRow
                                          ? "bg-red-50"
                                          : isHdrSummaryRow
                                            ? "bg-slate-50"
                                            : undefined
                                      }
                                    >
                                      <td
                                        className={`px-3 py-2 ${
                                          isHdrSummaryRow ? "font-bold text-slate-800" : ""
                                        } ${conflictHighlightRow ? "font-semibold text-red-900" : ""}`}
                                      >
                                        {row.name}
                                      </td>
                                      <td
                                        className={`px-3 py-2 text-right tabular-nums font-sans ${
                                          isHdrSummaryRow ? "font-bold text-slate-800" : ""
                                        } ${conflictHighlightRow ? "font-semibold text-red-900" : ""}`}
                                      >
                                        {formatOneDecimal(row.hours)}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {detailsTab !== "HDR" && (
                                  <tr className="bg-slate-50">
                                    <td className="px-3 py-2 font-bold text-slate-800">
                                      {workloadBreakdownTotalLabel(detailsTab)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-bold tabular-nums font-sans text-slate-800">
                                      {formatOneDecimal(
                                        (adminModalBreakdownMerged?.[detailsTab] ?? []).reduce(
                                          (sum, row) => sum + workloadHoursForBreakdownRow(row),
                                          0
                                        )
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-semibold text-slate-500">NOTES</div>
                          <textarea
                            readOnly
                            value={workloadModalNotes(detailsItem).trim()}
                            placeholder={STAFF_PROFILE_NOTES_PLACEHOLDER}
                            rows={4}
                            className="w-full resize-y rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-500 read-only:bg-slate-50"
                          />
                        </div>
                        <div className="h-2" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {distributeModalOpen && (
                <div className="fixed inset-0 z-[82] flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-md rounded-md bg-white shadow-lg">
                    <div className="flex items-center justify-between rounded-t-md bg-[#2f4d9c] px-5 py-3 text-white">
                      <div className="text-base font-bold">Distribute Workload</div>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded bg-white/10 text-lg hover:bg-white/20"
                        onClick={closeDistributeModal}
                      >
                        ×
                      </button>
                    </div>
                    <div className="space-y-4 p-5">
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Year</div>
                        <input
                          type="number"
                          value={distributeYearInput}
                          onChange={(e) => setDistributeYearInput(e.target.value)}
                          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Year"
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Semester</div>
                        <select
                          value={distributeSemesterInput}
                          onChange={(e) => setDistributeSemesterInput(e.target.value as "S1" | "S2")}
                          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="S1">S1 (1 January - 30 June)</option>
                          <option value="S2">S2 (1 July - 31 December)</option>
                        </select>
                      </div>
                      <div className="text-xs font-semibold text-[#dc2626]">
                        DDL is the final day for academics to confirm their workload.
                      </div>
                      {distributeError && <div className="text-sm font-semibold text-[#dc2626]">{distributeError}</div>}
                      <div className="flex items-center justify-end gap-3 pt-1">
                        <button
                          type="button"
                          onClick={closeDistributeModal}
                          className="rounded bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmDistributeWorkload}
                          className="rounded bg-[#2f4d9c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#264183]"
                        >
                          Confirm
                        </button>
                      </div>
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
                title="Employee Management"
                description="Search staff members, import templates, and review latest profile update times."
                rightSlot={
                  <TemplateImportExportActions
                    onDownload={handleDownloadTemplate}
                    onOpenImport={handleOpenImport}
                    fileInputRef={fileInputRef}
                    onImportChange={handleImportTemplate}
                  />
                }
              />
              {importMessage.startsWith("Import failed") ? (
                <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                  {importMessage}
                </div>
              ) : null}

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

                <div className="mt-4 rounded border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left">Staff ID</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Title</th>
                        <th className="px-3 py-2 text-left">Department</th>
                        <th className="px-3 py-2 text-right">Updated Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminPageItems.map((person) => (
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
                          <td className="px-3 py-2 text-right tabular-nums font-sans text-slate-700">
                            {modifiedTimeById(person.id)}
                          </td>
                        </tr>
                      ))}
                      {adminPageItems.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                            No staff found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginationControls
                  page={adminPage}
                  totalPages={adminTotalPages}
                  onPrev={() => setAdminPage((p) => Math.max(1, p - 1))}
                  onNext={() => setAdminPage((p) => Math.min(adminTotalPages, p + 1))}
                  disablePrev={adminPage <= 1}
                  disableNext={adminPage >= adminTotalPages}
                />
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
