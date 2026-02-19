const fetch = require('node-fetch');
const cheerio = require('cheerio');

// CORS middleware
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
}

module.exports = async (req, res) => {
  cors(res);

  // Handle preflight
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
      result = await resolvePixeldrain(url, req);
    } else if (type === 'cyberfile' || url.includes('cyberfile')) {
      result = await resolveCyberfile(url, req);
    } else {
      result = { 
        success: true, 
        directUrl: url, 
        type: 'direct',
        proxyUrl: `${getBaseUrl(req)}/api/proxy?url=${encodeURIComponent(url)}`
      };
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Resolve error:', error);
    return res.status(500).json({ 
      error: error.message,
      iframeUrl: url,
      iframeOnly: true
    });
  }
};

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Pixeldrain resolver
async function resolvePixeldrain(url, req) {
  let fileId = null;

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

  const baseUrl = getBaseUrl(req);
  const directUrl = `https://pixeldrain.com/api/file/${fileId}`;
  
  // Try to get file info
  let info = null;
  try {
    const infoRes = await fetch(`https://pixeldrain.com/api/file/${fileId}/info`);
    if (infoRes.ok) {
      info = await infoRes.json();
    }
  } catch (e) {}

  return {
    success: true,
    type: 'pixeldrain',
    fileId: fileId,
    directUrl: directUrl,
    proxyUrl: `${baseUrl}/api/proxy?url=${encodeURIComponent(directUrl)}`,
    embedUrl: `https://pixeldrain.com/u/${fileId}?embed`,
    downloadUrl: `${directUrl}?download`,
    info: info ? {
      name: info.name,
      size: info.size,
      mimeType: info.mime_type
    } : null,
    sources: [{
      url: directUrl,
      proxyUrl: `${baseUrl}/api/proxy?url=${encodeURIComponent(directUrl)}`,
      quality: 'default'
    }]
  };
}

// Cyberfile resolver
async function resolveCyberfile(url, req) {
  const baseUrl = getBaseUrl(req);
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': url
  };

  // Fetch main page
  let response = await fetch(url, { headers, redirect: 'follow' });
  let html = await response.text();
  let $ = cheerio.load(html);

  // Check for form submission (countdown page)
  const form = $('form[method="post"]').first();
  if (form.length > 0 && form.find('input[name="op"]').length > 0) {
    const formData = new URLSearchParams();
    form.find('input').each((i, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || '';
      if (name) formData.append(name, value);
    });

    // Wait for countdown
    await new Promise(r => setTimeout(r, 2000));

    const formAction = form.attr('action') || url;
    const postUrl = formAction.startsWith('http') ? formAction : new URL(formAction, url).href;

    response = await fetch(postUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': url
      },
      body: formData.toString(),
      redirect: 'follow'
    });

    html = await response.text();
    $ = cheerio.load(html);
  }

  // Extract video sources
  const sources = [];
  const scriptContent = $('script').text();

  // Method 1: Video tag
  $('video source, video[src]').each((i, el) => {
    const src = $(el).attr('src');
    if (src && isVideoUrl(src)) {
      sources.push({ url: makeAbsolute(src, url), quality: $(el).attr('label') || 'video' });
    }
  });

  // Method 2: JWPlayer
  const jwMatch = scriptContent.match(/sources:\s*\[([\s\S]*?)\]/);
  if (jwMatch) {
    const fileMatches = jwMatch[1].match(/file:\s*["']([^"']+)["']/g);
    if (fileMatches) {
      fileMatches.forEach(m => {
        const url = m.match(/["']([^"']+)["']/);
        if (url && isVideoUrl(url[1])) {
          sources.push({ url: url[1], quality: 'jwplayer' });
        }
      });
    }
  }

  // Method 3: Direct URL patterns
  const urlPatterns = [
    /"file"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/gi,
    /source:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
    /src:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
    /https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*/gi
  ];

  for (const pattern of urlPatterns) {
    let match;
    const text = html + scriptContent;
    while ((match = pattern.exec(text)) !== null) {
      const videoUrl = match[1] || match[0];
      if (isVideoUrl(videoUrl) && !sources.find(s => s.url === videoUrl)) {
        sources.push({ url: videoUrl, quality: 'extracted' });
      }
    }
  }

  // Method 4: Packed JavaScript
  const packedMatch = scriptContent.match(/eval\(function\(p,a,c,k,e,[dr]\).*?\)\)/);
  if (packedMatch) {
    try {
      const unpacked = unpack(packedMatch[0]);
      const videoMatch = unpacked.match(/https?:\/\/[^\s"']+\.(?:mp4|m3u8)[^\s"']*/);
      if (videoMatch && !sources.find(s => s.url === videoMatch[0])) {
        sources.push({ url: videoMatch[0], quality: 'packed' });
      }
    } catch (e) {}
  }

  // Method 5: Download links
  $('a[href*=".mp4"], a.download-btn, a[href*="download"]').each((i, el) => {
    const href = $(el).attr('href');
    if (href && isVideoUrl(href)) {
      sources.push({ url: makeAbsolute(href, url), quality: 'download' });
    }
  });

  // Method 6: Iframe embeds
  let embedUrl = null;
  $('iframe[src*="player"], iframe[src*="embed"], iframe[src*="video"]').each((i, el) => {
    const src = $(el).attr('src');
    if (src) {
      embedUrl = makeAbsolute(src, url);
    }
  });

  // Deduplicate sources
  const uniqueSources = [];
  const seen = new Set();
  for (const source of sources) {
    if (!seen.has(source.url) && source.url.startsWith('http')) {
      seen.add(source.url);
      uniqueSources.push({
        url: source.url,
        proxyUrl: `${baseUrl}/api/proxy?url=${encodeURIComponent(source.url)}`,
        quality: source.quality
      });
    }
  }

  if (uniqueSources.length > 0) {
    return {
      success: true,
      type: 'cyberfile',
      directUrl: uniqueSources[0].url,
      proxyUrl: uniqueSources[0].proxyUrl,
      sources: uniqueSources,
      embedUrl: embedUrl
    };
  }

  if (embedUrl) {
    return {
      success: true,
      type: 'cyberfile',
      embedUrl: embedUrl,
      iframeOnly: true
    };
  }

  return {
    success: false,
    type: 'cyberfile',
    iframeUrl: url,
    iframeOnly: true,
    error: 'Could not extract video URL'
  };
}

function isVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return /\.(mp4|m3u8|webm|mkv|avi|mov|mpd)/.test(lower) || 
         lower.includes('/video') || 
         lower.includes('stream');
}

function makeAbsolute(url, base) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

// Simple JavaScript unpacker for packed code
function unpack(packed) {
  try {
    const match = packed.match(/\('([^']+)',(\d+),(\d+),'([^']+)'\.split/);
    if (!match) return '';
    
    let [, p, a, c, k] = match;
    a = parseInt(a);
    c = parseInt(c);
    k = k.split('|');
    
    const e = (c) => {
      return (c < a ? '' : e(parseInt(c / a))) + 
        ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
    };
    
    while (c--) {
      if (k[c]) {
        p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
      }
    }
    
    return p;
  } catch {
    return '';
  }
}
