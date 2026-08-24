/**
 * Lightweight coordination boundary used by restore/import code. Keeping this
 * registry separate prevents backup-only utilities from pulling the complete
 * AI/document indexing dependency graph into their process.
 */
export interface DocumentIndexMaintenanceController {
  pauseAllAndDrain(): Promise<string[]>;
  resumeAllAfterMaintenance(vaultIds: string[]): Promise<void>;
}

let controller: DocumentIndexMaintenanceController | null = null;

export function registerDocumentIndexMaintenanceController(
  next: DocumentIndexMaintenanceController,
): void {
  controller = next;
}

export async function pauseAllDocumentIndexingAndDrain(): Promise<string[]> {
  return controller ? controller.pauseAllAndDrain() : [];
}

export async function resumeAllDocumentIndexingAfterMaintenance(vaultIds: string[]): Promise<void> {
  if (controller) await controller.resumeAllAfterMaintenance(vaultIds);
}
