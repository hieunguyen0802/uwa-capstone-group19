/** Excel workload template — column refs are 1-based Excel semantics as strings (e.g. "H", "U"). */

/** Semester workload conversion factor (hours per point). */
export const TEACHING_HOURS_FACTOR = 17.25 as const;

/** Course / unit shown in frontend Teaching tab — column K (three staff-detail columns inserted after C). */
export const TEACHING_UNIT_COL = "K";
/** Teaching “score”; displayed hours = score × TEACHING_HOURS_FACTOR — column X */
export const TEACHING_SCORE_COL = "X";
/** Stable staff key for grouping multiple course rows — UWA workload template column "Staff Number" */
export const STAFF_ID_COL = "C";
/** Template column D — New Staff (true / false). */
export const NEW_STAFF_COL = "D";
/** Template column E — free-text notes. */
export const NOTES_COL = "E";
/** Template column F — HoD Review (yes / no). */
export const HOD_REVIEW_COL = "F";
/** FTE used for anomaly/research residual calculation — column G */
export const FTE_COL = "G";
/** Target band label from template (e.g. Balanced Teaching & Research) — column I */
export const TARGET_BAND_COL = "I";
/** Target teaching % — column J */
export const TARGET_TEACHING_PCT_COL = "J";

/** HDR: FT student count — column Y (first row per employee only when deduping) */
export const HDR_FT_STUDENTS_COL = "Y";
/** HDR: PT student count — column AA */
export const HDR_PT_STUDENTS_COL = "AA";
/** HDR: FT proportion — column Z */
export const HDR_FT_PROPORTION_COL = "Z";
/** HDR: total hours — column AC (first row per employee only when deduping) */
export const HDR_TOTAL_HRS_COL = "AC";
/** HDR: PT proportion — column AB */
export const HDR_PT_PROPORTION_COL = "AB";
/** HDR workload points used for anomaly calculation — column AD */
export const HDR_POINTS_COL = "AD";
/** Service value used by UI Service tab — column AE (first row per employee only when deduping) */
export const SERVICE_POINTS_COL = "AE";

/** Assigned Roles total points used for import totals/research model — column AF */
export const ROLE_TOTAL_POINTS_COL = "AF";

/** Horizontal assigned-role name/points pairs (template): AG=name, AH=pts, AI=name, AJ=pts, … */
export const ROLE_NAME_COL_START = "AG";
export const ROLE_POINTS_COL_START = "AH";
export const ROLE_BLOCK_STRIDE_COLS = 2;
export const MAX_ROLE_PAIR_BLOCKS = 12;
