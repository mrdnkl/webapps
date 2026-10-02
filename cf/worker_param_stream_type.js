// ==========================================
// CONFIGURATION
// ==========================================
const SOURCE_M3U_URL = "https://example.tv/playlist.m3u";

// Cache duration: 10 minutes
const CACHE_TTL_MS = 10 * 60 * 1000; 

// Global memory cache variables
let cachedM3UContent = null;
let lastFetchTime = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const workerDomain = url.origin;

    // ==========================================
    // ROUTE 1: /playlist.m3u (Auto-generates full M3U)
    // ==========================================
    if (url.pathname === "/playlist.m3u") {
      try {
        const rawM3uText = await getOrFetchM3U();
        if (!rawM3uText) {
          return new Response("Error: Failed to fetch source M3U playlist.", { status: 502 });
        }

        // Convert playlist links to use Worker endpoint with .m3u8 parameter suffix
        const generatedM3u = buildCustomM3U(rawM3uText, workerDomain);

        return new Response(generatedM3u, {
          headers: {
            "Content-Type": "audio/x-mpegurl",
            "Content-Disposition": 'inline; filename="playlist.m3u"',
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
          }
        });

      } catch (err) {
        return new Response(`Worker Error: ${err.message}`, { status: 500 });
      }
    }

    // ==========================================
    // ROUTE 2: /live/stream.m3u8?id=811941.m3u8
    // ==========================================
    if (url.pathname === "/live/stream") {
      const rawStreamId = url.searchParams.get("id");

      if (!rawStreamId) {
        return new Response("Error: Missing 'id' parameter in query string.", { status: 400 });
      }

      // Clean ID parameter (e.g., "811941.m3u8" -> "811941")
      const cleanStreamId = sanitizeStreamId(rawStreamId);

      try {
        const m3uText = await getOrFetchM3U();
        if (!m3uText) {
          return new Response("Error: Failed to fetch source M3U playlist.", { status: 502 });
        }

        let targetStreamUrl = parseM3UForId(m3uText, cleanStreamId);

        if (!targetStreamUrl) {
          return new Response(`Error: Stream ID '${cleanStreamId}' not found.`, { status: 404 });
        }

        targetStreamUrl = convertToM3U8Url(targetStreamUrl);

        const m3u8Content = [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          "#EXT-X-STREAM-INF:PROGRAM-ID=1,AVERAGE-BANDWIDTH=2200000,BANDWIDTH=2200000",
          targetStreamUrl
        ].join("\n");

        return new Response(m3u8Content, {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
          }
        });

      } catch (err) {
        return new Response(`Worker Error: ${err.message}`, { status: 500 });
      }
    }

    return new Response("M3U8 Builder Worker is active. Load /playlist.m3u in your IPTV app.", { status: 200 });
  }
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Strips extensions like .m3u8 or .ts from the ID parameter
 * Example: "811941.m3u8" -> "811941"
 */
function sanitizeStreamId(idParam) {
  return idParam.replace(/\.(m3u8|ts|mpd|m3u)$/i, "");
}

/**
 * Rewrites source playlist URLs to use /live/stream.m3u8?id=811941.m3u8
 */
function buildCustomM3U(rawM3u, workerDomain) {
  const lines = rawM3u.split("\n");
  const rewrittenLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("http")) {
      const streamId = extractStreamId(line);

      if (streamId) {
        // Appends .m3u8 extension to query parameter
        rewrittenLines.push(`${workerDomain}/live/stream?id=${streamId}.m3u8`);
      } else {
        rewrittenLines.push(line);
      }
    } else {
      rewrittenLines.push(line);
    }
  }

  return rewrittenLines.join("\n");
}

/**
 * Extracts raw stream ID from IPTV provider URLs
 */
function extractStreamId(streamUrl) {
  try {
    const parsed = new URL(streamUrl);

    if (parsed.searchParams.has("stream")) {
      return sanitizeStreamId(parsed.searchParams.get("stream"));
    }
    if (parsed.searchParams.has("id")) {
      return sanitizeStreamId(parsed.searchParams.get("id"));
    }

    const pathSegments = parsed.pathname.split("/");
    const lastSegment = pathSegments[pathSegments.length - 1];
    const match = lastSegment.match(/(\d+)/);

    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Memory cache handler for the source M3U file
 */
async function getOrFetchM3U() {
  const now = Date.now();

  if (cachedM3UContent && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedM3UContent;
  }

  const response = await fetch(SOURCE_M3U_URL);
  if (!response.ok) {
    if (cachedM3UContent) return cachedM3UContent;
    return null;
  }

  cachedM3UContent = await response.text();
  lastFetchTime = now;

  return cachedM3UContent;
}

/**
 * Locates matching stream URL by raw ID
 */
function parseM3UForId(m3uContent, streamId) {
  const lines = m3uContent.split("\n");
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("http") && (line.includes(`stream=${streamId}`) || line.includes(`/${streamId}`))) {
      return line;
    }
  }

  return null;
}

/**
 * Converts parameter extension=ts to extension=m3u8
 */
function convertToM3U8Url(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);

    if (parsedUrl.searchParams.has("extension")) {
      parsedUrl.searchParams.set("extension", "m3u8");
    }

    let updatedUrl = parsedUrl.toString();

    if (parsedUrl.pathname.endsWith(".ts")) {
      updatedUrl = updatedUrl.replace(/\.ts(\?|$)/, ".m3u8$1");
    }

    return updatedUrl;
  } catch (e) {
    return rawUrl;
  }
}
