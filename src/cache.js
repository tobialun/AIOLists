/**
 * Cache implementation with TTL support and automatic cleanup
 */
class Cache {
  constructor(options = {}) {
    this.cache = new Map();
    this.defaultTTL = options.defaultTTL || 86400000; // 1 day in milliseconds
    this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes
    this._startCleanupInterval();
  }

  /**
   * Start the automatic cleanup interval
   * @private
   */
  _startCleanupInterval() {
    this._cleanupTimer = setInterval(() => {
      this._cleanup();
    }, this.cleanupInterval);
    
    // Prevent the interval from keeping the process alive
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * Clean up expired entries
   * @private
   */
  _cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (item.expiry < now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Check if a key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean} Whether the key exists and is valid
   */
  has(key) {
    if (!this.cache.has(key)) return false;
    
    const item = this.cache.get(key);
    const now = Date.now();
    
    // Check if the cached item has expired
    if (item.expiry < now) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or null if not found/expired
   */
  get(key) {
    if (!this.has(key)) return null;
    return this.cache.get(key).value;
  }

  /**
   * Set a value in cache with optional TTL
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} [ttl] - Time to live in milliseconds
   * @returns {boolean} Whether the operation was successful
   */
  set(key, value, ttl = this.defaultTTL) {
    const expiry = Date.now() + ttl;
    this.cache.set(key, { value, expiry });
    return true;
  }

  /**
   * Get multiple values from cache
   * @param {string[]} keys - Array of cache keys
   * @returns {Object} Object with found values
   */
  getMany(keys) {
    const result = {};
    for (const key of keys) {
      const value = this.get(key);
      if (value !== null) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Set multiple values in cache
   * @param {Object} entries - Object with key-value pairs
   * @param {number} [ttl] - Time to live in milliseconds
   */
  setMany(entries, ttl = this.defaultTTL) {
    for (const [key, value] of Object.entries(entries)) {
      this.set(key, value, ttl);
    }
  }

  /**
   * Delete a key from cache
   * @param {string} key - Cache key
   * @returns {boolean} Whether the key was deleted
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Stop the cleanup interval
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }
}

module.exports = Cache; 