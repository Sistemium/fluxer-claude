#!/bin/bash

# Script to create ML models snapshot for fast AI service deployment

REGION="${SPOT_AWS_REGION:-eu-north-1}"
INSTANCE_TYPE="g6.xlarge"
KEY_NAME="${AWS_KEY_PAIR_NAME:-sistemium}"
SECURITY_GROUP="${AWS_SECURITY_GROUP_ID:-sg-01560170d46b4153e}"
SUBNET_ID="${AWS_SUBNET_ID:-subnet-39956550}"

echo "Creating ML models snapshot in region: $REGION"
echo "This will:"
echo "1. Launch a temporary instance"
echo "2. Install all ML dependencies and models"
echo "3. Create a snapshot of the ML disk"
echo "4. Terminate the instance"
echo ""

read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 1
fi

# Create User Data script for ML setup
cat > ml-setup-userdata.sh << 'EOF'
#!/bin/bash
set -e

# Update system
apt-get update -y
apt-get install -y python3 python3-pip awscli curl

# Setup ML disk
ML_DISK="/dev/xvdf"
ML_MOUNT="/models"

echo "Setting up ML disk..."
mkdir -p "$ML_MOUNT"

# Format and mount
mkfs.ext4 "$ML_DISK"
mount "$ML_DISK" "$ML_MOUNT"

# Create directory structure
mkdir -p "$ML_MOUNT/python"
mkdir -p "$ML_MOUNT/huggingface"
mkdir -p "$ML_MOUNT/torch-cache"

# Set environment variables
export PYTHONPATH="$ML_MOUNT/python:$PYTHONPATH"
export HUGGINGFACE_HUB_CACHE="$ML_MOUNT/huggingface"
export TORCH_HOME="$ML_MOUNT/torch-cache"

# Install Python packages to ML disk
echo "Installing Python packages..."
pip3 install --target "$ML_MOUNT/python" \
    fastapi uvicorn torch diffusers transformers accelerate \
    safetensors pillow requests boto3 paho-mqtt huggingface_hub

# Get HuggingFace token from secrets
HF_TOKEN=""
if aws secretsmanager get-secret-value --secret-id "fluxer/huggingface-token" --region "$REGION" --query SecretString --output text > /tmp/hf_token.json 2>/dev/null; then
    HF_TOKEN=$(cat /tmp/hf_token.json | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))")
    rm -f /tmp/hf_token.json
fi

if [ -n "$HF_TOKEN" ]; then
    echo "Downloading FLUX.1-dev model..."
    
    # Create Python script to download model
    cat > /tmp/download_model.py << 'PYTHON_EOF'
import os
from huggingface_hub import login, snapshot_download
from diffusers import FluxPipeline
import torch

# Login to HuggingFace
token = os.environ.get('HUGGINGFACE_TOKEN')
if token:
    login(token=token)
    print("Logged in to HuggingFace")

# Download FLUX.1-dev model
print("Downloading FLUX.1-dev model...")
try:
    pipeline = FluxPipeline.from_pretrained(
        "black-forest-labs/FLUX.1-dev",
        torch_dtype=torch.bfloat16,
        use_safetensors=True
    )
    print("FLUX.1-dev model downloaded successfully")
except Exception as e:
    print(f"Error downloading FLUX.1-dev: {e}")
    
    # Fallback to SDXL
    print("Downloading SDXL as fallback...")
    from diffusers import StableDiffusionXLPipeline
    pipeline = StableDiffusionXLPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0",
        torch_dtype=torch.float16,
        use_safetensors=True
    )
    print("SDXL model downloaded successfully")

print("Model download completed")
PYTHON_EOF

    # Set environment and run download
    export HUGGINGFACE_TOKEN="$HF_TOKEN"
    cd "$ML_MOUNT"
    python3 /tmp/download_model.py
    
    echo "Model download completed"
else
    echo "Warning: No HuggingFace token found, downloading only SDXL..."
    
    cat > /tmp/download_sdxl.py << 'PYTHON_EOF'
from diffusers import StableDiffusionXLPipeline
import torch

print("Downloading SDXL model...")
pipeline = StableDiffusionXLPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    torch_dtype=torch.float16,
    use_safetensors=True
)
print("SDXL model downloaded successfully")
PYTHON_EOF

    cd "$ML_MOUNT"
    python3 /tmp/download_sdxl.py
fi

# Set proper permissions
chown -R ubuntu:ubuntu "$ML_MOUNT"
chmod -R 755 "$ML_MOUNT"

# Create completion marker
touch "$ML_MOUNT/.ml-setup-complete"

echo "ML setup completed successfully"
echo "Disk usage:"
df -h "$ML_MOUNT"
echo "Directory structure:"
ls -la "$ML_MOUNT"
EOF

# Encode user data
USER_DATA=$(base64 -w 0 ml-setup-userdata.sh)

echo "Launching temporary instance for ML setup..."

# Launch instance
INSTANCE_ID=$(aws ec2 run-instances \
    --region "$REGION" \
    --image-id ami-0d272b151e3b29b0b \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SECURITY_GROUP" \
    --subnet-id "$SUBNET_ID" \
    --user-data "$USER_DATA" \
    --iam-instance-profile Name=ai-service-role \
    --block-device-mappings '[
        {
            "DeviceName": "/dev/xvda",
            "Ebs": {
                "VolumeSize": 30,
                "VolumeType": "gp3",
                "DeleteOnTermination": true
            }
        },
        {
            "DeviceName": "/dev/xvdf",
            "Ebs": {
                "VolumeSize": 100,
                "VolumeType": "gp3",
                "DeleteOnTermination": false
            }
        }
    ]' \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ml-snapshot-builder},{Key=Purpose,Value=snapshot-creation}]' \
    --query 'Instances[0].InstanceId' \
    --output text)

echo "Instance launched: $INSTANCE_ID"
echo "Waiting for instance to complete setup..."

# Wait for instance to be running
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
echo "Instance is running"

# Wait for setup to complete (check for completion marker)
echo "Waiting for ML setup to complete (this may take 30-60 minutes)..."
while true; do
    sleep 60
    
    # Check instance status
    STATE=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].State.Name' --output text)
    if [ "$STATE" != "running" ]; then
        echo "Instance stopped unexpectedly: $STATE"
        exit 1
    fi
    
    echo "Still waiting... (instance is $STATE)"
done

echo ""
echo "Manual step required:"
echo "1. SSH to the instance: ssh -i ~/.ssh/$KEY_NAME.pem ubuntu@<instance-ip>"
echo "2. Check if setup completed: ls -la /models/.ml-setup-complete"
echo "3. When ready, run this script again with 'snapshot' argument"
echo ""
echo "Instance ID: $INSTANCE_ID"

# Cleanup
rm -f ml-setup-userdata.sh