/**
 * Auth API wrappers — OTP request / verify / me.
 *
 * Contract (backend):
 *   POST /api/login/request-otp/   { email }           → { sent: true }
 *   POST /api/login/verify-otp/    { email, code }     → { access, refresh, role, staff_id, email }
 *   GET  /api/auth/me/                                  → { role, permissions, menu, ... }
 */
import { apiClient } from "./client";

export type MenuItem = {
  key: string;
  label: string;
  route: string;
  permission: string;
};

export type AuthProfile = {
  staff_id: string;
  staff_number: string;
  email: string;
  full_name: string;
  role: "ACADEMIC" | "HOD" | "SCHOOL_OPS" | "HOS";
  department: string | null;
  title: string;
  permissions: string[];
  menu: MenuItem[];
};

export type OtpVerifyResponse = {
  access: string;
  refresh: string;
  role: string;
  staff_id: string | null;
  email: string;
};

function normalizeMenu(raw: unknown): MenuItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      key: typeof item.key === "string" ? item.key : "",
      label: typeof item.label === "string" ? item.label : "",
      route: typeof item.route === "string" ? item.route : "",
      permission: typeof item.permission === "string" ? item.permission : "",
    }))
    .filter((item) => item.route && item.permission);
}

function normalizePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function normalizeAuthProfile(raw: unknown): AuthProfile {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    staff_id: typeof data.staff_id === "string" ? data.staff_id : "",
    staff_number: typeof data.staff_number === "string" ? data.staff_number : "",
    email: typeof data.email === "string" ? data.email : "",
    full_name: typeof data.full_name === "string" ? data.full_name : "",
    role: (typeof data.role === "string" ? data.role : "ACADEMIC") as AuthProfile["role"],
    department: typeof data.department === "string" ? data.department : null,
    title: typeof data.title === "string" ? data.title : "",
    permissions: normalizePermissions(data.permissions),
    menu: normalizeMenu(data.menu),
  };
}

export async function requestOtp(email: string): Promise<{ sent: boolean }> {
  const res = await apiClient.post("/login/request-otp/", { email });
  return res.data;
}

export async function verifyOtp(email: string, code: string): Promise<OtpVerifyResponse> {
  const res = await apiClient.post("/login/verify-otp/", { email, code });
  return res.data;
}

export async function fetchMe(): Promise<AuthProfile> {
  const res = await apiClient.get("/auth/me/");
  return normalizeAuthProfile(res.data);
}
