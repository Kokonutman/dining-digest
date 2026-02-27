import { NextResponse } from "next/server";
import { getLastRunAt } from "@/lib/dining/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getLastRunAt();
  const status = result.warnings.length ? "degraded" : "ok";
  return NextResponse.json({
    status,
    service: "dining-digest",
    timestamp: new Date().toISOString()
  });
}
