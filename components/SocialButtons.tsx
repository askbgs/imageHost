import { IconChevron } from "./Icons";

// Plain lettermarks. To use the providers' official sign-in buttons instead, download them
// from each provider's brand resources and follow their guidelines.
const MARK: Record<string, string> = { github: "GH", google: "G", facebook: "f" };

export function SocialButtons({
  providers,
  next,
  verb = "Continue",
}: {
  providers: { id: string; label: string }[];
  next: string;
  verb?: string;
}) {
  if (providers.length === 0) return null;
  const q = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <div className="social">
      {providers.map((p) => (
        <a key={p.id} className={`btn secondary block social-btn social-${p.id}`} href={`/auth/${p.id}${q}`}>
          <span className="social-mark" aria-hidden="true">
            {MARK[p.id] ?? p.label.slice(0, 1)}
          </span>
          <span>
            {verb} with {p.label}
          </span>
          <IconChevron size={16} className="social-arrow" />
        </a>
      ))}
      <div className="divider-or">or use your email</div>
    </div>
  );
}
