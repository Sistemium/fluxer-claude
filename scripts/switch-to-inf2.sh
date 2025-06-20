#!/bin/bash
set -e

echo "=== Switching AI service to Inferentia2 version ==="
echo "$(date): Starting switch to inf2 FluxService..."

# Stop AI service
echo "Stopping AI service..."
sudo systemctl stop ai-service

# Backup original flux_service.py
echo "Creating backup of original flux_service.py..."
sudo cp /opt/ai-service/services/flux_service.py /opt/ai-service/services/flux_service.py.backup

# Download inf2 version from GitHub
echo "Downloading Inferentia2 FLUX service from GitHub..."
cd /opt/ai-service/services
sudo curl -fsSL https://raw.githubusercontent.com/Sistemium/fluxer-claude/main/ai-service/services/flux_service_inf2.py -o flux_service_inf2.py

# Replace the original with inf2 version
echo "Replacing flux_service.py with Inferentia2 version..."
sudo mv flux_service_inf2.py flux_service.py

# Update environment variables for Inferentia2
echo "Updating environment variables for Inferentia2..."
sudo bash -c 'cat > /opt/ai-service.env << EOF
AWS_REGION=eu-north-1
BACKEND_URL=http://localhost:3000
SQS_QUEUE_URL=
HUGGINGFACE_TOKEN=
HUGGINGFACE_HUB_CACHE=/opt/neuron/models
TORCH_HOME=/opt/neuron/cache
NEURON_VISIBLE_CORES=1
MODEL_NAME=black-forest-labs/FLUX.1-dev
DEVICE_TYPE=neuron
PYTORCH_NEURON_CACHE_PATH=/opt/neuron/cache
EOF'

# Restart AI service
echo "Starting AI service with Inferentia2 support..."
sudo systemctl daemon-reload
sudo systemctl start ai-service

# Wait for service to start
echo "Waiting for service to initialize..."
sleep 20

# Check service status
echo "Checking service status..."
sudo systemctl status ai-service --no-pager || true

# Check Neuron devices
echo "Checking Neuron devices..."
neuron-ls || echo "Neuron devices not available"

echo "=== Switch to Inferentia2 completed ==="
echo "$(date): Check logs with: sudo journalctl -u ai-service -f"
echo "$(date): Check health with: curl http://localhost:8000/health"
echo "$(date): Monitor Neuron: neuron-monitor"