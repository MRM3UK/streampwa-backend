/**
 * Xtream Codes API Extractor
 * Serverless function for Vercel
 * 
 * Acts as a secure proxy to fetch data from Xtream Codes API
 * Returns clean, formatted JSON to the frontend.
 */

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: 'Method not allowed',
            message: 'Only POST requests are accepted'
        });
    }

    try {
        const { server, username, password, type } = req.body;

        // Validate input
        if (!server || !username || !password || !type) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'Please provide server, username, password, and type'
            });
        }

        // Validate type
        const validTypes = ['live', 'vod', 'series'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                error: 'Invalid type',
                message: 'Type must be live, vod, or series'
            });
        }

        // Clean server URL
        const cleanServer = server.replace(/\/+$/, '');

        // Validate URL format
        try {
            new URL(cleanServer);
        } catch {
            return res.status(400).json({
                error: 'Invalid server URL',
                message: 'Please provide a valid server URL'
            });
        }

        // Build API URLs
        const baseParams = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
        
        // Action mappings
        const actionMap = {
            live: { categories: 'get_live_categories', streams: 'get_live_streams' },
            vod: { categories: 'get_vod_categories', streams: 'get_vod_streams' },
            series: { categories: 'get_series_categories', streams: 'get_series' }
        };

        const actions = actionMap[type];

        // Fetch options
        const fetchOptions = {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        };

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
        } catch (e) {
            // Categories are optional, continue without them
        }

        // Create category map
        const categoryMap = {};
        categories.forEach(cat => {
            categoryMap[cat.category_id] = cat.category_name;
        });

        // Fetch streams
        const streamsUrl = `${cleanServer}/player_api.php?${baseParams}&action=${actions.streams}`;
        const streamsResponse = await fetch(streamsUrl, fetchOptions);

        if (!streamsResponse.ok) {
            // Try to get error details
            let errorMessage = `Server returned ${streamsResponse.status}`;
            try {
                const errorData = await streamsResponse.json();
                if (errorData.user_info && errorData.user_info.auth === 0) {
                    errorMessage = 'Invalid username or password';
                }
            } catch {
                // Ignore parse errors
            }
            
            return res.status(streamsResponse.status === 401 ? 401 : 502).json({
                error: 'Authentication failed',
                message: errorMessage
            });
        }

        const streamsData = await streamsResponse.json();

        // Check for auth failure in response
        if (streamsData && streamsData.user_info && streamsData.user_info.auth === 0) {
            return res.status(401).json({
                error: 'Authentication failed',
                message: 'Invalid username or password'
            });
        }

        // Validate streams data
        if (!Array.isArray(streamsData)) {
            return res.status(500).json({
                error: 'Invalid response',
                message: 'Server did not return valid stream data'
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
                duration: stream.duration || ''
            };
        });

        // Return success response
        return res.status(200).json({
            success: true,
            type: type,
            count: processedStreams.length,
            streams: processedStreams,
            categories: categories.length
        });

    } catch (error) {
        // Log error server-side only (no credentials)
        console.error('API Error:', error.message);

        // Handle specific error types
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
            return res.status(504).json({
                error: 'Request timeout',
                message: 'The server took too long to respond'
            });
        }

        if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
            return res.status(502).json({
                error: 'Connection failed',
                message: 'Could not connect to the server. Please check the URL.'
            });
        }

        if (error.message.includes('JSON')) {
            return res.status(502).json({
                error: 'Invalid response',
                message: 'Server returned invalid data'
            });
        }

        return res.status(500).json({
            error: 'Internal server error',
            message: 'An unexpected error occurred'
        });
    }
}

// Vercel config
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '1mb',
        },
        // Increase timeout for slow servers
        maxDuration: 30,
    },
};
