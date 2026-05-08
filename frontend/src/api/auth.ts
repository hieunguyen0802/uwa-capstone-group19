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
  return res.data;
}
