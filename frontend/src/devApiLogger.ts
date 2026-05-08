/**
 * Dev-only fetch interceptor for frontend-backend contract debugging.
 *
 * Wraps window.fetch and logs every /api/* call with method, URL, status, and
 * response body shape. Active only when NODE_ENV !== 'production' AND
 * REACT_APP_LOG_API is unset or truthy.
 *
 * Install by importing once from index.tsx (top of file, before App):
 *     import './devApiLogger';
 */

type LogRow = {
  method: string;
  url: string;
  status: number;
  ms: number;
  reqBody?: unknown;
  resShape?: string[] | string;
};

const GROUP = "%c[API]";
const OK = "color:#16a34a;font-weight:bold";
const BAD = "color:#dc2626;font-weight:bold";
const MID = "color:#2563eb;font-weight:bold";

function shapeOf(value: unknown): string[] | string {
  if (value == null) return "null";
  if (Array.isArray(value)) {
    return `array[${value.length}]${value.length ? " of " + shapeOf(value[0]) : ""}`;
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>);
  }
  return typeof value;
}

function installed(): boolean {
  return (window as unknown as { __apiLoggerInstalled?: boolean }).__apiLoggerInstalled === true;
}

export function installDevApiLogger(): void {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.REACT_APP_LOG_API === "false") return;
  if (installed()) return;
  (window as unknown as { __apiLoggerInstalled?: boolean }).__apiLoggerInstalled = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    const isApi = url.includes("/api/");
    if (!isApi) return original(input, init);

    const started = performance.now();
    let row: LogRow = { method, url, status: 0, ms: 0 };

    try {
      if (init?.body && typeof init.body === "string") {
        try { row.reqBody = JSON.parse(init.body); } catch { row.reqBody = init.body; }
      }

      const res = await original(input, init);
      row.status = res.status;
      row.ms = Math.round(performance.now() - started);

      // Peek body without consuming — clone first
      const clone = res.clone();
      try {
        const text = await clone.text();
        if (text) {
          try { row.resShape = shapeOf(JSON.parse(text)); }
          catch { row.resShape = `text[${text.length}b]`; }
        }
      } catch { /* ignore */ }

      const style = res.ok ? OK : BAD;
      // eslint-disable-next-line no-console
      console.groupCollapsed(`${GROUP} %c${method}%c ${url} %c${res.status} %c${row.ms}ms`,
        style, MID, "color:inherit", style, "color:#94a3b8");
      // eslint-disable-next-line no-console
      if (row.reqBody !== undefined) console.log("req:", row.reqBody);
      // eslint-disable-next-line no-console
      if (row.resShape !== undefined) console.log("res shape:", row.resShape);
      // eslint-disable-next-line no-console
      console.groupEnd();

      return res;
    } catch (err) {
      row.ms = Math.round(performance.now() - started);
      // eslint-disable-next-line no-console
      console.error(`${GROUP} ${method} ${url} NETWORK_ERR ${row.ms}ms`, err);
      throw err;
    }
  };
}

installDevApiLogger();
