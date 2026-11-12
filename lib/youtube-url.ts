export function parseYouTubeUrl(raw: string): { videoId: string | null; playlistId: string | null } | null {
  const value = raw.trim();
  if (!value || value.length > 2048) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return { videoId: value, playlistId: null };

  let url: URL;
  try {
    url = new URL(value.startsWith("http") ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTube =
    host === "youtu.be" ||
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com";
  if (!isYouTube) return null;

  const rawPlaylistId = url.searchParams.get("list");
  const playlistId = rawPlaylistId && /^[A-Za-z0-9_-]{10,100}$/.test(rawPlaylistId)
    ? rawPlaylistId
    : null;
  let videoId: string | null = null;

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0]?.slice(0, 11) ?? null;
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v");
  } else {
    const match = url.pathname.match(/\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (match) videoId = match[2];
  }

  if (videoId && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) videoId = null;
  if (!videoId && !playlistId) return null;
  return { videoId, playlistId };
}
