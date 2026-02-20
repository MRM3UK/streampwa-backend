// /api/debug.js - Enhanced debug endpoint

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const { id } = req.query;
    const logs = [];

    const log = (msg, data = null) => {
        const entry = { time: new Date().toISOString(), message: msg };
        if (data) entry.data = data;
        logs.push(entry);
        console.log(msg, data || '');
    };

    try {
        log('Starting enhanced debug for content ID:', id);

        // Test 1: Create guest account
        log('Step 1: Creating guest account...');
        let accountToken = null;
        
        try {
            const accountRes = await fetch('https://api.gofile.io/accounts', {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                    'Origin': 'https://gofile.io',
                    'Referer': 'https://gofile.io/'
                }
            });
            
            const accountText = await accountRes.text();
            log('Guest account response:', accountText);
            
            const accountData = JSON.parse(accountText);
            
            if (accountData.status === 'ok' && accountData.data?.token) {
                accountToken = accountData.data.token;
                log('✅ Account token obtained successfully:', accountToken);
            } else {
                log('❌ Failed to get account token');
            }
        } catch (e) {
            log('❌ Error creating guest account:', e.message);
        }

        if (!accountToken) {
            return res.status(500).json({
                status: 'error',
                message: 'Failed to create guest account',
                logs: logs
            });
        }

        // Test 2: Get content info
        if (id) {
            log('Step 2: Getting content info...');
            
            try {
                const contentRes = await fetch(`https://api.gofile.io/contents/${id}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${accountToken}`,
                        'Cookie': `accountToken=${accountToken}`
                    }
                });
                
                const contentText = await contentRes.text();
                log('Content info response status:', contentRes.status);
                log('Content info response:', contentText.substring(0, 500));
                
                const contentData = JSON.parse(contentText);
                
                if (contentData.status === 'ok' && contentData.data) {
                    log('✅ Content info obtained successfully');
                    log('Content type:', contentData.data.type);
                    log('Content name:', contentData.data.name);
                    
                    // Test 3: Get direct links (if it's a folder)
                    if (contentData.data.type === 'folder') {
                        log('Step 3: Getting direct links for folder...');
                        
                        try {
                            const directRes = await fetch(`https://api.gofile.io/contents/${id}/directlinks`, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                    'Accept': 'application/json',
                                    'Authorization': `Bearer ${accountToken}`,
                                    'Cookie': `accountToken=${accountToken}`
                                }
                            });
                            
                            const directText = await directRes.text();
                            log('Direct links response status:', directRes.status);
                            log('Direct links response:', directText.substring(0, 500));
                            
                            const directData = JSON.parse(directText);
                            
                            if (directData.status === 'ok' && directData.data) {
                                log('✅ Direct links obtained successfully');
                                if (directData.data.contents) {
                                    const contentCount = Object.keys(directData.data.contents).length;
                                    log('Number of items with direct links:', contentCount);
                                }
                            } else {
                                log('❌ Failed to get direct links:', directData.message || 'Unknown error');
                            }
                        } catch (e) {
                            log('❌ Error getting direct links:', e.message);
                        }
                    }
                    // Test 3b: Get direct link (if it's a file)
                    else if (contentData.data.type === 'file') {
                        log('Step 3: Getting direct link for file...');
                        
                        try {
                            const directRes = await fetch(`https://api.gofile.io/contents/${id}/directlinks`, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                    'Accept': 'application/json',
                                    'Authorization': `Bearer ${accountToken}`,
                                    'Cookie': `accountToken=${accountToken}`
                                }
                            });
                            
                            const directText = await directRes.text();
                            log('Direct link response status:', directRes.status);
                            log('Direct link response:', directText.substring(0, 500));
                            
                            const directData = JSON.parse(directText);
                            
                            if (directData.status === 'ok' && directData.data?.directLink) {
                                log('✅ Direct link obtained successfully');
                                log('Direct link URL:', directData.data.directLink);
                            } else {
                                log('❌ Failed to get direct link:', directData.message || 'Unknown error');
                            }
                        } catch (e) {
                            log('❌ Error getting direct link:', e.message);
                        }
                    }
                } else {
                    log('❌ Failed to get content info:', contentData.message || 'Unknown error');
                }
            } catch (e) {
                log('❌ Error getting content info:', e.message);
            }
        }

        return res.status(200).json({
            status: 'debug_complete',
            logs: logs
        });

    } catch (error) {
        log('Fatal error:', error.message);
        return res.status(500).json({
            status: 'error',
            error: error.message,
            logs: logs
        });
    }
}
