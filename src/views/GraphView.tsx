import { TutorPanel } from "./TutorPanel";
import { useMemo, useState, useEffect, type ReactNode } from "react";
import type { AppSettings } from "@shared/types";
import type { GraphNavigationTarget } from "../navigation";
import {
  academicKnowledgeViewSource,
  type KnowledgeViewSource,
} from "./knowledgeViewSource";
import { StellarWorkspace } from "../stellarGraph/StellarWorkspace";
import { desktopSource } from "../stellarGraph/source";
import { ThemesModal } from "./ThemesModal";
import { IdeaDuplicatesModal } from "./IdeaDuplicatesModal";
import { EdgeAuditModal } from "./EdgeAuditModal";
import { t } from "../i18n";
export function GraphView({
  settings,
  onSettingsChange,
  target,
  dataSource = academicKnowledgeViewSource,
  scopeControl,
  testId,
}: {
  settings: AppSettings;
  onSettingsChange: () => void;
  target?: GraphNavigationTarget | null;
  dataSource?: KnowledgeViewSource;
  scopeControl?: ReactNode;
  testId?: string;
}) {
  const [tutorTarget, setTutorTarget] = useState<GraphNavigationTarget | null>(
    null,
  );
  const [modal, setModal] = useState(target?.openTutor ? "tutor" : ""),
    [revision, setRevision] = useState(0);
  const source = useMemo(
    () =>
      desktopSource(
        dataSource,
        `${dataSource.key}:${target?.workId || "corpus"}`,
      ),
    [dataSource, target?.workId, revision],
  );
  useEffect(
    () => dataSource.subscribe?.(() => setRevision((v) => v + 1)),
    [dataSource],
  );
  const close = () => {
    setModal("");
    setRevision((v) => v + 1);
  };
  return (
    <div className="h-full min-h-0" data-testid={testId || "graph-view"}>
      <StellarWorkspace
        key={`${source.key}:${target?.nonce || 0}`}
        source={source}
        workId={target?.workId}
        initialSeed={
          tutorTarget?.nodeId ||
          (target?.preset === "authors" ? undefined : target?.nodeId)
        }
        initialEdge={tutorTarget?.edgeId || target?.edgeId}
        initialSearch={target?.search || target?.theme}
        author={target?.preset === "authors" ? target?.label : undefined}
        title={target?.workTitle}
        openEvidence={dataSource.openEvidence}
        saveIdea={dataSource.saveIdea}
        saveEdge={dataSource.saveEdge}
        audit={dataSource.capabilities.audit}
        toolbar={
          <>
            {scopeControl}
            {(dataSource.capabilities.manageThemes ||
              dataSource.capabilities.audit ||
              dataSource.capabilities.duplicates) && (
              <select
                className="input text-xs"
                value=""
                aria-label={t("Herramientas de investigación")}
                onChange={(e) => setModal(e.target.value)}
              >
                <option value="">{t("Herramientas")}</option>
                {dataSource.capabilities.tutor && (
                  <option value="tutor">{t("Tutor")}</option>
                )}
                {dataSource.capabilities.manageThemes && (
                  <option value="themes">{t("Temas")}</option>
                )}
                {dataSource.capabilities.duplicates && (
                  <option value="duplicates">{t("Ideas duplicadas")}</option>
                )}
                {dataSource.capabilities.audit && (
                  <option value="audit">{t("Auditoría de relaciones")}</option>
                )}
              </select>
            )}
          </>
        }
      />
      {modal === "tutor" && (
        <div className="absolute right-0 top-0 bottom-0 z-30">
          <TutorPanel
            settings={settings}
            onClose={close}
            onClearFocus={() => setTutorTarget(null)}
            onFocusStop={(stop) =>
              setTutorTarget({
                nonce: Date.now(),
                nodeId: stop.nodeIds.find((id) => !id.startsWith("theme:")),
                edgeId: stop.edgeId || undefined,
              })
            }
          />
        </div>
      )}
      {modal === "themes" && (
        <ThemesModal
          settings={settings}
          onSettingsChange={onSettingsChange}
          onReprocessed={() => setRevision((v) => v + 1)}
          onClose={close}
        />
      )}
      {modal === "duplicates" && <IdeaDuplicatesModal onClose={close} />}
      {modal === "audit" && (
        <EdgeAuditModal
          onClose={close}
          onChanged={() => setRevision((v) => v + 1)}
        />
      )}
    </div>
  );
}
