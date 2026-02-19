const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url, id, action } = req.query;

  try {
    let fileId = id;

    // Extract ID from URL if provided
    if (url && !fileId) {
      const match = url.match(/pixeldrain\.com\/(?:u|api\/file)\/([a-zA-Z0-9]+)/);
      if (match) {
        fileId = match[1];
      }
    }

    if (!fileId) {
      return res.status(400).json({ error: 'File ID or URL required' });
    }

    // If action is 'stream', proxy the video
    if (action === 'stream') {
      const streamUrl = `https://pixeldrain.com/api/file/${fileId}`;
      
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://pixeldrain.com/'
      };

      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const response = await fetch(streamUrl, { headers });

      // Forward headers
      ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(h => {
        const val = response.headers.get(h);
        if (val) res.setHeader(h, val);
      });

      res.status(response.status);
      response.body.pipe(res);
      return;
    }

    // Get file info
    const infoUrl = `https://pixeldrain.com/api/file/${fileId}/info`;
    const infoRes = await fetch(infoUrl);
    const info = await infoRes.json();

    if (info.success === false) {
      return res.status(404).json({ error: info.message || 'File not found' });
    }

    // Construct URLs
    const baseApiUrl = `${getBaseUrl(req)}/api/pixeldrain`;
    
    return res.status(200).json({
      success: true,
      fileId: fileId,
      info: {
        name: info.name,
        size: info.size,
        sizeFormatted: formatBytes(info.size),
        mimeType: info.mime_type,
        views: info.views,
        dateUpload: info.date_upload
      },
      urls: {
        // Direct Pixeldrain URLs
        direct: `https://pixeldrain.com/api/file/${fileId}`,
        download: `https://pixeldrain.com/api/file/${fileId}?download`,
        embed: `https://pixeldrain.com/u/${fileId}?embed`,
        thumbnail: `https://pixeldrain.com/api/file/${fileId}/thumbnail`,
        // Proxied URLs (use these for playback)
        proxy: `${baseApiUrl}?id=${fileId}&action=stream`,
        proxyUrl: `${getBaseUrl(req)}/api/proxy?url=${encodeURIComponent(`https://pixeldrain.com/api/file/${fileId}`)}`
      }
    });

  } catch (error) {
    console.error('Pixeldrain error:', error);
    return res.status(500).json({ error: error.message });
  }
};

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports.config = {
  api: {
    responseLimit: false,
    bodyParser: false
  }
};
