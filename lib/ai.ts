import "server-only";
import { getDb } from "./db";
import { newId } from "./password";

export type AiTask =
  | "course"
  | "playlist"
  | "lesson"
  | "tutor"
  | "notes"
  | "coach"
  | "roadmap";

export type AiStatus = {
  configured: boolean;
  model: string;
  fastModel: string;
  baseUrl: string;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type CallOptions = {
  task: AiTask;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  userId?: string;
};

const DEFAULT_BASE_URL = "https://freebuff.com/api/v1/paid";
const FAST_TASKS = new Set<AiTask>(["tutor", "notes", "coach"]);

export function getAiStatus(): AiStatus {
  const model = String(process.env.AI_MODEL ?? "").trim();
  const fastModel = String(process.env.AI_FAST_MODEL ?? "").trim() || model;
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  return {
    configured: Boolean(apiKey && model),
    model,
    fastModel,
    baseUrl: (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
  };
}

function modelFor(task: AiTask, status: AiStatus): string {
  return FAST_TASKS.has(task) && status.fastModel ? status.fastModel : status.model;
}

function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function recordUsage(
  userId: string | undefined,
  task: AiTask,
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
) {
  if (!userId) return;
  try {
    getDb()
      .prepare(
        `INSERT INTO ai_usage (id, user_id, task, model, prompt_tokens, completion_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId("ai-usage-"),
        userId,
        task,
        model,
        Math.max(0, Number(usage?.prompt_tokens) || 0),
        Math.max(0, Number(usage?.completion_tokens) || 0),
        new Date().toISOString(),
      );
  } catch (error) {
    console.warn("[ai] usage logging failed", error);
  }
}

async function callModel(options: CallOptions): Promise<string | null> {
  const status = getAiStatus();
  if (!status.configured) return null;
  const model = modelFor(options.task, status);
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  const body: Record<string, unknown> = {
    model,
    temperature: options.temperature ?? 0.3,
    messages: options.messages,
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.json) body.response_format = { type: "json_object" };

  async function send(includeJsonMode: boolean) {
    return fetch(`${status.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(
        includeJsonMode ? body : Object.fromEntries(Object.entries(body).filter(([key]) => key !== "response_format")),
      ),
      signal: AbortSignal.timeout(120_000),
    });
  }

  try {
    let response = await send(options.json === true);
    // Some OpenAI-compatible endpoints reject response_format. Retry once without it.
    if (response.status === 400 && options.json) response = await send(false);
    if (!response.ok) {
      console.warn("[ai] request failed", options.task, response.status, (await response.text()).slice(0, 800));
      return null;
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    recordUsage(options.userId, options.task, model, payload.usage);
    return payload.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.warn("[ai] request error", options.task, error);
    return null;
  }
}

export async function aiText(options: Omit<CallOptions, "json">): Promise<string | null> {
  const text = await callModel({ ...options, json: false });
  return text?.trim() || null;
}

export async function aiJson<T>(options: Omit<CallOptions, "json">): Promise<T | null> {
  const text = await callModel({ ...options, json: true });
  if (!text) return null;
  return extractJson(text) as T | null;
}

export function aiFailureMessage(): string {
  return getAiStatus().configured
    ? "The AI request failed. Check the terminal for the provider response, then try again."
    : "AI is not configured. Add AI_API_KEY and AI_MODEL to .env, then restart the app.";
}
