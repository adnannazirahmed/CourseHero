import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { generateCoach } from "@/lib/coach";

export async function POST(request: Request) {
  const user = getLocalUser();
  let force = false;
  try {
    const body = (await request.json()) as { refresh?: boolean };
    force = body.refresh === true;
  } catch {
    // A refresh is optional.
  }
  const content = await generateCoach(user.id, force);
  return NextResponse.json(content);
}
