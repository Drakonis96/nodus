/** Shared progress indicator for theme loading, layout and corpus context. */
export function StellarProgress({ label, progress }: { label: string; progress: number }) {
  return <div className="stellar-progress" role="status" aria-live="polite">
    <span>{label}</span>
    <div className="stellar-progress-track">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} />
    </div>
  </div>;
}
