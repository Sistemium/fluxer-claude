import mongoose, { Document, Schema } from 'mongoose'

export interface ISpotRegion extends Document {
  regionCode: string
  regionName: string
  amiId: string
  securityGroupIds: string[]
  isActive: boolean
  isDefault: boolean
  spotPrice: number
  instanceTypes: string[]
  availabilityZones: string[]
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const SpotRegionSchema = new Schema<ISpotRegion>({
  regionCode: { 
    type: String, 
    required: true, 
    unique: true,
    index: true
  },
  regionName: { 
    type: String, 
    required: true 
  },
  amiId: { 
    type: String, 
    required: true 
  },
  securityGroupIds: [{ 
    type: String, 
    required: true 
  }],
  isActive: { 
    type: Boolean, 
    default: true 
  },
  isDefault: { 
    type: Boolean, 
    default: false 
  },
  spotPrice: { 
    type: Number, 
    required: true,
    default: 0.50 
  },
  instanceTypes: [{ 
    type: String, 
    required: true 
  }],
  availabilityZones: [{ 
    type: String 
  }],
  notes: { 
    type: String 
  }
}, {
  timestamps: true
})

// Ensure only one default region
SpotRegionSchema.pre('save', async function(next) {
  if (this.isDefault) {
    await SpotRegion.updateMany(
      { _id: { $ne: this._id } },
      { isDefault: false }
    )
  }
  next()
})

// Index for efficient queries
SpotRegionSchema.index({ isActive: 1, isDefault: -1 })

export const SpotRegion = mongoose.model<ISpotRegion>('SpotRegion', SpotRegionSchema)