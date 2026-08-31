// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Creation-time policy for the master password that protects recovery copies.
 *
 * Nodus deliberately accepts long passphrases instead of forcing arbitrary
 * upper-case, number, or symbol combinations. The backups use scrypt for key
 * derivation; the UI must describe the one actual composition rule precisely.
 */
export const MIN_BACKUP_PASSWORD_LENGTH = 8;

export interface BackupPasswordValidation {
  normalized: string;
  /** Unicode code points, rather than UTF-16 code units. */
  length: number;
  valid: boolean;
}

export function validateBackupPassword(password: string): BackupPasswordValidation {
  const normalized = password.trim();
  const length = Array.from(normalized).length;
  return {
    normalized,
    length,
    valid: length >= MIN_BACKUP_PASSWORD_LENGTH,
  };
}

export function backupPasswordsMatch(password: string, confirmation: string): boolean {
  return validateBackupPassword(password).normalized === validateBackupPassword(confirmation).normalized;
}
