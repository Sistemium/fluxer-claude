import mongoose, { Document, Schema } from 'mongoose'

export interface IImage extends Document {
  userId: string
  prompt: string
  imageUrl: string
  width: number
  height: number
  guidanceScale: number
  numInferenceSteps: number
  seed?: number
  jobId: string
  status: 'generating' | 'completed' | 'failed'
  createdAt: Date
  updatedAt: Date
}

const ImageSchema = new Schema<IImage>({
  userId: { type: String, required: true, index: true },
  prompt: { type: String, required: true },
  imageUrl: { type: String },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  guidanceScale: { type: Number, required: true },
  numInferenceSteps: { type: Number, required: true },
  seed: { type: Number },
  jobId: { type: String, required: true, unique: true },
  status: { 
    type: String, 
    enum: ['generating', 'completed', 'failed'], 
    default: 'generating' 
  }
}, {
  timestamps: true
})

// Index for efficient queries
ImageSchema.index({ userId: 1, createdAt: -1 })
ImageSchema.index({ jobId: 1 })

export const Image = mongoose.model<IImage>('Image', ImageSchema)