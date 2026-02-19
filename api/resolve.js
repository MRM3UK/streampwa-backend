const fetch = require('node-fetch');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url, type } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  try {
    let result;

    if (type === 'pixeldrain' || url.includes('pixeldrain.com')) {
      result = await resolvePixeldrain(url);
    } else if (type === 'cyberfile' || url.includes('cyberfile')) {
      result = await resolveCyberfile(url);
    } else {
      result = { 
        success: true, 
        directUrl: url, 
        type: 'direct',
        embedUrl: url 
      };
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Resolve error:', error);
    return res.status(500).json({ 
      error: error.message,
      fallbackEmbed: url 
    });
  }
};

// Pixeldrain resolver
async function resolvePixeldrain(url) {
  // Extract file ID from various Pixeldrain URL formats
  let fileId = null;

  // Pattern: /u/FILEID or /api/file/FILEID
  const patterns = [
    /pixeldrain\.com\/u\/([a-zA-Z0-9]+)/,
    /pixeldrain\.com\/api\/file\/([a-zA-Z0-9]+)/,
    /pixeldrain\.com\/l\/([a-zA-Z0-9]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      fileId = match[1];
      break;
    }
  }

  if (!fileId) {
    throw new Error('Invalid Pixeldrain URL');
  }

  // Get file info from Pixeldrain API
  const infoUrl = `https://pixeldrain.com/api/file/${fileId}/info`;
  
  try {
    const infoRes = await fetch(infoUrl);
    const info = await infoRes.json();

    if (info.success === false) {
      throw new Error(info.message || 'File not found');
    }

    // Direct download/stream URL
    const directUrl = `https://pixeldrain.com/api/file/${fileId}`;
    const embedUrl = `https://pixeldrain.com/u/${fileId}?embed`;
    
    return {
      success: true,
      type: 'pixeldrain',
      fileId: fileId,
      directUrl: directUrl,
      embedUrl: embedUrl,
      downloadUrl: `${directUrl}?download`,
      info: {
        name: info.name,
        size: info.size,
        mimeType: info.mime_type,
        views: info.views,
        dateUpload: info.date_upload
      }
    };
  } catch (error) {
    // Fallback to basic URLs
    return {
      success: true,
      type: 'pixeldrain',
      fileId: fileId,
      directUrl: `https://pixeldrain.com/api/file/${fileId}`,
      embedUrl: `https://pixeldrain.com/u/${fileId}?embed`,
      downloadUrl: `https://pixeldrain.com/api/file/${fileId}?download`
    };
  }
}

// Cyberfile resolver
async function resolveCyberfile(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': url
  };

  // Fetch the main page
  const response = await fetch(url, { headers, redirect: 'follow' });
  const html = await response.text();
  const $ = cheerio.load(html);

  let directUrl = null;
  let embedUrl = null;

  // Method 1: Look for video source directly
  $('video source').each((i, el) => {
    const src = $(el).attr('src');
    if (src && (src.includes('.mp4') || src.includes('.m3u8'))) {
      directUrl = src;
    }
  });

  // Method 2: Look for video tag src
  if (!directUrl) {
    $('video').each((i, el) => {
      const src = $(el).attr('src');
      if (src) directUrl = src;
    });
  }

  // Method 3: Look for player iframe
  if (!directUrl) {
    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && (src.includes('player') || src.includes('embed') || src.includes('video'))) {
        embedUrl = src.startsWith('//') ? 'https:' + src : src;
      }
    });
  }

  // Method 4: Search in scripts for video URLs
  if (!directUrl) {
    const scripts = $('script').text();
    
    // Look for various patterns
    const patterns = [
      /file:\s*["']([^"']+\.mp4[^"']*)/i,
      /source:\s*["']([^"']+\.mp4[^"']*)/i,
      /src:\s*["']([^"']+\.mp4[^"']*)/i,
      /videoUrl:\s*["']([^"']+)/i,
      /streamUrl:\s*["']([^"']+)/i,
      /"file"\s*:\s*"([^"]+)"/i,
      /player\.src\s*\(\s*{\s*src:\s*["']([^"']+)/i,
      /sources:\s*\[\s*{\s*src:\s*["']([^"']+)/i,
      /https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi
    ];

    for (const pattern of patterns) {
      const match = scripts.match(pattern);
      if (match) {
        directUrl = match[1] || match[0];
        if (directUrl && !directUrl.startsWith('http')) {
          directUrl = null;
          continue;
        }
        break;
      }
    }
  }

  // Method 5: Look for download links
  if (!directUrl) {
    $('a[href*=".mp4"], a[href*="download"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('.mp4')) {
        directUrl = href.startsWith('http') ? href : new URL(href, url).href;
      }
    });
  }

  // Method 6: Look for JWPlayer setup
  if (!directUrl) {
    const scripts = $('script').text();
    const jwMatch = scripts.match(/jwplayer\([^)]+\)\.setup\(({[\s\S]*?})\)/);
    if (jwMatch) {
      try {
        // Try to parse JWPlayer config
        const configStr = jwMatch[1].replace(/'/g, '"');
        const fileMatch = configStr.match(/"file"\s*:\s*"([^"]+)"/);
        if (fileMatch) {
          directUrl = fileMatch[1];
        }
      } catch (e) {}
    }
  }

  if (directUrl) {
    // Make URL absolute if needed
    if (!directUrl.startsWith('http')) {
      directUrl = new URL(directUrl, url).href;
    }

    return {
      success: true,
      type: 'cyberfile',
      directUrl: directUrl,
      embedUrl: embedUrl || url,
      needsProxy: true
    };
  }

  if (embedUrl) {
    return {
      success: true,
      type: 'cyberfile',
      directUrl: null,
      embedUrl: embedUrl,
      iframeOnly: true
    };
  }

  // Return iframe fallback
  return {
    success: false,
    type: 'cyberfile',
    error: 'Could not extract direct URL',
    embedUrl: url,
    iframeOnly: true
  };
}
