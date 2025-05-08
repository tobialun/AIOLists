/**
 * Cache implementation with TTL support
 */
class Cache {
  constructor() {
    this.cache = new Map();
  }

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

  get(key) {
    if (!this.has(key)) return null;
    return this.cache.get(key).value;
  }

  set(key, value, ttl) {
    const expiry = Date.now() + ttl;
    this.cache.set(key, { value, expiry });
    return true;
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = Cache; 