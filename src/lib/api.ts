import { NextResponse } from "next/server";
import { serverNow } from "./clock";
import { ApiError, mapPgError } from "./errors";

export { ApiError, mapPgError };

/** Every response carries server_time (the simulated clock). */
export async function apiOk(data: unknown, status = 200) {
  const server_time = (await serverNow()).toISOString();
  return NextResponse.json({ ...(data as object), server_time }, { status });
}

export async function apiError(e: unknown) {
  const server_time = (await serverNow().catch(() => new Date())).toISOString();
  const mapped = e instanceof ApiError ? e : mapPgError(e);
  if (mapped) {
    return NextResponse.json(
      { error: mapped.code, message: mapped.message, ...mapped.extra, server_time },
      { status: mapped.status }
    );
  }
  console.error("Unhandled API error:", e);
  return NextResponse.json(
    { error: "INTERNAL", message: "Something went wrong", server_time },
    { status: 500 }
  );
}

/**
 * Plain-text error for file-download routes (.ics). A browser following an
 * <a download> link would otherwise save the JSON error body as the "file".
 */
export function textError(e: unknown): Response {
  const mapped = e instanceof ApiError ? e : mapPgError(e);
  if (!mapped) console.error("Unhandled download error:", e);
  const status = mapped?.status ?? 500;
  const message = mapped?.message ?? "Something went wrong. Go back to your GRIT dashboard and try again.";
  return new Response(`${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
