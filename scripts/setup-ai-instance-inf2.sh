#!/bin/bash
set -e

echo "=== Fluxer AI Instance Setup Script (Inferentia2 / inf2.xlarge) ==="
echo "Starting setup at $(date)"

# Update system and install essentials (Amazon Linux 2023)
echo "Updating system packages..."
yum update -y
yum install -y git python3-pip
# curl, python3, awscli уже предустановлены в Amazon Linux 2023

# Get HuggingFace token from AWS Secrets Manager
SPOT_REGION="${SPOT_AWS_REGION:-eu-west-1}"
echo "Retrieving HuggingFace token from AWS Secrets Manager in region $SPOT_REGION..."
HF_TOKEN=""
if aws secretsmanager get-secret-value --secret-id "fluxer/huggingface-token" --region "$SPOT_REGION" --query SecretString --output text > /tmp/hf_token.json 2>/dev/null; then
    HF_TOKEN=$(cat /tmp/hf_token.json | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))")
    echo "HuggingFace token retrieved successfully"
    rm -f /tmp/hf_token.json
else
    echo "Warning: Could not retrieve HuggingFace token from Secrets Manager"
fi

# Check Neuron SDK for Inferentia2 (pre-installed on inf2 AMI)
echo "Checking AWS Neuron SDK for Inferentia2..."
neuron-ls || echo "Neuron runtime not available"

# Install Python packages for Neuron
echo "Installing Neuron Python packages from official Neuron repository..."
# Use official Neuron pip repository
pip3 install --extra-index-url=https://pip.repos.neuron.amazonaws.com neuronx-cc torch-neuronx transformers

# Install AI packages compatible with Neuron
pip3 install diffusers fastapi uvicorn \
    safetensors pillow requests boto3 paho-mqtt huggingface_hub protobuf \
    sentencepiece python-dotenv accelerate

echo "Neuron SDK and AI packages installed successfully"

# Create directories for models and cache
mkdir -p /opt/neuron/models
mkdir -p /opt/neuron/cache
chown -R ec2-user:ec2-user /opt/neuron
chmod -R 755 /opt/neuron

# Clone AI service code from Git
echo "Cloning AI service code from GitHub..."
cd /opt
git clone https://github.com/${GITHUB_REPO:-Sistemium/fluxer-claude}.git ai-service-repo
cp -r ai-service-repo/ai-service /opt/ai-service || mkdir -p /opt/ai-service
cd /opt/ai-service

# Set up environment for Inferentia2
echo "Setting up environment variables for Inferentia2..."
cat << EOF > /opt/ai-service.env
AWS_REGION=${SPOT_AWS_REGION:-${AWS_REGION:-eu-west-1}}
BACKEND_URL=${BACKEND_URL:-http://localhost:3000}
SQS_QUEUE_URL=${SQS_QUEUE_URL:-}
HUGGINGFACE_TOKEN=$HF_TOKEN
HUGGINGFACE_HUB_CACHE=/opt/neuron/models
TORCH_HOME=/opt/neuron/cache
NEURON_VISIBLE_CORES=1
MODEL_NAME=black-forest-labs/FLUX.1-dev
DEVICE_TYPE=neuron
PYTORCH_NEURON_CACHE_PATH=/opt/neuron/cache
EOF

# Create systemd service for Inferentia2
echo "Creating systemd service for Inferentia2..."
cat << EOF > /etc/systemd/system/ai-service.service
[Unit]
Description=Fluxer AI Service (Inferentia2)
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/ai-service
EnvironmentFile=/opt/ai-service.env
Environment=PATH=/usr/bin:/usr/local/bin
Environment=NEURON_RT_NUM_CORES=1
Environment=NEURON_RT_LOG_LEVEL=INFO
ExecStart=/usr/bin/python3 main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Start service
echo "Starting AI service on Inferentia2..."
systemctl daemon-reload
systemctl enable ai-service
systemctl start ai-service

# Wait for service to start
echo "Waiting for service to start..."
sleep 15

# Check service status
echo "Checking service status..."
systemctl status ai-service || true

# Check Neuron devices
echo "Checking Neuron devices..."
neuron-ls || echo "Neuron devices check failed"

echo "=== Setup completed at $(date) ==="
echo "AI service should be starting up and loading FLUX model on Inferentia2..."
echo ""
echo "=== Useful Commands ==="
echo "Check service status: sudo systemctl status ai-service"
echo "View realtime logs: sudo journalctl -u ai-service -f"
echo "Check health: curl http://localhost:8000/health"
echo "Check Neuron devices: neuron-ls"
echo "Monitor Neuron: neuron-monitor"
echo "Restart service: sudo systemctl restart ai-service"
echo "=================="