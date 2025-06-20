const { IAMClient, CreateRoleCommand, CreateInstanceProfileCommand, AddRoleToInstanceProfileCommand, AttachRolePolicyCommand } = require('@aws-sdk/client-iam');

async function createAIServiceRole() {
  const iam = new IAMClient({
    region: process.env.AWS_REGION || 'eu-west-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const roleName = 'ai-service-role';
  
  try {
    // 1. Create IAM Role
    console.log('Creating IAM Role...');
    const trustPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: 'ec2.amazonaws.com'
          },
          Action: 'sts:AssumeRole'
        }
      ]
    };

    await iam.send(new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
      Description: 'IAM role for AI service EC2 instances',
    }));
    console.log('✅ IAM Role created successfully');

    // 2. Attach policies to the role
    console.log('Attaching policies...');
    
    // S3 access for model storage
    await iam.send(new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: 'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'
    }));
    
    // EventBridge access
    await iam.send(new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: 'arn:aws:iam::aws:policy/AmazonEventBridgeFullAccess'
    }));
    
    // SQS access
    await iam.send(new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: 'arn:aws:iam::aws:policy/AmazonSQSFullAccess'
    }));
    
    console.log('✅ Policies attached successfully');

    // 3. Create Instance Profile
    console.log('Creating Instance Profile...');
    await iam.send(new CreateInstanceProfileCommand({
      InstanceProfileName: roleName
    }));
    console.log('✅ Instance Profile created successfully');

    // 4. Add role to instance profile
    console.log('Adding role to instance profile...');
    await iam.send(new AddRoleToInstanceProfileCommand({
      InstanceProfileName: roleName,
      RoleName: roleName
    }));
    console.log('✅ Role added to instance profile successfully');

    console.log('\n🎉 AI Service IAM Role setup completed!');
    console.log(`Role ARN: arn:aws:iam::YOUR_ACCOUNT_ID:role/${roleName}`);
    console.log(`Instance Profile ARN: arn:aws:iam::YOUR_ACCOUNT_ID:instance-profile/${roleName}`);
    
  } catch (error) {
    if (error.name === 'EntityAlreadyExistsException') {
      console.log('⚠️  Role or Instance Profile already exists');
    } else {
      console.error('❌ Error creating IAM role:', error);
      throw error;
    }
  }
}

// Load environment variables
require('dotenv').config({ path: '../.env.local' });

createAIServiceRole().catch(console.error);