// ==========================================
// CONFIGURATION
// ==========================================
const SOURCE_M3U_URL = "https://example.tv/playlist.m3u";

// Cache duration in milliseconds (e.g., 10 minutes = 10 * 60 * 1000)
const CACHE_TTL_MS = 10 * 60 * 1000; 

// Global memory cache variables (persists across warm Worker requests)
let cachedM3UContent = null;
let lastFetchTime = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Endpoint: /live/stream.m3u8?id=811941
    if (url.pathname === "/live/stream.m3u8") {
      const streamId = url.searchParams.get("id");

      if (!streamId) {
        return new Response("Error: Missing 'id' parameter in query string.", { status: 400 });
      }

      try {
        // Step 1: Get M3U content (from Cache or Network)
        const m3uText = await getOrFetchM3U();

        if (!m3uText) {
          return new Response("Error: Failed to fetch source M3U playlist.", { status: 502 });
        }

        // Step 2: Extract target stream URL by stream ID
        let targetStreamUrl = parseM3UForId(m3uText, streamId);

        if (!targetStreamUrl) {
          return new Response(`Error: Stream ID '${streamId}' not found.`, { status: 404 });
        }

        // Step 3: Rewrite stream URL to use m3u8 extension
        targetStreamUrl = convertToM3U8Url(targetStreamUrl);

        // Step 4: Construct HLS M3U8 Response
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

    return new Response("M3U8 Builder Worker with Caching is active.", { status: 200 });
  }
};

/**
 * Helper 1: Handles in-memory caching logic for the source M3U file
 */
async function getOrFetchM3U() {
  const now = Date.now();

  // Check if cache exists and is still fresh (within TTL)
  if (cachedM3UContent && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedM3UContent;
  }

  // Cache expired or empty -> Fetch fresh copy from provider
  const response = await fetch(SOURCE_M3U_URL);
  if (!response.ok) {
    // If fetch fails but we have stale cache, return stale cache as a fallback
    if (cachedM3UContent) return cachedM3UContent;
    return null;
  }

  // Update cache memory and timestamp
  cachedM3UContent = await response.text();
  lastFetchTime = now;

  return cachedM3UContent;
}

/**
 * Helper 2: Parse M3U text and locate line matching stream ID
 */
function parseM3UForId(m3uContent, streamId) {
  const lines = m3uContent.split("\n");
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match lines starting with http containing stream=<streamId> or id=<streamId>
    if (line.startsWith("http") && (line.includes(`stream=${streamId}`) || line.includes(`/${streamId}`))) {
      return line;
    }
  }

  return null;
}

/**
 * Helper 3: Converts .ts references or query parameters to m3u8
 */
function convertToM3U8Url(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);

    // 1. Replace 'extension' query parameter if present (e.g., extension=ts -> extension=m3u8)
    if (parsedUrl.searchParams.has("extension")) {
      parsedUrl.searchParams.set("extension", "m3u8");
    }

    let updatedUrl = parsedUrl.toString();

    // 2. Fallback: Replace trailing .ts file extension in pathname if present
    if (parsedUrl.pathname.endsWith(".ts")) {
      updatedUrl = updatedUrl.replace(/\.ts(\?|$)/, ".m3u8$1");
    }

    return updatedUrl;
  } catch (e) {
    return rawUrl;
  }
}
