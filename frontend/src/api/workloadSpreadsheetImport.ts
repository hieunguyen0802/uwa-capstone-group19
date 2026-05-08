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
  created?: number;
  updated?: number;
  failed?: number;
  errors?: Array<{ staffId?: string; sheet?: string; message?: string }>;
  message?: string;
};

const API_BASE = process.env.REACT_APP_API_BASE_URL ?? "";

function readAccessToken(): string {
  if (typeof window === "undefined") return "";
  return (
    window.localStorage.getItem("access") ||
    window.sessionStorage.getItem("access") ||
    window.localStorage.getItem("token") ||
    window.sessionStorage.getItem("token") ||
    ""
  );
}

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

  const token = readAccessToken();
  const response = await fetch(`${API_BASE}/api/school-operations/workloads/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `School Operations import failed (${response.status})`);
  }

  return (await response.json()) as PostWorkloadSpreadsheetImportResponse;
}
