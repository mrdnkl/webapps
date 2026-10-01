// USAGE: https://my-tv.<your-subdomain>.workers.dev/live/stream.m3u8?id=811
// Playlist: https://my-tv.<your-subdomain>.workers.dev/playlist.m3u
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
    const workerDomain = url.origin; // Dynamically gets your worker host (e.g., https://my-tv.worker.dev)

    // ==========================================
    // ROUTE 1: /playlist.m3u (Auto-generates full M3U)
    // ==========================================
    if (url.pathname === "/playlist.m3u") {
      try {
        const rawM3uText = await getOrFetchM3U();
        if (!rawM3uText) {
          return new Response("Error: Failed to fetch source M3U playlist.", { status: 502 });
        }

        // Convert the source playlist to point to our Worker endpoints
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
    // ROUTE 2: /live/stream.m3u8?id=... (Stream Player)
    // ==========================================
    if (url.pathname === "/live/stream.m3u8") {
      const streamId = url.searchParams.get("id");

      if (!streamId) {
        return new Response("Error: Missing 'id' parameter in query string.", { status: 400 });
      }

      try {
        const m3uText = await getOrFetchM3U();
        if (!m3uText) {
          return new Response("Error: Failed to fetch source M3U playlist.", { status: 502 });
        }

        let targetStreamUrl = parseM3UForId(m3uText, streamId);

        if (!targetStreamUrl) {
          return new Response(`Error: Stream ID '${streamId}' not found.`, { status: 404 });
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
 * Parses raw M3U text and replaces external stream links with Worker endpoint URLs
 */
function buildCustomM3U(rawM3u, workerDomain) {
  const lines = rawM3u.split("\n");
  const rewrittenLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // If the line is an HTTP stream URL
    if (line.startsWith("http")) {
      const streamId = extractStreamId(line);

      if (streamId) {
        // Rewrite to worker endpoint
        rewrittenLines.push(`${workerDomain}/live/stream.m3u8?id=${streamId}`);
      } else {
        // Keep original line if no stream ID could be parsed
        rewrittenLines.push(line);
      }
    } else {
      // Keep M3U headers, metadata (#EXTINF, #EXTGRP), and logos untouched
      rewrittenLines.push(line);
    }
  }

  return rewrittenLines.join("\n");
}

/**
 * Extracts stream ID from typical IPTV provider URLs
 * Examples: 
 *   http://example.tv/live/user/pass/811941.m3u8 -> 811941
 *   http://example.tv/play/live.php?stream=811941 -> 811941
 */
function extractStreamId(streamUrl) {
  try {
    const parsed = new URL(streamUrl);

    // 1. Check for query parameter 'stream' or 'id'
    if (parsed.searchParams.has("stream")) {
      return parsed.searchParams.get("stream");
    }
    if (parsed.searchParams.has("id")) {
      return parsed.searchParams.get("id");
    }

    // 2. Search for numeric ID in path filename (e.g. /811941.m3u8)
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
 * Locates matching stream URL by ID
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
