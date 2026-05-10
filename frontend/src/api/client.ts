/**
 * Thin axios client with JWT bearer injection + 401 handling.
 *
 * All API calls go through this client so token management lives in one place.
 * Access token is stored in localStorage under 'access_token'; refresh is TODO
 * (next milestone once backend exposes /api/login/refresh/).
 */
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";

const API_ROOT = (process.env.REACT_APP_API_BASE_URL ?? "http://localhost:8000").replace(/\/api\/?$/, "");
const BASE_URL = `${API_ROOT}/api`;

export const ACCESS_TOKEN_KEY = "access_token";
export const REFRESH_TOKEN_KEY = "refresh_token";
const AUTH_STORAGE_KEYS = [
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  "access",
  "refresh",
  "token",
  "user",
];

export function clearAuthStorage() {
  if (typeof window === "undefined") return;
  AUTH_STORAGE_KEYS.forEach((key) => {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  });
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      // token missing / expired — clear and let caller redirect to login
      clearAuthStorage();
    }
    return Promise.reject(err);
  }
);

function parseStoredJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readAccessToken(): string {
  if (typeof window === "undefined") return "";

  const directToken =
    window.localStorage.getItem(ACCESS_TOKEN_KEY) ||
    window.sessionStorage.getItem(ACCESS_TOKEN_KEY) ||
    window.localStorage.getItem("access") ||
    window.sessionStorage.getItem("access") ||
    window.localStorage.getItem("token") ||
    window.sessionStorage.getItem("token");
  if (directToken) return directToken;

  const userRecord = parseStoredJson(window.localStorage.getItem("user"));
  const nestedToken =
    (typeof userRecord?.access === "string" && userRecord.access) ||
    (typeof userRecord?.token === "string" && userRecord.token) ||
    "";
  return nestedToken;
}

export function buildApiUrl(path: string): string {
  if (!path.startsWith("/")) return `${API_ROOT}/${path}`;
  return `${API_ROOT}${path}`;
}

async function readErrorText(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `Request failed (${response.status})`;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const detail =
      (typeof parsed.message === "string" && parsed.message) ||
      (typeof parsed.detail === "string" && parsed.detail) ||
      text;
    return detail || `Request failed (${response.status})`;
  } catch {
    return text;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readAccessToken();
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers,
    credentials: init.credentials ?? "same-origin",
  });

  if (!response.ok) {
    throw new Error(await readErrorText(response));
  }
  return response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  return (await response.json()) as T;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const matched = header.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
  if (!matched?.[1]) return null;
  return decodeURIComponent(matched[1].replace(/"/g, "").trim());
}

export async function downloadApiFile(path: string, fallbackFilename: string): Promise<void> {
  const response = await apiFetch(path);
  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filenameFromDisposition(response.headers.get("Content-Disposition")) || fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export function clearLocalStorageKeys(keys: string[]) {
  if (typeof window === "undefined") return;
  keys.forEach((key) => window.localStorage.removeItem(key));
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
