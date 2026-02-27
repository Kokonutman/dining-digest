import { GroupedInterestingItem } from "@/lib/dining/types";
import { getMailingListSubscribers } from "@/lib/dining/state";
import { getPublicBaseUrl, makeUnsubscribeToken } from "@/lib/dining/subscribers";

type EmailBuildResult = {
  subject: string;
  text: string;
  html: string;
};

type SendDigestParams = {
  date: string;
  generatedAtIso: string;
  items: GroupedInterestingItem[];
  dryRun?: boolean;
};

type SendDigestResult = {
  emailSent: boolean;
  provider: "resend" | null;
  warnings: string[];
  errors: string[];
};

function formatSubjectDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(parsed);
}

function buildDigestEmail(params: {
  date: string;
  generatedAtIso: string;
  items: GroupedInterestingItem[];
  unsubscribeUrl?: string;
}): EmailBuildResult {
  const subject = `UMD Dining picks for ${formatSubjectDate(params.date)}`;
  const mealGroups = buildMealGroups(params.items);

  const lines: string[] = [];
  lines.push(subject);
  lines.push("");

  if (!mealGroups.length) {
    lines.push("No interesting items found today.");
  } else {
    for (const group of mealGroups) {
      lines.push(`${group.meal}`);
      for (const entry of group.entries) {
        const special = entry.isSpecial ? " [SPECIAL]" : "";
        lines.push(`- ${entry.item}${special}`);
        const station = entry.station?.trim();
        const stationPart = station ? ` | Station: ${station}` : "";
        lines.push(`  - ${entry.hall}${stationPart}`);
      }
      lines.push("");
    }
  }

  lines.push(`Generated at ${params.generatedAtIso}`);
  if (params.unsubscribeUrl) {
    lines.push("");
    lines.push(`Unsubscribe: ${params.unsubscribeUrl}`);
  }

  const htmlItems = mealGroups.length
    ? mealGroups
        .map((group) => {
          const entries = group.entries
            .map((entry) => {
              const station = entry.station?.trim();
              const stationPart = station
                ? ` <span style="color:#94a3b8;">| Station: ${escapeHtml(station)}</span>`
                : "";
              const specialBadge = entry.isSpecial
                ? `<span style="display:inline-block;padding:2px 7px;border:1px solid #854d0e;border-radius:999px;color:#fef08a;font-size:11px;">special</span>`
                : "";
              return `
                <li style="margin:8px 0;color:#cbd5e1;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="color:#f8fafc;">${escapeHtml(entry.item)}</span>
                    ${specialBadge}
                  </div>
                  <div style="margin-top:2px;color:#cbd5e1;">${escapeHtml(entry.hall)}${stationPart}</div>
                </li>
              `;
            })
            .join("");
          return `
            <section style="margin:0 0 16px;padding:12px;border:1px solid #1e293b;border-radius:10px;background:#0f172a;">
              <h3 style="margin:0 0 8px;color:#67e8f9;font-size:14px;letter-spacing:.06em;text-transform:uppercase;">${escapeHtml(group.meal)}</h3>
              <ul style="margin:0;padding-left:18px;">${entries}</ul>
            </section>
          `;
        })
        .join("")
    : `<p style="margin:0;color:#cbd5e1;">No interesting items found today.</p>`;

  const html = `
    <div style="background:#020617;padding:24px;font-family:'Space Grotesk','Inter','Segoe UI',Arial,sans-serif;color:#e2e8f0;line-height:1.45;">
      <div style="max-width:760px;margin:0 auto;background:#0b1220;border:1px solid #1e293b;border-radius:14px;overflow:hidden;">
        <div style="padding:16px 20px;background:linear-gradient(90deg,#0f172a 0%, #0b2440 55%, #103253 100%);border-bottom:1px solid #1e293b;">
          <p style="margin:0 0 4px;color:#67e8f9;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Arjun K. Iyer · Systems Feed</p>
          <h2 style="margin:0;color:#f8fafc;font-size:22px;">${escapeHtml(subject)}</h2>
        </div>
        <div style="padding:18px 20px;">
        ${htmlItems}
        <hr style="border:none;border-top:1px solid #1e293b;margin:18px 0;" />
        <p style="margin:0;color:#94a3b8;font-size:12px;">Generated at ${escapeHtml(params.generatedAtIso)}</p>
        ${
          params.unsubscribeUrl
            ? `<p style="margin:10px 0 0;color:#94a3b8;font-size:12px;">Not interested anymore? <a href="${escapeHtml(params.unsubscribeUrl)}" style="color:#7fe6ff;">Unsubscribe</a></p>`
            : ""
        }
        </div>
      </div>
    </div>
  `;

  return {
    subject,
    text: lines.join("\n"),
    html
  };
}

function parseRecipients(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

async function sendViaResend(params: {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY_MISSING");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html
    })
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) {
        detail = `:${payload.message}`;
      }
    } catch {
      // ignore parsing errors to preserve base status
    }
    throw new Error(`RESEND_SEND_FAILED_${response.status}${detail}`);
  }
}

export async function sendDigestEmail(params: SendDigestParams): Promise<SendDigestResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const to = process.env.DINING_EMAIL_TO ?? "";
  const from = process.env.DINING_EMAIL_FROM;
  const subscribersRes = await getMailingListSubscribers();
  warnings.push(...subscribersRes.warnings);

  if (!from) {
    return {
      emailSent: false,
      provider: null,
      warnings,
      errors: ["EMAIL_ENV_MISSING_FROM"]
    };
  }

  const recipients = Array.from(
    new Set([...parseRecipients(to), ...subscribersRes.value.map((entry) => entry.trim().toLowerCase())])
  );

  if (!recipients.length) {
    return {
      emailSent: false,
      provider: null,
      warnings,
      errors: ["EMAIL_NO_RECIPIENTS"]
    };
  }

  if (params.dryRun) {
    return {
      emailSent: false,
      provider: null,
      warnings: ["DRY_RUN_EMAIL_SKIPPED"],
      errors
    };
  }

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) {
    warnings.push("UNSUBSCRIBE_BASE_URL_MISSING");
  }

  let sentCount = 0;
  for (const recipient of recipients) {
    const token = makeUnsubscribeToken(recipient);
    if (!token) {
      warnings.push("UNSUBSCRIBE_SECRET_MISSING");
    }
    const unsubscribeUrl =
      baseUrl && token
        ? `${baseUrl}/unsubscribe?email=${encodeURIComponent(recipient)}&token=${encodeURIComponent(token)}`
        : undefined;

    const { subject, text, html } = buildDigestEmail({
      date: params.date,
      generatedAtIso: params.generatedAtIso,
      items: params.items,
      unsubscribeUrl
    });

    try {
      await sendViaResend({ to: recipient, from, subject, text, html });
      sentCount += 1;
    } catch {
      errors.push(`EMAIL_SEND_FAILED_RESEND:${recipient}`);
    }
  }

  if (sentCount > 0 && sentCount < recipients.length) {
    warnings.push("EMAIL_PARTIAL_SEND");
  }

  return {
    emailSent: sentCount > 0,
    provider: sentCount > 0 ? "resend" : null,
    warnings: Array.from(new Set(warnings)),
    errors: Array.from(new Set(errors))
  };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type MealEntry = {
  meal: string;
  item: string;
  hall: string;
  station?: string;
  isSpecial: boolean;
};

type MealGroup = {
  meal: string;
  entries: MealEntry[];
};

function mealSortIndex(meal: string): number {
  const normalized = meal.trim().toLowerCase();
  const order = ["breakfast", "brunch", "lunch", "dinner", "late night", "specials"];
  const index = order.indexOf(normalized);
  return index === -1 ? order.length : index;
}

function buildMealGroups(items: GroupedInterestingItem[]): MealGroup[] {
  const byMeal = new Map<string, MealEntry[]>();

  for (const item of items) {
    const isSpecial = item.matchedIncludes.some((match) => match.toLowerCase() === "special");
    for (const appearance of item.appearances) {
      const mealKey = appearance.meal.trim() || "Other";
      const list = byMeal.get(mealKey) ?? [];
      list.push({
        meal: mealKey,
        item: item.item,
        hall: appearance.hall,
        station: appearance.station,
        isSpecial
      });
      byMeal.set(mealKey, list);
    }
  }

  return [...byMeal.entries()]
    .map(([meal, entries]) => ({
      meal,
      entries: entries.sort((a, b) => {
        const itemCmp = a.item.localeCompare(b.item);
        if (itemCmp !== 0) return itemCmp;
        return a.hall.localeCompare(b.hall);
      })
    }))
    .sort((a, b) => {
      const idxCmp = mealSortIndex(a.meal) - mealSortIndex(b.meal);
      if (idxCmp !== 0) return idxCmp;
      return a.meal.localeCompare(b.meal);
    });
}
