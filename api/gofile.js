// /api/gofile.js - FIXED VERSION

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ status: 'error', message: 'Method not allowed' });
    }

    const { id, token, recursive, password } = req.query;

    if (!id) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Content ID is required. Use ?id=YOUR_CONTENT_ID' 
        });
    }

    try {
        // Step 1: Get website token from Gofile
        const websiteToken = await getWebsiteToken();
        console.log('Website Token:', websiteToken);

        // Step 2: Create guest account if no token provided
        let accountToken = token;
        if (!accountToken) {
            accountToken = await createGuestAccount();
            console.log('Account Token:', accountToken);
        }

        if (!accountToken) {
            throw new Error('Failed to create guest account');
        }

        // Step 3: Fetch content
        const allFiles = [];
        const folders = [];
        
        await fetchGofileContent(
            id, 
            accountToken, 
            websiteToken, 
            password,
            allFiles, 
            folders, 
            recursive === 'true', 
            0
        );

        // Sort files by name
        allFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        return res.status(200).json({
            status: 'ok',
            data: {
                contentId: id,
                totalFiles: allFiles.length,
                totalFolders: folders.length,
                files: allFiles,
                folders: folders,
                accountToken: accountToken // Return for subsequent requests
            }
        });

    } catch (error) {
        console.error('Gofile API Error:', error);
        return res.status(500).json({ 
            status: 'error', 
            message: error.message || 'Failed to fetch content from Gofile',
            details: error.stack
        });
    }
}

// Get website token from Gofile's main page
async function getWebsiteToken() {
    try {
        // Method 1: Try to fetch from Gofile's JS
        const response = await fetch('https://gofile.io/dist/js/alljs.js', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Referer': 'https://gofile.io/'
            }
        });
        
        if (response.ok) {
            const text = await response.text();
            // Look for websiteToken in the JS
            const match = text.match(/(?:websiteToken|wt)\s*[=:]\s*["']([a-zA-Z0-9]+)["']/);
            if (match && match[1]) {
                return match[1];
            }
        }
    } catch (e) {
        console.log('Failed to get token from JS:', e.message);
    }

    // Method 2: Try known working tokens (these change periodically)
    const knownTokens = [
        '4fd6sg89d7s6',
        'aB9cD3fG2hI1',
    ];
    
    // Method 3: Return a default (may need updating)
    return knownTokens[0];
}

// Create a guest account
async function createGuestAccount() {
    try {
        const response = await fetch('https://api.gofile.io/accounts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Origin': 'https://gofile.io',
                'Referer': 'https://gofile.io/'
            }
        });

        const data = await response.json();
        console.log('Guest account response:', JSON.stringify(data));

        if (data.status === 'ok' && data.data?.token) {
            return data.data.token;
        }
        
        return null;
    } catch (error) {
        console.error('Failed to create guest account:', error);
        return null;
    }
}

// Fetch content from Gofile
async function fetchGofileContent(contentId, accountToken, websiteToken, password, files, folders, recursive, depth) {
    if (depth > 10) {
        console.log('Max recursion depth reached');
        return;
    }

    // Build API URL
    let apiUrl = `https://api.gofile.io/contents/${contentId}?wt=${websiteToken}`;
    if (password) {
        // Hash password if provided
        const hashHex = await sha256(password);
        apiUrl += `&password=${hashHex}`;
    }

    console.log('Fetching:', apiUrl);

    const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accountToken}`,
            'Origin': 'https://gofile.io',
            'Referer': 'https://gofile.io/',
            'Cookie': `accountToken=${accountToken}`
        }
    });

    const responseText = await response.text();
    console.log('Response status:', response.status);
    console.log('Response body:', responseText.substring(0, 500));

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
    }

    if (data.status !== 'ok') {
        const errorMsg = data.data?.message || data.message || 'Unknown error';
        
        // Handle specific errors
        if (errorMsg.includes('password') || data.data?.passwordRequired) {
            throw new Error('Password required for this content. Add &password=YOUR_PASSWORD to the URL.');
        }
        if (errorMsg.includes('notFound')) {
            throw new Error('Content not found. The link may be invalid or expired.');
        }
        if (errorMsg.includes('notPublic')) {
            throw new Error('This content is not public.');
        }
        
        throw new Error(`Gofile API error: ${errorMsg}`);
    }

    const content = data.data;

    // Handle folder
    if (content.type === 'folder') {
        folders.push({
            id: content.id,
            name: content.name,
            type: 'folder',
            parentFolder: content.parentFolder,
            createTime: content.createTime,
            isPublic: content.public,
            childrenCount: Object.keys(content.children || {}).length
        });

        // Process children
        if (content.children) {
            for (const childId of Object.keys(content.children)) {
                const child = content.children[childId];
                
                if (child.type === 'file') {
                    const fileInfo = extractFileInfo(child, content.name, content.id);
                    if (fileInfo) {
                        files.push(fileInfo);
                    }
                } else if (child.type === 'folder') {
                    if (recursive) {
                        // Recursively fetch subfolder
                        await fetchGofileContent(
                            child.id, 
                            accountToken, 
                            websiteToken,
                            password,
                            files, 
                            folders, 
                            true, 
                            depth + 1
                        );
                    } else {
                        folders.push({
                            id: child.id,
                            name: child.name,
                            type: 'folder',
                            parentFolder: content.id,
                            createTime: child.createTime,
                            childrenCount: Object.keys(child.children || {}).length
                        });
                    }
                }
            }
        }
    } 
    // Handle single file
    else if (content.type === 'file') {
        const fileInfo = extractFileInfo(content, '', '');
        if (fileInfo) {
            files.push(fileInfo);
        }
    }
}

// Extract file information
function extractFileInfo(file, folderName, folderId) {
    if (!file || !file.name) return null;

    const name = file.name;
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    
    // Media type mappings
    const mediaTypes = {
        // Video
        'mp4': 'video', 'mkv': 'video', 'avi': 'video', 'webm': 'video',
        'mov': 'video', 'wmv': 'video', 'flv': 'video', 'm4v': 'video',
        'mpeg': 'video', 'mpg': 'video', '3gp': 'video', 'ts': 'video',
        'mts': 'video', 'm2ts': 'video', 'vob': 'video', 'ogv': 'video',
        
        // Audio
        'mp3': 'audio', 'flac': 'audio', 'wav': 'audio', 'ogg': 'audio',
        'm4a': 'audio', 'aac': 'audio', 'wma': 'audio', 'opus': 'audio',
        'aiff': 'audio', 'ape': 'audio',
        
        // HLS
        'm3u8': 'hls', 'm3u': 'hls',
        
        // DASH
        'mpd': 'dash',
        
        // Subtitles
        'srt': 'subtitle', 'vtt': 'subtitle', 'ass': 'subtitle', 'sub': 'subtitle',
        'ssa': 'subtitle', 'idx': 'subtitle',
        
        // Images
        'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image',
        'webp': 'image', 'bmp': 'image', 'svg': 'image', 'ico': 'image'
    };

    const mediaType = mediaTypes[ext] || 'other';
    const isPlayable = ['video', 'audio', 'hls', 'dash'].includes(mediaType);

    // Get the direct link
    let directLink = file.link || '';
    
    // Some files have a different link structure
    if (!directLink && file.directLink) {
        directLink = file.directLink;
    }

    return {
        id: file.id || generateId(),
        name: name,
        size: file.size || 0,
        sizeFormatted: formatFileSize(file.size || 0),
        createTime: file.createTime || 0,
        createTimeFormatted: formatDate(file.createTime),
        modTime: file.modTime || file.createTime || 0,
        mimetype: file.mimetype || getMimeType(ext),
        md5: file.md5 || '',
        link: directLink,
        directLink: directLink,
        extension: ext,
        mediaType: mediaType,
        isPlayable: isPlayable,
        thumbnail: file.thumbnail || null,
        folderName: folderName,
        folderId: folderId,
        downloadCount: file.downloadCount || 0,
        serverSelected: file.serverSelected || file.server || ''
    };
}

// Helper functions
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
        'wmv': 'video/x-ms-wmv',
        'flv': 'video/x-flv',
        'm4v': 'video/x-m4v',
        'mp3': 'audio/mpeg',
        'flac': 'audio/flac',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        'm4a': 'audio/mp4',
        'm3u8': 'application/vnd.apple.mpegurl',
        'mpd': 'application/dash+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

function generateId() {
    return 'file_' + Math.random().toString(36).substr(2, 9);
}

// SHA256 hash for password
async function sha256(message) {
    // Use Web Crypto API if available
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    // Fallback: simple implementation
    const { createHash } = await import('crypto');
    return createHash('sha256').update(message).digest('hex');
}
