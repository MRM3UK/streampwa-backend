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
    
    // Determine referer
    let referer;
    try {
      referer = new URL(decodedUrl).origin;
    } catch {
      referer = '';
    }

    if (decodedUrl.includes('cyberfile')) {
      referer = decodedUrl.includes('cyberfile.me') ? 'https://cyberfile.me/' : 
                decodedUrl.includes('cyberfile.su') ? 'https://cyberfile.su/' : referer;
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
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow'
    });

    // Forward important headers
    const headersToForward = [
      'content-type',
      'content-length', 
      'content-range',
      'accept-ranges',
      'content-disposition'
    ];

    headersToForward.forEach(header => {
      const value = response.headers.get(header);
      if (value) {
        res.setHeader(header, value);
      }
    });

    // Cache for 1 hour
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Set status
    res.status(response.status);

    // Stream response body
    if (req.method !== 'HEAD' && response.body) {
      response.body.pipe(res);
    } else {
      res.end();
    }

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Config for Vercel - allow large responses and streaming
module.exports.config = {
  api: {
    responseLimit: false,
    bodyParser: false
  }
};
