import asyncio
import json
import time
import logging
import os
import requests
from typing import Optional
from services.mqtt_client import get_mqtt_client

logger = logging.getLogger(__name__)

class InstanceMonitor:
    def __init__(self):
        self.instance_id = os.getenv('EC2_INSTANCE_ID', 'unknown')
        self.instance_type = os.getenv('EC2_INSTANCE_TYPE', 'unknown')
        self.mqtt_client = None
        self.monitoring = False
        self.last_state = None
        
    async def start_monitoring(self):
        """Start monitoring instance state and health"""
        try:
            self.mqtt_client = get_mqtt_client()
            if not self.mqtt_client:
                logger.warning("MQTT client not available, instance monitoring disabled")
                return
                
            self.monitoring = True
            logger.info(f"Starting instance monitoring for {self.instance_id}")
            
            # Send initial state
            await self.send_instance_event('started', {
                'instance_id': self.instance_id,
                'instance_type': self.instance_type,
                'service_status': 'initializing'
            })
            
            # Start monitoring loop
            asyncio.create_task(self.monitor_loop())
            
        except Exception as e:
            logger.error(f"Failed to start instance monitoring: {e}")
    
    async def monitor_loop(self):
        """Main monitoring loop"""
        while self.monitoring:
            try:
                # Check instance metadata and health
                current_state = await self.get_instance_state()
                
                if current_state != self.last_state:
                    await self.send_state_change(current_state)
                    self.last_state = current_state
                
                # Send periodic heartbeat
                await self.send_heartbeat()
                
                # Check for spot interruption
                await self.check_spot_interruption()
                
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                await asyncio.sleep(60)  # Wait longer on error
    
    async def get_instance_state(self) -> dict:
        """Get current instance state from metadata"""
        try:
            # Get instance metadata
            metadata = {}
            
            # Instance ID from metadata service
            try:
                response = requests.get(
                    'http://169.254.169.254/latest/meta-data/instance-id',
                    timeout=2
                )
                if response.status_code == 200:
                    metadata['instance_id'] = response.text
            except:
                metadata['instance_id'] = self.instance_id
            
            # Instance type
            try:
                response = requests.get(
                    'http://169.254.169.254/latest/meta-data/instance-type',
                    timeout=2
                )
                if response.status_code == 200:
                    metadata['instance_type'] = response.text
            except:
                metadata['instance_type'] = self.instance_type
            
            # Public IP
            try:
                response = requests.get(
                    'http://169.254.169.254/latest/meta-data/public-ipv4',
                    timeout=2
                )
                if response.status_code == 200:
                    metadata['public_ip'] = response.text
            except:
                metadata['public_ip'] = None
            
            # Private IP
            try:
                response = requests.get(
                    'http://169.254.169.254/latest/meta-data/local-ipv4',
                    timeout=2
                )
                if response.status_code == 200:
                    metadata['private_ip'] = response.text
            except:
                metadata['private_ip'] = None
            
            # Service health
            metadata['service_status'] = self.get_service_status()
            metadata['timestamp'] = time.time()
            
            return metadata
            
        except Exception as e:
            logger.error(f"Failed to get instance state: {e}")
            return {
                'instance_id': self.instance_id,
                'instance_type': self.instance_type,
                'service_status': 'unknown',
                'timestamp': time.time()
            }
    
    def get_service_status(self) -> str:
        """Get AI service health status"""
        try:
            # Check if service is responding
            response = requests.get('http://localhost:8000/health', timeout=5)
            if response.status_code == 200:
                return 'healthy'
            else:
                return 'unhealthy'
        except:
            return 'unavailable'
    
    async def check_spot_interruption(self):
        """Check for spot interruption notice"""
        try:
            response = requests.get(
                'http://169.254.169.254/latest/meta-data/spot/instance-action',
                timeout=2
            )
            if response.status_code == 200:
                # Spot interruption detected
                action = response.text
                logger.warning(f"Spot interruption detected: {action}")
                
                await self.send_instance_event('spot_interruption', {
                    'instance_id': self.instance_id,
                    'action': action,
                    'notice_time': time.time()
                })
                
        except requests.exceptions.RequestException:
            # 404 means no interruption notice - this is normal
            pass
        except Exception as e:
            logger.error(f"Error checking spot interruption: {e}")
    
    async def send_state_change(self, state: dict):
        """Send instance state change event"""
        await self.send_instance_event('state_change', state)
    
    async def send_heartbeat(self):
        """Send periodic heartbeat"""
        await self.send_instance_event('heartbeat', {
            'instance_id': self.instance_id,
            'timestamp': time.time(),
            'service_status': self.get_service_status()
        })
    
    async def send_instance_event(self, event_type: str, data: dict):
        """Send instance event via MQTT"""
        try:
            if not self.mqtt_client:
                return
                
            topic = f"fluxer/instances/{self.instance_id}/{event_type}"
            
            message = {
                'event_type': event_type,
                'instance_id': self.instance_id,
                'timestamp': time.time(),
                'data': data
            }
            
            self.mqtt_client._publish_message(topic, message)
            logger.debug(f"Sent instance event: {event_type}")
            
        except Exception as e:
            logger.error(f"Failed to send instance event: {e}")
    
    async def send_service_ready(self):
        """Send service ready notification"""
        await self.send_instance_event('service_ready', {
            'instance_id': self.instance_id,
            'instance_type': self.instance_type,
            'service_status': 'ready',
            'public_ip': self.get_public_ip()
        })
    
    async def send_service_stopping(self):
        """Send service stopping notification"""
        await self.send_instance_event('service_stopping', {
            'instance_id': self.instance_id,
            'timestamp': time.time()
        })
    
    def get_public_ip(self) -> Optional[str]:
        """Get public IP from metadata"""
        try:
            response = requests.get(
                'http://169.254.169.254/latest/meta-data/public-ipv4',
                timeout=2
            )
            if response.status_code == 200:
                return response.text
        except:
            pass
        return None
    
    def stop_monitoring(self):
        """Stop instance monitoring"""
        self.monitoring = False
        logger.info("Instance monitoring stopped")

# Global instance monitor
_instance_monitor = None

def get_instance_monitor() -> InstanceMonitor:
    """Get global instance monitor instance"""
    global _instance_monitor
    if _instance_monitor is None:
        _instance_monitor = InstanceMonitor()
    return _instance_monitor