// Text for the ?error= codes the sign-in callback can return. Unknown codes show nothing.
const MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  state_mismatch: "That sign-in link expired or was opened in another browser. Please try again.",
  provider_disabled: "That sign-in option isn't available.",
  provider_error: "The provider didn't complete the sign-in. Please try again.",
  email_in_use:
    "An account with this email already exists. Sign in with your password, then connect this provider under Settings.",
  no_email:
    "We couldn't get a confirmed email address from that account. Allow access to your email, or sign up with email and password.",
  signup_closed: "New sign-ups are closed.",
  suspended: "This account is suspended.",
  linked_elsewhere: "That account is already connected to a different user here.",
  already_connected: "You already have an account from this provider connected. Disconnect it first.",
  rate_limited: "Too many sign-in attempts. Please wait a few minutes.",
  retry: "Something changed while signing you in. Please try again.",
  server_error: "Something went wrong. Please try again.",
  last_method: "Set a password or connect another provider before disconnecting this one, so you can still sign in.",
};

export const oauthMessage = (code: string | undefined) => (code ? MESSAGES[code] ?? null : null);
