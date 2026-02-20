// /api/test.js - Quick test with your credentials

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const { id } = req.query;
    
    if (!id) {
        return res.json({ error: 'No ID provided. Use ?id=2PVaWx' });
    }

    const results = {};

    try {
        // Test 1: Create new account
        const newAccountRes = await fetch('https://api.gofile.io/accounts', {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });
        const newAccount = await newAccountRes.json();
        results.newAccount = newAccount;

        const token = newAccount.data?.token;

        if (!token) {
            return res.json({ error: 'Failed to create account', results });
        }

        // Test 2: Try /getContent endpoint
        const getContentRes = await fetch(
            `https://api.gofile.io/getContent?contentId=${id}&token=${token}&wt=4fd6sg89d7s6`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Origin': 'https://gofile.io',
                    'Referer': 'https://gofile.io/'
                }
            }
        );
        const getContentText = await getContentRes.text();
        
        try {
            results.getContent = {
                status: getContentRes.status,
                data: JSON.parse(getContentText)
            };
        } catch (e) {
            results.getContent = {
                status: getContentRes.status,
                raw: getContentText.substring(0, 500),
                error: 'Invalid JSON'
            };
        }

        // Test 3: Try /contents endpoint
        const contentsRes = await fetch(
            `https://api.gofile.io/contents/${id}?token=${token}&wt=4fd6sg89d7s6`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Origin': 'https://gofile.io',
                    'Referer': 'https://gofile.io/'
                }
            }
        );
        const contentsText = await contentsRes.text();
        
        try {
            results.contents = {
                status: contentsRes.status,
                data: JSON.parse(contentsText)
            };
        } catch (e) {
            results.contents = {
                status: contentsRes.status,
                raw: contentsText.substring(0, 500),
                error: 'Invalid JSON'
            };
        }

        // Test 4: Try without wt parameter
        const noWtRes = await fetch(
            `https://api.gofile.io/getContent?contentId=${id}&token=${token}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                }
            }
        );
        const noWtText = await noWtRes.text();
        
        try {
            results.noWt = {
                status: noWtRes.status,
                data: JSON.parse(noWtText)
            };
        } catch (e) {
            results.noWt = {
                status: noWtRes.status,
                raw: noWtText.substring(0, 500),
                error: 'Invalid JSON'
            };
        }

        return res.json({
            success: true,
            contentId: id,
            testToken: token,
            results
        });

    } catch (error) {
        return res.json({
            error: error.message,
            results
        });
    }
}
