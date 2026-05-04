/**
 * Workload Excel import — single backend entry point.
 * Replace the stub with `fetch` to `POST /api/workload/spreadsheet/import` (path TBD by your API).
 */

import type { WorkloadImportParseResult } from "../workload/parseWorkloadWorkbook";
import { TEACHING_HOURS_FACTOR } from "../workload/workloadSpreadsheetRules";

export type PostWorkloadSpreadsheetImportBody = WorkloadImportParseResult & {
  teachingHoursFactor: typeof TEACHING_HOURS_FACTOR;
  importedAtIso: string;
};

export type PostWorkloadSpreadsheetImportResponse = {
  ok: boolean;
  /** Server job id / reference */
  referenceId?: string;
};

// const API_BASE = process.env.REACT_APP_API_BASE_URL ?? "";

/**
 * POST full parsed workbook (all cells + derived teaching/role fields) to the backend.
 *
 * Contract (suggested):
 * `POST /api/workload/spreadsheet/import`
 * Body: JSON matching {@link PostWorkloadSpreadsheetImportBody}
 * Response: JSON matching {@link PostWorkloadSpreadsheetImportResponse}
 */
export async function postWorkloadSpreadsheetImport(
  parseResult: WorkloadImportParseResult
): Promise<PostWorkloadSpreadsheetImportResponse> {
  const payload: PostWorkloadSpreadsheetImportBody = {
    ...parseResult,
    teachingHoursFactor: TEACHING_HOURS_FACTOR,
    importedAtIso: new Date().toISOString(),
  };

  // TODO(backend):
  // const response = await fetch(`${API_BASE}/api/workload/spreadsheet/import`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(payload),
  // });
  // if (!response.ok) throw new Error(await response.text());
  // return (await response.json()) as PostWorkloadSpreadsheetImportResponse;

  console.info("[postWorkloadSpreadsheetImport] stub payload", {
    fileName: payload.fileName,
    rowCount: payload.sheets.reduce((n, s) => n + s.rows.length, 0),
    teachingHoursFactor: payload.teachingHoursFactor,
  });
  return { ok: true, referenceId: "stub-workload-import" };
}
