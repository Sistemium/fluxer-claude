#!/usr/bin/env python3

import requests
import json
import time

# Test generate endpoint
def test_generate():
    url = "http://0.0.0.0:8000/generate"
    
    payload = {
        "user_id": "test_user",
        "prompt": "A cute cat sitting on a table",
        "width": 512,
        "height": 512,
        "guidance_scale": 7.5,
        "num_inference_steps": 20,  # Reduced for faster testing
        "seed": 42
    }
    
    print("Testing /generate endpoint...")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    
    try:
        response = requests.post(url, json=payload, timeout=30)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        if response.status_code == 200:
            job_data = response.json()
            job_id = job_data.get("job_id")
            
            if job_id:
                print(f"\nJob created: {job_id}")
                print("Checking job status...")
                
                # Check job status
                status_url = f"http://0.0.0.0:8000/job/{job_id}"
                
                for i in range(10):  # Check up to 10 times
                    time.sleep(2)
                    status_response = requests.get(status_url)
                    status_data = status_response.json()
                    
                    print(f"Status check {i+1}: {status_data.get('status')}")
                    
                    if status_data.get('status') in ['completed', 'failed']:
                        print(f"Final result: {json.dumps(status_data, indent=2)}")
                        break
                        
        else:
            print(f"Error: {response.text}")
            
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_generate()