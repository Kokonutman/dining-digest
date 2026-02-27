"use client";

import { useActionState } from "react";
import type { SubscribeState } from "@/app/subscribe-actions";

const INITIAL_STATE: SubscribeState = {
  success: false,
  added: false,
  message: ""
};

type SubscribeAction = (
  state: SubscribeState,
  formData: FormData
) => Promise<SubscribeState>;

export function SubscribeForm({ action }: { action: SubscribeAction }) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const messageClassName = state.message
    ? state.success
      ? "subscribe-message subscribe-success"
      : "subscribe-message subscribe-error"
    : "subscribe-message";

  return (
    <>
      <form action={formAction} className="signup-form">
        <label htmlFor="email" className="label">
          Join the mailing list
        </label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          className="input"
        />
        <button type="submit" disabled={isPending} className="btn btn-solid">
          {isPending ? "Submitting..." : "Subscribe"}
        </button>
      </form>
      {state.message ? <p className={messageClassName}>{state.message}</p> : null}
    </>
  );
}
