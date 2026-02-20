// /api/gofile.js - WORKING VERSION

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { id, recursive } = req.query;

    if (!id) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Content ID required. Use ?id=YOUR_CONTENT_ID' 
        });
    }

    try {
        console.log('Fetching content:', id);

        // Step 1: Create guest account
        const accountRes = await fetch('https://api.gofile.io/accounts', {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Origin': 'https://gofile.io',
                'Referer': 'https://gofile.io/'
            }
        });

        const accountData = await accountRes.json();
        console.log('Account created:', accountData.status);
        
        if (accountData.status !== 'ok' || !accountData.data?.token) {
            throw new Error('Failed to create guest account');
        }

        const token = accountData.data.token;
        console.log('Token obtained:', token.substring(0, 10) + '...');

        // Step 2: Fetch content using the working endpoint
        const allFiles = [];
        const allFolders = [];

        await fetchContent(id, token, allFiles, allFolders, recursive === 'true', 0);

        // Sort files
        allFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        console.log(`Fetched ${allFiles.length} files, ${allFolders.length} folders`);

        return res.status(200).json({
            status: 'ok',
            data: {
                contentId: id,
                totalFiles: allFiles.length,
                totalFolders: allFolders.length,
                files: allFiles,
                folders: allFolders,
                accountToken: token
            }
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            status: 'error', 
            message: error.message
        });
    }
}

async function fetchContent(contentId, token, files, folders, recursive, depth) {
    if (depth > 10) {
        console.log('Max depth reached');
        return;
    }

    console.log(`Fetching (depth ${depth}):`, contentId);

    try {
        // Try the /getContent endpoint (older API that might work)
        const contentRes = await fetch(
            `https://api.gofile.io/getContent?contentId=${contentId}&token=${token}&wt=4fd6sg89d7s6`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                    'Origin': 'https://gofile.io',
                    'Referer': `https://gofile.io/d/${contentId}`
                }
            }
        );

        const contentText = await contentRes.text();
        let contentData;

        try {
            contentData = JSON.parse(contentText);
        } catch (e) {
            console.error('Invalid JSON response:', contentText.substring(0, 200));
            throw new Error('Invalid response from Gofile API');
        }

        console.log('Content response status:', contentData.status);

        if (contentData.status !== 'ok') {
            // Try alternative endpoint
            const altRes = await fetch(
                `https://api.gofile.io/contents/${contentId}?token=${token}&wt=4fd6sg89d7s6`,
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'Origin': 'https://gofile.io',
                        'Referer': `https://gofile.io/d/${contentId}`
                    }
                }
            );

            const altText = await altRes.text();
            
            try {
                contentData = JSON.parse(altText);
            } catch (e) {
                console.error('Alternative endpoint also failed');
                throw new Error('Failed to fetch content. Link may be invalid or expired.');
            }
        }

        if (contentData.status !== 'ok') {
            const errorMsg = contentData.message || 'Unknown error from Gofile';
            throw new Error(errorMsg);
        }

        const content = contentData.data;

        if (!content) {
            throw new Error('No content data received');
        }

        console.log('Content type:', content.type, 'Name:', content.name);

        // Process folder
        if (content.type === 'folder') {
            folders.push({
                id: content.id,
                name: content.name,
                type: 'folder',
                createTime: content.createTime || 0,
                childrenCount: content.childrenIds?.length || Object.keys(content.children || {}).length
            });

            // Process children
            const children = content.children || {};
            const childIds = content.childrenIds || Object.keys(children);

            console.log(`Processing ${childIds.length} children...`);

            for (const childId of childIds) {
                const child = children[childId];
                
                if (!child) continue;

                if (child.type === 'file') {
                    const fileInfo = createFileInfo(child, content.name, content.id);
                    if (fileInfo) {
                        files.push(fileInfo);
                    }
                } else if (child.type === 'folder') {
                    if (recursive) {
                        // Recursively fetch subfolder
                        await fetchContent(child.id, token, files, folders, true, depth + 1);
                    } else {
                        folders.push({
                            id: child.id,
                            name: child.name,
                            type: 'folder',
                            createTime: child.createTime || 0,
                            childrenCount: child.childrenIds?.length || 0
                        });
                    }
                }
            }
        }
        // Process single file
        else if (content.type === 'file') {
            const fileInfo = createFileInfo(content, '', '');
            if (fileInfo) {
                files.push(fileInfo);
            }
        }

    } catch (error) {
        console.error(`Error fetching ${contentId}:`, error.message);
        throw error;
    }
}

function createFileInfo(file, folderName, folderId) {
    if (!file || !file.name) return null;

    const name = file.name;
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    
    // Media type detection
    const mediaTypes = {
        // Video
        'mp4': 'video', 'mkv': 'video', 'avi': 'video', 'webm': 'video',
        'mov': 'video', 'wmv': 'video', 'flv': 'video', 'm4v': 'video',
        'mpeg': 'video', 'mpg': 'video', '3gp': 'video', 'ts': 'video',
        'mts': 'video', 'm2ts': 'video', 'vob': 'video', 'ogv': 'video',
        
        // Audio
        'mp3': 'audio', 'flac': 'audio', 'wav': 'audio', 'ogg': 'audio',
        'm4a': 'audio', 'aac': 'audio', 'wma': 'audio', 'opus': 'audio',
        
        // Streaming
        'm3u8': 'hls', 'm3u': 'hls', 'mpd': 'dash',
        
        // Subtitles
        'srt': 'subtitle', 'vtt': 'subtitle', 'ass': 'subtitle', 'sub': 'subtitle',
        
        // Images
        'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image',
        'webp': 'image', 'bmp': 'image', 'svg': 'image'
    };

    const mediaType = mediaTypes[ext] || 'other';
    const isPlayable = ['video', 'audio', 'hls', 'dash'].includes(mediaType);

    return {
        id: file.id || `file_${Math.random().toString(36).substr(2, 9)}`,
        name: name,
        size: file.size || 0,
        sizeFormatted: formatFileSize(file.size || 0),
        createTime: file.createTime || 0,
        createTimeFormatted: formatDate(file.createTime),
        link: file.link || '',
        directLink: file.link || '',
        extension: ext,
        mediaType: mediaType,
        isPlayable: isPlayable,
        thumbnail: file.thumbnail || null,
        folderName: folderName,
        folderId: folderId,
        mimetype: file.mimetype || getMimeType(ext)
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
        'ogg': 'audio/ogg',
        'm4a': 'audio/mp4',
        'm3u8': 'application/vnd.apple.mpegurl',
        'mpd': 'application/dash+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}
