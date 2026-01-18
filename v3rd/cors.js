export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // 1. Get everything after the first "/"
    // .slice(1) removes the leading "/"
    let targetUrl = url.pathname.slice(1) + url.search;

    if (!targetUrl) {
      return new Response("Hello World!", { status: 400 });
    }

    // 2. Fix URL formatting (adds https:// if missing)
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    try {
      // 3. Setup the request to the target
      const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "*/*",
        },
      });

      const response = await fetch(proxyRequest);

      // 4. Inject CORS headers into the response
      const corsHeaders = new Headers(response.headers);
      corsHeaders.set("Access-Control-Allow-Origin", "*");
      corsHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
      corsHeaders.set("Access-Control-Allow-Headers", "*");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: corsHeaders,
      });
    } catch (err) {
      return new Response("Proxy Error: " + err.message, { status: 500 });
    }
  }
};
