import os
import json
import asyncio
import logging
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# ─── Model constants ──────────────────────────────────────────────
MODEL_DEFAULT = os.environ.get('GEMINI_MODEL', 'gemini-3.5-flash-lite')
MODEL_FALLBACK = 'gemini-3.1-flash-lite'

class GeminiClients:
    def __init__(self):
        self.clients = {
            'diagnosis': None,
            'value': None,
            'planner': None
        }

    def get_client(self, agent_name: str = 'diagnosis'):
        if not self.clients.get(agent_name):
            key = os.environ.get(f'GEMINI_API_KEY_{agent_name.upper()}')
            if not key:
                key = os.environ.get('GEMINI_API_KEY_DIAGNOSIS', '')
            
            self.clients[agent_name] = genai.Client(api_key=key)
            
        return self.clients[agent_name]

gemini_clients = GeminiClients()

async def call_gemini(system_prompt: str, user_prompt: str, response_schema: dict = None, model_name: str = MODEL_DEFAULT, agent_name: str = 'diagnosis') -> dict:
    """
    Call Gemini with structured JSON output and retry-once-with-backoff.
    """
    client = gemini_clients.get_client(agent_name)

    # We use GenerateContentConfig for response schema
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=response_schema,
        automatic_function_calling={"disable": True}
    )
    
    for attempt in range(2):
        active_model_name = model_name if attempt == 0 else (MODEL_FALLBACK if model_name == MODEL_DEFAULT else model_name)
        try:
            # Using async client
            result = await client.aio.models.generate_content(
                model=active_model_name,
                contents=user_prompt,
                config=config
            )
            return json.loads(result.text)
        except Exception as e:
            if attempt == 0:
                await asyncio.sleep(1.5)
                logger.warning(f"[GeminiClient] Attempt 1 failed with model {active_model_name}, retrying: {str(e)}")
            else:
                raise e
