const API_BASE = process.env.REACT_APP_API_BASE_URL ?? "";

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
  if (!path.startsWith("/")) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
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
    credentials: init.credentials ?? "include",
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
  const matched = header.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
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
