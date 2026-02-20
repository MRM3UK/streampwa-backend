// /api/test.js - Test Gofile API endpoints

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const { id = 'LIr3Qi' } = req.query;
    const results = {};

    try {
        // Step 1: Create account
        console.log('Creating guest account...');
        const accountRes = await fetch('https://api.gofile.io/accounts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        const accountData = await accountRes.json();
        results.account = accountData;

        if (accountData.status !== 'ok') {
            throw new Error('Failed to create account');
        }

        const token = accountData.data.token;
        console.log('Token:', token);

        // Step 2: Test /contents endpoint
        console.log('Testing /contents endpoint...');
        const contentsRes = await fetch(`https://api.gofile.io/contents/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });
        const contentsData = await contentsRes.json();
        results.contents = {
            status: contentsRes.status,
            data: contentsData
        };

        // Step 3: If we got children, try to get direct links for one file
        if (contentsData.status === 'ok' && contentsData.data?.children) {
            const children = Object.values(contentsData.data.children);
            const firstFile = children.find(c => c.type === 'file');
            
            if (firstFile) {
                console.log('Testing /directlinks endpoint...');
                const directLinksRes = await fetch(`https://api.gofile.io/contents/${id}/directlinks`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json'
                    }
                });
                
                if (directLinksRes.ok) {
                    const directLinksData = await directLinksRes.json();
                    results.directLinks = directLinksData;
                } else {
                    results.directLinks = {
                        status: directLinksRes.status,
                        error: 'Endpoint not available or requires different auth'
                    };
                }

                // Show sample file info
                results.sampleFile = {
                    id: firstFile.id,
                    name: firstFile.name,
                    size: firstFile.size,
                    link: firstFile.link,
                    hasDirectLink: !!firstFile.link
                };
            }
        }

        return res.status(200).json({
            status: 'ok',
            contentId: id,
            results: results
        });

    } catch (error) {
        return res.status(500).json({
            status: 'error',
            message: error.message,
            results: results
        });
    }
}
