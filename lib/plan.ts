export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (h > 0) return `${h}h`;
  return `${Math.max(1, m)}m`;
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function parseClock(value: string): number {
  const parts = value
    .trim()
    .split(":")
    .map((part) => Number(part.replace(/[^0-9]/g, "")) || 0);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export type PlanLesson = {
  id: string;
  title: string;
  start_seconds: number;
  end_seconds: number;
  position: number;
  video_id?: string | null;
};

export type PlanDay = {
  day: number;
  totalSeconds: number;
  lessons: PlanLesson[];
};

export function buildPlan(
  lessons: PlanLesson[],
  paceMinutes: number,
  skippedIds: Set<string>,
  completedIds: Set<string>,
): PlanDay[] {
  const remaining = lessons.filter(
    (lesson) => !skippedIds.has(lesson.id) && !completedIds.has(lesson.id),
  );
  const budget = Math.max(15, paceMinutes) * 60;
  const days: PlanDay[] = [];
  let current: PlanDay = { day: 1, totalSeconds: 0, lessons: [] };

  for (const lesson of remaining) {
    const length = Math.max(60, lesson.end_seconds - lesson.start_seconds);
    if (current.lessons.length > 0 && current.totalSeconds + length > budget) {
      days.push(current);
      current = { day: days.length + 1, totalSeconds: 0, lessons: [] };
    }
    current.lessons.push(lesson);
    current.totalSeconds += length;
  }
  if (current.lessons.length > 0) days.push(current);
  return days;
}

export function planForTargetDays(
  lessons: PlanLesson[],
  targetDays: number,
  skippedIds: Set<string>,
  completedIds: Set<string>,
): PlanDay[] {
  const days = Math.min(30, Math.max(1, Math.round(Number(targetDays) || 7)));
  const remaining = lessons.filter(
    (lesson) => !skippedIds.has(lesson.id) && !completedIds.has(lesson.id),
  );
  if (remaining.length === 0) return [];
  const totalSeconds = remaining.reduce(
    (total, lesson) => total + Math.max(60, lesson.end_seconds - lesson.start_seconds),
    0,
  );
  const paceMinutes = Math.max(5, Math.ceil(totalSeconds / 60 / days));
  const plan = buildPlan(lessons, paceMinutes, skippedIds, completedIds);
  if (plan.length <= days) return plan;
  // Never propose more days than the learner chose. Fold any overflow into the last day.
  const head = plan.slice(0, days - 1);
  const tail = plan.slice(days - 1);
  head.push({
    day: days,
    totalSeconds: tail.reduce((total, day) => total + day.totalSeconds, 0),
    lessons: tail.flatMap((day) => day.lessons),
  });
  return head;
}

export function dailyMinutesForTarget(
  lessons: PlanLesson[],
  targetDays: number,
  skippedIds: Set<string>,
  completedIds: Set<string>,
): number {
  const plan = planForTargetDays(lessons, targetDays, skippedIds, completedIds);
  if (plan.length === 0) return 0;
  return Math.max(...plan.map((day) => Math.ceil(day.totalSeconds / 60)));
}

export function localDateKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function calculateStreak(activityDates: string[]): number {
  if (activityDates.length === 0) return 0;
  const unique = new Set(activityDates.map(localDateKey));
  const cursor = new Date();
  let streak = 0;
  // A streak stays alive if you studied today or yesterday.
  if (!unique.has(dayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!unique.has(dayKey(cursor))) return 0;
  }
  while (unique.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function slugify(value: string, suffix = ""): string {
  const base = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "course"}${suffix ? `-${suffix}` : ""}`;
}
