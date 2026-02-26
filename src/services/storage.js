// Storage abstraction layer — routes never talk to a cloud provider directly.
// To switch providers: change STORAGE_PROVIDER in .env
// To add a new provider: create src/services/providers/<name>.js with the same interface

const provider = process.env.STORAGE_PROVIDER || 'cloudinary'

let storageProvider
try {
  storageProvider = require(`./providers/${provider}`)
} catch {
  throw new Error(`Storage provider "${provider}" not found. Check STORAGE_PROVIDER in .env`)
}

module.exports = {
  /**
   * Upload a file buffer to cloud storage
   * @param {Buffer} buffer - file buffer
   * @param {Object} options - { folder, mimetype }
   * @returns {Object} - { cloudId, url, thumbnailUrl, width, height }
   */
  upload: (buffer, options) => storageProvider.upload(buffer, options),

  /**
   * Delete a file from cloud storage
   * @param {string} cloudId - the provider's file identifier
   * @param {Object} options - { type } — 'photo' or 'video'
   */
  delete: (cloudId, options) => storageProvider.delete(cloudId, options),

  /**
   * Get a thumbnail URL for an existing file
   * @param {string} cloudId
   * @param {Object} options - { width, height }
   * @returns {string} thumbnail URL
   */
  getThumbnail: (cloudId, options) => storageProvider.getThumbnail(cloudId, options)
}
