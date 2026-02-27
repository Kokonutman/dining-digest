import { NextResponse } from "next/server";
import { getLastRunAt } from "@/lib/dining/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getLastRunAt();
  const hasReadFailure = result.warnings.some((warning) => warning.endsWith("_FAILED"));
  const status = hasReadFailure ? "degraded" : "ok";
  const timestamp = new Date().toISOString();

  return NextResponse.json(
    {
      status,
      service: "dining-digest",
      timestamp
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
      }
    }
  );
}
