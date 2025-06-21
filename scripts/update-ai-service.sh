#!/bin/bash
set -e

echo "=== AI Service Update Script ===" 
echo "Starting update at $(date)"

# Check if running as root (needed for systemctl)
if [ "$EUID" -ne 0 ]; then
    echo "This script must be run as root (use sudo)"
    exit 1
fi

# Configuration
SERVICE_NAME="ai-service"
AI_SERVICE_DIR="/opt/ai-service"
REPO_DIR="/opt/ai-service-repo"

# Check if repo directory exists
if [ ! -d "$REPO_DIR" ]; then
    echo "ERROR: Repository directory $REPO_DIR not found"
    echo "This script should only be run on instances set up with setup-ai-instance.sh"
    exit 1
fi

# Stop the service first
echo "Stopping AI service..."
systemctl stop $SERVICE_NAME || true

# Update repository
echo "Updating repository..."
cd $REPO_DIR
git pull origin main

# Check if ai-service directory exists in repo
if [ ! -d "$REPO_DIR/ai-service" ]; then
    echo "ERROR: ai-service directory not found in repository"
    exit 1
fi

# Backup current service (optional)
if [ -d "$AI_SERVICE_DIR" ]; then
    echo "Backing up current service..."
    cp -r $AI_SERVICE_DIR ${AI_SERVICE_DIR}.backup.$(date +%Y%m%d_%H%M%S) || true
fi

# Copy new code
echo "Installing new code..."
rm -rf $AI_SERVICE_DIR
cp -r $REPO_DIR/ai-service $AI_SERVICE_DIR

# Set correct ownership
echo "Setting ownership..."
chown -R ubuntu:ubuntu $AI_SERVICE_DIR

# Preserve environment file if it exists
if [ -f "/opt/ai-service.env" ]; then
    echo "Environment file preserved at /opt/ai-service.env"
else
    echo "WARNING: No environment file found at /opt/ai-service.env"
fi

# Start the service
echo "Starting AI service..."
systemctl start $SERVICE_NAME

# Wait a moment and check status
sleep 5
echo "Checking service status..."
systemctl status $SERVICE_NAME --no-pager || true

echo "=== Update completed at $(date) ==="
echo ""
echo "=== Useful Commands ==="
echo "Check service status: sudo systemctl status $SERVICE_NAME"
echo "View realtime logs: sudo journalctl -u $SERVICE_NAME -f"
echo "Check health: curl http://localhost:8000/health"
echo "Restart service: sudo systemctl restart $SERVICE_NAME"
echo "=================="