"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordReset,
  resetPassword,
  signIn,
  signUp,
  type FormState,
} from "@/app/actions/auth";

export function SignInForm({
  next,
  allowSignup,
}: {
  next: string;
  allowSignup: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    signIn,
    {},
  );
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
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.fields?.email}
        />
      </div>
      <div className="field">
        <div className="label-row">
          <label htmlFor="password">Password</label>
          <Link href="/forgot-password" className="label-link">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <button type="submit" className="btn primary block" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {allowSignup && (
        <p className="switch">
          New here?{" "}
          <Link
            href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
          >
            Create an account
          </Link>
        </p>
      )}
    </form>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    signUp,
    {},
  );
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
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          defaultValue={state.fields?.name}
          maxLength={60}
        />
        <span className="field-hint">Optional. Shown only to you.</span>
      </div>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.fields?.email}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
        />
        <span className="field-hint">At least 10 characters.</span>
      </div>
      <button type="submit" className="btn primary block" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p className="switch">
        Already have an account?{" "}
        <Link
          href={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

/** "Forgot password?": asks for the email address. */
export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    requestPasswordReset,
    {},
  );
  if (state.ok) {
    return (
      <div className="stack">
        <div className="alert ok" role="status">
          {state.ok}
        </div>
        <p className="switch">
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }
  return (
    <form action={action} noValidate>
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          defaultValue={state.fields?.email}
        />
      </div>
      <button type="submit" className="btn primary block" disabled={pending}>
        {pending ? "Sending…" : "Email me a reset link"}
      </button>
      <p className="switch">
        Remembered it? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}

/** The page behind the emailed link: choose a new password. */
export function ResetPasswordForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    resetPassword,
    {},
  );
  return (
    <form action={action} noValidate>
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers update the right saved login. */}
      <input
        type="email"
        name="username"
        value={email}
        autoComplete="username"
        readOnly
        hidden
      />
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
          {/expired|already used/.test(state.error) && (
            <>
              {" "}
              <Link href="/forgot-password">Get a new link</Link>
            </>
          )}
        </div>
      )}
      <div className="field">
        <label htmlFor="password">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          autoFocus
        />
        <span className="field-hint">At least 10 characters.</span>
      </div>
      <div className="field">
        <label htmlFor="confirm">Type it again</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
        />
      </div>
      <button type="submit" className="btn primary block" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
