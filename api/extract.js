/**
 * Xtream Codes API Extractor
 * Serverless function for Vercel
 * 
 * This function acts as a proxy to fetch data from Xtream Codes API
 * and returns clean, formatted JSON to the frontend.
 */

// Enable CORS for all origins
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

export default async function handler(req, res) {
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).json({});
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

        // Clean server URL (remove trailing slash)
        const cleanServer = server.replace(/\/+$/, '');

        // Build API URL
        const apiUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

        // Fetch data from Xtream API
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
            },
            // Set timeout to 30 seconds
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Check if authentication was successful
        if (data.user_info && data.user_info.auth === 0) {
            return res.status(401).json({
                error: 'Authentication failed',
                message: 'Invalid username or password'
            });
        }

        // Fetch categories for the specific type
        let categoryUrl = '';
        if (type === 'live') {
            categoryUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`;
        } else if (type === 'vod') {
            categoryUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_vod_categories`;
        } else if (type === 'series') {
            categoryUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_categories`;
        }

        const categoriesResponse = await fetch(categoryUrl, {
            signal: AbortSignal.timeout(30000)
        });
        const categories = categoriesResponse.ok ? await categoriesResponse.json() : [];

        // Create category map for faster lookups
        const categoryMap = {};
        if (Array.isArray(categories)) {
            categories.forEach(cat => {
                categoryMap[cat.category_id] = cat.category_name;
            });
        }

        // Fetch streams for the specific type
        let streamsUrl = '';
        if (type === 'live') {
            streamsUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
        } else if (type === 'vod') {
            streamsUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_vod_streams`;
        } else if (type === 'series') {
            streamsUrl = `${cleanServer}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series`;
        }

        const streamsResponse = await fetch(streamsUrl, {
            signal: AbortSignal.timeout(30000)
        });

        if (!streamsResponse.ok) {
            throw new Error('Failed to fetch streams');
        }

        const streams = await streamsResponse.json();

        if (!Array.isArray(streams)) {
            return res.status(500).json({
                error: 'Invalid response',
                message: 'API did not return valid stream data'
            });
        }

        // Process and clean stream data
        const processedStreams = streams.map(stream => {
            // Map category ID to category name
            const categoryName = categoryMap[stream.category_id] || 
                                stream.category_name || 
                                'Uncategorized';

            return {
                stream_id: stream.stream_id || stream.series_id || stream.num,
                name: stream.name || stream.title || 'Unknown',
                stream_icon: stream.stream_icon || stream.cover || '',
                category_id: stream.category_id || '',
                category_name: categoryName,
                // Additional metadata for VOD/Series
                rating: stream.rating || '',
                added: stream.added || '',
                year: stream.year || stream.releaseDate || '',
                duration: stream.duration || ''
            };
        });

        // Return clean data
        return res.status(200).json({
            success: true,
            type: type,
            count: processedStreams.length,
            streams: processedStreams,
            // Include user info (without sensitive data)
            userInfo: data.user_info ? {
                username: data.user_info.username,
                status: data.user_info.status,
                exp_date: data.user_info.exp_date,
                active_cons: data.user_info.active_cons,
                max_connections: data.user_info.max_connections
            } : null
        });

    } catch (error) {
        console.error('API Error:', error.message);

        // Handle different error types
        if (error.name === 'AbortError') {
            return res.status(504).json({
                error: 'Request timeout',
                message: 'The server took too long to respond'
            });
        }

        if (error.message.includes('fetch')) {
            return res.status(502).json({
                error: 'Connection failed',
                message: 'Could not connect to the Xtream server. Please check the server URL.'
            });
        }

        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

// Export config for Vercel
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '1mb',
        },
    },
};
