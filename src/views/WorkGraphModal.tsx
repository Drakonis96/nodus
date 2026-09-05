import { useEffect, useMemo } from "react";
import { StellarWorkspace } from "../stellarGraph/StellarWorkspace";
import { desktopSource } from "../stellarGraph/source";
import { academicKnowledgeViewSource } from "./knowledgeViewSource";
import { t } from "../i18n";
export function WorkGraphModal({
  work,
  onClose,
}: {
  work: { nodus_id: string; title: string };
  onClose: () => void;
}) {
  const source = useMemo(
    () =>
      desktopSource(academicKnowledgeViewSource, `academic:${work.nodus_id}`),
    [work.nodus_id],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 p-4 flex"
      role="dialog"
      aria-modal="true"
      aria-label={t("Grafo de la obra")}
      onClick={onClose}
    >
      <div
        className="w-full h-full overflow-hidden rounded-2xl border border-neutral-700"
        onClick={(e) => e.stopPropagation()}
      >
        <StellarWorkspace
          source={source}
          workId={work.nodus_id}
          title={work.title}
          audit
          toolbar={<button onClick={onClose}>{t("Cerrar")} ×</button>}
        />
      </div>
    </div>
  );
}
