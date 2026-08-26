import { compassT } from "../../i18n.compass";
import type {
  CompassProviderId,
  CompassProviderStatus as Status,
} from "./types";

const failures = new Set<Status["state"]>([
  "error",
  "offline",
  "rate-limited",
  "budget-exhausted",
  "temporarily-disabled",
]);
export function CompassProviderStatus({
  providers,
  onRetry,
}: {
  providers: Status[];
  onRetry?: (provider: CompassProviderId) => void;
}) {
  if (!providers.length) return null;
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="status"
      aria-live="polite"
      aria-label={compassT("Proveedores")}
    >
      {providers.map((item) => (
        <span
          key={`${item.provider}:${item.lane}`}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${failures.has(item.state) ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" : item.state === "complete" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}
          title={item.error ?? compassT(item.state)}
        >
          <span aria-hidden="true">
            {failures.has(item.state)
              ? "!"
              : item.state === "complete"
                ? "✓"
                : item.state === "searching"
                  ? "…"
                  : "·"}
          </span>
          <span>
            {item.provider} · {compassT(item.state)} · {item.count}
          </span>
          {onRetry && failures.has(item.state) && (
            <button
              type="button"
              className="ml-1 underline"
              onClick={() => onRetry(item.provider)}
            >
              {compassT("Reintentar")}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
