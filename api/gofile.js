// /api/gofile.js - WORKING VERSION WITH CORRECT ENDPOINTS

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
        console.log('=== Gofile Fetch Started ===');
        console.log('Content ID:', id);

        // Step 1: Create/Get guest account token
        let accountToken = token;
        if (!accountToken) {
            console.log('Creating guest account...');
            accountToken = await createGuestAccount();
        }

        if (!accountToken) {
            throw new Error('Failed to create Gofile account. Please try again.');
        }

        console.log('Account token obtained');

        // Step 2: Fetch content with token
        const allFiles = [];
        const folders = [];
        
        await fetchGofileContent({
            contentId: id,
            accountToken,
            password,
            files: allFiles,
            folders,
            recursive: recursive === 'true',
            depth: 0
        });

        // Sort files
        allFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        console.log(`=== Complete: ${allFiles.length} files, ${folders.length} folders ===`);

        return res.status(200).json({
            status: 'ok',
            data: {
                contentId: id,
                totalFiles: allFiles.length,
                totalFolders: folders.length,
                files: allFiles,
                folders: folders,
                accountToken: accountToken
            }
        });

    } catch (error) {
        console.error('=== Error ===');
        console.error(error.message);
        
        return res.status(500).json({ 
            status: 'error', 
            message: error.message || 'Failed to fetch content from Gofile'
        });
    }
}

// Create guest account
async function createGuestAccount() {
    try {
        const response = await fetch('https://api.gofile.io/accounts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            }
        });

        const data = await response.json();
        
        if (data.status === 'ok' && data.data?.token) {
            return data.data.token;
        }
        
        console.error('Account creation failed:', data);
        return null;
    } catch (error) {
        console.error('Account creation error:', error);
        return null;
    }
}

// Fetch content from Gofile
async function fetchGofileContent(options) {
    const { contentId, accountToken, password, files, folders, recursive, depth } = options;

    if (depth > 10) {
        console.log('Max recursion depth reached');
        return;
    }

    console.log(`Fetching content (depth ${depth}): ${contentId}`);

    // Build URL - NO website token needed with account token
    let apiUrl = `https://api.gofile.io/contents/${contentId}`;
    
    // Add password hash if provided
    if (password) {
        const crypto = await import('crypto');
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        apiUrl += `?password=${passwordHash}`;
    }

    const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${accountToken}`,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseText = await response.text();
    console.log('Response preview:', responseText.substring(0, 200));

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        throw new Error('Invalid JSON response from Gofile');
    }

    if (data.status !== 'ok') {
        handleGofileError(data);
    }

    const content = data.data;

    if (!content) {
        throw new Error('No content data received');
    }

    console.log(`Content: ${content.type} - ${content.name || contentId}`);

    // Process based on content type
    if (content.type === 'folder') {
        // Add folder to list
        folders.push({
            id: content.id,
            name: content.name || 'Unnamed Folder',
            type: 'folder',
            parentFolder: content.parentFolder,
            createTime: content.createTime,
            isPublic: content.public,
            code: content.code,
            childrenCount: 0
        });

        // Process children
        const children = content.children || content.contents || {};
        const childrenArray = Object.values(children);
        
        folders[folders.length - 1].childrenCount = childrenArray.length;

        console.log(`Processing ${childrenArray.length} children...`);

        for (const child of childrenArray) {
            if (!child) continue;

            if (child.type === 'file') {
                const fileInfo = extractFileInfo(child, content.name, content.id);
                if (fileInfo) {
                    files.push(fileInfo);
                }
            } else if (child.type === 'folder') {
                if (recursive) {
                    // Recursively fetch subfolder
                    await fetchGofileContent({
                        contentId: child.id,
                        accountToken,
                        password,
                        files,
                        folders,
                        recursive: true,
                        depth: depth + 1
                    });
                } else {
                    // Just add folder reference
                    folders.push({
                        id: child.id,
                        name: child.name || 'Unnamed Folder',
                        type: 'folder',
                        parentFolder: content.id,
                        createTime: child.createTime,
                        childrenCount: 0
                    });
                }
            }
        }
    } else if (content.type === 'file') {
        // Single file
        const fileInfo = extractFileInfo(content, '', '');
        if (fileInfo) {
            files.push(fileInfo);
        }
    }
}

// Handle Gofile API errors
function handleGofileError(data) {
    const errorData = data.data || {};
    const errorMessage = errorData.message || data.message || 'Unknown error';

    // Check for specific error codes
    if (errorMessage.includes('password')) {
        throw new Error('This content is password protected. Please provide the password.');
    }
    if (errorMessage.includes('notFound') || errorMessage.includes('not found')) {
        throw new Error('Content not found. The link may be invalid or expired.');
    }
    if (errorMessage.includes('notPublic') || errorMessage.includes('not public')) {
        throw new Error('This content is private and cannot be accessed.');
    }
    if (errorMessage.includes('token')) {
        throw new Error('Authentication failed. Please try again.');
    }

    throw new Error(`Gofile API error: ${errorMessage}`);
}

// Extract file information
function extractFileInfo(file, folderName, folderId) {
    if (!file || !file.name) return null;

    const name = file.name;
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    
    // Media type detection
    const videoExts = ['mp4', 'mkv', 'avi', 'webm', 'mov', 'wmv', 'flv', 'm4v', 'mpeg', 'mpg', '3gp', 'ts', 'mts', 'm2ts', 'vob', 'ogv'];
    const audioExts = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'wma', 'opus', 'aiff', 'ape'];
    const hlsExts = ['m3u8', 'm3u'];
    const dashExts = ['mpd'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
    const subtitleExts = ['srt', 'vtt', 'ass', 'sub', 'ssa'];

    let mediaType = 'other';
    if (videoExts.includes(ext)) mediaType = 'video';
    else if (audioExts.includes(ext)) mediaType = 'audio';
    else if (hlsExts.includes(ext)) mediaType = 'hls';
    else if (dashExts.includes(ext)) mediaType = 'dash';
    else if (imageExts.includes(ext)) mediaType = 'image';
    else if (subtitleExts.includes(ext)) mediaType = 'subtitle';

    const isPlayable = ['video', 'audio', 'hls', 'dash'].includes(mediaType);

    // Get direct link
    const directLink = file.link || file.directLink || '';

    return {
        id: file.id || `file_${Math.random().toString(36).substr(2, 9)}`,
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
        thumbnail: file.thumbnail || file.thumbnailSmall || null,
        folderName: folderName,
        folderId: folderId,
        downloadCount: file.downloadCount || 0,
        server: file.server || ''
    };
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    try {
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return 'Unknown';
    }
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
        'mpd': 'application/dash+xml',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}
