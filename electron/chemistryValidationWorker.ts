import { validateChemicalReferences } from './chemistryValidationCore';
import type { ChemistryValidationRequest } from '@shared/chemistryDocument';

process.parentPort?.on('message', event => {
  void validateChemicalReferences(event.data as ChemistryValidationRequest).then(
    result => process.parentPort?.postMessage({ result }),
    error => process.parentPort?.postMessage({ error: error instanceof Error ? error.message : 'Chemical validation failed.' }),
  );
});
