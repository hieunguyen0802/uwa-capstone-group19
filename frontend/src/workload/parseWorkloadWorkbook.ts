import * as XLSX from "xlsx";
import type { WorkSheet } from "xlsx";
import {
  FTE_COL,
  HDR_FT_STUDENTS_COL,
  HDR_FT_PROPORTION_COL,
  HDR_POINTS_COL,
  HDR_PT_STUDENTS_COL,
  HDR_PT_PROPORTION_COL,
  HDR_TOTAL_HRS_COL,
  MAX_ROLE_PAIR_BLOCKS,
  ROLE_BLOCK_STRIDE_COLS,
  ROLE_NAME_COL_START,
  ROLE_POINTS_COL_START,
  ROLE_TOTAL_POINTS_COL,
  SERVICE_POINTS_COL,
  STAFF_ID_COL,
  TARGET_BAND_COL,
  TEACHING_HOURS_FACTOR,
  TEACHING_SCORE_COL,
  TEACHING_UNIT_COL,
} from "./workloadSpreadsheetRules";
import { excelColToZeroIndex, zeroIndexToExcelCol } from "./excelColumnUtils";

export type ParsedAssignedRole = { roleNameCol: string; pointsCol: string; roleName: string; points: number | null };

export type WorkloadParsedRow = {
  /** 1-based row index inside the workbook sheet */
  rowIndex: number;
  /** Every scanned cell keyed by Excel column letters (sparse). Empty cells omitted unless present in sheet range. */
  cellsByColumn: Record<string, string | number | null>;
  computed: {
    staffIdGuess: string | null;
    teachingUnitNameFromH: string | null;
    teachingScoreFromU: number | null;
    teachingHours: number | null;
    assignedRolesEndedAtFirstBlankName: ParsedAssignedRole[];
  };
};

/** HDR: canonical from first populated row; later rows with different Y / AC / AD values → conflict + extras. */
export type WorkloadHdrMetrics = {
  ftStudents: number | null;
  ptStudents: number | null;
  ftHours: number | null;
  ptHours: number | null;
  totalHrs: number | null;
  derivedHrs: number | null;
  hdrPoints: number | null;
  hasHdrFieldConflict: boolean;
  ftStudentsConflict?: boolean;
  totalHrsConflict?: boolean;
  hdrPointsConflict?: boolean;
  /** Extra display rows (hours shown in modal; FT row shows count as today). */
  hdrExtraLines?: { name: string; hours: number }[];
};

/** Service: canonical AE points from first row; different AE on another row → conflict + extra line. */
export type WorkloadServiceMetrics = {
  servicePoints: number | null;
  hasServicePointsConflict: boolean;
  servicePointsConflict?: boolean;
  /** Extra Self-Directed Svc hours lines for conflicting template row. */
  serviceExtraLines?: { hours: number }[];
};

/** Assigned-role row: canonical rows exclude duplicates from totals; conflict extras are display-only. */
export type WorkloadRoleMetricRow = {
  name: string;
  points: number;
  hours: number;
  hourConflict?: boolean;
  excludeFromWorkloadTotal?: boolean;
};

export type WorkloadRoleMetrics = {
  roles: WorkloadRoleMetricRow[];
  totalPoints: number | null;
  totalHours: number | null;
  /** Same staff ID + same role name + different hours on another template row (non-teaching). */
  hasAssignedRoleHourConflict: boolean;
};

export type WorkloadAnomalyMetrics = {
  fte: number | null;
  targetBand: string | null;
  teachingPoints: number | null;
  assignedRolePoints: number | null;
  servicePoints: number | null;
  hdrPoints: number | null;
  researchResidualPoints: number | null;
  calculatedTeachingRatio: number | null;
  calculatedBand: "Research Focused" | "Balanced Teaching & Research" | "Teaching Focused" | null;
  totalHoursFromPoints: number | null;
};

/** One teaching row per template line (unit + hours); duplicate same unit flagged for UI / failed import. */
export type TeachingLineImport = {
  unit: string;
  hours: number | null;
  duplicateUnitConflict?: boolean;
  /** Second and later rows for the same unit code — excluded from teaching subtotal (first row still counts once). */
  excludeFromWorkloadTotal?: boolean;
};

export type ParsedWorkloadSheet = {
  sheetName: string;
  headerRowIndex0: number | null;
  /** Aggregated Teaching lines per staff ID; different units sum into teaching totals. */
  teachingHoursSumByStaffId: Record<string, number>;
  /** Per-unit lines; same unit twice for one staff is invalid — both rows get duplicateUnitConflict and extras do not add to sums. */
  teachingLinesByStaffId: Record<string, TeachingLineImport[]>;
  /** HDR Y/AC/AD — first row canonical; later rows may fill nulls or trigger conflict if same field differs. */
  hdrMetricsByStaffId: Record<string, WorkloadHdrMetrics>;
  /** Service AE — first row canonical; later different points → conflict. */
  serviceMetricsByStaffId: Record<string, WorkloadServiceMetrics>;
  /** Assigned roles: first non-empty row per staff is canonical; later rows detect same role name + different hours. */
  roleMetricsByStaffId: Record<string, WorkloadRoleMetrics>;
  /** Teaching ratio / residual research calculations from imported Excel metrics. */
  anomalyMetricsByStaffId: Record<string, WorkloadAnomalyMetrics>;
  rows: WorkloadParsedRow[];
};

export type WorkloadImportParseResult = {
  fileName: string;
  sheets: ParsedWorkloadSheet[];
};

function parseOptionalNumber(norm: string | number | null): number | null {
  if (norm === null || norm === "") return null;
  if (typeof norm === "number") return Number.isFinite(norm) ? norm : null;
  const n = Number.parseFloat(String(norm).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeScalar(v: unknown): string | number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  const s = String(v).trim();
  if (!s) return null;
  const n = Number.parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : s;
}

function normalizeBandName(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("research focused")) return "Research Focused";
  if (v.includes("balanced")) return "Balanced Teaching & Research";
  if (v.includes("teaching focused")) return "Teaching Focused";
  return raw.trim();
}

function calculateBandFromRatio(ratio: number): "Research Focused" | "Balanced Teaching & Research" | "Teaching Focused" {
  if (ratio <= 0.2) return "Research Focused";
  if (ratio <= 0.79) return "Balanced Teaching & Research";
  return "Teaching Focused";
}

function cellAtColLetter(sheetRow: unknown[], letter: string): string {
  const idx = excelColToZeroIndex(letter);
  if (idx < 0 || !sheetRow?.length || idx >= sheetRow.length) return "";
  const v = normalizeScalar(sheetRow[idx]);
  if (v === null) return "";
  return typeof v === "number" ? String(v) : String(v).trim();
}

function normalizedHeaderCell(cell: unknown): string {
  const v = normalizeScalar(cell);
  if (v === null || typeof v === "number") return "";
  return String(v)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** UWA workbook: row whose Unit Code column (K) equals "Unit Code" is the true field header row (Excel row 4); data begins next row */
function findHeaderRowPreferringWorkloadTemplate(aoa: unknown[][]): number {
  const colUnit = excelColToZeroIndex(TEACHING_UNIT_COL);
  for (let r = 0; r < Math.min(aoa.length, 80); r += 1) {
    const hLabel = normalizedHeaderCell((aoa[r] ?? [])[colUnit]);
    if (hLabel === "unit code") return r;
  }
  return -1;
}

function headerDetectorRow(aoa: unknown[][], idx: number): boolean {
  const row = aoa[idx] ?? [];
  /** Skip template section banners that mention "staff" but are not column headers */
  const hBanner = normalizedHeaderCell(row[excelColToZeroIndex(TEACHING_UNIT_COL)]);
  if (hBanner === "teaching (per unit)" || hBanner === "hdr supervision" || hBanner === "service & assigned roles")
    return false;

  const glue = row.map((c) => String(c ?? "").toLowerCase()).join("|");
  if (/staff\s+member\s+id|staff\s+number/i.test(glue)) return true;
  if (/staff|employee|person|member|empl/i.test(glue)) return true;
  const hSample = normalizeScalar(row[excelColToZeroIndex(TEACHING_UNIT_COL)]);
  if (typeof hSample === "string" && /course|unit\s*code|subject|code|teaching/i.test(hSample)) return true;
  const uSample = normalizeScalar(row[excelColToZeroIndex(TEACHING_SCORE_COL)]);
  if (typeof uSample === "string" && /score|point|fte|pct|hours|wl\s*p/i.test(uSample)) return true;
  return false;
}

function findBestHeaderRowIndex(aoa: unknown[][]): number {
  const tpl = findHeaderRowPreferringWorkloadTemplate(aoa);
  if (tpl >= 0) return tpl;

  for (let r = 0; r < Math.min(aoa.length, 36); r += 1) {
    if (headerDetectorRow(aoa, r)) return r;
  }
  const lengths = aoa.slice(0, 12).map((row) => (row ?? []).filter((c) => c != null && String(c).trim() !== "").length);
  const bestIdx = lengths.indexOf(Math.max(...lengths, 1));
  return bestIdx >= 0 ? Math.min(bestIdx + 2, Math.max(aoa.length - 1, 0)) : 2;
}

const ROLE_HOUR_COMPARE_EPS = 0.05;

function normalizeRoleNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Same normalisation as role names — used for Unit Code equality (duplicate course rows). */
function normalizeTeachingUnitKey(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, " ");
}

/** After concatenating teaching lines (e.g. multi-sheet import), mark duplicate unit rows: all flagged red; only first occurrence per unit counts toward totals. */
export function applyDuplicateTeachingUnitFlagsToLines(lines: TeachingLineImport[]): TeachingLineImport[] {
  const indicesByKey = new Map<string, number[]>();
  lines.forEach((line, i) => {
    const k = normalizeTeachingUnitKey(String(line.unit ?? ""));
    if (!k) return;
    if (!indicesByKey.has(k)) indicesByKey.set(k, []);
    indicesByKey.get(k)!.push(i);
  });
  const conflictIdx = new Set<number>();
  const excludeFromTotalIdx = new Set<number>();
  for (const arr of Array.from(indicesByKey.values())) {
    if (arr.length <= 1) continue;
    const sorted = [...arr].sort((a, b) => a - b);
    sorted.forEach((j) => conflictIdx.add(j));
    sorted.slice(1).forEach((j) => excludeFromTotalIdx.add(j));
  }
  return lines.map((line, i) => {
    const base: TeachingLineImport = { unit: line.unit, hours: line.hours };
    if (conflictIdx.has(i)) base.duplicateUnitConflict = true;
    if (excludeFromTotalIdx.has(i)) base.excludeFromWorkloadTotal = true;
    return base;
  });
}

function rowIsProbablyEmpty(raw: unknown[]) {
  if (!raw?.length) return true;
  return !(raw.some((cell) => {
    if (cell == null || cell === "") return false;
    const s = String(cell).trim();
    return Boolean(s);
  }));
}

export function sliceRolesUntilBlankName(raw: unknown[]): ParsedAssignedRole[] {
  const out: ParsedAssignedRole[] = [];
  const nameCol0 = excelColToZeroIndex(ROLE_NAME_COL_START);
  const pointsCol0 = excelColToZeroIndex(ROLE_POINTS_COL_START);
  for (let block = 0; block < MAX_ROLE_PAIR_BLOCKS; block += 1) {
    const nameIdx = nameCol0 + block * ROLE_BLOCK_STRIDE_COLS;
    const pointsIdx = pointsCol0 + block * ROLE_BLOCK_STRIDE_COLS;
    const nameLetter = zeroIndexToExcelCol(nameIdx);
    const pointsLetter = zeroIndexToExcelCol(pointsIdx);
    const nameRaw = raw[nameIdx];
    const ptsRaw = raw[pointsIdx];
    const nameTrim = typeof nameRaw === "string" ? nameRaw.trim() : nameRaw != null ? String(nameRaw).trim() : "";
    if (!nameTrim) break;
    const ptsScaled = normalizeScalar(ptsRaw);
    const pts =
      ptsScaled === null ? null : typeof ptsScaled === "number" ? ptsScaled : Number.parseFloat(String(ptsScaled));
    out.push({
      roleNameCol: nameLetter,
      pointsCol: pointsLetter,
      roleName: nameTrim,
      points: pts != null && Number.isFinite(pts) ? pts : null,
    });
  }
  return out;
}

function sumRolePointsFromPointColumns(
  cellsByColumn: Record<string, string | number | null>
): number | null {
  const pointsCol0 = excelColToZeroIndex(ROLE_POINTS_COL_START);
  let sum = 0;
  let hasAny = false;
  for (let block = 0; block < MAX_ROLE_PAIR_BLOCKS; block += 1) {
    const pointsLetter = zeroIndexToExcelCol(pointsCol0 + block * ROLE_BLOCK_STRIDE_COLS);
    const raw = normalizeScalar(cellsByColumn[pointsLetter]);
    if (raw == null || (typeof raw === "string" && raw.trim() === "")) break;
    const n = parseOptionalNumber(raw);
    if (n == null || !Number.isFinite(n)) continue;
    sum += n;
    hasAny = true;
  }
  return hasAny ? Math.round(sum * 1000) / 1000 : null;
}

function buildRowCellsMap(raw: unknown[], maxCols: number) {
  const cellsByColumn: Record<string, string | number | null> = {};
  for (let c = 0; c <= maxCols; c += 1) {
    const letter = zeroIndexToExcelCol(c);
    const v = normalizeScalar(raw[c]);
    if (v !== null && !(typeof v === "string" && v.trim() === "")) {
      cellsByColumn[letter] = v;
    }
  }
  return cellsByColumn;
}

export function sheetToWorkloadPayload(sheetName: string, worksheet: WorkSheet): ParsedWorkloadSheet {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, blankrows: false }) as unknown[][];
  const aoa =
    grid.length > 0
      ? grid
      : ([] as unknown[][]);

  let maxCols = -1;
  for (let r = 0; r < aoa.length; r += 1) {
    maxCols = Math.max(maxCols, (aoa[r]?.length ?? 0) - 1);
  }
  if (maxCols < excelColToZeroIndex(TEACHING_SCORE_COL)) {
    maxCols = excelColToZeroIndex(TEACHING_SCORE_COL);
  }
  const hdrFtPropIdx = excelColToZeroIndex(HDR_FT_PROPORTION_COL);
  if (maxCols < hdrFtPropIdx) maxCols = hdrFtPropIdx;
  const hdrPtPropIdx = excelColToZeroIndex(HDR_PT_PROPORTION_COL);
  if (maxCols < hdrPtPropIdx) maxCols = hdrPtPropIdx;
  const hdrTotalIdx = excelColToZeroIndex(HDR_TOTAL_HRS_COL);
  if (maxCols < hdrTotalIdx) maxCols = hdrTotalIdx;
  const svcIdx = excelColToZeroIndex(SERVICE_POINTS_COL);
  if (maxCols < svcIdx) maxCols = svcIdx;
  const roleTotalIdx = excelColToZeroIndex(ROLE_TOTAL_POINTS_COL);
  if (maxCols < roleTotalIdx) maxCols = roleTotalIdx;

  const headerRowIndex = findBestHeaderRowIndex(aoa);

  const teachingHoursSumByStaffId: Record<string, number> = {};
  const teachingLinesByStaffId: Record<string, TeachingLineImport[]> = {};
  const hdrMetricsByStaffId: Record<string, WorkloadHdrMetrics> = {};
  const serviceMetricsByStaffId: Record<string, WorkloadServiceMetrics> = {};
  const roleMetricsByStaffId: Record<string, WorkloadRoleMetrics> = {};
  const anomalyMetricsByStaffId: Record<string, WorkloadAnomalyMetrics> = {};
  const teachingPointsSumByStaffId: Record<string, number> = {};

  const rows: WorkloadParsedRow[] = [];
  let rowIndexExcel = headerRowIndex + 2;

  for (let r = headerRowIndex + 1; r < aoa.length; r += 1, rowIndexExcel += 1) {
    const rawRow = [...(aoa[r] ?? [])];
    while (rawRow.length <= maxCols) rawRow.push(null);
    if (rowIsProbablyEmpty(rawRow)) continue;

    const cellsByColumn = buildRowCellsMap(rawRow, maxCols);

    const staffGuess = cellAtColLetter(rawRow, STAFF_ID_COL);
    const unitH = normalizeScalar(rawRow[excelColToZeroIndex(TEACHING_UNIT_COL)]);
    const unitDisplay = unitH === null ? null : typeof unitH === "string" ? unitH.trim() : String(unitH);
    const teachingScoreNorm = normalizeScalar(rawRow[excelColToZeroIndex(TEACHING_SCORE_COL)]);
    let teachingScore: number | null = null;
    if (typeof teachingScoreNorm === "number") teachingScore = teachingScoreNorm;
    else if (typeof teachingScoreNorm === "string") {
      const n = Number.parseFloat(teachingScoreNorm.replace(/,/g, ""));
      teachingScore = Number.isFinite(n) ? n : null;
    }
    const teachingHours =
      teachingScore != null && Number.isFinite(teachingScore) ? Math.round(teachingScore * TEACHING_HOURS_FACTOR * 1000) / 1000 : null;

    const roles = sliceRolesUntilBlankName(rawRow);

    const staffKey = (staffGuess && String(staffGuess).trim()) || `__row:${rowIndexExcel}`;

    if (!Object.prototype.hasOwnProperty.call(hdrMetricsByStaffId, staffKey)) {
      hdrMetricsByStaffId[staffKey] = {
        ftStudents: null,
        ptStudents: null,
        ftHours: null,
        ptHours: null,
        totalHrs: null,
        derivedHrs: null,
        hdrPoints: null,
        hasHdrFieldConflict: false,
        hdrExtraLines: [],
      };
    }
    const hm = hdrMetricsByStaffId[staffKey];
    const ftRaw = normalizeScalar(rawRow[excelColToZeroIndex(HDR_FT_STUDENTS_COL)]);
    const ptRaw = normalizeScalar(rawRow[excelColToZeroIndex(HDR_PT_STUDENTS_COL)]);
    const zPropRaw = normalizeScalar(rawRow[excelColToZeroIndex(HDR_FT_PROPORTION_COL)]);
    const abPropRaw = normalizeScalar(rawRow[excelColToZeroIndex(HDR_PT_PROPORTION_COL)]);
    const zhRaw = normalizeScalar(rawRow[excelColToZeroIndex(HDR_TOTAL_HRS_COL)]);
    const hpRaw = normalizeScalar(rawRow[excelColToZeroIndex(HDR_POINTS_COL)]);
    const ft = parseOptionalNumber(ftRaw);
    const pt = parseOptionalNumber(ptRaw);
    const zProp = parseOptionalNumber(zPropRaw);
    const abProp = parseOptionalNumber(abPropRaw);
    const zh = parseOptionalNumber(zhRaw);
    const hp = parseOptionalNumber(hpRaw);
    const ftHours = zProp != null ? Math.round(zProp * 86.25 * 1000) / 1000 : null;
    const ptHours = abProp != null ? Math.round(abProp * 43.125 * 1000) / 1000 : null;
    const derivedHdrHrs = ftHours != null || ptHours != null ? Math.round(((ftHours ?? 0) + (ptHours ?? 0)) * 1000) / 1000 : null;
    const hdrIncoming = ft != null || pt != null || zh != null || hp != null || derivedHdrHrs != null;
    if (hdrIncoming) {
      const baselineEmpty =
        hm.ftStudents == null &&
        hm.ptStudents == null &&
        hm.ftHours == null &&
        hm.ptHours == null &&
        hm.totalHrs == null &&
        hm.hdrPoints == null &&
        hm.derivedHrs == null;
      if (baselineEmpty) {
        hm.ftStudents = ft != null ? Math.round(ft * 1000) / 1000 : null;
        hm.ptStudents = pt != null ? Math.round(pt * 1000) / 1000 : null;
        hm.ftHours = ftHours;
        hm.ptHours = ptHours;
        hm.totalHrs = zh != null ? Math.round(zh * 1000) / 1000 : null;
        hm.derivedHrs = derivedHdrHrs;
        hm.hdrPoints = hp != null ? Math.round(hp * 1000) / 1000 : null;
      } else {
        if (hm.ftStudents == null && ft != null) hm.ftStudents = Math.round(ft * 1000) / 1000;
        if (hm.ptStudents == null && pt != null) hm.ptStudents = Math.round(pt * 1000) / 1000;
        if (hm.ftHours == null && ftHours != null) hm.ftHours = ftHours;
        if (hm.ptHours == null && ptHours != null) hm.ptHours = ptHours;
        if (hm.totalHrs == null && zh != null) hm.totalHrs = Math.round(zh * 1000) / 1000;
        if (hm.derivedHrs == null && derivedHdrHrs != null) hm.derivedHrs = derivedHdrHrs;
        if (hm.hdrPoints == null && hp != null) hm.hdrPoints = Math.round(hp * 1000) / 1000;

        if (ft != null && hm.ftStudents != null && Math.abs(hm.ftStudents - ft) > ROLE_HOUR_COMPARE_EPS) {
          hm.hasHdrFieldConflict = true;
          hm.ftStudentsConflict = true;
          hm.hdrExtraLines!.push({ name: "FT students", hours: Math.round(ft * 1000) / 1000 });
        }
        if (zh != null && hm.totalHrs != null && Math.abs(hm.totalHrs - zh) > ROLE_HOUR_COMPARE_EPS) {
          hm.hasHdrFieldConflict = true;
          hm.totalHrsConflict = true;
          hm.hdrExtraLines!.push({ name: "HDR Total", hours: Math.round(zh * 1000) / 1000 });
        }
        if (hp != null && hm.hdrPoints != null && Math.abs(hm.hdrPoints - hp) > ROLE_HOUR_COMPARE_EPS) {
          hm.hasHdrFieldConflict = true;
          hm.hdrPointsConflict = true;
          const hrs = Math.round(hp * TEACHING_HOURS_FACTOR * 1000) / 1000;
          hm.hdrExtraLines!.push({ name: "HDR WL Pts", hours: hrs });
        }
      }
    }

    if (!Object.prototype.hasOwnProperty.call(serviceMetricsByStaffId, staffKey)) {
      serviceMetricsByStaffId[staffKey] = {
        servicePoints: null,
        hasServicePointsConflict: false,
        serviceExtraLines: [],
      };
    }
    const sm = serviceMetricsByStaffId[staffKey];
    const serviceRaw = normalizeScalar(rawRow[excelColToZeroIndex(SERVICE_POINTS_COL)]);
    const svcPts = parseOptionalNumber(serviceRaw);
    if (svcPts != null) {
      const p = Math.round(svcPts * 1000) / 1000;
      if (sm.servicePoints == null) {
        sm.servicePoints = p;
      } else if (Math.abs(sm.servicePoints - p) > ROLE_HOUR_COMPARE_EPS) {
        sm.hasServicePointsConflict = true;
        sm.servicePointsConflict = true;
        sm.serviceExtraLines!.push({ hours: Math.round(p * TEACHING_HOURS_FACTOR * 1000) / 1000 });
      }
    }
    if (!Object.prototype.hasOwnProperty.call(roleMetricsByStaffId, staffKey)) {
      roleMetricsByStaffId[staffKey] = {
        roles: [],
        totalPoints: null,
        totalHours: null,
        hasAssignedRoleHourConflict: false,
      };
    }
    const assignedRoleRows = roles
      .map((r) => {
        if (r.points == null || !Number.isFinite(r.points)) return null;
        const points = Math.round(r.points * 1000) / 1000;
        const hours = Math.round(points * TEACHING_HOURS_FACTOR * 1000) / 1000;
        return { name: r.roleName, points, hours };
      })
      .filter((v): v is { name: string; points: number; hours: number } => v !== null);

    const rm = roleMetricsByStaffId[staffKey];
    if (assignedRoleRows.length > 0) {
      if (rm.roles.length === 0) {
        rm.roles = assignedRoleRows.map((r) => ({
          name: r.name,
          points: r.points,
          hours: r.hours,
          hourConflict: false,
          excludeFromWorkloadTotal: false,
        }));
        const pointsSum =
          assignedRoleRows.length > 0
            ? Math.round(assignedRoleRows.reduce((sum, r) => sum + r.points, 0) * 1000) / 1000
            : null;
        const hoursSum =
          pointsSum != null ? Math.round(pointsSum * TEACHING_HOURS_FACTOR * 1000) / 1000 : null;
        rm.totalPoints = pointsSum;
        rm.totalHours = hoursSum;
      } else {
        for (const cur of assignedRoleRows) {
          const k = normalizeRoleNameKey(cur.name);
          const baseline = rm.roles.find(
            (r) => normalizeRoleNameKey(r.name) === k && !r.excludeFromWorkloadTotal
          );
          if (baseline && Math.abs(baseline.hours - cur.hours) > ROLE_HOUR_COMPARE_EPS) {
            rm.hasAssignedRoleHourConflict = true;
            baseline.hourConflict = true;
            const dup = rm.roles.some(
              (r) =>
                normalizeRoleNameKey(r.name) === k &&
                Math.abs(r.hours - cur.hours) <= ROLE_HOUR_COMPARE_EPS &&
                Boolean(r.excludeFromWorkloadTotal)
            );
            if (!dup) {
              rm.roles.push({
                name: cur.name,
                points: cur.points,
                hours: cur.hours,
                hourConflict: true,
                excludeFromWorkloadTotal: true,
              });
            }
          }
        }
      }
    }

    if (unitDisplay && teachingScore != null && teachingHours != null) {
      if (!teachingLinesByStaffId[staffKey]) teachingLinesByStaffId[staffKey] = [];
      const linesArr = teachingLinesByStaffId[staffKey];
      const unitKey = normalizeTeachingUnitKey(unitDisplay);
      const dupIdx = unitKey ? linesArr.findIndex((l) => normalizeTeachingUnitKey(String(l.unit ?? "")) === unitKey) : -1;
      if (dupIdx >= 0) {
        const prev = linesArr[dupIdx];
        linesArr[dupIdx] = { ...prev, duplicateUnitConflict: true };
        linesArr.push({
          unit: unitDisplay,
          hours: teachingHours,
          duplicateUnitConflict: true,
          excludeFromWorkloadTotal: true,
        });
      } else {
        teachingHoursSumByStaffId[staffKey] =
          (teachingHoursSumByStaffId[staffKey] ?? 0) + teachingHours;
        teachingPointsSumByStaffId[staffKey] = (teachingPointsSumByStaffId[staffKey] ?? 0) + teachingScore;
        linesArr.push({ unit: unitDisplay, hours: teachingHours });
      }
    }

    rows.push({
      rowIndex: rowIndexExcel,
      cellsByColumn,
      computed: {
        staffIdGuess: staffGuess || null,
        teachingUnitNameFromH: unitDisplay,
        teachingScoreFromU: teachingScore,
        teachingHours,
        assignedRolesEndedAtFirstBlankName: roles,
      },
    });
  }

  for (const staffKey of Object.keys({ ...teachingPointsSumByStaffId, ...hdrMetricsByStaffId, ...serviceMetricsByStaffId, ...roleMetricsByStaffId })) {
    const firstRow = rows.find((r) => (r.computed.staffIdGuess ?? "").trim() === staffKey);
    const fte = parseOptionalNumber(firstRow ? normalizeScalar(firstRow.cellsByColumn[FTE_COL]) : null);
    const bandRaw = firstRow ? normalizeScalar(firstRow.cellsByColumn[TARGET_BAND_COL]) : null;
    const targetBand = normalizeBandName(bandRaw == null ? null : String(bandRaw));
    const teachingPointsRaw = teachingPointsSumByStaffId[staffKey] ?? null;
    const teachingPoints = teachingPointsRaw != null ? Math.round(teachingPointsRaw * 1000) / 1000 : null;
    const assignedRolePointsFromTemplate = parseOptionalNumber(
      firstRow ? normalizeScalar(firstRow.cellsByColumn[ROLE_TOTAL_POINTS_COL]) : null
    );
    const assignedRolePointsFromPairColumns = firstRow
      ? sumRolePointsFromPointColumns(firstRow.cellsByColumn)
      : null;
    const assignedRolePoints =
      assignedRolePointsFromTemplate != null
        ? Math.round(assignedRolePointsFromTemplate * 1000) / 1000
        : assignedRolePointsFromPairColumns ?? roleMetricsByStaffId[staffKey]?.totalPoints ?? null;
    const servicePoints = serviceMetricsByStaffId[staffKey]?.servicePoints ?? null;
    const hdrPoints = parseOptionalNumber(firstRow ? normalizeScalar(firstRow.cellsByColumn[HDR_POINTS_COL]) : null);
    const hdrHoursPreferred =
      hdrMetricsByStaffId[staffKey]?.derivedHrs ??
      hdrMetricsByStaffId[staffKey]?.totalHrs ??
      null;
    const teachingHoursForResidual =
      teachingPoints != null ? Math.round(teachingPoints * TEACHING_HOURS_FACTOR * 1000) / 1000 : 0;
    const hdrHoursForResidual =
      hdrHoursPreferred != null
        ? Math.round(hdrHoursPreferred * 1000) / 1000
        : hdrPoints != null
          ? Math.round(hdrPoints * TEACHING_HOURS_FACTOR * 1000) / 1000
          : 0;
    const serviceHoursForResidual =
      servicePoints != null ? Math.round(servicePoints * TEACHING_HOURS_FACTOR * 1000) / 1000 : 0;
    const roleHoursForResidual =
      roleMetricsByStaffId[staffKey]?.totalHours != null
        ? Math.round(roleMetricsByStaffId[staffKey]!.totalHours! * 1000) / 1000
        : assignedRolePoints != null
          ? Math.round(assignedRolePoints * TEACHING_HOURS_FACTOR * 1000) / 1000
          : 0;
    const fteForResidual = typeof fte === "number" && Number.isFinite(fte) && fte > 0 ? fte : 1;
    const baselineSemesterHours = fteForResidual * 50 * TEACHING_HOURS_FACTOR;
    const researchResidualHours =
      Math.round(
        (baselineSemesterHours -
          (teachingHoursForResidual + hdrHoursForResidual + serviceHoursForResidual + roleHoursForResidual)) *
          1000
      ) / 1000;
    const researchResidualPoints =
      Math.round((researchResidualHours / TEACHING_HOURS_FACTOR) * 1000) / 1000;
    const denom =
      teachingPoints != null && researchResidualPoints != null ? teachingPoints + researchResidualPoints : null;
    const calculatedTeachingRatio =
      denom != null && denom > 0 && teachingPoints != null
        ? Math.round((teachingPoints / denom) * 10000) / 10000
        : null;
    const calculatedBand = calculatedTeachingRatio != null ? calculateBandFromRatio(calculatedTeachingRatio) : null;
    const totalHoursFromPoints =
      Math.round(
        (teachingHoursForResidual +
          hdrHoursForResidual +
          serviceHoursForResidual +
          roleHoursForResidual +
          researchResidualHours) *
          1000
      ) / 1000;

    anomalyMetricsByStaffId[staffKey] = {
      fte: fte != null ? Math.round(fte * 1000) / 1000 : null,
      targetBand,
      teachingPoints,
      assignedRolePoints,
      servicePoints,
      hdrPoints: hdrPoints != null ? Math.round(hdrPoints * 1000) / 1000 : null,
      researchResidualPoints,
      calculatedTeachingRatio,
      calculatedBand,
      totalHoursFromPoints,
    };
  }

  return {
    sheetName,
    headerRowIndex0: headerRowIndex,
    rows,
    teachingHoursSumByStaffId,
    teachingLinesByStaffId,
    hdrMetricsByStaffId,
    serviceMetricsByStaffId,
    roleMetricsByStaffId,
    anomalyMetricsByStaffId,
  };
}

/** Parse workbook and build payload for `/api/workload/spreadsheet/import`. */
export function parseWorkloadWorkbookArrayBuffer(opts: {
  fileName: string;
  buf: ArrayBuffer;
}): WorkloadImportParseResult {
  const { fileName, buf } = opts;
  const workbook = XLSX.read(buf, { type: "array", cellDates: false, dense: false });
  const sheets: ParsedWorkloadSheet[] = [];
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    sheets.push(sheetToWorkloadPayload(sheetName, ws));
  }
  return { fileName, sheets };
}
