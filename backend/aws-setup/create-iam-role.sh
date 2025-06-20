#!/bin/bash

# Script to create IAM role for AI service EC2 instances

ROLE_NAME="ai-service-role"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "Creating IAM role for AI service..."
echo "Account ID: $ACCOUNT_ID"
echo "Role name: $ROLE_NAME"
echo ""

# 1. Create trust policy document
echo "Creating trust policy..."
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# 2. Create IAM role
echo "Creating IAM role..."
aws iam create-role \
  --role-name $ROLE_NAME \
  --assume-role-policy-document file://trust-policy.json \
  --description "IAM role for AI service EC2 instances"

if [ $? -eq 0 ]; then
  echo "✅ IAM role created successfully"
else
  echo "⚠️  Role might already exist, continuing..."
fi

# 3. Attach managed policies
echo "Attaching policies..."

# S3 access for model storage
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess

# EventBridge access
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/AmazonEventBridgeFullAccess

# SQS access  
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess

# Secrets Manager access
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite

echo "✅ Policies attached"

# 4. Create custom policy for additional permissions
echo "Creating custom policy..."
cat > ai-service-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::fluxr/*",
        "arn:aws:s3:::${MODEL_CACHE_S3_BUCKET:-fluxr-models}/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "events:PutEvents"
      ],
      "Resource": "arn:aws:events:*:$ACCOUNT_ID:event-bus/fluxer-ai-events"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": [
        "arn:aws:secretsmanager:eu-west-1:$ACCOUNT_ID:secret:fluxer/*",
        "arn:aws:secretsmanager:eu-north-1:$ACCOUNT_ID:secret:fluxer/*"
      ]
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name ai-service-custom-policy \
  --policy-document file://ai-service-policy.json \
  --description "Custom policy for AI service"

# Attach custom policy
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::$ACCOUNT_ID:policy/ai-service-custom-policy

echo "✅ Custom policy created and attached"

# 5. Create instance profile
echo "Creating instance profile..."
aws iam create-instance-profile \
  --instance-profile-name $ROLE_NAME

if [ $? -eq 0 ]; then
  echo "✅ Instance profile created"
else
  echo "⚠️  Instance profile might already exist, continuing..."
fi

# 6. Add role to instance profile
echo "Adding role to instance profile..."
aws iam add-role-to-instance-profile \
  --instance-profile-name $ROLE_NAME \
  --role-name $ROLE_NAME

echo "✅ Role added to instance profile"

# 7. Wait for IAM consistency
echo "Waiting for IAM propagation (30 seconds)..."
sleep 30

# Cleanup temporary files
rm -f trust-policy.json ai-service-policy.json

echo ""
echo "🎉 AI Service IAM Role setup completed!"
echo "Role ARN: arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"
echo "Instance Profile ARN: arn:aws:iam::$ACCOUNT_ID:instance-profile/$ROLE_NAME"
echo ""
echo "You can now launch spot instances with IAM instance profile: $ROLE_NAME"