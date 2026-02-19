const fetch = require('node-fetch');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  // CORS
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
    const result = await extractCyberfile(url, getBaseUrl(req));
    return res.status(200).json(result);
  } catch (error) {
    console.error('Cyberfile error:', error);
    return res.status(500).json({ 
      error: error.message,
      iframeUrl: url,
      iframeOnly: true
    });
  }
};

async function extractCyberfile(url, baseUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
  };

  let response = await fetch(url, { headers, redirect: 'follow' });
  let html = await response.text();
  let $ = cheerio.load(html);

  // Handle download form if present
  const downloadForm = $('form[name="F1"], form#F1, form[method="post"]').first();
  if (downloadForm.length && downloadForm.find('input[name="op"]').val() === 'download2') {
    const formData = new URLSearchParams();
    downloadForm.find('input').each((i, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || '';
      if (name) formData.append(name, value);
    });

    await new Promise(r => setTimeout(r, 3000));

    const postUrl = downloadForm.attr('action') || url;
    response = await fetch(postUrl.startsWith('http') ? postUrl : new URL(postUrl, url).href, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': url },
      body: formData.toString(),
      redirect: 'follow'
    });

    html = await response.text();
    $ = cheerio.load(html);
  }

  const sources = [];
  const scripts = $('script').text() + ' ' + html;

  // Extract from video tags
  $('video source[src], video[src]').each((i, el) => {
    const src = $(el).attr('src');
    if (src && isVideo(src)) sources.push({ url: absolute(src, url), quality: 'video' });
  });

  // Extract from scripts
  const patterns = [
    /["']?(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']?/gi,
    /["']?(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']?/gi,
    /file:\s*["']([^"']+)/gi,
    /source:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(scripts)) !== null) {
      const videoUrl = match[1] || match[0];
      if (isVideo(videoUrl) && videoUrl.startsWith('http')) {
        sources.push({ url: videoUrl, quality: 'script' });
      }
    }
  }

  // Check for packed JS
  const packedMatch = scripts.match(/eval\(function\(p,a,c,k,e,[dr]\)[\s\S]*?\)\)/);
  if (packedMatch) {
    try {
      const unpacked = unpack(packedMatch[0]);
      const videoUrls = unpacked.match(/https?:\/\/[^\s"']+\.(?:mp4|m3u8)[^\s"']*/g);
      if (videoUrls) {
        videoUrls.forEach(u => sources.push({ url: u, quality: 'packed' }));
      }
    } catch (e) {}
  }

  // Deduplicate
  const unique = [];
  const seen = new Set();
  for (const s of sources) {
    if (!seen.has(s.url)) {
      seen.add(s.url);
      unique.push({
        url: s.url,
        proxyUrl: `${baseUrl}/api/proxy?url=${encodeURIComponent(s.url)}`,
        quality: s.quality
      });
    }
  }

  // Check for embed iframe
  let embedUrl = null;
  $('iframe[src]').each((i, el) => {
    const src = $(el).attr('src');
    if (src && (src.includes('player') || src.includes('embed') || src.includes('video'))) {
      embedUrl = absolute(src, url);
    }
  });

  if (unique.length > 0) {
    return {
      success: true,
      type: 'cyberfile',
      directUrl: unique[0].url,
      proxyUrl: unique[0].proxyUrl,
      sources: unique
    };
  }

  return {
    success: false,
    type: 'cyberfile',
    embedUrl: embedUrl || url,
    iframeUrl: url,
    iframeOnly: true
  };
}

function isVideo(url) {
  if (!url) return false;
  return /\.(mp4|m3u8|webm|mkv|mpd)/i.test(url);
}

function absolute(url, base) {
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  try { return new URL(url, base).href; } catch { return url; }
}

function unpack(p) {
  try {
    const match = p.match(/\('([^']+)',(\d+),(\d+),'([^']+)'\.split/);
    if (!match) return '';
    let [, code, a, c, k] = match;
    a = parseInt(a); c = parseInt(c); k = k.split('|');
    const e = (c) => (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
    while (c--) { if (k[c]) code = code.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]); }
    return code;
  } catch { return ''; }
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
