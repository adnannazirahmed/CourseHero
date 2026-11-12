"use server";

import { redirect } from "next/navigation";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/password";
import { slugify } from "@/lib/plan";

export async function createRoadmap(formData: FormData) {
  const user = getLocalUser();
  const title = String(formData.get("title") ?? "").trim().slice(0, 100);
  const description = String(formData.get("description") ?? "").trim().slice(0, 500);
  const courseIds = formData.getAll("courseIds").map(String);

  if (!title) {
    redirect(`/roadmaps?error=${encodeURIComponent("Give the roadmap a title first.")}`);
  }

  const db = getDb();
  const courseRows = courseIds.length
    ? (db
        .prepare(
          `SELECT id FROM courses WHERE id IN (${courseIds.map(() => "?").join(",")}) AND status = 'ready'`,
        )
        .all(...courseIds) as Array<{ id: string }>)
    : [];
  if (courseRows.length === 0) {
    redirect(`/roadmaps?error=${encodeURIComponent("Pick at least one course for the roadmap.")}`);
  }

  const id = newId("roadmap-");
  let slug = slugify(title, id.replace("roadmap-", "").slice(0, 5));
  const existing = db.prepare("SELECT id FROM roadmaps WHERE slug = ?").get(slug);
  if (existing) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  db.prepare(
    "INSERT INTO roadmaps (id, owner_id, title, slug, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, user.id, title, slug, description, new Date().toISOString());

  courseRows.forEach((course, index) => {
    db.prepare(
      "INSERT INTO roadmap_items (id, roadmap_id, course_id, position) VALUES (?, ?, ?, ?)",
    ).run(newId("roadmap-item-"), id, course.id, index);
  });

  redirect(`/roadmap/${slug}`);
}

export async function enrollInRoadmap(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const user = getLocalUser();
  const db = getDb();
  const roadmap = db
    .prepare("SELECT id FROM roadmaps WHERE slug = ?")
    .get(slug) as { id: string } | undefined;
  if (!roadmap) redirect("/roadmaps");

  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR IGNORE INTO roadmap_enrollments (id, roadmap_id, user_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(newId("roadmap-enroll-"), roadmap.id, user.id, now);

  const items = db
    .prepare("SELECT course_id FROM roadmap_items WHERE roadmap_id = ?")
    .all(roadmap.id) as Array<{ course_id: string }>;
  for (const item of items) {
    db.prepare(
      "INSERT OR IGNORE INTO enrollments (id, user_id, course_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(newId("enroll-"), user.id, item.course_id, now);
  }

  redirect(`/roadmap/${slug}?enrolled=1`);
}
