import "server-only";
import { YoutubeTranscript } from "youtube-transcript";

export type Chapter = { title: string; startSeconds: number };
export type VideoMeta = {
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  durationSeconds: number;
  description: string;
  chapters: Chapter[];
};
export type TranscriptItem = { text: string; offset: number; duration: number };
export type PlaylistVideo = { videoId: string; title: string; durationSeconds: number };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function extractJson(html: string, marker: string): unknown {
  const index = html.indexOf(marker);
  if (index === -1) return null;
  const start = html.indexOf("{", index);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function textOf(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) {
    return node.runs
      .map((run) => (run && typeof run === "object" && typeof (run as { text?: string }).text === "string"
        ? (run as { text: string }).text
        : ""))
      .join("");
  }
  return "";
}

function clockToSeconds(value: string): number {
  const parts = value
    .trim()
    .split(":")
    .map((part) => Number(part.replace(/[^0-9]/g, "")) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function collectChaptersFromPlayer(player: unknown): Chapter[] {
  const chapters: Chapter[] = [];
  try {
    const panels =
      (player as { engagementPanels?: Array<Record<string, unknown>> })?.engagementPanels ?? [];
    for (const panel of panels) {
      const section = (panel as Record<string, unknown>)
        ?.engagementPanelSectionListRenderer as Record<string, unknown> | undefined;
      const list = (section?.content as Record<string, unknown> | undefined)
        ?.macroMarkersListRenderer as Record<string, unknown> | undefined;
      const contents = list?.contents;
      if (!Array.isArray(contents)) continue;
      for (const item of contents) {
        const renderer = (item as Record<string, unknown>)
          ?.macroMarkersListItemRenderer as Record<string, unknown> | undefined;
        if (!renderer) continue;
        const title = textOf(renderer.title);
        const time = textOf(renderer.timeDescription);
        if (title && time) {
          chapters.push({ title, startSeconds: clockToSeconds(time) });
        }
      }
    }
  } catch {
    // ignore malformed panels
  }
  return chapters;
}

function parseDescriptionChapters(description: string): Chapter[] {
  const chapters: Chapter[] = [];
  const lines = description.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|]?\s*(.{2,120})$/);
    if (!match) continue;
    const title = match[2].replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) continue;
    chapters.push({ title, startSeconds: clockToSeconds(match[1]) });
  }
  const seen = new Set<number>();
  return chapters
    .filter((chapter) => {
      if (seen.has(chapter.startSeconds)) return false;
      seen.add(chapter.startSeconds);
      return true;
    })
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .slice(0, 40);
}

export async function fetchVideoMeta(videoId: string): Promise<VideoMeta> {
  let oembed: { title?: string; author_name?: string; thumbnail_url?: string } = {};
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (response.ok) oembed = await response.json();
  } catch {
    // Metadata still comes from the watch page below.
  }

  let title = oembed.title ?? "YouTube course";
  let author = oembed.author_name ?? "YouTube creator";
  let durationSeconds = 0;
  let description = "";
  let chapters: Chapter[] = [];

  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`, {
      headers: {
        "user-agent": UA,
        "accept-language": "en-US,en;q=0.9",
        cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAI",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const html = await response.text();
      const player = extractJson(html, "ytInitialPlayerResponse") as
        | { videoDetails?: Record<string, unknown> }
        | null;
      const details = player?.videoDetails;
      if (details) {
        if (typeof details.title === "string" && details.title) title = details.title;
        if (typeof details.author === "string" && details.author) author = details.author;
        if (details.lengthSeconds) durationSeconds = Number(details.lengthSeconds) || 0;
        if (typeof details.shortDescription === "string") description = details.shortDescription;
      }
      chapters = collectChaptersFromPlayer(player);
      if (chapters.length < 2) chapters = parseDescriptionChapters(description);
    }
  } catch {
    // Fall back to oEmbed metadata.
  }

  const thumbnail =
    oembed.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  return {
    videoId,
    title: title.slice(0, 180),
    author: author.slice(0, 120),
    thumbnail,
    durationSeconds,
    description,
    chapters: chapters.filter((chapter) => chapter.startSeconds < Math.max(3600, durationSeconds || Infinity)),
  };
}

export async function fetchTranscript(videoId: string): Promise<TranscriptItem[]> {
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    return items
      .map((item) => ({
        text: String(item.text ?? "").replace(/\s+/g, " ").trim(),
        // youtube-transcript reports offsets and durations in milliseconds.
        offset: Math.round(Number(item.offset ?? 0) / 1000),
        duration: Math.round(Number(item.duration ?? 0) / 1000),
      }))
      .filter((item) => item.text.length > 0);
  } catch {
    return [];
  }
}

function collectPlaylistVideos(data: unknown, out: PlaylistVideo[], depth = 0) {
  if (!data || typeof data !== "object" || depth > 12) return;
  if (Array.isArray(data)) {
    for (const item of data) collectPlaylistVideos(item, out, depth + 1);
    return;
  }
  const node = data as Record<string, unknown>;
  const renderer = node.playlistVideoRenderer as Record<string, unknown> | undefined;
  if (renderer && typeof renderer.videoId === "string") {
    const title = textOf(renderer.title) || "Untitled video";
    const length = textOf(renderer.lengthText);
    out.push({
      videoId: renderer.videoId,
      title,
      durationSeconds: clockToSeconds(length),
    });
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") collectPlaylistVideos(value, out, depth + 1);
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .trim();
}

async function fetchPlaylistRss(playlistId: string): Promise<{
  title: string;
  author: string;
  videos: PlaylistVideo[];
} | null> {
  try {
    const response = await fetch(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`,
      {
        headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) return null;
    const xml = await response.text();
    const head = xml.split("<entry>")[0];
    const titleMatch = head.match(/<title>([\s\S]*?)<\/title>/);
    const authorMatch = head.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/);
    const videos: PlaylistVideo[] = [];
    for (const entry of xml.split("<entry>").slice(1)) {
      const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim();
      if (!videoId) continue;
      const title =
        entry.match(/<media:title>([\s\S]*?)<\/media:title>/)?.[1] ??
        entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ??
        "Untitled video";
      const duration = Number(
        entry.match(/<media:content[^>]*duration="(\d+)"/)?.[1] ?? 0,
      );
      videos.push({
        videoId,
        title: decodeXml(title),
        durationSeconds: Number.isFinite(duration) ? duration : 0,
      });
    }
    if (videos.length === 0) return null;
    return {
      title: decodeXml(titleMatch?.[1] ?? "YouTube playlist"),
      author: decodeXml(authorMatch?.[1] ?? "YouTube creator"),
      videos,
    };
  } catch {
    return null;
  }
}

export async function fetchPlaylist(playlistId: string): Promise<{
  title: string;
  author: string;
  thumbnail: string;
  videos: PlaylistVideo[];
}> {
  let title = "YouTube playlist";
  let author = "YouTube creator";
  let thumbnail = "";
  let videos: PlaylistVideo[] = [];

  try {
    const response = await fetch(`https://www.youtube.com/playlist?list=${playlistId}&hl=en&gl=US`, {
      headers: {
        "user-agent": UA,
        "accept-language": "en-US,en;q=0.9",
        cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAI",
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (response.ok) {
      const html = await response.text();
      const data = extractJson(html, "ytInitialData");
      collectPlaylistVideos(data, videos);
      const seen = new Set<string>();
      videos = videos.filter((video) => {
        if (seen.has(video.videoId)) return false;
        seen.add(video.videoId);
        return true;
      });

      const header = extractJson(html, "ytInitialPlayerResponse") as
        | { playlistData?: { playlistHeaderRenderer?: Record<string, unknown> } }
        | null;
      const headerRenderer = header?.playlistData?.playlistHeaderRenderer;
      if (headerRenderer) {
        title = textOf(headerRenderer.title) || title;
        author =
          textOf(headerRenderer.ownerText) ||
          textOf(headerRenderer.owner) ||
          author;
      }
      if (!thumbnail && videos[0]) {
        thumbnail = `https://i.ytimg.com/vi/${videos[0].videoId}/maxresdefault.jpg`;
      }
    }
  } catch {
    // The caller handles an empty playlist.
  }

  // YouTube's current playlist layout often hides the legacy renderer; the public
  // RSS feed is a stable fallback and includes every public video's id and title.
  if (videos.length === 0) {
    const rss = await fetchPlaylistRss(playlistId);
    if (rss) {
      title = rss.title;
      author = rss.author;
      videos = rss.videos;
      thumbnail = `https://i.ytimg.com/vi/${rss.videos[0].videoId}/maxresdefault.jpg`;
    }
  }

  return { title, author, thumbnail, videos: videos.slice(0, 80) };
}
