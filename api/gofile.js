// /api/gofile.js - FIXED VERSION WITH DIRECT LINKS

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
        console.log('=== Starting Gofile Fetch ===');
        console.log('Content ID:', id);

        // Step 1: Create guest account
        let accountToken = token;
        if (!accountToken) {
            console.log('Creating guest account...');
            accountToken = await createGuestAccount();
            console.log('Account Token:', accountToken);
        }

        if (!accountToken) {
            throw new Error('Failed to create Gofile guest account. Please try again.');
        }

        // Step 2: Get direct links for content
        console.log('Getting direct links...');
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

        // Sort files by name
        allFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        console.log(`=== Fetch Complete: ${allFiles.length} files, ${folders.length} folders ===`);

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
        console.error('=== Gofile API Error ===');
        console.error('Error:', error.message);
        
        return res.status(500).json({ 
            status: 'error', 
            message: error.message || 'Failed to fetch content from Gofile'
        });
    }
}

// Create a guest account on Gofile
async function createGuestAccount() {
    try {
        console.log('Creating guest account...');
        
        const response = await fetch('https://api.gofile.io/accounts', {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Origin': 'https://gofile.io',
                'Referer': 'https://gofile.io/'
            }
        });

        const text = await response.text();
        console.log('Guest account response:', text);

        const data = JSON.parse(text);

        if (data.status === 'ok' && data.data?.token) {
            return data.data.token;
        }
        
        throw new Error('Failed to create guest account: ' + (data.message || 'Unknown error'));
        
    } catch (error) {
        console.error('Guest account creation error:', error.message);
        throw new Error('Failed to create guest account: ' + error.message);
    }
}

// Fetch content from Gofile API using direct links endpoint
async function fetchGofileContent(options) {
    const { contentId, accountToken, password, files, folders, recursive, depth } = options;

    if (depth > 10) {
        console.log('Max recursion depth reached');
        return;
    }

    console.log(`Fetching content (depth ${depth}):`, contentId);

    // First, get the content info
    const contentInfo = await getContentInfo(contentId, accountToken);
    
    if (!contentInfo) {
        throw new Error('Failed to get content info');
    }

    // Handle folder
    if (contentInfo.type === 'folder') {
        folders.push({
            id: contentInfo.id,
            name: contentInfo.name,
            type: 'folder',
            parentFolder: contentInfo.parentFolder,
            createTime: contentInfo.createTime,
            isPublic: contentInfo.public,
            childrenCount: contentInfo.childrenIds?.length || 0
        });

        console.log(`Folder "${contentInfo.name}" with ${contentInfo.childrenIds?.length || 0} children`);

        // Get direct links for all children
        const directLinks = await getDirectLinks(contentId, accountToken);
        
        if (directLinks && directLinks.contents) {
            // Process each child
            for (const [childId, childData] of Object.entries(directLinks.contents)) {
                if (childData.type === 'file') {
                    const fileInfo = extractFileInfo(childData, contentInfo.name, contentInfo.id);
                    if (fileInfo) {
                        files.push(fileInfo);
                        console.log('  + File:', fileInfo.name);
                    }
                } else if (childData.type === 'folder' && recursive) {
                    // Recursively process subfolder
                    await fetchGofileContent({
                        contentId: childId,
                        accountToken,
                        password,
                        files,
                        folders,
                        recursive: true,
                        depth: depth + 1
                    });
                } else if (childData.type === 'folder') {
                    folders.push({
                        id: childId,
                        name: childData.name,
                        type: 'folder',
                        parentFolder: contentInfo.id,
                        createTime: childData.createTime,
                        childrenCount: childData.childrenIds?.length || 0
                    });
                }
            }
        }
    } 
    // Handle single file
    else if (contentInfo.type === 'file') {
        // Get direct link for the file
        const directLink = await getFileDirectLink(contentId, accountToken);
        if (directLink) {
            const fileInfo = extractFileInfo({...contentInfo, link: directLink}, '', '');
            if (fileInfo) {
                files.push(fileInfo);
            }
        } else {
            // Fallback: use the original link if direct link fails
            const fileInfo = extractFileInfo(contentInfo, '', '');
            if (fileInfo) {
                files.push(fileInfo);
            }
        }
    }
}

// Get basic content info
async function getContentInfo(contentId, accountToken) {
    try {
        const response = await fetch(`https://api.gofile.io/contents/${contentId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Authorization': `Bearer ${accountToken}`,
                'Cookie': `accountToken=${accountToken}`
            }
        });

        const text = await response.text();
        console.log('Content info response:', text.substring(0, 200));

        const data = JSON.parse(text);

        if (data.status === 'ok' && data.data) {
            return data.data;
        }
        
        throw new Error(data.message || 'Failed to get content info');
        
    } catch (error) {
        console.error('Content info error:', error.message);
        throw new Error('Failed to get content info: ' + error.message);
    }
}

// Get direct links for a folder's contents
async function getDirectLinks(folderId, accountToken) {
    try {
        const response = await fetch(`https://api.gofile.io/contents/${folderId}/directlinks`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Authorization': `Bearer ${accountToken}`,
                'Cookie': `accountToken=${accountToken}`
            }
        });

        const text = await response.text();
        console.log('Direct links response:', text.substring(0, 200));

        const data = JSON.parse(text);

        if (data.status === 'ok' && data.data) {
            return data.data;
        }
        
        throw new Error(data.message || 'Failed to get direct links');
        
    } catch (error) {
        console.error('Direct links error:', error.message);
        return null; // Return null instead of throwing to allow fallback
    }
}

// Get direct link for a single file
async function getFileDirectLink(fileId, accountToken) {
    try {
        const response = await fetch(`https://api.gofile.io/contents/${fileId}/directlinks`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Authorization': `Bearer ${accountToken}`,
                'Cookie': `accountToken=${accountToken}`
            }
        });

        const text = await response.text();
        console.log('File direct link response:', text.substring(0, 200));

        const data = JSON.parse(text);

        if (data.status === 'ok' && data.data && data.data.directLink) {
            return data.data.directLink;
        }
        
        return null;
        
    } catch (error) {
        console.error('File direct link error:', error.message);
        return null;
    }
}

// Extract file information into a structured format
function extractFileInfo(file, folderName, folderId) {
    if (!file || !file.name) return null;

    const name = file.name;
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    
    // Comprehensive media type mappings
    const mediaTypes = {
        // Video formats
        'mp4': 'video', 'mkv': 'video', 'avi': 'video', 'webm': 'video',
        'mov': 'video', 'wmv': 'video', 'flv': 'video', 'm4v': 'video',
        'mpeg': 'video', 'mpg': 'video', '3gp': 'video', 'ts': 'video',
        'mts': 'video', 'm2ts': 'video', 'vob': 'video', 'ogv': 'video',
        'divx': 'video', 'xvid': 'video', 'rm': 'video', 'rmvb': 'video',
        'asf': 'video', 'f4v': 'video',
        
        // Audio formats
        'mp3': 'audio', 'flac': 'audio', 'wav': 'audio', 'ogg': 'audio',
        'm4a': 'audio', 'aac': 'audio', 'wma': 'audio', 'opus': 'audio',
        'aiff': 'audio', 'ape': 'audio', 'alac': 'audio', 'mid': 'audio',
        'midi': 'audio',
        
        // Streaming formats
        'm3u8': 'hls', 'm3u': 'hls',
        'mpd': 'dash',
        
        // Subtitle formats
        'srt': 'subtitle', 'vtt': 'subtitle', 'ass': 'subtitle', 
        'sub': 'subtitle', 'ssa': 'subtitle', 'idx': 'subtitle',
        
        // Image formats
        'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image',
        'webp': 'image', 'bmp': 'image', 'svg': 'image', 'ico': 'image',
        'tiff': 'image', 'tif': 'image'
    };

    const mediaType = mediaTypes[ext] || 'other';
    const isPlayable = ['video', 'audio', 'hls', 'dash'].includes(mediaType);

    // Get the direct download/stream link
    let directLink = file.link || file.directLink || '';

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
        server: file.server || file.serverSelected || ''
    };
}

// Format file size for display
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format timestamp to readable date
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

// Get MIME type from extension
function getMimeType(ext) {
    const mimeTypes = {
        // Video
        'mp4': 'video/mp4',
        'mkv': 'video/x-matroska',
        'avi': 'video/x-msvideo',
        'webm': 'video/webm',
        'mov': 'video/quicktime',
        'wmv': 'video/x-ms-wmv',
        'flv': 'video/x-flv',
        'm4v': 'video/x-m4v',
        'ts': 'video/mp2t',
        '3gp': 'video/3gpp',
        // Audio
        'mp3': 'audio/mpeg',
        'flac': 'audio/flac',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        'm4a': 'audio/mp4',
        'aac': 'audio/aac',
        // Streaming
        'm3u8': 'application/vnd.apple.mpegurl',
        'mpd': 'application/dash+xml',
        // Images
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}
