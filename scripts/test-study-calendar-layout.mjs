import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-calendar-layout-'));
const outfile = path.join(tmp, 'studyCalendarLayout.mjs');

await build({
  entryPoints: [path.join(repoRoot, 'src/views/studyCalendarLayout.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['@shared/*'],
  logLevel: 'silent',
});

const {
  calendarDay,
  eventDayRange,
  eventSpansMultipleDays,
  eventsByCoveredDay,
  layoutCalendarWeek,
} = await import(pathToFileURL(outfile).href);

const at = (year, month, day, hour = 9) => new Date(year, month - 1, day, hour).toISOString();
const event = (id, startsAt, endsAt = null) => ({
  id,
  shortId: id,
  title: `Event ${id}`,
  type: 'class',
  icon: 'calendar',
  emoji: '',
  description: '',
  url: '',
  startsAt,
  endsAt,
  allDay: false,
  courseId: null,
  subjectId: null,
  topicId: null,
  notes: '',
  reminderMinutes: null,
  reminderAt: null,
  notifiedAt: null,
  completed: false,
  createdAt: startsAt,
  updatedAt: startsAt,
});

test.after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test('multi-day ranges include every local calendar day and stay DST-safe', () => {
  const springChange = event('dst', at(2026, 3, 28), at(2026, 3, 30));
  const range = eventDayRange(springChange);
  assert.equal(range.end - range.start, 2);
  assert.equal(calendarDay(new Date(2026, 2, 29)) - calendarDay(new Date(2026, 2, 28)), 1);
  assert.equal(eventSpansMultipleDays(springChange), true);

  const covered = eventsByCoveredDay([springChange]);
  assert.deepEqual([...covered.keys()], [range.start, range.start + 1, range.end]);
  assert.ok([...covered.values()].every((events) => events[0].id === 'dst'));
});

test('multi-day bars are clipped and marked as continuations at week boundaries', () => {
  const spanning = event('span', at(2026, 3, 4), at(2026, 3, 10));

  const firstWeek = layoutCalendarWeek([spanning], new Date(2026, 2, 2));
  assert.deepEqual(firstWeek.segments.map(({ startColumn, span, continuesBefore, continuesAfter }) => ({
    startColumn,
    span,
    continuesBefore,
    continuesAfter,
  })), [{
    startColumn: 2,
    span: 5,
    continuesBefore: false,
    continuesAfter: true,
  }]);

  const secondWeek = layoutCalendarWeek([spanning], new Date(2026, 2, 9));
  assert.deepEqual(secondWeek.segments.map(({ startColumn, span, continuesBefore, continuesAfter }) => ({
    startColumn,
    span,
    continuesBefore,
    continuesAfter,
  })), [{
    startColumn: 0,
    span: 2,
    continuesBefore: true,
    continuesAfter: false,
  }]);
});

test('overlapping events use separate lanes and overflow is counted per covered day', () => {
  const events = [
    event('long', at(2026, 3, 2), at(2026, 3, 5)),
    event('middle', at(2026, 3, 3), at(2026, 3, 4)),
    event('single', at(2026, 3, 4)),
  ];

  const full = layoutCalendarWeek(events, new Date(2026, 2, 2));
  assert.equal(full.laneCount, 3);
  assert.deepEqual(full.segments.map(({ event: item, lane }) => [item.id, lane]), [
    ['long', 0],
    ['middle', 1],
    ['single', 2],
  ]);

  const limited = layoutCalendarWeek(events, new Date(2026, 2, 2), { maxLanes: 2 });
  assert.equal(limited.segments.length, 2);
  assert.deepEqual(limited.overflowByDay, [0, 0, 1, 0, 0, 0, 0]);
});

test('week-view filtering lays out only multi-day events when requested', () => {
  const events = [
    event('span', at(2026, 3, 2), at(2026, 3, 3)),
    event('single', at(2026, 3, 2)),
  ];
  const layout = layoutCalendarWeek(events, new Date(2026, 2, 2), { multiDayOnly: true });
  assert.deepEqual(layout.segments.map(({ event: item }) => item.id), ['span']);
});
