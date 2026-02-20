// /api/gofile.js
export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const { id, token, recursive } = req.query;

    if (!id) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Content ID is required. Use ?id=YOUR_CONTENT_ID' 
        });
    }

    try {
        // Create guest account to get token if not provided
        let accountToken = token;
        
        if (!accountToken) {
            try {
                const guestResponse = await fetch('https://api.gofile.io/accounts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                const guestData = await guestResponse.json();
                
                if (guestData.status === 'ok' && guestData.data?.token) {
                    accountToken = guestData.data.token;
                }
            } catch (e) {
                console.log('Guest account creation failed, continuing without token');
            }
        }

        const allFiles = [];
        const folders = [];
        
        await fetchGofileContent(id, accountToken, allFiles, folders, recursive === 'true', 0);

        // Sort files by name
        allFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        return res.status(200).json({
            status: 'ok',
            data: {
                contentId: id,
                totalFiles: allFiles.length,
                totalFolders: folders.length,
                files: allFiles,
                folders: folders
            }
        });

    } catch (error) {
        console.error('Gofile API Error:', error);
        return res.status(500).json({ 
            status: 'error', 
            message: error.message || 'Failed to fetch content from Gofile'
        });
    }
}

async function fetchGofileContent(contentId, token, files, folders, recursive, depth) {
    if (depth > 10) {
        console.log('Max recursion depth reached');
        return;
    }

    const headers = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['Cookie'] = `accountToken=${token}`;
    }

    // Website token for Gofile API
    const websiteToken = '4fd6sg89d7s6';
    const apiUrl = `https://api.gofile.io/contents/${contentId}?wt=${websiteToken}`;

    const response = await fetch(apiUrl, {
        method: 'GET',
        headers: headers
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status !== 'ok') {
        throw new Error(data.data?.message || data.message || 'Gofile API returned error');
    }

    const content = data.data;

    if (content.type === 'folder') {
        folders.push({
            id: content.id,
            name: content.name,
            type: 'folder',
            parentFolder: content.parentFolder,
            createTime: content.createTime,
            childrenCount: content.childrenCount || 0
        });

        if (content.children) {
            const childKeys = Object.keys(content.children);
            
            for (const key of childKeys) {
                const child = content.children[key];
                
                if (child.type === 'file') {
                    const fileInfo = extractFileInfo(child, content.name, content.id);
                    if (fileInfo) {
                        files.push(fileInfo);
                    }
                } else if (child.type === 'folder' && recursive) {
                    // Recursively fetch subfolder contents
                    await fetchGofileContent(child.id, token, files, folders, true, depth + 1);
                } else if (child.type === 'folder') {
                    folders.push({
                        id: child.id,
                        name: child.name,
                        type: 'folder',
                        parentFolder: content.id,
                        createTime: child.createTime,
                        childrenCount: child.childrenCount || 0
                    });
                }
            }
        }
    } else if (content.type === 'file') {
        const fileInfo = extractFileInfo(content, '', '');
        if (fileInfo) {
            files.push(fileInfo);
        }
    }
}

function extractFileInfo(file, folderName, folderId) {
    if (!file || !file.name) return null;

    const name = file.name;
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    
    // Define media type mappings
    const mediaTypes = {
        // Video
        'mp4': 'video', 'mkv': 'video', 'avi': 'video', 'webm': 'video',
        'mov': 'video', 'wmv': 'video', 'flv': 'video', 'm4v': 'video',
        'mpeg': 'video', 'mpg': 'video', '3gp': 'video', 'ts': 'video',
        
        // Audio
        'mp3': 'audio', 'flac': 'audio', 'wav': 'audio', 'ogg': 'audio',
        'm4a': 'audio', 'aac': 'audio', 'wma': 'audio', 'opus': 'audio',
        
        // HLS
        'm3u8': 'hls', 'm3u': 'hls',
        
        // DASH
        'mpd': 'dash',
        
        // Subtitles
        'srt': 'subtitle', 'vtt': 'subtitle', 'ass': 'subtitle', 'sub': 'subtitle',
        
        // Images
        'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image',
        'webp': 'image', 'bmp': 'image', 'svg': 'image'
    };

    const mediaType = mediaTypes[ext] || 'other';
    const isPlayable = ['video', 'audio', 'hls', 'dash'].includes(mediaType);

    return {
        id: file.id,
        name: name,
        size: file.size || 0,
        sizeFormatted: formatFileSize(file.size || 0),
        createTime: file.createTime || 0,
        createTimeFormatted: formatDate(file.createTime),
        modTime: file.modTime || file.createTime || 0,
        mimetype: file.mimetype || getMimeType(ext),
        md5: file.md5 || '',
        link: file.link || '',
        directLink: file.link || '',
        extension: ext,
        mediaType: mediaType,
        isPlayable: isPlayable,
        thumbnail: file.thumbnail || null,
        folderName: folderName,
        folderId: folderId,
        downloadCount: file.downloadCount || 0
    };
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getMimeType(ext) {
    const mimeTypes = {
        'mp4': 'video/mp4',
        'mkv': 'video/x-matroska',
        'avi': 'video/x-msvideo',
        'webm': 'video/webm',
        'mov': 'video/quicktime',
        'mp3': 'audio/mpeg',
        'flac': 'audio/flac',
        'wav': 'audio/wav',
        'm3u8': 'application/vnd.apple.mpegurl',
        'mpd': 'application/dash+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}
