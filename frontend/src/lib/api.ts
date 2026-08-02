import { getStaffSession } from "./session";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8010";
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (options.auth !== false) {
    const session = getStaffSession();
    if (session) headers["Authorization"] = `Bearer ${session.token}`;
  }

  const res = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.detail ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: { auth?: boolean }) => request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: { auth?: boolean }) =>
    request<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: { auth?: boolean }) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  del: <T>(path: string, opts?: { auth?: boolean }) => request<T>(path, { ...opts, method: "DELETE" }),
};
