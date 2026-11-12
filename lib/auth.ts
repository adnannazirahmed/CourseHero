import "server-only";
import { getDb } from "./db";

export type User = {
  id: string;
  name: string;
  email: string;
  goal: string;
  created_at: string;
};

export function getLocalUser(): User {
  const db = getDb();
  const users = db.prepare(
    "SELECT id, name, email, goal, created_at FROM users ORDER BY created_at ASC",
  ).all() as User[];
  const configuredId = process.env.COURSEIT_LOCAL_USER_ID?.trim();
  let user: User | undefined;

  if (configuredId) {
    user = users.find((item) => item.id === configuredId);
    if (!user) throw new Error("COURSEIT_LOCAL_USER_ID does not match a local profile.");
  } else {
    const personal = users.filter((item) => item.id !== "user-demo");
    if (personal.length > 1) {
      throw new Error("Multiple local profiles found. Set COURSEIT_LOCAL_USER_ID to choose one.");
    }
    user = personal[0] ?? users.find((item) => item.id === "user-demo") ?? users[0];
  }

  if (!user) throw new Error("No local profile found in the database.");
  return {
    ...user,
    name: user.id === "user-demo" && user.name === "Abhishek Kumar" ? "Learner" : user.name,
    goal: user.goal ?? "",
  };
}
