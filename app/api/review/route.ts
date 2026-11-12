import { NextResponse } from "next/server";
import { getLocalUser } from "@/lib/auth";
import { answerReview } from "@/lib/reviews";

export async function POST(request: Request) {
  const user = getLocalUser();
  let body: { reviewId?: string; answerIndex?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const answerIndex = Number(body.answerIndex);
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
    return NextResponse.json({ error: "Choose an answer." }, { status: 400 });
  }
  const result = answerReview(user.id, String(body.reviewId ?? ""), answerIndex);
  if (!result) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  return NextResponse.json(result);
}
