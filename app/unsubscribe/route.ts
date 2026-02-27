import { NextRequest } from "next/server";
import { isValidEmail, normalizeEmail, verifyUnsubscribeToken } from "@/lib/dining/subscribers";
import { removeMailingListSubscriber } from "@/lib/dining/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pageHtml(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #0b1117; color: #dce7f5; }
      main { max-width: 680px; margin: 9vh auto; padding: 24px; border: 1px solid rgba(129,160,186,0.22); border-radius: 10px; background: rgba(9,13,18,0.78); }
      h1 { margin: 0 0 12px; font-size: 1.5rem; }
      p { margin: 0; color: #b9c6d8; line-height: 1.5; }
      a { color: #7fe6ff; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
      <p style="margin-top:16px;"><a href="/">Back to dining digest</a></p>
    </main>
  </body>
</html>`;
}

export async function GET(request: NextRequest) {
  const email = normalizeEmail(request.nextUrl.searchParams.get("email") ?? "");
  const token = (request.nextUrl.searchParams.get("token") ?? "").trim();

  if (!email || !token || !isValidEmail(email)) {
    return new Response(pageHtml("Invalid request", "The unsubscribe link is missing required values."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  if (!verifyUnsubscribeToken(email, token)) {
    return new Response(pageHtml("Invalid token", "This unsubscribe link is invalid or expired."), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const result = await removeMailingListSubscriber(email);
  const writeFailed = result.warnings.some((warning) => warning.endsWith("_FAILED"));
  if (writeFailed) {
    return new Response(pageHtml("Unable to unsubscribe", "Please try again later."), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const message = result.value
    ? `You have been unsubscribed: ${email}`
    : `This email is not currently subscribed: ${email}`;
  return new Response(pageHtml("Unsubscribe complete", message), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}
