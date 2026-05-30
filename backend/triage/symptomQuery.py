from google import genai
import json

client = genai.Client()


def queryGem(symptoms: list[str]):

    prompt = f"""
You are a medical triage assistant.

Patient symptoms:
{symptoms}

Respond ONLY in valid JSON with this format:
{{
  "possible_conditions": ["condition1", "condition2"],
  "urgency": "low | medium | high | emergency",
  "recommended_action": "string",
  "reasoning": "short explanation"
}}

Rules:
- Be cautious and prioritize safety
- If symptoms could be serious, mark as higher urgency
- Do NOT include anything outside JSON
"""

    #ask gemini everything
    response = client.models.generate_content(
        model="gemini-3-flash-preview", contents=prompt
    )
    

    # make it so that if the aptient says certian keywords then to 
    # automatically make the result be to go to hospital


    try:
        return json.loads(response.text)
    except:
        return {
            "error": "Invalid AI response",
            "raw": response.text
        }
    