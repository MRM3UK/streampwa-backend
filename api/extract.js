/**
 * Xtream Codes API Extractor
 * Serverless function for Vercel
 */

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: 'Method not allowed'
        });
    }

    try {
        const { server, username, password, type } = req.body;

        // Validate
        if (!server || !username || !password || !type) {
            return res.status(400).json({
                error: 'Missing required fields'
            });
        }

        const validTypes = ['live', 'vod', 'series'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                error: 'Invalid type'
            });
        }

        const cleanServer = server.replace(/\/+$/, '');

        // Validate URL
        try {
            new URL(cleanServer);
        } catch {
            return res.status(400).json({
                error: 'Invalid server URL'
            });
        }

        const baseParams = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
        
        const fetchOptions = {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        };

        // First, get user info
        const infoUrl = `${cleanServer}/player_api.php?${baseParams}`;
        let userInfo = null;

        try {
            const infoResponse = await fetch(infoUrl, fetchOptions);
            if (infoResponse.ok) {
                const infoData = await infoResponse.json();
                
                // Check auth
                if (infoData.user_info && infoData.user_info.auth === 0) {
                    return res.status(401).json({
                        error: 'Invalid credentials'
                    });
                }

                if (infoData.user_info) {
                    userInfo = {
                        username: infoData.user_info.username,
                        status: infoData.user_info.status,
                        exp_date: infoData.user_info.exp_date,
                        is_trial: infoData.user_info.is_trial,
                        active_cons: infoData.user_info.active_cons,
                        created_at: infoData.user_info.created_at,
                        max_connections: infoData.user_info.max_connections,
                        allowed_output_formats: infoData.user_info.allowed_output_formats
                    };
                }

                // Also get server info if available
                if (infoData.server_info) {
                    userInfo.server_url = infoData.server_info.url;
                    userInfo.server_port = infoData.server_info.port;
                    userInfo.server_protocol = infoData.server_info.server_protocol;
                    userInfo.timezone = infoData.server_info.timezone;
                }
            }
        } catch (e) {
            // Continue without user info
        }

        // Action mappings
        const actionMap = {
            live: { categories: 'get_live_categories', streams: 'get_live_streams' },
            vod: { categories: 'get_vod_categories', streams: 'get_vod_streams' },
            series: { categories: 'get_series_categories', streams: 'get_series' }
        };

        const actions = actionMap[type];

        // Fetch categories
        const categoryUrl = `${cleanServer}/player_api.php?${baseParams}&action=${actions.categories}`;
        let categories = [];
        
        try {
            const catResponse = await fetch(categoryUrl, fetchOptions);
            if (catResponse.ok) {
                const catData = await catResponse.json();
                if (Array.isArray(catData)) {
                    categories = catData;
                }
            }
        } catch (e) {}

        // Category map
        const categoryMap = {};
        categories.forEach(cat => {
            categoryMap[cat.category_id] = cat.category_name;
        });

        // Fetch streams
        const streamsUrl = `${cleanServer}/player_api.php?${baseParams}&action=${actions.streams}`;
        const streamsResponse = await fetch(streamsUrl, fetchOptions);

        if (!streamsResponse.ok) {
            return res.status(502).json({
                error: `Server returned ${streamsResponse.status}`
            });
        }

        const streamsData = await streamsResponse.json();

        if (!Array.isArray(streamsData)) {
            // Check if it's an auth error
            if (streamsData && streamsData.user_info && streamsData.user_info.auth === 0) {
                return res.status(401).json({
                    error: 'Invalid credentials'
                });
            }
            
            return res.status(500).json({
                error: 'Invalid response from server'
            });
        }

        // Process streams
        const processedStreams = streamsData.map(stream => {
            const categoryName = categoryMap[stream.category_id] || 
                                stream.category_name || 
                                'Uncategorized';

            return {
                stream_id: stream.stream_id || stream.series_id || stream.num,
                name: stream.name || stream.title || 'Unknown',
                stream_icon: stream.stream_icon || stream.cover || '',
                category_id: stream.category_id || '',
                category_name: categoryName,
                rating: stream.rating || '',
                added: stream.added || '',
                year: stream.year || stream.releaseDate || '',
                duration: stream.duration || '',
                plot: stream.plot || '',
                cast: stream.cast || '',
                director: stream.director || '',
                genre: stream.genre || ''
            };
        });

        return res.status(200).json({
            success: true,
            type: type,
            count: processedStreams.length,
            streams: processedStreams,
            categories: categories.length,
            userInfo: userInfo
        });

    } catch (error) {
        console.error('API Error:', error.message);

        if (error.name === 'AbortError' || error.message.includes('timeout')) {
            return res.status(504).json({
                error: 'Request timeout'
            });
        }

        if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
            return res.status(502).json({
                error: 'Connection failed'
            });
        }

        return res.status(500).json({
            error: 'Internal server error'
        });
    }
}

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '1mb',
        },
        maxDuration: 30,
    },
};
