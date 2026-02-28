"use server";

import { addMailingListSubscriber } from "@/lib/dining/state";
import { isValidEmail, normalizeEmail } from "@/lib/dining/subscribers";

export type SubscribeState = {
  success: boolean;
  added: boolean;
  message: string;
};

export async function subscribeAction(
  _: SubscribeState,
  formData: FormData
): Promise<SubscribeState> {
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : "";

  if (!email || !isValidEmail(email)) {
    return {
      success: false,
      added: false,
      message: "Enter a valid email address."
    };
  }

  const result = await addMailingListSubscriber(email);
  const stateUnavailable = result.warnings.includes("SUBSCRIBERS_DISABLED");
  if (stateUnavailable) {
    return {
      success: false,
      added: false,
      message: "Signups are temporarily unavailable."
    };
  }

  if (result.warnings.some((warning) => warning.endsWith("_FAILED"))) {
    return {
      success: false,
      added: false,
      message: "Signup failed."
    };
  }

  return {
    success: true,
    added: result.value,
    message: result.value ? "You are subscribed." : "You are already subscribed."
  };
}
