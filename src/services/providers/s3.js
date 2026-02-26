// AWS S3 storage provider
// To use: npm install @aws-sdk/client-s3
// Then set STORAGE_PROVIDER=s3 in .env and fill in AWS_* variables

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { v4: uuidv4 } = require('uuid')

const client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
})

const BUCKET = process.env.AWS_BUCKET_NAME

module.exports = {
  async upload(buffer, { folder, mimetype }) {
    const ext = mimetype.split('/')[1] || 'jpg'
    const key = `${folder}/${uuidv4()}.${ext}`

    await client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimetype
    }))

    const url = `https://${BUCKET}.s3.amazonaws.com/${key}`

    // S3 has no built-in image transformations.
    // For thumbnails, add CloudFront + Lambda@Edge, or use imgproxy.
    return {
      cloudId: key,
      url,
      thumbnailUrl: url,
      width: null,
      height: null
    }
  },

  async delete(cloudId) {
    await client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: cloudId
    }))
  },

  getThumbnail(cloudId) {
    // Replace with CloudFront URL if configured
    return `https://${BUCKET}.s3.amazonaws.com/${cloudId}`
  }
}
