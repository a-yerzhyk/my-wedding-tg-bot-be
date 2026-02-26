const cloudinary = require('cloudinary').v2

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

module.exports = {
  async upload(buffer, { folder, mimetype }) {
    // When adding video support, resource_type will be determined by mimetype:
    // const resourceType = mimetype.startsWith('video') ? 'video' : 'image'
    const resourceType = 'image'

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder, resource_type: resourceType },
        (error, result) => {
          if (error) reject(error)
          else resolve(result)
        }
      ).end(buffer)
    })

    const thumbnailUrl = cloudinary.url(result.public_id, {
      width: 400,
      height: 400,
      crop: 'fill',
      quality: 'auto',
      format: 'webp'
    })

    return {
      cloudId: result.public_id,
      url: result.secure_url,
      thumbnailUrl,
      width: result.width,
      height: result.height
    }
  },

  async delete(cloudId, { type = 'photo' } = {}) {
    // When adding video support:
    // const resourceType = type === 'video' ? 'video' : 'image'
    const resourceType = 'image'
    await cloudinary.uploader.destroy(cloudId, { resource_type: resourceType })
  },

  getThumbnail(cloudId, { width = 400, height = 400 } = {}) {
    return cloudinary.url(cloudId, {
      width,
      height,
      crop: 'fill',
      quality: 'auto',
      format: 'webp'
    })
  }
}
