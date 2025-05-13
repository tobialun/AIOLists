const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Extract list ID from MDBList URL
 * @param {string} url - MDBList URL (e.g., https://mdblist.com/lists/username/list-name)
 * @returns {Promise<{listId: string, listName: string}>} List ID and name
 * @throws {Error} If list ID cannot be extracted
 */
async function extractMDBListId(url) {
  try {
    // Validate URL format
    const urlPattern = /^https?:\/\/mdblist\.com\/lists\/([\w-]+)\/([\w-]+)$/;
    const urlMatch = url.match(urlPattern);
    if (!urlMatch) {
      throw new Error('Invalid MDBList URL format');
    }

    const [, username, listName] = urlMatch;

    // Fetch the page content
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // Find the meta tag with og:image property
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (!ogImage) {
      throw new Error('Could not find list image metadata');
    }

    // Extract list ID from the image URL
    const idMatch = ogImage.match(/[?&]id=(\d+)/);
    if (!idMatch) {
      throw new Error('Could not extract list ID from image URL');
    }

    return {
      listId: idMatch[1],
      listName: listName
    };
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error('MDBList not found');
    }
    throw error;
  }
}

/**
 * Build manifest URL for MDBList
 * @param {string} listId - MDBList ID
 * @param {string} listName - List name from URL
 * @param {string} mdblistApiKey - MDBList API key
 * @param {string} type - Content type ('movie' or 'series')
 * @returns {string} Catalog URL
 */
function buildManifestUrl(listId, listName, mdblistApiKey, type) {
  const baseUrl = '1fe84bc728af-stremio-mdblist.baby-beamup.club';
  // Remove any special characters from the list name
  const safeName = listName.replace(/[^\w\s-]/g, '');
  // Create a unique catalog ID based on type
  const catalogId = `${listId}-${type}`;
  return `https://${baseUrl}/${catalogId}/${mdblistApiKey}/catalog/${type}/${safeName}.json`;
}

module.exports = {
  extractMDBListId,
  buildManifestUrl
}; 