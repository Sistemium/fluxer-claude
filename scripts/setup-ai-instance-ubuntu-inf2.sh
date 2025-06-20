#!/bin/bash
set -e

echo "=== Fluxer AI Instance Setup Script (Ubuntu + Inferentia2) ==="
echo "Starting setup at $(date)"

# Update system and install essentials (Ubuntu)
echo "Updating system packages..."
apt-get update -y
apt-get install -y git python3-pip curl unzip awscli

# Fix OpenSSL/pyOpenSSL version conflicts in Deep Learning AMI
echo "Fixing OpenSSL/pyOpenSSL compatibility issues..."
pip3 install --upgrade pyopenssl cryptography urllib3 botocore boto3

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

# Check Neuron SDK (should be pre-installed in Deep Learning AMI Neuron)
echo "Checking AWS Neuron SDK for Ubuntu..."
if command -v neuron-ls >/dev/null 2>&1; then
    echo "✅ Neuron SDK already installed"
    neuron-ls || true
else
    echo "❌ Neuron SDK not found - this should not happen with Deep Learning AMI Neuron"
    echo "Continuing without manual Neuron installation..."
fi

# Check if torch-neuronx is already available (Deep Learning AMI should have it)
echo "Checking torch-neuronx availability..."
TORCH_NEURONX_TEST=$(python3 -c "
try:
    import torch_neuronx
    print('torch-neuronx-ok')
except Exception as e:
    print(f'torch-neuronx-error: {e}')
" 2>&1)

if [[ "$TORCH_NEURONX_TEST" == *"torch-neuronx-ok"* ]]; then
    echo "✅ torch-neuronx is working"
else
    echo "⚠️  torch-neuronx issue: $TORCH_NEURONX_TEST"
    echo "Installing/upgrading torch-neuronx from Neuron repository..."
    pip3 install --upgrade --extra-index-url=https://pip.repos.neuron.amazonaws.com torch-neuronx transformers
fi

# Install AI packages 
echo "Installing AI packages..."
pip3 install diffusers fastapi uvicorn \
    safetensors pillow requests boto3 paho-mqtt huggingface_hub protobuf \
    sentencepiece python-dotenv

# Test if accelerate is compatible with torch-neuronx
echo "Testing accelerate compatibility with torch-neuronx..."
ACCELERATE_TEST=$(python3 -c "
try:
    import torch_neuronx
    import accelerate
    print('accelerate-compatible')
except ImportError as e:
    if 'accelerate' in str(e):
        print('accelerate-missing')
    else:
        print('accelerate-conflict')
except Exception as e:
    print(f'accelerate-error: {e}')
" 2>&1)

if [[ "$ACCELERATE_TEST" == *"accelerate-compatible"* ]]; then
    echo "✅ accelerate is already compatible with torch-neuronx"
elif [[ "$ACCELERATE_TEST" == *"accelerate-missing"* ]]; then
    echo "Installing accelerate..."
    pip3 install accelerate
else
    echo "⚠️  accelerate conflicts with torch-neuronx, skipping installation"
    echo "Conflict details: $ACCELERATE_TEST"
fi

echo "Neuron SDK and AI packages installed successfully"

# Create directories for models and cache on root EBS (inf2.xlarge has no instance store)
mkdir -p /opt/neuron/models
mkdir -p /opt/neuron/cache
chown -R ubuntu:ubuntu /opt/neuron
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

# Create systemd service for Inferentia2 (Ubuntu)
echo "Creating systemd service for Inferentia2..."
cat << EOF > /etc/systemd/system/ai-service.service
[Unit]
Description=Fluxer AI Service (Ubuntu + Inferentia2)
After=network.target

[Service]
Type=simple
User=ubuntu
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
echo "Starting AI service on Ubuntu + Inferentia2..."
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
echo "AI service should be starting up and loading FLUX model on Ubuntu + Inferentia2..."
echo ""
echo "=== Useful Commands ==="
echo "Check service status: sudo systemctl status ai-service"
echo "View realtime logs: sudo journalctl -u ai-service -f"
echo "Check health: curl http://localhost:8000/health"
echo "Check Neuron devices: neuron-ls"
echo "Monitor Neuron: neuron-monitor"
echo "Restart service: sudo systemctl restart ai-service"
echo "=================="