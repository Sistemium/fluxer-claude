#!/bin/bash
set -e

echo "=== Fluxer AI Instance Setup Script ==="
echo "Starting setup at $(date)"

# Check if we can write to log file (system is functional)
echo "Testing system functionality..."
if ! echo "System test" > /tmp/setup-test.log 2>/dev/null; then
    echo "WARNING: System appears to be in a problematic state"
fi

# Set aggressive timeouts to prevent infinite hangs
export DEBIAN_FRONTEND=noninteractive
export APT_GET_TIMEOUT=30

# Check system readiness without waiting for cloud-init
echo "Checking system readiness..."
if pgrep -f cloud-init > /dev/null; then
    echo "Cloud-init is still running in background, but proceeding with setup..."
else
    echo "Cloud-init appears to be finished"
fi

# Ensure basic system commands are available
if ! command -v apt-get >/dev/null 2>&1; then
    echo "ERROR: apt-get not available, system may not be ready"
    exit 1
fi

echo "System appears ready for setup"

# Wait for package managers to finish with shorter timeout
echo "Waiting for package managers to finish (max 120 seconds)..."
WAIT_COUNT=0
MAX_WAIT=12 # 12 * 10 = 120 seconds

while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
        echo "Package manager still busy after 120 seconds, force proceeding..."
        # Kill unattended-upgrades if stuck
        sudo pkill -f unattended-upgrade || true
        sudo pkill -f apt || true
        sleep 5
        # Force unlock if still locked
        sudo rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock
        break
    fi
    echo "Package manager is busy, waiting 10 seconds... ($((WAIT_COUNT * 10))/120 seconds)"
    sleep 10
done

# Clean up duplicate CUDA sources that cause warnings
echo "Cleaning up duplicate APT sources..."
if [ -f /etc/apt/sources.list.d/archive_uri-https_developer_download_nvidia_com_compute_cuda_repos_ubuntu2204_x86_64_-jammy.list ]; then
    rm -f /etc/apt/sources.list.d/archive_uri-https_developer_download_nvidia_com_compute_cuda_repos_ubuntu2204_x86_64_-jammy.list
fi

# Update system and install essentials with retries
echo "Updating system packages..."
RETRY_COUNT=0
MAX_RETRIES=3

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if apt-get update -y; then
        echo "Package list updated successfully"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "apt-get update failed, retry $RETRY_COUNT/$MAX_RETRIES..."
        sleep 10
        
        if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
            echo "apt-get update failed after $MAX_RETRIES attempts, continuing anyway..."
        fi
    fi
done

echo "Installing essential packages..."
apt-get install -y git curl python3 python3-pip awscli || {
    echo "Package installation failed, but continuing..."
}

# Get HuggingFace token from AWS Secrets Manager  
# Try spot region first, then fallback to main infrastructure region
SPOT_REGION="${SPOT_AWS_REGION:-us-east-1}"
MAIN_REGION="${AWS_REGION:-eu-west-1}"
echo "Retrieving HuggingFace token from AWS Secrets Manager..."
HF_TOKEN=""

# Try spot region first
if aws secretsmanager get-secret-value --secret-id "fluxer/huggingface-token" --region "$SPOT_REGION" --query SecretString --output text > /tmp/hf_token.json 2>/dev/null; then
    echo "Found token in spot region $SPOT_REGION"
elif aws secretsmanager get-secret-value --secret-id "fluxer/huggingface-token" --region "$MAIN_REGION" --query SecretString --output text > /tmp/hf_token.json 2>/dev/null; then
    echo "Found token in main region $MAIN_REGION"
else
    echo "Warning: Could not retrieve HuggingFace token from either region"
fi

if [ -f /tmp/hf_token.json ]; then
    HF_TOKEN=$(cat /tmp/hf_token.json | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))")
    echo "HuggingFace token retrieved successfully"
    rm -f /tmp/hf_token.json
else
    echo "Warning: Could not retrieve HuggingFace token from Secrets Manager"
fi

# Use pre-mounted instance store from Deep Learning AMI
if [ -d "/opt/dlami/nvme" ]; then
    echo "Using Deep Learning AMI instance store at /opt/dlami/nvme"
    
    # Check available space for g6e.xlarge (2x NVMe SSDs)
    NVME_SPACE=$(df -h /opt/dlami/nvme | tail -1 | awk '{print $2}')
    echo "Instance store space available: $NVME_SPACE"
    
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
            
            # Try to find and activate pytorch environment
            if conda env list | grep -q pytorch; then
                echo "Activating pytorch conda environment..."
                conda activate pytorch
            elif conda env list | grep -q py310; then
                echo "Activating py310 conda environment..."
                conda activate py310  
            else
                echo "Using conda base environment..."
                conda activate base
            fi
        fi
        
        echo "Checking PyTorch installation..."
        if [ "$PYTHON_TYPE" = "conda" ]; then
            python -c "import torch; print('PyTorch version:', torch.__version__); print('CUDA available:', torch.cuda.is_available())" || {
                echo "PyTorch not found, installing..."
                conda install pytorch torchvision pytorch-cuda -c pytorch -c nvidia -y
            }
        else
            "$PYTHON_BASE/bin/python" -c "import torch; print('PyTorch version:', torch.__version__); print('CUDA available:', torch.cuda.is_available())"
        fi
        
        if [ "$PYTHON_TYPE" = "conda" ]; then
            pip install --cache-dir /opt/dlami/nvme/pip-cache \
                diffusers transformers accelerate \
                fastapi uvicorn \
                safetensors pillow requests boto3 paho-mqtt huggingface_hub protobuf \
                sentencepiece python-dotenv
        else
            "$PYTHON_BASE/bin/pip" install --cache-dir /opt/dlami/nvme/pip-cache \
                diffusers transformers accelerate \
                fastapi uvicorn \
                safetensors pillow requests boto3 paho-mqtt huggingface_hub protobuf \
                sentencepiece python-dotenv
        fi
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

# Get EC2 instance metadata
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || echo "unknown")
INSTANCE_TYPE=$(curl -s http://169.254.169.254/latest/meta-data/instance-type 2>/dev/null || echo "unknown")

# Extract MQTT host and port from MQTT_BROKER_URL
MQTT_URL="${MQTT_BROKER_URL:-mqtt://mqtt1.sistemium.net}"
MQTT_HOST=$(echo "$MQTT_URL" | sed 's|mqtt://||' | sed 's|:[0-9]*$||')
MQTT_PORT=$(echo "$MQTT_URL" | grep -o ':[0-9]*$' | sed 's|:||' || echo "1883")

cat << EOF > /opt/ai-service.env
AWS_REGION=${SPOT_AWS_REGION:-${AWS_REGION:-eu-west-1}}
BACKEND_URL=${BACKEND_URL:-http://localhost:3000}
SQS_QUEUE_URL=${SQS_QUEUE_URL:-}
HUGGINGFACE_TOKEN=$HF_TOKEN
HUGGINGFACE_HUB_CACHE=/opt/dlami/nvme/huggingface
TORCH_HOME=/opt/dlami/nvme/torch-cache
CUDA_VISIBLE_DEVICES=0
MODEL_NAME=black-forest-labs/FLUX.1-dev
EC2_INSTANCE_ID=$INSTANCE_ID
EC2_INSTANCE_TYPE=$INSTANCE_TYPE
MQTT_BROKER_HOST=$MQTT_HOST
MQTT_BROKER_PORT=$MQTT_PORT
MQTT_USERNAME=${MQTT_USERNAME:-}
MQTT_PASSWORD=${MQTT_PASSWORD:-}
EOF

# Create systemd service - use detected python environment
echo "Creating systemd service..."
if [ -n "$PYTHON_BASE" ]; then
    if [ "$PYTHON_TYPE" = "conda" ]; then
        # For conda, create wrapper script that properly activates environment
        cat << EOF > /opt/ai-service-start.sh
#!/bin/bash
source $PYTHON_BASE/etc/profile.d/conda.sh
if conda env list | grep -q pytorch; then
    conda activate pytorch
elif conda env list | grep -q py310; then
    conda activate py310
else
    conda activate base
fi
cd /opt/ai-service
exec python main.py
EOF
        chmod +x /opt/ai-service-start.sh
        EXEC_START="/opt/ai-service-start.sh"
        PATH_ENV="/opt/conda/bin:/usr/bin:/usr/local/bin"
    else
        EXEC_START="$PYTHON_BASE/bin/python main.py"
        PATH_ENV="$PYTHON_BASE/bin:/usr/bin:/usr/local/bin"
    fi
else
    EXEC_START="/usr/bin/python3 main.py"
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
ExecStart=$EXEC_START
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Install update script
echo "Installing update script..."
cp /opt/ai-service-repo/scripts/update-ai-service.sh /usr/local/bin/update-ai-service
chmod +x /usr/local/bin/update-ai-service

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