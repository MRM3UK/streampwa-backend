const fetch = require('node-fetch');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  try {
    const result = await extractCyberfileVideo(url, getBaseUrl(req));
    return res.status(200).json(result);
  } catch (error) {
    console.error('Cyberfile error:', error);
    return res.status(500).json({ 
      error: error.message,
      iframeUrl: url 
    });
  }
};

async function extractCyberfileVideo(url, baseUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  };

  // First request to get cookies and initial page
  let response = await fetch(url, { 
    headers,
    redirect: 'follow'
  });

  let cookies = response.headers.get('set-cookie') || '';
  let html = await response.text();
  let $ = cheerio.load(html);

  // Check if there's a form to submit (countdown/captcha page)
  const form = $('form#download-form, form[action*="download"], form[method="post"]').first();
  
  if (form.length > 0) {
    // Extract form data
    const formData = new URLSearchParams();
    form.find('input').each((i, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || '';
      if (name) {
        formData.append(name, value);
      }
    });

    const formAction = form.attr('action') || url;
    const postUrl = formAction.startsWith('http') ? formAction : new URL(formAction, url).href;

    // Wait a bit (some sites require this)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Submit form
    response = await fetch(postUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'Referer': url
      },
      body: formData.toString(),
      redirect: 'follow'
    });

    html = await response.text();
    $ = cheerio.load(html);
  }

  // Try multiple extraction methods
  let directUrl = null;
  let sources = [];

  // Method 1: Video tag sources
  $('video source, video').each((i, el) => {
    const src = $(el).attr('src');
    if (src && isVideoUrl(src)) {
      sources.push({ src, quality: $(el).attr('label') || 'default' });
    }
  });

  // Method 2: JWPlayer
  const scriptContent = $('script').text();
  
  const jwSetup = scriptContent.match(/jwplayer\([^)]+\)\.setup\(([\s\S]*?)\);/);
  if (jwSetup) {
    const fileMatch = jwSetup[1].match(/["']?file["']?\s*:\s*["']([^"']+)["']/);
    if (fileMatch) {
      sources.push({ src: fileMatch[1], quality: 'jwplayer' });
    }
  }

  // Method 3: Direct URL patterns in scripts
  const urlPatterns = [
    /["']?(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']?/gi,
    /["']?(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']?/gi,
    /file:\s*["']([^"']+)/gi,
    /source:\s*["']([^"']+)/gi,
    /src:\s*["']([^"']+\.(?:mp4|m3u8|webm)[^"']*)/gi,
    /videoUrl\s*[=:]\s*["']([^"']+)/gi
  ];

  for (const pattern of urlPatterns) {
    let match;
    while ((match = pattern.exec(scriptContent)) !== null) {
      const src = match[1];
      if (isVideoUrl(src) && !sources.find(s => s.src === src)) {
        sources.push({ src, quality: 'script' });
      }
    }
  }

  // Method 4: Data attributes
  $('[data-src], [data-video], [data-file]').each((i, el) => {
    const src = $(el).attr('data-src') || $(el).attr('data-video') || $(el).attr('data-file');
    if (src && isVideoUrl(src)) {
      sources.push({ src, quality: 'data-attr' });
    }
  });

  // Method 5: Download links
  $('a[href*=".mp4"], a[href*="download"], a.download-btn, button[data-url]').each((i, el) => {
    const href = $(el).attr('href') || $(el).attr('data-url');
    if (href && isVideoUrl(href)) {
      sources.push({ src: href, quality: 'download' });
    }
  });

  // Method 6: Look for iframe embeds
  let embedUrl = null;
  $('iframe').each((i, el) => {
    const src = $(el).attr('src');
    if (src && (src.includes('player') || src.includes('embed') || src.includes('video'))) {
      embedUrl = src.startsWith('//') ? 'https:' + src : 
                 src.startsWith('/') ? new URL(src, url).href : src;
    }
  });

  // Clean and validate sources
  sources = sources
    .map(s => ({
      ...s,
      src: s.src.startsWith('//') ? 'https:' + s.src :
           s.src.startsWith('/') ? new URL(s.src, url).href : s.src
    }))
    .filter(s => s.src.startsWith('http'));

  // Remove duplicates
  const uniqueSources = [];
  const seen = new Set();
  for (const source of sources) {
    if (!seen.has(source.src)) {
      seen.add(source.src);
      uniqueSources.push(source);
    }
  }

  if (uniqueSources.length > 0) {
    directUrl = uniqueSources[0].src;
  }

  // Build response
  const result = {
    success: !!directUrl,
    originalUrl: url,
    sources: uniqueSources.map(s => ({
      url: s.src,
      quality: s.quality,
      proxyUrl: `${baseUrl}/api/proxy?url=${encodeURIComponent(s.src)}`
    }))
  };

  if (directUrl) {
    result.directUrl = directUrl;
    result.proxyUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(directUrl)}`;
  }

  if (embedUrl) {
    result.embedUrl = embedUrl;
  }

  if (!directUrl && !embedUrl) {
    result.iframeUrl = url;
    result.iframeOnly = true;
  }

  return result;
}

function isVideoUrl(url) {
  if (!url) return false;
  const videoExtensions = ['.mp4', '.m3u8', '.webm', '.mkv', '.avi', '.mov', '.mpd'];
  const lower = url.toLowerCase();
  return videoExtensions.some(ext => lower.includes(ext)) || 
         lower.includes('/video') || 
         lower.includes('stream');
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
