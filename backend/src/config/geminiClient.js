const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

// ─── Model constants ──────────────────────────────────────────────
const MODEL_DEFAULT = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const MODEL_FALLBACK = 'gemini-3.5-flash-lite';

let genAI = null;

function getGenAI() {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }
  return genAI;
}

/**
 * Call Gemini with structured JSON output and retry-once-with-backoff.
 *
 * @param {object} options
 * @param {string} options.systemPrompt - System instruction for the model
 * @param {string} options.userPrompt - User message content
 * @param {object} [options.responseSchema] - SchemaType schema for structured output
 * @param {string} [options.modelName] - Model to use (default: gemini-3.5-flash-lite)
 * @returns {Promise<object>} Parsed JSON response from Gemini
 * @throws {Error} If both attempts fail
 */
async function callGemini({ systemPrompt, userPrompt, responseSchema, modelName = MODEL_DEFAULT }) {
  const client = getGenAI();

  const getModelInstance = (mName) => client.getGenerativeModel({
    model: mName,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      ...(responseSchema ? { responseSchema } : {})
    }
  });

  // Retry once with backoff on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    const activeModelName = attempt === 0 ? modelName : (modelName === MODEL_DEFAULT ? MODEL_FALLBACK : modelName);
    try {
      const model = getModelInstance(activeModelName);
      const result = await model.generateContent(userPrompt);
      const text = result.response.text();
      return JSON.parse(text);
    } catch (error) {
      if (attempt === 0) {
        // Wait 1.5 seconds before retry
        await new Promise(resolve => setTimeout(resolve, 1500));
        console.warn(`[GeminiClient] Attempt 1 failed with model ${activeModelName}, retrying: ${error.message}`);
      } else {
        throw error;
      }
    }
  }
}

module.exports = { getGenAI, callGemini, SchemaType, MODEL_DEFAULT, MODEL_FALLBACK };
