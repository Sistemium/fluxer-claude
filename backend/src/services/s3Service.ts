import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import logger from '../utils/logger.js'

interface S3UploadResult {
  success: boolean
  url?: string
  key?: string
  error?: string
}

export class S3Service {
  private static instance: S3Service
  private s3: S3Client
  private bucketName: string
  private region: string

  constructor() {
    this.region = process.env.AWS_REGION || 'eu-west-1'
    this.bucketName = process.env.S3_IMAGES_BUCKET || 'fluxer-images'
    
    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    })

    logger.info('S3Service initialized', { 
      region: this.region,
      bucket: this.bucketName 
    })
  }

  static getInstance(): S3Service {
    if (!S3Service.instance) {
      S3Service.instance = new S3Service()
    }
    return S3Service.instance
  }

  /**
   * Upload base64 image data to S3
   */
  async uploadBase64Image(
    base64Data: string, 
    userId: string, 
    jobId: string
  ): Promise<S3UploadResult> {
    try {
      // Remove data:image/png;base64, prefix if present
      const cleanBase64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '')
      
      // Convert base64 to buffer
      const imageBuffer = Buffer.from(cleanBase64, 'base64')
      
      // Generate unique S3 key
      const timestamp = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
      const s3Key = `images/${userId}/${timestamp}/${jobId}.png`
      
      logger.info('Uploading image to S3', {
        userId,
        jobId,
        s3Key,
        sizeBytes: imageBuffer.length
      })

      // Upload to S3
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: imageBuffer,
        ContentType: 'image/png',
        ContentLength: imageBuffer.length,
        // Cache for 1 year
        CacheControl: 'max-age=31536000',
        // Set metadata
        Metadata: {
          userId,
          jobId,
          uploadedAt: new Date().toISOString()
        }
      })

      await this.s3.send(command)

      // Construct public URL
      const imageUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${s3Key}`

      logger.info('Image uploaded successfully', {
        userId,
        jobId,
        s3Key,
        imageUrl
      })

      return {
        success: true,
        url: imageUrl,
        key: s3Key
      }

    } catch (error) {
      logger.error('Failed to upload image to S3', {
        userId,
        jobId,
        error: error instanceof Error ? error.message : error
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown S3 upload error'
      }
    }
  }

  /**
   * Delete image from S3
   */
  async deleteImage(s3Key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key
      })

      await this.s3.send(command)

      logger.info('Image deleted from S3', { s3Key })
      return true

    } catch (error) {
      logger.error('Failed to delete image from S3', {
        s3Key,
        error: error instanceof Error ? error.message : error
      })
      return false
    }
  }

  /**
   * Extract S3 key from image URL
   */
  extractS3Key(imageUrl: string): string | null {
    try {
      // Match patterns like:
      // https://bucket.s3.region.amazonaws.com/path/to/image.png
      // https://s3.region.amazonaws.com/bucket/path/to/image.png
      
      if (imageUrl.includes(`${this.bucketName}.s3.${this.region}.amazonaws.com/`)) {
        return imageUrl.split(`${this.bucketName}.s3.${this.region}.amazonaws.com/`)[1] || null
      }
      
      if (imageUrl.includes(`s3.${this.region}.amazonaws.com/${this.bucketName}/`)) {
        return imageUrl.split(`s3.${this.region}.amazonaws.com/${this.bucketName}/`)[1] || null
      }

      return null
    } catch {
      return null
    }
  }

  getBucketName(): string {
    return this.bucketName
  }

  getRegion(): string {
    return this.region
  }
}