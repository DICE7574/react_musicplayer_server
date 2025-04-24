const axios = require('axios');

module.exports = (app, io, YOUTUBE_API_KEY) => {
    app.get('/youtube/search', async (req, res) => {
        const { query } = req.query;
        if (!query) return res.status(400).json({ success: false, message: '쿼리가 없습니다.' });

        try {
            const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
                params: {
                    part: 'snippet',
                    q: query,
                    type: 'video',
                    key: YOUTUBE_API_KEY,
                    maxResults: 10,
                },
            });

            const items = searchRes.data.items;
            const ids = items.map(item => item.id.videoId).join(',');

            const detailRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: {
                    part: 'contentDetails',
                    id: ids,
                    key: YOUTUBE_API_KEY,
                },
            });

            const durationsMap = {};
            detailRes.data.items.forEach(item => {
                durationsMap[item.id] = item.contentDetails.duration;
            });

            const mergedItems = items.map(item => ({
                ...item,
                contentDetails: {
                    duration: durationsMap[item.id.videoId] || null
                }
            }));

            res.json({ success: true, items: mergedItems });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: 'YouTube 검색 실패' });
        }
    });
};
