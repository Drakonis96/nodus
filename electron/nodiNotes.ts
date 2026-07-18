import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { deriveNodiNoteTitle } from '@shared/nodiNotes';
import type { NodiNote, NodiNoteInput } from '@shared/types';

// Quick Markdown notes for the Nodi companion. Stored as a small JSON file in the
// user-data directory (install-wide, not per-vault) so a jot survives vault
// switches and app restarts. Mirrors the atomic read/write of `nodiConversations`.

interface Store {
  version: 1;
  notes: NodiNote[];
}

const MAX_NOTES = 500;

function storePath(): string {
  return path.join(app.getPath('userData'), 'nodi-notes.json');
}

function normalizeNote(value: NodiNote): NodiNote {
  const content = typeof value.content === 'string' ? value.content : '';
  const explicitTitle = value.titleExplicit === true ? String(value.title || '').trim() : '';
  return {
    id: String(value.id || crypto.randomUUID()),
    title: (explicitTitle || deriveNodiNoteTitle(content)).slice(0, 100),
    titleExplicit: Boolean(explicitTitle),
    content,
    createdAt: Number(value.createdAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Partial<Store>;
    return {
      version: 1,
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(normalizeNote) : [],
    };
  } catch {
    return { version: 1, notes: [] };
  }
}

function write(store: Store): void {
  const target = storePath();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(store), 'utf8');
  fs.renameSync(temporary, target);
}

export function listNodiNotes(): NodiNote[] {
  return read().notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveNodiNote(input: NodiNoteInput): NodiNote {
  const store = read();
  const existingIndex = input.id ? store.notes.findIndex((note) => note.id === input.id) : -1;
  const existing = existingIndex >= 0 ? store.notes[existingIndex] : null;
  const now = Date.now();
  const content = typeof input.content === 'string' ? input.content : '';
  const explicitTitle = String(input.title || '').trim();
  const note = normalizeNote({
    id: existing?.id ?? crypto.randomUUID(),
    title: explicitTitle || deriveNodiNoteTitle(content),
    titleExplicit: Boolean(explicitTitle),
    content,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  if (existingIndex >= 0) store.notes.splice(existingIndex, 1);
  store.notes.unshift(note);
  store.notes = store.notes.slice(0, MAX_NOTES);
  write(store);
  return note;
}

export function deleteNodiNote(id: string): void {
  const store = read();
  store.notes = store.notes.filter((note) => note.id !== id);
  write(store);
}
