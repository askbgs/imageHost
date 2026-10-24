"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type FormState } from "@/app/actions/auth";

export function SignInForm({ next, allowSignup }: { next: string; allowSignup: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  return (
    <form action={action} noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button type="submit" className="btn primary block" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {allowSignup && (
        <p className="switch">
          New here? <Link href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
        </p>
      )}
    </form>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signUp, {});
  return (
    <form action={action} noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" autoComplete="name" defaultValue={state.fields?.name} maxLength={60} />
        <span className="field-hint">Optional. Shown only to you.</span>
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        <span className="field-hint">At least 10 characters.</span>
      </div>
      <button type="submit" className="btn primary block" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p className="switch">
        Already have an account? <Link href={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
      </p>
    </form>
  );
}
