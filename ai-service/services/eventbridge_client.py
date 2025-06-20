import boto3
import json
import logging
import os
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

class EventBridgeClient:
    """Client for sending events to AWS EventBridge"""
    
    def __init__(self):
        self.client = boto3.client('events', region_name=os.getenv('AWS_REGION', 'eu-west-1'))
        self.event_bus_name = os.getenv('EVENTBRIDGE_BUS_NAME', 'fluxer-ai-events')
        logger.info(f"EventBridge client initialized with bus: {self.event_bus_name}")
    
    def _send_event(self, detail_type: str, detail: dict) -> bool:
        """Send event to EventBridge"""
        try:
            response = self.client.put_events(
                Entries=[
                    {
                        'Source': 'fluxer.ai-service',
                        'DetailType': detail_type,
                        'Detail': json.dumps(detail),
                        'EventBusName': self.event_bus_name
                    }
                ]
            )
            
            if response['FailedEntryCount'] > 0:
                logger.error(f"Failed to send event: {response['Entries']}")
                return False
                
            event_id = response['Entries'][0].get('EventId')
            logger.info(f"Event sent successfully: {detail_type}, EventId: {event_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error sending event to EventBridge: {e}")
            return False
    
    def send_progress_event(self, job_id: str, user_id: str, progress: int, message: str) -> bool:
        """Send progress update event"""
        detail = {
            'jobId': job_id,
            'userId': user_id,
            'progress': progress,
            'message': message,
            'timestamp': datetime.utcnow().isoformat()
        }
        return self._send_event('AI Generation Progress', detail)
    
    def send_completion_event(self, job_id: str, user_id: str) -> bool:
        """Send completion event (without image data)"""
        detail = {
            'jobId': job_id,
            'userId': user_id,
            'status': 'completed',
            'timestamp': datetime.utcnow().isoformat()
        }
        return self._send_event('AI Generation Completed', detail)
    
    def send_error_event(self, job_id: str, user_id: str, error: str) -> bool:
        """Send error event"""
        detail = {
            'jobId': job_id,
            'userId': user_id,
            'error': error,
            'timestamp': datetime.utcnow().isoformat()
        }
        return self._send_event('AI Generation Failed', detail)

# Global instance
eventbridge_client: Optional[EventBridgeClient] = None

def get_eventbridge_client() -> EventBridgeClient:
    """Get or create EventBridge client instance"""
    global eventbridge_client
    if eventbridge_client is None:
        eventbridge_client = EventBridgeClient()
    return eventbridge_client

def send_progress_update(job_id: str, user_id: str, progress: int, message: str) -> None:
    """Convenience function to send progress update"""
    try:
        client = get_eventbridge_client()
        success = client.send_progress_event(job_id, user_id, progress, message)
        if not success:
            logger.warning(f"Failed to send progress update for job {job_id}")
    except Exception as e:
        logger.error(f"Error in send_progress_update: {e}")

def send_completion_update(job_id: str, user_id: str) -> None:
    """Convenience function to send completion update (without image data)"""
    try:
        client = get_eventbridge_client()
        success = client.send_completion_event(job_id, user_id)
        if not success:
            logger.warning(f"Failed to send completion update for job {job_id}")
    except Exception as e:
        logger.error(f"Error in send_completion_update: {e}")

def send_error_update(job_id: str, user_id: str, error: str) -> None:
    """Convenience function to send error update"""
    try:
        client = get_eventbridge_client()
        success = client.send_error_event(job_id, user_id, error)
        if not success:
            logger.warning(f"Failed to send error update for job {job_id}")
    except Exception as e:
        logger.error(f"Error in send_error_update: {e}")