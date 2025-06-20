#!/bin/bash
set -e

echo "=== Fixing FLUX memory issues on AI instance ==="
echo "$(date): Starting FLUX memory optimization..."

# Stop AI service
echo "Stopping AI service..."
sudo systemctl stop ai-service

# Backup original flux_service.py
echo "Creating backup of original flux_service.py..."
sudo cp /opt/ai-service/services/flux_service.py /opt/ai-service/services/flux_service.py.backup

# Download fixed version from GitHub
echo "Downloading fixed FLUX service from GitHub..."
cd /opt/ai-service/services
sudo curl -fsSL https://raw.githubusercontent.com/Sistemium/fluxer-claude/main/ai-service/services/flux_service_fixed.py -o flux_service_fixed.py

# Replace the original with fixed version
echo "Replacing flux_service.py with memory-optimized version..."
sudo mv flux_service_fixed.py flux_service.py

# Update environment variables for better CUDA memory management
echo "Updating environment variables..."
sudo bash -c 'cat >> /opt/ai-service.env << EOF
PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512,expandable_segments:True
CUDA_LAUNCH_BLOCKING=0
TORCH_USE_CUDA_DSA=1
EOF'

# Clear any existing CUDA processes
echo "Clearing CUDA processes..."
sudo fuser -k /dev/nvidia* 2>/dev/null || true

# Restart AI service
echo "Starting AI service with memory optimizations..."
sudo systemctl daemon-reload
sudo systemctl start ai-service

# Wait for service to start
echo "Waiting for service to initialize..."
sleep 15

# Check service status
echo "Checking service status..."
sudo systemctl status ai-service --no-pager || true

echo "=== FLUX memory optimization completed ==="
echo "$(date): Check logs with: sudo journalctl -u ai-service -f"
echo "$(date): Check health with: curl http://localhost:8000/health"