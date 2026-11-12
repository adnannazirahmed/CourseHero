"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getLocalUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function updateProfile(formData: FormData) {
  const user = getLocalUser();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const goal = String(formData.get("goal") ?? "").trim().slice(0, 500);

  if (!name) {
    redirect("/profile?error=Add a display name first.");
  }

  getDb().prepare("UPDATE users SET name = ?, goal = ? WHERE id = ?").run(name, goal, user.id);
  revalidatePath("/", "layout");
  redirect("/profile?saved=1");
}
