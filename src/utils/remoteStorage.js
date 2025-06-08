// src/utils/remoteStorage.js
const { Redis } = require('@upstash/redis');

async function getTraktTokens(userConfig) {
    if (!userConfig.upstashUrl || !userConfig.upstashToken || !userConfig.traktUuid) {
        return null;
    }

    try {
        const redis = new Redis({
            url: userConfig.upstashUrl,
            token: userConfig.upstashToken,
        });

        const data = await redis.get(`trakt:${userConfig.traktUuid}`);
        return data;
    } catch (error) {
        console.error('Upstash Error: Failed to get Trakt tokens:', error.message);
        return null;
    }
}

async function saveTraktTokens(userConfig, tokens) {
    if (!userConfig.upstashUrl || !userConfig.upstashToken || !userConfig.traktUuid) {
        return;
    }

     try {
        const redis = new Redis({
            url: userConfig.upstashUrl,
            token: userConfig.upstashToken,
        });

        // Store the tokens object, setting it to expire in 90 days (the validity of a Trakt refresh token)
        await redis.set(`trakt:${userConfig.traktUuid}`, tokens, { ex: 1 * 24 * 60 * 60 });
    } catch (error) {
        console.error('Upstash Error: Failed to save Trakt tokens:', error.message);
    }
}

module.exports = { getTraktTokens, saveTraktTokens };