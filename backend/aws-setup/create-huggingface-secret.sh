#!/bin/bash

# Script to create HuggingFace token secret in AWS Secrets Manager

SECRET_NAME="fluxer/huggingface-token"
REGION="${SPOT_AWS_REGION:-eu-north-1}"

echo "Creating HuggingFace token secret in AWS Secrets Manager..."
echo "Region: $REGION"
echo "Secret name: $SECRET_NAME"
echo ""

# Prompt for HuggingFace token
read -p "Enter your HuggingFace token: " -s HF_TOKEN
echo ""

if [ -z "$HF_TOKEN" ]; then
    echo "❌ HuggingFace token cannot be empty"
    exit 1
fi

# Create the secret
echo "Creating secret..."
aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --description "HuggingFace token for accessing FLUX.1-dev model" \
    --secret-string "{\"token\":\"$HF_TOKEN\"}" \
    --region "$REGION"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ HuggingFace token secret created successfully!"
    echo "Secret ARN: arn:aws:secretsmanager:$REGION:$(aws sts get-caller-identity --query Account --output text):secret:$SECRET_NAME"
    echo ""
    echo "The AI service will now be able to access FLUX.1-dev model using this token."
else
    echo "❌ Failed to create secret. It might already exist."
    echo ""
    echo "To update existing secret, run:"
    echo "aws secretsmanager update-secret --secret-id $SECRET_NAME --secret-string '{\"token\":\"YOUR_TOKEN\"}' --region $REGION"
fi