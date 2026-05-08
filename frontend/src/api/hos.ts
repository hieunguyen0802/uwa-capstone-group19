import { apiClient } from "./client";

export type HosWorkloadRow = {
  id: string;
  sourceWorkloadId?: string;
  staffId: string;
  name: string;
  title: string;
  department: string;
  reason?: string;
  status: "pending" | "approved" | "rejected" | "initial";
  totalWorkHours: number;
  submittedAt?: string | null;
  semesterLabel: string;
  periodLabel: string;
  version?: string | null;
};

export type HosBreakdown = Record<string, Array<{ name: string; hours: number }>>;

export type HosWorkloadDetail = HosWorkloadRow & {
  applicationReason?: string;
  schoolOperationsNotes?: string;
  reviewerNote?: string;
  breakdown: HosBreakdown;
  canEditBreakdown?: boolean;
  cancelled?: boolean;
};

export type HosSemesterReport = {
  id: string;
  year: number;
  semester: "S1" | "S2";
  title: string;
  createdAt?: string | null;
  downloadUrl?: string;
  unread?: boolean;
};

export type HosStaffDirectoryRow = {
  id: string;
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

export type HosRoleAssignment = {
  id: number;
  staffId: string;
  name: string;
  role: "HoD" | "Admin";
  department: string;
  permissions: string[];
  assignedAt: string;
  status: "active" | "disabled";
};

export type HosAnalyticsPayload = {
  reportingPeriodLabel: string;
  scopeLabel: string;
  summary: {
    totalDepartments?: number;
    totalAcademics: number;
    totalWorkHours: number;
    pendingRequests: number;
    approvedRequests: number;
    rejectedRequests: number;
  };
  totalWorkHoursTrend: Array<{ period: string; totalWorkHours: number }>;
  averageWorkHoursBySemester: Array<{ period: string; averageWorkHours: number }>;
  statusDistribution: Record<string, number>;
  workloadHoursDistribution: Array<{ department: string; totalWorkHours: number }>;
};

export async function fetchHosWorkloadRequests(params: Record<string, string>) {
  const res = await apiClient.get("/hos/workload-requests", { params });
  return res.data as { items: HosWorkloadRow[]; total: number };
}

export async function fetchHosWorkloadDetail(id: string) {
  const res = await apiClient.get(`/hos/workload-requests/${id}`);
  return res.data as HosWorkloadDetail;
}

export async function decideHosWorkload(
  id: string,
  payload: { decision: "approve" | "reject"; note: string; breakdown?: HosBreakdown; ifVersion?: string | null }
) {
  const res = await apiClient.post(`/hos/workload-requests/${id}/decision`, payload);
  return res.data;
}

export async function fetchHosSemesterReports() {
  const res = await apiClient.get("/hos/reports/semester-distribution");
  return res.data as { items: HosSemesterReport[] };
}

export async function downloadHosSemesterReport(downloadUrl: string) {
  const path = downloadUrl.replace(/^\/api/, "");
  const res = await apiClient.get(path, { responseType: "blob" });
  return res.data as Blob;
}

export async function fetchHosStaffDirectory(params: Record<string, string> = {}) {
  const res = await apiClient.get("/hos/staff-directory", { params });
  return res.data as { items: HosStaffDirectoryRow[]; total: number };
}

export async function importHosStaffDirectory(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiClient.post("/hos/staff-directory/import", formData);
  return res.data as {
    success: boolean;
    importedCount: number;
    failedCount: number;
    items: Array<{ rowNumber: number; staffId: string; messages: string[]; imported: boolean }>;
  };
}

export async function fetchHosRoleAssignments() {
  const res = await apiClient.get("/hos/role-assignments");
  return res.data as { items: HosRoleAssignment[] };
}

export async function createHosRoleAssignment(payload: {
  staffId: string;
  role: "HoD" | "Admin";
  department: string;
  permissions: string[];
}) {
  const res = await apiClient.post("/hos/role-assignments", payload);
  return res.data as HosRoleAssignment;
}

export async function disableHosRoleAssignment(id: number) {
  const res = await apiClient.patch(`/hos/role-assignments/${id}/status`, {
    status: "disabled",
  });
  return res.data as { id: number; status: "disabled" };
}

export async function fetchHosAnalytics(params: Record<string, string>) {
  const res = await apiClient.get("/hos/analytics/workloads", { params });
  return res.data as { success: boolean; data: HosAnalyticsPayload };
}

export async function exportHosWorkloads(params: Record<string, string>) {
  const res = await apiClient.get("/hos/exports/workloads", {
    params,
    responseType: "blob",
  });
  return res.data as Blob;
}
