// USAGE: // Stream: https://my-tv.<your-subdomain>.workers.dev/live/stream.m3u8?id=811
// ==========================================
// CONFIGURATION
// ==========================================
const SOURCE_M3U_URL = "https://example.tv/playlist.m3u";

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
        // Step 1: Fetch source M3U content
        const m3uResponse = await fetch(SOURCE_M3U_URL);
        if (!m3uResponse.ok) {
          return new Response("Error: Failed to fetch source M3U playlist.", { status: 502 });
        }

        const m3uText = await m3uResponse.text();

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

    return new Response("M3U8 Builder Worker is active.", { status: 200 });
  }
};

/**
 * Helper 1: Parse M3U text and locate line matching stream ID
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
 * Helper 2: Converts .ts references or query parameters to m3u8
 */
function convertToM3U8Url(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);

    // 1. Check and replace 'extension' query parameter if present (e.g., extension=ts -> extension=m3u8)
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
    // Return original string if URL parsing fails
    return rawUrl;
  }
}
