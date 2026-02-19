const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    
    // Determine referer based on URL
    let referer = new URL(decodedUrl).origin;
    if (decodedUrl.includes('cyberfile')) {
      referer = 'https://cyberfile.me/';
    } else if (decodedUrl.includes('pixeldrain')) {
      referer = 'https://pixeldrain.com/';
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': referer,
      'Origin': referer
    };

    // Forward range header for video seeking
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await fetch(decodedUrl, {
      method: req.method,
      headers,
      redirect: 'follow'
    });

    // Forward response headers
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=3600');

    res.status(response.status);

    // Stream the response
    response.body.pipe(res);

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Vercel config for streaming
module.exports.config = {
  api: {
    responseLimit: false,
    bodyParser: false
  }
};
