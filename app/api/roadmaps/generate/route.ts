import { NextResponse } from "next/server";
import { aiFailureMessage, aiJson, getAiStatus } from "@/lib/ai";
import { getLocalUser } from "@/lib/auth";
import { getCatalog } from "@/lib/data";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/password";
import { slugify } from "@/lib/plan";

function fallbackCourseIds(goal: string, courses: Array<{ id: string; title: string; description: string; author: string }>) {
  const words = goal.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
  return courses
    .map((course, index) => {
      const text = `${course.title} ${course.description} ${course.author}`.toLowerCase();
      const score = words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
      return { course, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5)
    .map((entry) => entry.course.id);
}

export async function POST(request: Request) {
  const user = getLocalUser();
  let body: { goal?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const goal = String(body.goal ?? "").trim().slice(0, 500);
  if (goal.length < 5) {
    return NextResponse.json({ error: "Describe the goal in a little more detail." }, { status: 400 });
  }

  const courses = getCatalog();
  if (courses.length === 0) {
    return NextResponse.json({ error: "Build at least one course before generating a roadmap." }, { status: 400 });
  }

  let title = goal.slice(0, 80);
  let description = `A local study path toward: ${goal}`;
  let courseIds: string[] = [];

  if (getAiStatus().configured) {
    const courseList = courses
      .map(
        (course, index) =>
          `${index}. ${course.title} — ${course.author} — ${Math.round(course.duration_seconds / 60)} min — ${course.description.slice(0, 220)}`,
      )
      .join("\n");
    const result = await aiJson<{
      title?: string;
      description?: string;
      courseIndexes?: number[];
      courseIds?: string[];
    }>({
      task: "roadmap",
      userId: user.id,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You design an ordered learning roadmap using only the available local courses. Output valid JSON only. Do not invent courses.",
        },
        {
          role: "user",
          content: `Learner goal: ${goal}\n\nAvailable courses:\n${courseList}\n\nChoose 2-6 courses in the order they should be studied. Prefer prerequisites first and avoid duplicates.\nReturn JSON: {"title":"","description":"","courseIndexes":[0,1]}`,
        },
      ],
    });
    if (result) {
      title = String(result.title ?? title).trim().slice(0, 100) || title;
      description = String(result.description ?? description).trim().slice(0, 500) || description;
      const indexes = Array.isArray(result.courseIndexes)
        ? result.courseIndexes.map((value) => Number(value))
        : [];
      courseIds = indexes
        .filter((index) => Number.isInteger(index) && index >= 0 && index < courses.length)
        .map((index) => courses[index].id)
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, 8);
    }
  }

  if (courseIds.length === 0) courseIds = fallbackCourseIds(goal, courses);
  if (courseIds.length === 0) {
    return NextResponse.json({ error: getAiStatus().configured ? aiFailureMessage() : "No matching courses found." }, { status: 400 });
  }

  const db = getDb();
  const id = newId("roadmap-");
  let slug = slugify(title, id.replace("roadmap-", "").slice(0, 5));
  if (db.prepare("SELECT id FROM roadmaps WHERE slug = ?").get(slug)) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO roadmaps (id, owner_id, title, slug, description, goal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(id, user.id, title, slug, description, goal, now);
    courseIds.forEach((courseId, index) => {
      db.prepare(
        "INSERT INTO roadmap_items (id, roadmap_id, course_id, position) VALUES (?, ?, ?, ?)",
      ).run(newId("roadmap-item-"), id, courseId, index);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return NextResponse.json({ slug, title, courseCount: courseIds.length, ai: getAiStatus().configured });
}
