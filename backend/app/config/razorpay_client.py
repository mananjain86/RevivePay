import os
import razorpay

def get_razorpay_client() -> razorpay.Client:
    key_id = os.environ.get('RAZORPAY_KEY_ID', '')
    key_secret = os.environ.get('RAZORPAY_KEY_SECRET', '')
    return razorpay.Client(auth=(key_id, key_secret))

# Create a singleton instance similar to Node.js
razorpay_client = get_razorpay_client()
