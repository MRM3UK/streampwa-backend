// /api/debug.js - Complete API Tester

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const { id } = req.query;
    const results = {
        contentId: id,
        steps: [],
        success: false
    };

    const addStep = (name, data) => {
        results.steps.push({ step: name, ...data });
        console.log(`[${name}]`, JSON.stringify(data).substring(0, 300));
    };

    try {
        // ==========================================
        // STEP 1: Create Guest Account
        // ==========================================
        addStep('1_create_account', { status: 'starting' });
        
        const accountResponse = await fetch('https://api.gofile.io/accounts', {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Origin': 'https://gofile.io',
                'Referer': 'https://gofile.io/'
            }
        });

        const accountText = await accountResponse.text();
        let accountData;
        
        try {
            accountData = JSON.parse(accountText);
        } catch (e) {
            addStep('1_create_account', { 
                status: 'error', 
                error: 'Invalid JSON', 
                raw: accountText.substring(0, 200) 
            });
            throw new Error('Invalid account response');
        }

        addStep('1_create_account', { 
            status: accountData.status,
            hasToken: !!accountData.data?.token,
            response: accountData
        });

        if (accountData.status !== 'ok' || !accountData.data?.token) {
            throw new Error('Failed to create guest account');
        }

        const accountToken = accountData.data.token;

        // ==========================================
        // STEP 2: Try to get website token from JS
        // ==========================================
        addStep('2_website_token', { status: 'starting' });
        
        let websiteToken = null;
        
        try {
            const jsResponse = await fetch('https://gofile.io/dist/js/alljs.js', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Referer': 'https://gofile.io/'
                }
            });

            if (jsResponse.ok) {
                const jsText = await jsResponse.text();
                
                // Try multiple patterns
                const patterns = [
                    /fetchData\.wt\s*=\s*["']([^"']+)["']/,
                    /wt\s*[:=]\s*["']([^"']+)["']/,
                    /websiteToken\s*[:=]\s*["']([^"']+)["']/,
                    /["']wt["']\s*:\s*["']([^"']+)["']/
                ];

                for (const pattern of patterns) {
                    const match = jsText.match(pattern);
                    if (match && match[1]) {
                        websiteToken = match[1];
                        break;
                    }
                }
                
                addStep('2_website_token', { 
                    status: 'ok', 
                    found: !!websiteToken,
                    token: websiteToken 
                });
            } else {
                addStep('2_website_token', { 
                    status: 'failed', 
                    httpStatus: jsResponse.status 
                });
            }
        } catch (e) {
            addStep('2_website_token', { 
                status: 'error', 
                error: e.message 
            });
        }

        // Use fallback if not found
        if (!websiteToken) {
            websiteToken = '4fd6sg89d7s6';
            addStep('2_website_token_fallback', { 
                using: websiteToken 
            });
        }

        // ==========================================
        // STEP 3: Test content endpoint WITHOUT wt
        // ==========================================
        if (id) {
            addStep('3_content_no_wt', { status: 'starting', url: `https://api.gofile.io/contents/${id}` });
            
            try {
                const contentRes1 = await fetch(`https://api.gofile.io/contents/${id}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${accountToken}`,
                        'Origin': 'https://gofile.io',
                        'Referer': 'https://gofile.io/'
                    }
                });

                const contentText1 = await contentRes1.text();
                let contentData1;
                
                try {
                    contentData1 = JSON.parse(contentText1);
                } catch (e) {
                    contentData1 = { raw: contentText1.substring(0, 300) };
                }

                addStep('3_content_no_wt', { 
                    httpStatus: contentRes1.status,
                    response: contentData1
                });
            } catch (e) {
                addStep('3_content_no_wt', { 
                    status: 'error', 
                    error: e.message 
                });
            }

            // ==========================================
            // STEP 4: Test content endpoint WITH wt
            // ==========================================
            addStep('4_content_with_wt', { status: 'starting', url: `https://api.gofile.io/contents/${id}?wt=${websiteToken}` });
            
            try {
                const contentRes2 = await fetch(`https://api.gofile.io/contents/${id}?wt=${websiteToken}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${accountToken}`,
                        'Origin': 'https://gofile.io',
                        'Referer': 'https://gofile.io/',
                        'Cookie': `accountToken=${accountToken}`
                    }
                });

                const contentText2 = await contentRes2.text();
                let contentData2;
                
                try {
                    contentData2 = JSON.parse(contentText2);
                } catch (e) {
                    contentData2 = { raw: contentText2.substring(0, 500) };
                }

                addStep('4_content_with_wt', { 
                    httpStatus: contentRes2.status,
                    response: contentData2
                });

                // If successful, try to get direct links
                if (contentData2.status === 'ok') {
                    results.contentInfo = contentData2.data;
                    
                    // ==========================================
                    // STEP 5: Test direct links endpoint
                    // ==========================================
                    addStep('5_direct_links', { status: 'starting' });
                    
                    try {
                        const directRes = await fetch(`https://api.gofile.io/contents/${id}/directlinks`, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                                'Accept': 'application/json',
                                'Authorization': `Bearer ${accountToken}`,
                                'Origin': 'https://gofile.io',
                                'Referer': 'https://gofile.io/',
                                'Cookie': `accountToken=${accountToken}`
                            }
                        });

                        const directText = await directRes.text();
                        let directData;
                        
                        try {
                            directData = JSON.parse(directText);
                        } catch (e) {
                            directData = { raw: directText.substring(0, 500) };
                        }

                        addStep('5_direct_links', { 
                            httpStatus: directRes.status,
                            response: directData
                        });

                        if (directData.status === 'ok') {
                            results.directLinks = directData.data;
                            results.success = true;
                        }
                    } catch (e) {
                        addStep('5_direct_links', { 
                            status: 'error', 
                            error: e.message 
                        });
                    }
                }
            } catch (e) {
                addStep('4_content_with_wt', { 
                    status: 'error', 
                    error: e.message 
                });
            }

            // ==========================================
            // STEP 6: Alternative - Try getContent endpoint
            // ==========================================
            addStep('6_get_content', { status: 'starting', url: `https://api.gofile.io/getContent?contentId=${id}&token=${accountToken}&wt=${websiteToken}` });
            
            try {
                const getContentRes = await fetch(`https://api.gofile.io/getContent?contentId=${id}&token=${accountToken}&wt=${websiteToken}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                        'Accept': 'application/json',
                        'Origin': 'https://gofile.io',
                        'Referer': 'https://gofile.io/'
                    }
                });

                const getContentText = await getContentRes.text();
                let getContentData;
                
                try {
                    getContentData = JSON.parse(getContentText);
                } catch (e) {
                    getContentData = { raw: getContentText.substring(0, 500) };
                }

                addStep('6_get_content', { 
                    httpStatus: getContentRes.status,
                    response: getContentData
                });

                if (getContentData.status === 'ok' && !results.success) {
                    results.contentInfo = getContentData.data;
                    results.success = true;
                }
            } catch (e) {
                addStep('6_get_content', { 
                    status: 'error', 
                    error: e.message 
                });
            }
        }

        results.accountToken = accountToken;
        results.websiteToken = websiteToken;

        return res.status(200).json(results);

    } catch (error) {
        results.error = error.message;
        return res.status(500).json(results);
    }
}
