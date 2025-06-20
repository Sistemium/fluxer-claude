import paho.mqtt.client as mqtt
import json
import logging
import os
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

class MqttClient:
    """MQTT client for sending AI service events"""
    
    def __init__(self):
        self.client = mqtt.Client(client_id=f"fluxer-ai-{os.getpid()}")
        self.broker_host = os.getenv('MQTT_BROKER_HOST', 'localhost')
        self.broker_port = int(os.getenv('MQTT_BROKER_PORT', '1883'))
        self.username = os.getenv('MQTT_USERNAME')
        self.password = os.getenv('MQTT_PASSWORD')
        self.connected = False
        
        # Set up authentication if provided
        if self.username and self.password:
            self.client.username_pw_set(self.username, self.password)
        
        # Set up callbacks
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_publish = self._on_publish
        
        logger.info(f"MQTT client initialized for {self.broker_host}:{self.broker_port}")
    
    def _on_connect(self, client, userdata, flags, rc):
        """Callback for when the client receives a CONNACK response from the server"""
        if rc == 0:
            self.connected = True
            logger.info("Connected to MQTT broker successfully")
        else:
            self.connected = False
            logger.error(f"Failed to connect to MQTT broker, return code {rc}")
    
    def _on_disconnect(self, client, userdata, rc):
        """Callback for when the client disconnects from the server"""
        self.connected = False
        if rc != 0:
            logger.warning("Unexpected MQTT disconnection. Will auto-reconnect")
        else:
            logger.info("Disconnected from MQTT broker")
    
    def _on_publish(self, client, userdata, mid):
        """Callback for when a message is successfully published"""
        logger.debug(f"Message published successfully, mid: {mid}")
    
    def connect(self) -> bool:
        """Connect to MQTT broker"""
        try:
            logger.info(f"Connecting to MQTT broker at {self.broker_host}:{self.broker_port}")
            self.client.connect(self.broker_host, self.broker_port, 60)
            self.client.loop_start()  # Start background thread for network activity
            
            # Wait a bit for connection
            import time
            time.sleep(1)
            
            return self.connected
        except Exception as e:
            logger.error(f"Error connecting to MQTT broker: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from MQTT broker"""
        self.client.loop_stop()
        self.client.disconnect()
    
    def _publish_message(self, topic: str, payload: dict) -> bool:
        """Publish a message to MQTT broker"""
        if not self.connected:
            logger.warning("MQTT client not connected, cannot publish message")
            return False
        
        try:
            message = json.dumps(payload)
            result = self.client.publish(topic, message, qos=1)
            
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                logger.debug(f"Published to {topic}: {payload}")
                return True
            else:
                logger.error(f"Failed to publish to {topic}, error code: {result.rc}")
                return False
        except Exception as e:
            logger.error(f"Error publishing MQTT message to {topic}: {e}")
            return False
    
    def send_progress_update(self, job_id: str, user_id: str, progress: int, message: str) -> bool:
        """Send progress update via MQTT"""
        topic = f"fluxer/ai/progress/{user_id}/{job_id}"
        payload = {
            'jobId': job_id,
            'userId': user_id,
            'progress': progress,
            'message': message,
            'timestamp': datetime.utcnow().isoformat()
        }
        return self._publish_message(topic, payload)
    
    def send_completion_update(self, job_id: str, user_id: str) -> bool:
        """Send completion update via MQTT (without image data)"""
        topic = f"fluxer/ai/completed/{user_id}/{job_id}"
        payload = {
            'jobId': job_id,
            'userId': user_id,
            'status': 'completed',
            'timestamp': datetime.utcnow().isoformat()
        }
        return self._publish_message(topic, payload)
    
    def send_error_update(self, job_id: str, user_id: str, error: str) -> bool:
        """Send error update via MQTT"""
        topic = f"fluxer/ai/error/{user_id}/{job_id}"
        payload = {
            'jobId': job_id,
            'userId': user_id,
            'error': error,
            'timestamp': datetime.utcnow().isoformat()
        }
        return self._publish_message(topic, payload)

# Global instance
mqtt_client: Optional[MqttClient] = None

def get_mqtt_client() -> Optional[MqttClient]:
    """Get or create MQTT client instance"""
    global mqtt_client
    
    # Check if MQTT is configured
    if not os.getenv('MQTT_BROKER_HOST'):
        logger.info("MQTT not configured, skipping MQTT client initialization")
        return None
    
    if mqtt_client is None:
        mqtt_client = MqttClient()
        if not mqtt_client.connect():
            logger.warning("Failed to connect to MQTT broker")
            mqtt_client = None
    
    return mqtt_client

def send_progress_update(job_id: str, user_id: str, progress: int, message: str) -> None:
    """Convenience function to send progress update"""
    try:
        client = get_mqtt_client()
        if client:
            success = client.send_progress_update(job_id, user_id, progress, message)
            if not success:
                logger.warning(f"Failed to send MQTT progress update for job {job_id}")
        else:
            logger.debug("MQTT client not available, skipping progress update")
    except Exception as e:
        logger.error(f"Error in send_progress_update: {e}")

def send_completion_update(job_id: str, user_id: str) -> None:
    """Convenience function to send completion update (without image data)"""
    try:
        client = get_mqtt_client()
        if client:
            success = client.send_completion_update(job_id, user_id)
            if not success:
                logger.warning(f"Failed to send MQTT completion update for job {job_id}")
        else:
            logger.debug("MQTT client not available, skipping completion update")
    except Exception as e:
        logger.error(f"Error in send_completion_update: {e}")

def send_error_update(job_id: str, user_id: str, error: str) -> None:
    """Convenience function to send error update"""
    try:
        client = get_mqtt_client()
        if client:
            success = client.send_error_update(job_id, user_id, error)
            if not success:
                logger.warning(f"Failed to send MQTT error update for job {job_id}")
        else:
            logger.debug("MQTT client not available, skipping error update")
    except Exception as e:
        logger.error(f"Error in send_error_update: {e}")

def cleanup_mqtt():
    """Cleanup MQTT client on shutdown"""
    global mqtt_client
    if mqtt_client:
        mqtt_client.disconnect()
        mqtt_client = None