// Script to populate real AWS region data in MongoDB
// Run with: node populate-regions.js

import mongoose from 'mongoose'
import { SpotRegion } from './backend/dist/models/SpotRegion.js'

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fluxer'

// Real AWS data from AWS_REGIONS_MAPPING.md
const realRegions = [
  {
    regionCode: 'us-east-1',
    regionName: 'US East (N. Virginia)',
    amiId: 'ami-0866a3c8686eaeeba', // Ubuntu 24.04 LTS
    securityGroupIds: ['sg-YOUR_SG_HERE'], // Replace with actual
    spotPrice: 0.45,
    instanceTypes: ['g6e.xlarge', 'g5.xlarge'],
    availabilityZones: ['us-east-1a', 'us-east-1b', 'us-east-1c', 'us-east-1d', 'us-east-1f'],
    isActive: true,
    isDefault: true, // Set as default
    notes: 'Primary region with best spot availability'
  },
  {
    regionCode: 'eu-west-1',
    regionName: 'Europe (Ireland)',
    amiId: 'ami-0c02fb55956c7d316', // Ubuntu 24.04 LTS
    securityGroupIds: ['sg-YOUR_SG_HERE'], // Replace with actual
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
    securityGroupIds: ['sg-YOUR_SG_HERE'], // Replace with actual
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
    securityGroupIds: ['sg-YOUR_SG_HERE'], // Replace with actual
    spotPrice: 0.60,
    instanceTypes: ['g6e.xlarge', 'g5.xlarge'],
    availabilityZones: ['ap-southeast-1a', 'ap-southeast-1b', 'ap-southeast-1c'],
    isActive: false, // Disabled by default
    isDefault: false,
    notes: 'Asia Pacific region'
  }
]

async function populateRegions() {
  try {
    console.log('Connecting to MongoDB...')
    await mongoose.connect(MONGODB_URI)
    console.log('Connected to MongoDB')

    // Clear existing regions
    await SpotRegion.deleteMany({})
    console.log('Cleared existing regions')

    // Insert real regions
    await SpotRegion.insertMany(realRegions)
    console.log(`Inserted ${realRegions.length} regions`)

    // Verify insertion
    const regions = await SpotRegion.find().sort({ isDefault: -1, regionName: 1 })
    console.log('\nRegions in database:')
    regions.forEach(region => {
      console.log(`- ${region.regionCode} (${region.regionName}) - ${region.isDefault ? 'DEFAULT' : 'active'}: ${region.isActive}`)
    })

    console.log('\n✅ Regions populated successfully!')
    console.log('\n🔧 Next steps:')
    console.log('1. Update security group IDs in admin panel: /admin/regions')
    console.log('2. Verify AMI IDs are correct for each region') 
    console.log('3. Test spot instance launch with new configuration')
    
  } catch (error) {
    console.error('❌ Error populating regions:', error)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected from MongoDB')
  }
}

populateRegions()