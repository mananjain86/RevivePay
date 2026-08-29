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
    Call Gemini with structured JSON output and retry-with-backoff.
    Switches to fallback model on retries without changing the API key.
    """
    client = gemini_clients.get_client(agent_name)

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=response_schema,
        automatic_function_calling={"disable": True}
    )
    
    max_attempts = 3
    for attempt in range(max_attempts):
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
            if attempt < max_attempts - 1:
                # Exponential backoff: e.g., 2s, then 4s
                sleep_time = 2.0 * (attempt + 1)
                logger.warning(f"[GeminiClient] Attempt {attempt + 1} failed for {agent_name} with model {active_model_name}. Retrying in {sleep_time}s with fallback model: {str(e)}")
                await asyncio.sleep(sleep_time)
            else:
                logger.error(f"[GeminiClient] All {max_attempts} attempts failed for {agent_name}.")
                raise e
