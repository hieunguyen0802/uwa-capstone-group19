/**
 * Workload Excel import — single backend entry point.
 * Replace the stub with `fetch` to `POST /api/workload/spreadsheet/import` (path TBD by your API).
 */

import { apiClient } from "./client";
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
  created?: number;
  updated?: number;
  failed?: number;
  errors?: Array<{ staffId?: string; sheet?: string; message?: string }>;
  message?: string;
};

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

  const response = await apiClient.post("/school-operations/workloads/import", payload);
  return response.data as PostWorkloadSpreadsheetImportResponse;
}
