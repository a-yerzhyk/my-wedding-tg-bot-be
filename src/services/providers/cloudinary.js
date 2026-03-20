const cloudinary = require('cloudinary').v2

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

module.exports = {
  async upload(buffer, { folder, mimetype }) {
    const resourceType = mimetype.startsWith('video/') ? 'video' : 'image'

    const uploadOptions = { folder, resource_type: resourceType }
    if (resourceType === 'image') uploadOptions.format = 'jpg'

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) reject(error)
          else resolve(result)
        }
      ).end(buffer)
    })

    const thumbnailUrl = cloudinary.url(result.public_id, {
      resource_type: resourceType,
      width: 400,
      height: 400,
      crop: 'fill',
      quality: 'auto',
      format: resourceType === 'video' ? 'jpg' : 'webp'
    })

    return {
      cloudId: result.public_id,
      url: result.secure_url,
      thumbnailUrl,
      width: result.width,
      height: result.height,
      duration: result.duration ?? null
    }
  },

  async delete(cloudId, { type = 'photo' } = {}) {
    const resourceType = type === 'video' ? 'video' : 'image'
    await cloudinary.uploader.destroy(cloudId, { resource_type: resourceType })
  },

  getThumbnail(cloudId, { width = 400, height = 400, type = 'photo' } = {}) {
    return cloudinary.url(cloudId, {
      resource_type: type === 'video' ? 'video' : 'image',
      width,
      height,
      crop: 'fill',
      quality: 'auto',
      format: type === 'video' ? 'jpg' : 'webp'
    })
  }
}
