// src/utils/remoteStorage.js
const { Redis } = require('@upstash/redis');

async function getTraktTokens(userConfig) {
    if (!userConfig.upstashUrl || !userConfig.upstashToken || !userConfig.traktUuid) {
        console.log('[UPSTASH] getTraktTokens: Missing required credentials');
        return null;
    }

    try {
        const redis = new Redis({
            url: userConfig.upstashUrl,
            token: userConfig.upstashToken,
        });

        const redisKey = `trakt:${userConfig.traktUuid}`;
        console.log(`[UPSTASH] Attempting to get tokens from Redis key: ${redisKey}`);
        
        const data = await redis.get(redisKey);
        console.log(`[UPSTASH] Retrieved tokens:`, {
            found: !!data,
            hasAccessToken: !!data?.accessToken,
            hasRefreshToken: !!data?.refreshToken,
            expiresAt: data?.expiresAt
        });
        
        return data;
    } catch (error) {
        console.error('Upstash Error: Failed to get Trakt tokens:', error.message);
        return null;
    }
}

async function saveTraktTokens(userConfig, tokens) {
    if (!userConfig.upstashUrl || !userConfig.upstashToken || !userConfig.traktUuid) {
        console.log('[UPSTASH] saveTraktTokens: Missing required credentials');
        return;
    }

     try {
        const redis = new Redis({
            url: userConfig.upstashUrl,
            token: userConfig.upstashToken,
        });

        const redisKey = `trakt:${userConfig.traktUuid}`;
        console.log(`[UPSTASH] Saving tokens to Redis key: ${redisKey}`);
        console.log(`[UPSTASH] Tokens being saved:`, {
            hasAccessToken: !!tokens.accessToken,
            hasRefreshToken: !!tokens.refreshToken,
            expiresAt: tokens.expiresAt
        });
        
        await redis.set(redisKey, tokens);
        console.log(`[UPSTASH] Successfully saved tokens to Redis`);
        
        // Verify the save by reading back immediately
        const verification = await redis.get(redisKey);
        console.log(`[UPSTASH] Verification read back:`, {
            hasAccessToken: !!verification?.accessToken,
            hasRefreshToken: !!verification?.refreshToken,
            expiresAt: verification?.expiresAt
        });
        
    } catch (error) {
        console.error('Upstash Error: Failed to save Trakt tokens:', error.message);
        throw error; // Re-throw to ensure calling code knows it failed
    }
}

module.exports = { getTraktTokens, saveTraktTokens };