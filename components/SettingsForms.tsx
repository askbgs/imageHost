"use client";

import { useActionState } from "react";
import { changePassword, updateProfile, type FormState } from "@/app/actions/auth";

function Result({ state }: { state: FormState }) {
  if (state.error) return <div className="alert error" role="alert">{state.error}</div>;
  if (state.ok) return <div className="alert ok" role="status">{state.ok}</div>;
  return null;
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfile, {});
  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="email-ro">Email</label>
        <input id="email-ro" type="email" value={email} readOnly disabled />
      </div>
      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" defaultValue={name} maxLength={60} autoComplete="name" />
      </div>
      <Result state={state} />
      <div>
        <button type="submit" className="btn secondary" disabled={pending}>
          {pending ? "Saving…" : "Save name"}
        </button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} className="stack" key={state.ok ?? "pw"}>
      <div className="field">
        <label htmlFor="current">Current password</label>
        <input id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div className="field">
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <span className="field-hint">At least 10 characters. Changing it signs out your other devices.</span>
      </div>
      <Result state={state} />
      <div>
        <button type="submit" className="btn secondary" disabled={pending}>
          {pending ? "Changing…" : "Change password"}
        </button>
      </div>
    </form>
  );
}
