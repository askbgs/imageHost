import Link from "next/link";
import { formatStorage, type StorageUsage } from "@/lib/quota";

/** Storage used against the plan's allowance. Server component: pass the result of storageUsage(). */
export function StorageMeter({
  usage,
  compact = false,
}: {
  usage: StorageUsage;
  compact?: boolean;
}) {
  const pct = usage.limit
    ? Math.min(100, (usage.used / usage.limit) * 100)
    : 100;
  const full = usage.used >= usage.limit;
  const tone = full ? " full" : pct >= 90 ? " high" : "";
  const canUpgrade =
    usage.plan.id !== "business" && !usage.plan.label.includes("admin");
  return (
    <div className={`meter${compact ? " meter-compact" : ""}`}>
      <div className="meter-label">
        <span>Storage</span>
        <strong>
          {formatStorage(usage.used)} of {formatStorage(usage.limit)}
        </strong>
      </div>
      <div
        className={`meter-bar${tone}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={Math.min(usage.used, usage.limit)}
        aria-valuetext={`${formatStorage(usage.used)} of ${formatStorage(usage.limit)} used`}
        aria-label="Storage used"
      >
        {/* A sliver shows as soon as anything is stored. */}
        <span style={{ width: `${usage.used > 0 ? Math.max(pct, 1) : 0}%` }} />
      </div>
      {full ? (
        <span className="meter-hint">
          Storage full. Delete images to upload more
          {canUpgrade && (
            <>
              , or <Link href="/pricing">upgrade</Link>
            </>
          )}
          .
        </span>
      ) : pct >= 90 ? (
        <span className="meter-hint warn">
          Almost full: {formatStorage(usage.limit - usage.used)} left
          {canUpgrade && (
            <>
              . <Link href="/pricing">Get more space</Link>
            </>
          )}
          .
        </span>
      ) : null}
    </div>
  );
}

/** Banner for the upload page when the account is nearly or completely out of space. */
export function StorageNotice({ usage }: { usage: StorageUsage }) {
  const pct = usage.limit ? (usage.used / usage.limit) * 100 : 100;
  if (pct < 90) return null;
  const full = usage.used >= usage.limit;
  const canUpgrade =
    usage.plan.id !== "business" && !usage.plan.label.includes("admin");
  return (
    <div
      className={`alert ${full ? "error" : "warn"} storage-notice`}
      role={full ? "alert" : "status"}
    >
      {full ? (
        <>
          <strong>Your storage is full.</strong> You&apos;re using{" "}
          {formatStorage(usage.used)} of the {formatStorage(usage.limit)} on the{" "}
          {usage.plan.label} plan, so new uploads won&apos;t go through.{" "}
        </>
      ) : (
        <>
          <strong>Your storage is almost full.</strong>{" "}
          {formatStorage(usage.limit - usage.used)} of{" "}
          {formatStorage(usage.limit)} left.{" "}
        </>
      )}
      <Link href="/account">Delete images you don&apos;t need</Link>
      {canUpgrade && (
        <>
          {" "}
          or <Link href="/pricing">upgrade for more space</Link>
        </>
      )}
      .
    </div>
  );
}
