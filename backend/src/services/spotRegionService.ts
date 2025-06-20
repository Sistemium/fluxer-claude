import { SpotRegion, ISpotRegion } from '../models/SpotRegion.js'
import logger from '../utils/logger.js'

export class SpotRegionService {
  private static instance: SpotRegionService

  static getInstance(): SpotRegionService {
    if (!SpotRegionService.instance) {
      SpotRegionService.instance = new SpotRegionService()
    }
    return SpotRegionService.instance
  }

  async initializeDefaultRegions(): Promise<void> {
    try {
      // Check if regions already exist
      const existingCount = await SpotRegion.countDocuments()
      if (existingCount > 0) {
        logger.info(`Spot regions already initialized (${existingCount} regions)`)
        return
      }

      logger.info('Initializing default spot regions...')

      const defaultRegions = [
        {
          regionCode: 'us-east-1',
          regionName: 'US East (N. Virginia)',
          amiId: 'ami-0866a3c8686eaeeba', // Ubuntu 24.04 LTS
          securityGroupIds: ['sg-01234567890123456'], // Replace with actual
          spotPrice: 0.45,
          instanceTypes: ['g6e.xlarge', 'g5.xlarge', 'inf2.xlarge'],
          availabilityZones: ['us-east-1a', 'us-east-1b', 'us-east-1c'],
          isActive: true,
          isDefault: true,
          notes: 'Primary region with best spot availability'
        },
        {
          regionCode: 'eu-west-1',
          regionName: 'Europe (Ireland)',
          amiId: 'ami-0c02fb55956c7d316', // Ubuntu 24.04 LTS
          securityGroupIds: ['sg-0987654321fedcba0'], // Replace with actual
          spotPrice: 0.50,
          instanceTypes: ['g6e.xlarge', 'g5.xlarge'],
          availabilityZones: ['eu-west-1a', 'eu-west-1b', 'eu-west-1c'],
          isActive: true,
          isDefault: false,
          notes: 'Main infrastructure region'
        },
        {
          regionCode: 'eu-central-1',
          regionName: 'Europe (Frankfurt)',
          amiId: 'ami-0e872aee57663ae2d', // Ubuntu 24.04 LTS
          securityGroupIds: ['sg-0fedcba0987654321'], // Replace with actual
          spotPrice: 0.55,
          instanceTypes: ['g6e.xlarge', 'g5.xlarge'],
          availabilityZones: ['eu-central-1a', 'eu-central-1b', 'eu-central-1c'],
          isActive: true,
          isDefault: false,
          notes: 'Backup EU region'
        },
        {
          regionCode: 'ap-southeast-1',
          regionName: 'Asia Pacific (Singapore)',
          amiId: 'ami-047126e50991d067b', // Ubuntu 24.04 LTS
          securityGroupIds: ['sg-0123456789abcdef0'], // Replace with actual
          spotPrice: 0.60,
          instanceTypes: ['g6e.xlarge', 'g5.xlarge'],
          availabilityZones: ['ap-southeast-1a', 'ap-southeast-1b', 'ap-southeast-1c'],
          isActive: false,
          isDefault: false,
          notes: 'Asia Pacific region'
        }
      ]

      await SpotRegion.insertMany(defaultRegions)
      logger.info(`Initialized ${defaultRegions.length} default spot regions`)

    } catch (error) {
      logger.error('Failed to initialize default spot regions', error)
      throw error
    }
  }

  async getActiveRegions(): Promise<ISpotRegion[]> {
    return await SpotRegion.find({ isActive: true }).sort({ isDefault: -1, regionName: 1 })
  }

  async getAllRegions(): Promise<ISpotRegion[]> {
    return await SpotRegion.find().sort({ isDefault: -1, regionName: 1 })
  }

  async getDefaultRegion(): Promise<ISpotRegion | null> {
    return await SpotRegion.findOne({ isDefault: true, isActive: true })
  }

  async getRegionByCode(regionCode: string): Promise<ISpotRegion | null> {
    return await SpotRegion.findOne({ regionCode, isActive: true })
  }

  async setDefaultRegion(regionCode: string): Promise<ISpotRegion | null> {
    try {
      // First, remove default from all regions
      await SpotRegion.updateMany({}, { isDefault: false })
      
      // Then set the new default
      const updatedRegion = await SpotRegion.findOneAndUpdate(
        { regionCode, isActive: true },
        { isDefault: true },
        { new: true }
      )

      if (updatedRegion) {
        logger.info(`Set ${regionCode} as default spot region`)
      }

      return updatedRegion
    } catch (error) {
      logger.error(`Failed to set default region to ${regionCode}`, error)
      throw error
    }
  }

  async updateRegion(regionCode: string, updates: Partial<ISpotRegion>): Promise<ISpotRegion | null> {
    try {
      // Don't allow multiple defaults
      if (updates.isDefault) {
        await SpotRegion.updateMany(
          { regionCode: { $ne: regionCode } },
          { isDefault: false }
        )
      }

      const updatedRegion = await SpotRegion.findOneAndUpdate(
        { regionCode },
        updates,
        { new: true }
      )

      if (updatedRegion) {
        logger.info(`Updated spot region ${regionCode}`)
      }

      return updatedRegion
    } catch (error) {
      logger.error(`Failed to update region ${regionCode}`, error)
      throw error
    }
  }

  async createRegion(regionData: Partial<ISpotRegion>): Promise<ISpotRegion> {
    try {
      // If this is set as default, remove default from others
      if (regionData.isDefault) {
        await SpotRegion.updateMany({}, { isDefault: false })
      }

      const region = new SpotRegion(regionData)
      await region.save()
      
      logger.info(`Created new spot region ${region.regionCode}`)
      return region
    } catch (error) {
      logger.error('Failed to create region', error)
      throw error
    }
  }

  async deleteRegion(regionCode: string): Promise<boolean> {
    try {
      const region = await SpotRegion.findOne({ regionCode })
      if (!region) {
        return false
      }

      // Don't allow deletion of default region
      if (region.isDefault) {
        throw new Error('Cannot delete default region. Set another region as default first.')
      }

      await SpotRegion.deleteOne({ regionCode })
      logger.info(`Deleted spot region ${regionCode}`)
      return true
    } catch (error) {
      logger.error(`Failed to delete region ${regionCode}`, error)
      throw error
    }
  }

  async toggleRegionStatus(regionCode: string): Promise<ISpotRegion | null> {
    try {
      const region = await SpotRegion.findOne({ regionCode })
      if (!region) {
        return null
      }

      // Don't allow deactivating default region
      if (region.isDefault && region.isActive) {
        throw new Error('Cannot deactivate default region. Set another region as default first.')
      }

      region.isActive = !region.isActive
      await region.save()

      logger.info(`Toggled region ${regionCode} status to ${region.isActive ? 'active' : 'inactive'}`)
      return region
    } catch (error) {
      logger.error(`Failed to toggle region ${regionCode} status`, error)
      throw error
    }
  }
}