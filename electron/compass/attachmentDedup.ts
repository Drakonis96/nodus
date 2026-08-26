// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import fs from "node:fs";

// Library items keep independent attachment paths. Equal open files share an
// inode where possible, so removing either item remains safe while the bytes are
// stored only once. The existing copy is preserved when linking is unavailable.
export function deduplicateFileByHardLink(source: string, destination: string): boolean {
  try {
    const sourceStat = fs.statSync(source);
    const destinationStat = fs.statSync(destination);
    if (sourceStat.dev !== destinationStat.dev) return false;
    if (sourceStat.ino === destinationStat.ino) return true;
    const temporary = `${destination}.dedupe-${process.pid}-${randomUUID()}`;
    try {
      fs.linkSync(source, temporary);
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    const linked = fs.statSync(destination);
    return linked.dev === sourceStat.dev && linked.ino === sourceStat.ino;
  } catch {
    return false;
  }
}
