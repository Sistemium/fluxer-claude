#!/bin/bash
set -e

echo "=== Fluxer AI Instance Setup Script ==="
echo "Starting setup at $(date)"

# Update system and install essentials
echo "Updating system packages..."
apt-get update -y
apt-get install -y git curl python3 python3-pip awscli

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

# Use pre-mounted instance store from Deep Learning AMI
if [ -d "/opt/dlami/nvme" ]; then
    echo "Using Deep Learning AMI instance store at /opt/dlami/nvme (229GB)"
    
    # Create ML directories with proper permissions
    mkdir -p /opt/dlami/nvme/python
    mkdir -p /opt/dlami/nvme/huggingface  
    mkdir -p /opt/dlami/nvme/torch-cache
    mkdir -p /opt/dlami/nvme/pip-cache
    mkdir -p /opt/dlami/nvme/tmp
    
    # Set ownership before pip install
    chown -R ubuntu:ubuntu /opt/dlami/nvme
    chmod -R 755 /opt/dlami/nvme
    
    echo "Instance store available at /opt/dlami/nvme - 229GB, installing Python deps..."
    
    # Find PyTorch installation - conda or dedicated pytorch env
    echo "Finding PyTorch installation..."
    PYTHON_BASE=""
    
    # Check for conda first
    for conda_path in /opt/conda /home/ubuntu/miniconda3 /home/ubuntu/anaconda3 /usr/local/conda; do
        if [ -f "$conda_path/etc/profile.d/conda.sh" ]; then
            PYTHON_BASE="$conda_path"
            PYTHON_TYPE="conda"
            echo "Found conda at: $conda_path"
            break
        fi
    done
    
    # Check for pytorch dedicated env
    if [ -z "$PYTHON_BASE" ] && [ -f "/opt/pytorch/bin/python" ]; then
        PYTHON_BASE="/opt/pytorch"
        PYTHON_TYPE="pytorch"
        echo "Found PyTorch environment at: /opt/pytorch"
    fi
    
    if [ -n "$PYTHON_BASE" ]; then
        if [ "$PYTHON_TYPE" = "conda" ]; then
            source "$PYTHON_BASE/etc/profile.d/conda.sh"
            conda activate base
        fi
        
        echo "Checking PyTorch installation..."
        "$PYTHON_BASE/bin/python" -c "import torch; print('PyTorch version:', torch.__version__); print('CUDA available:', torch.cuda.is_available())"
        
        "$PYTHON_BASE/bin/pip" install --cache-dir /opt/dlami/nvme/pip-cache \
            diffusers transformers accelerate \
            fastapi uvicorn \
            safetensors pillow requests boto3 paho-mqtt huggingface_hub protobuf \
            sentencepiece python-dotenv
    else
        echo "No PyTorch environment found, using system python3..."
        pip3 install --cache-dir /opt/dlami/nvme/pip-cache \
            torch torchvision diffusers transformers accelerate \
            fastapi uvicorn \
            safetensors pillow requests boto3 paho-mqtt huggingface_hub protobuf \
            sentencepiece python-dotenv
    fi
    
    echo "Additional packages installed successfully"
else
    echo "Warning: Instance store not found, installing to system"
    pip3 install torch torchvision diffusers transformers accelerate \
        fastapi uvicorn \
        safetensors pillow requests boto3 paho-mqtt huggingface_hub protobuf \
        sentencepiece python-dotenv
fi

# Clone AI service code from Git
echo "Cloning AI service code from GitHub..."
cd /opt
git clone https://github.com/${GITHUB_REPO:-Sistemium/fluxer-claude}.git ai-service-repo
cp -r ai-service-repo/ai-service /opt/ai-service || mkdir -p /opt/ai-service
cd /opt/ai-service

# Set up environment - models cache to instance store, packages system
echo "Setting up environment variables..."
cat << EOF > /opt/ai-service.env
AWS_REGION=${SPOT_AWS_REGION:-${AWS_REGION:-eu-west-1}}
BACKEND_URL=${BACKEND_URL:-http://localhost:3000}
SQS_QUEUE_URL=${SQS_QUEUE_URL:-}
HUGGINGFACE_TOKEN=$HF_TOKEN
HUGGINGFACE_HUB_CACHE=/opt/dlami/nvme/huggingface
TORCH_HOME=/opt/dlami/nvme/torch-cache
CUDA_VISIBLE_DEVICES=0
MODEL_NAME=black-forest-labs/FLUX.1-dev
EOF

# Create systemd service - use detected python environment
echo "Creating systemd service..."
if [ -n "$PYTHON_BASE" ]; then
    PYTHON_PATH="$PYTHON_BASE/bin/python"
    PATH_ENV="$PYTHON_BASE/bin:/usr/bin:/usr/local/bin"
else
    PYTHON_PATH="/usr/bin/python3"
    PATH_ENV="/usr/bin:/usr/local/bin"
fi

cat << EOF > /etc/systemd/system/ai-service.service
[Unit]
Description=Fluxer AI Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/ai-service
EnvironmentFile=/opt/ai-service.env
Environment=PATH=$PATH_ENV
ExecStart=$PYTHON_PATH main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Start service
echo "Starting AI service..."
systemctl daemon-reload
systemctl enable ai-service
systemctl start ai-service

# Wait for service to start
echo "Waiting for service to start..."
sleep 10

# Check service status
echo "Checking service status..."
systemctl status ai-service || true

echo "=== Setup completed at $(date) ==="
echo "AI service should be starting up and loading FLUX model..."
echo ""
echo "=== Useful Commands ==="
echo "Check service status: sudo systemctl status ai-service"
echo "View realtime logs: sudo journalctl -u ai-service -f"
echo "Check health: curl http://localhost:8000/health"
echo "Restart service: sudo systemctl restart ai-service"
echo "=================="