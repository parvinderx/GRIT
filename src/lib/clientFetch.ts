/**
 * Client-side JSON request helpers. They never throw: network failures and
 * non-JSON bodies come back as { ok: false, message }, so callers can always
 * reset their busy state and show a specific error.
 */
export type JsonResult<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  data: Partial<T> & { message?: string; error?: string };
  message?: string;
};

export const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

export async function requestJson<T = Record<string, unknown>>(
  method: "GET" | "POST" | "PUT",
  url: string,
  opts: { body?: unknown; idempotent?: boolean } = {}
): Promise<JsonResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotent) headers["Idempotency-Key"] = crypto.randomUUID();

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    return { ok: false, status: 0, data: {}, message: NETWORK_ERROR };
  }
  let data: JsonResult<T>["data"] = {};
  try {
    data = await res.json();
  } catch {
    // empty or non-JSON body — keep {}
  }
  return { ok: res.ok, status: res.status, data, message: data?.message };
}

export function postJson<T = Record<string, unknown>>(url: string, body?: unknown, opts: { idempotent?: boolean } = {}) {
  return requestJson<T>("POST", url, { body, ...opts });
}
