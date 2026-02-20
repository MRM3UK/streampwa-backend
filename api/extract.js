export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only POST allowed
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { server, username, password, type } = req.body;

        // Validate required fields
        if (!server || !username || !password || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate type
        const validTypes = ['live', 'vod', 'series'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: 'Invalid type. Must be live, vod, or series' });
        }

        // Clean and validate server URL
        const cleanServer = server.replace(/\/+$/, '');
        try {
            new URL(cleanServer);
        } catch {
            return res.status(400).json({ error: 'Invalid server URL' });
        }

        // Build base params
        const baseParams = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

        // Fetch options
        const fetchOptions = {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        };

        // Get user info first
        let userInfo = null;
        try {
            const infoUrl = `${cleanServer}/player_api.php?${baseParams}`;
            const infoResponse = await fetch(infoUrl, fetchOptions);
            
            if (infoResponse.ok) {
                const infoData = await infoResponse.json();
                
                // Check authentication
                if (infoData.user_info && infoData.user_info.auth === 0) {
                    return res.status(401).json({ error: 'Invalid username or password' });
                }

                // Extract user info
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

                // Add server info if available
                if (infoData.server_info) {
                    userInfo.server_url = infoData.server_info.url;
                    userInfo.server_port = infoData.server_info.port;
                    userInfo.server_protocol = infoData.server_info.server_protocol;
                    userInfo.timezone = infoData.server_info.timezone;
                }
            }
        } catch (e) {
            // Continue without user info if it fails
            console.error('Failed to fetch user info:', e.message);
        }

        // Define actions for each type
        const actionMap = {
            live: {
                categories: 'get_live_categories',
                streams: 'get_live_streams'
            },
            vod: {
                categories: 'get_vod_categories',
                streams: 'get_vod_streams'
            },
            series: {
                categories: 'get_series_categories',
                streams: 'get_series'
            }
        };

        const actions = actionMap[type];

        // Fetch categories
        let categories = [];
        try {
            const categoryUrl = `${cleanServer}/player_api.php?${baseParams}&action=${actions.categories}`;
            const catResponse = await fetch(categoryUrl, fetchOptions);
            
            if (catResponse.ok) {
                const catData = await catResponse.json();
                if (Array.isArray(catData)) {
                    categories = catData;
                }
            }
        } catch (e) {
            // Categories are optional, continue without them
            console.error('Failed to fetch categories:', e.message);
        }

        // Create category lookup map
        const categoryMap = {};
        categories.forEach(cat => {
            if (cat.category_id && cat.category_name) {
                categoryMap[cat.category_id] = cat.category_name;
            }
        });

        // Fetch streams
        const streamsUrl = `${cleanServer}/player_api.php?${baseParams}&action=${actions.streams}`;
        const streamsResponse = await fetch(streamsUrl, fetchOptions);

        if (!streamsResponse.ok) {
            // Try to get error message
            let errorMsg = `Server returned ${streamsResponse.status}`;
            try {
                const errorData = await streamsResponse.json();
                if (errorData.user_info && errorData.user_info.auth === 0) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                if (errorData.message) {
                    errorMsg = errorData.message;
                }
            } catch {}
            
            return res.status(502).json({ error: errorMsg });
        }

        let streamsData;
        try {
            streamsData = await streamsResponse.json();
        } catch (e) {
            return res.status(502).json({ error: 'Invalid JSON response from server' });
        }

        // Check if response indicates auth failure
        if (streamsData && streamsData.user_info && streamsData.user_info.auth === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Validate streams data
        if (!Array.isArray(streamsData)) {
            return res.status(500).json({ error: 'Server did not return valid stream data' });
        }

        // Process and clean stream data
        const processedStreams = streamsData.map(stream => {
            // Get category name from map or use existing
            const categoryName = categoryMap[stream.category_id] || 
                                stream.category_name || 
                                'Uncategorized';

            return {
                stream_id: stream.stream_id || stream.series_id || stream.num,
                name: stream.name || stream.title || 'Unknown',
                stream_icon: stream.stream_icon || stream.cover || '',
                category_id: stream.category_id || '',
                category_name: categoryName,
                // Additional metadata
                rating: stream.rating || '',
                rating_5based: stream.rating_5based || '',
                added: stream.added || '',
                year: stream.year || stream.releaseDate || '',
                duration: stream.duration || '',
                duration_secs: stream.duration_secs || '',
                plot: stream.plot || '',
                cast: stream.cast || '',
                director: stream.director || '',
                genre: stream.genre || '',
                release_date: stream.release_date || stream.releaseDate || '',
                last_modified: stream.last_modified || '',
                tmdb_id: stream.tmdb_id || '',
                // For series
                num: stream.num || '',
                series_id: stream.series_id || '',
                episode_run_time: stream.episode_run_time || '',
                // Stream specific
                container_extension: stream.container_extension || '',
                custom_sid: stream.custom_sid || '',
                epg_channel_id: stream.epg_channel_id || '',
                tv_archive: stream.tv_archive || 0,
                tv_archive_duration: stream.tv_archive_duration || 0
            };
        });

        // Return success response
        return res.status(200).json({
            success: true,
            type: type,
            count: processedStreams.length,
            streams: processedStreams,
            categories: categories.length,
            userInfo: userInfo
        });

    } catch (error) {
        // Log error server-side (no credentials)
        console.error('API Error:', error.message);

        // Handle specific error types
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
            return res.status(504).json({
                error: 'Request timeout - server took too long to respond'
            });
        }

        if (error.message.includes('fetch') || 
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('ENOTFOUND') ||
            error.message.includes('network')) {
            return res.status(502).json({
                error: 'Connection failed - check server URL'
            });
        }

        if (error.message.includes('JSON')) {
            return res.status(502).json({
                error: 'Invalid response from server'
            });
        }

        // Generic error
        return res.status(500).json({
            error: 'An unexpected error occurred'
        });
    }
}

// Vercel configuration
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '1mb',
        },
        // Increase timeout for slow IPTV servers
        maxDuration: 30,
    },
};
