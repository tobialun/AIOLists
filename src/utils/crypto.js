// src/utils/crypto.js
const crypto = require('crypto');

// Ensure the encryption key is set in your environment variables
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    throw new Error('FATAL: ENCRYPTION_KEY environment variable must be set and be a 64-character hex string (32 bytes).');
}

const key = Buffer.from(ENCRYPTION_KEY, 'hex');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For GCM, the recommended IV length is 12, but 16 is also common and secure.
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts a plaintext string.
 * @param {string} text The plaintext to encrypt.
 * @returns {string} The encrypted string, formatted as 'iv:authtag:encrypted'.
 */
function encrypt(text) {
    if (text === null || typeof text === 'undefined') {
        return null;
    }
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an encrypted string.
 * @param {string} encryptedText The encrypted string in 'iv:authtag:encrypted' format.
 * @returns {string|null} The decrypted plaintext, or null if decryption fails.
 */
function decrypt(encryptedText) {
    if (encryptedText === null || typeof encryptedText === 'undefined') {
        return null;
    }
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted text format.');
        }
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('Decryption failed:', error.message);
        // Return null or handle the error as appropriate for your application
        return null;
    }
}

module.exports = { encrypt, decrypt };