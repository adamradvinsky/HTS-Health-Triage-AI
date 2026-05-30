import json
import os
from typing import Any, Dict, List, Optional

import requests

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

NEVER_MISS_SYMPTOMS = {
    "chest pain": ["chest pain", "pressure in chest", "crushing chest", "heart attack"],
    "difficulty breathing": ["shortness of breath", "can't breathe", "trouble breathing", "wheezing"],
    "stroke signs": ["sudden numbness", "face droop", "slurred speech", "one side weak", "stroke"],
    "severe bleeding": ["severe bleeding", "won't stop bleeding", "hemorrhage", "bleeding heavily"],
    "loss of consciousness": ["passed out", "fainted", "unconscious", "blackout"],
    "seizure": ["seizure", "convulsion", "shaking episode"],
    "severe head injury": ["head injury", "hit my head", "concussion", "knocked out"],
    "anaphylaxis": ["anaphylaxis", "throat swelling", "lip swelling", "tongue swelling"],
    "suicidal risk": ["suicidal", "want to die", "self-harm", "kill myself"],
    "severe abdominal pain": ["severe abdominal pain", "worst stomach pain", "appendicitis"],
}

SYSTEM_PROMPT = """
You are a cautious and friendly triage nurse assistant for a hackathon demo.
This is NOT a diagnosis tool. Prioritize safety and avoid overconfidence.

Goals:
1) Gather concise but relevant intake details through follow-up questions.
2) Classify care recommendation as one of: ER now, Urgent care today, Self-care/monitor.
3) If uncertain between levels, escalate to the higher level.
4) Output strictly valid JSON only, no markdown.

Output JSON schema:
{
  "stage": "needs_more_info" | "triage_decision",
  "assistant_message": "string",
  "triage_recommendation": "ER now" | "Urgent care today" | "Self-care / monitor",
  "reasoning_brief": "string",
  "follow_up_questions": ["string"],
    "self_care_tips": ["string"],
    "next_steps": ["string"],
  "intake_summary": {
    "chief_complaint": "string",
    "symptoms": ["string"],
    "onset_and_timeline": "string",
    "severity": "string",
    "related_event_or_injury": "string",
    "medical_history_relevant": "string",
    "medications_allergies": "string",
    "vitals_if_known": "string",
    "red_flags": ["string"],
    "disclaimer": "This summary is AI-generated for intake support and is not medical diagnosis."
  }
}

Rules:
- Keep responses short, warm, and practical.
- Use simple plain language. Avoid jargon and complex words.
- Sound like a calm nurse, not a legal disclaimer bot.
- Ask only the highest value missing questions (max 3 at a time).
- If enough intake details are already gathered, switch to "triage_decision" and wrap up.
- In wrap-up, tell user they can download the intake PDF summary and can continue asking questions.
- For "Self-care / monitor", provide general comfort/safety tips (not diagnosis).
- Include a short disclaimer in assistant_message when recommending care.
- Never claim certainty.
""".strip()


def _extract_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model did not return JSON")

    return json.loads(text[start : end + 1])


def detect_never_miss(text: str) -> List[str]:
    lowered = text.lower()
    hits = []
    for label, patterns in NEVER_MISS_SYMPTOMS.items():
        if any(p in lowered for p in patterns):
            hits.append(label)
    return hits


def _default_intake_summary(latest_user_message: str, red_flags: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        "chief_complaint": latest_user_message[:180],
        "symptoms": [],
        "onset_and_timeline": "Not fully collected yet",
        "severity": "Unknown",
        "related_event_or_injury": "Not provided",
        "medical_history_relevant": "Not provided",
        "medications_allergies": "Not provided",
        "vitals_if_known": "Not provided",
        "red_flags": red_flags or [],
        "disclaimer": "This summary is AI-generated for intake support and is not medical diagnosis.",
    }


def _minimal_fallback_questions() -> List[str]:
    return [
        "What symptom is bothering you most right now?",
        "When did it start?",
    ]


def _is_simple_greeting(text: str) -> bool:
    cleaned = text.strip().lower()
    return cleaned in {"hi", "hello", "hey", "yo", "sup", "good morning", "good afternoon", "good evening"}


def _build_high_risk_message(flags: List[str]) -> str:
    reason_map = {
        "chest pain": "Chest pain can sometimes be a sign of a heart problem.",
        "difficulty breathing": "Breathing trouble can get serious quickly.",
        "stroke signs": "Sudden numbness or speech changes can be stroke warning signs.",
        "severe bleeding": "Heavy bleeding can become dangerous fast.",
        "loss of consciousness": "Passing out can be a sign of a serious issue.",
        "seizure": "A seizure needs urgent medical evaluation.",
        "severe head injury": "Head injuries can have hidden complications.",
        "anaphylaxis": "Throat or face swelling can block breathing.",
        "suicidal risk": "Thoughts of self-harm need immediate support.",
        "severe abdominal pain": "Severe belly pain can be caused by urgent conditions.",
    }
    reasons = [reason_map[f] for f in flags if f in reason_map]
    joined_reasons = " ".join(reasons[:2]) if reasons else "Your symptoms may be high-risk."
    return (
        f"I want to be safe here. {joined_reasons} "
        "Please go to the ER now, and call 911 right away if symptoms get worse. "
        "This is not a diagnosis."
    )


def _looks_generic(question: str) -> bool:
    generic_markers = [
        "tell me more",
        "please tell me",
        "a bit more",
        "more details",
        "help me understand",
    ]
    lowered = question.lower()
    return any(marker in lowered for marker in generic_markers)


def _count_user_messages(messages: List[Dict[str, str]]) -> int:
    return len([m for m in messages if m.get("role") == "user" and m.get("content", "").strip()])


def _has_enough_context(messages: List[Dict[str, str]]) -> bool:
    user_messages = [m.get("content", "") for m in messages if m.get("role") == "user"]
    if len(user_messages) < 3:
        return False

    combined = " ".join(user_messages).lower()
    has_timing = any(token in combined for token in ["today", "yesterday", "hour", "day", "started", "since"])
    has_severity = any(token in combined for token in ["/10", "pain", "severe", "mild", "38", "39", "temperature", "fever"])
    has_associated = any(token in combined for token in ["cough", "breath", "vomit", "numb", "bleed", "headache", "rash", "tingly"])

    return has_timing and (has_severity or has_associated)


def _ensure_specific_followups(result: Dict[str, Any], latest_user_message: str) -> Dict[str, Any]:
    followups = result.get("follow_up_questions")
    if not isinstance(followups, list):
        followups = []

    followups = [q.strip() for q in followups if isinstance(q, str) and q.strip()]

    if result.get("stage") == "needs_more_info":
        if len(followups) == 0 or all(_looks_generic(q) for q in followups):
            followups = _minimal_fallback_questions()
        followups = followups[:3]

    result["follow_up_questions"] = followups

    if result.get("stage") == "needs_more_info":
        if _is_simple_greeting(latest_user_message):
            result["assistant_message"] = (
                "Hi, I can help with triage and intake questions. "
                "Tell me what symptom is bothering you most right now, and when it started."
            )
        else:
            formatted = "\n".join(f"{idx + 1}. {q}" for idx, q in enumerate(followups[:3]))
            result["assistant_message"] = (
                "Thanks for sharing that. I have a few quick questions so I can guide you safely:\n"
                f"{formatted}"
            )

    return result


def _force_wrap_up_if_ready(result: Dict[str, Any], messages: List[Dict[str, str]]) -> Dict[str, Any]:
    if result.get("stage") != "needs_more_info":
        return result

    if not _has_enough_context(messages):
        return result

    recommendation = result.get("triage_recommendation") or "Urgent care today"
    reasoning = result.get("reasoning_brief") or "Based on what you shared, this should be checked by a clinician."
    if recommendation == "Self-care / monitor":
        summary_text = (
            "Thanks for answering those questions. Based on what you shared, home care and monitoring is reasonable for now. "
            "If symptoms get worse or new red flags appear, go to urgent care or ER. "
            "You can download your intake summary PDF on the right, and you can still ask me more questions here."
        )
    elif recommendation == "ER now":
        summary_text = (
            "Thanks for sharing those details. I think ER is the safest next step right now. "
            "If symptoms worsen, call 911. You can download your intake summary PDF on the right, "
            "and you can still ask me more questions here."
        )
    else:
        summary_text = (
            "Thanks for sharing those details. This sounds appropriate for urgent care today. "
            "You can download your intake summary PDF on the right, and you can still ask me more questions here."
        )

    result["stage"] = "triage_decision"
    result["assistant_message"] = f"{summary_text} This is not a diagnosis."
    result["reasoning_brief"] = reasoning
    result["triage_recommendation"] = recommendation
    result["follow_up_questions"] = []
    return result


def _gemini_generate(messages: List[Dict[str, str]]) -> Dict[str, Any]:
    if not GEMINI_API_KEY:
        raise ValueError("Missing GEMINI_API_KEY")

    conversation_lines = []
    for item in messages:
        role = item.get("role", "user")
        content = item.get("content", "")
        if not content:
            continue
        conversation_lines.append(f"{role.upper()}: {content}")

    composed_prompt = (
        f"{SYSTEM_PROMPT}\n\n"
        "Conversation so far:\n"
        + "\n".join(conversation_lines)
        + "\n\nReturn JSON now."
    )

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    response = requests.post(
        url,
        params={"key": GEMINI_API_KEY},
        json={"contents": [{"parts": [{"text": composed_prompt}]}]},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()

    candidates = payload.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini returned no candidates")

    parts = candidates[0].get("content", {}).get("parts", [])
    model_text = "\n".join(part.get("text", "") for part in parts if part.get("text"))
    if not model_text:
        raise ValueError("Gemini returned empty content")

    return _extract_json(model_text)


def triage_chat(messages: List[Dict[str, str]]) -> Dict[str, Any]:
    latest_user_message = ""
    for message in reversed(messages):
        if message.get("role") == "user":
            latest_user_message = message.get("content", "")
            break

    flags = detect_never_miss(latest_user_message)
    if flags:
        return {
            "stage": "triage_decision",
            "assistant_message": _build_high_risk_message(flags),
            "triage_recommendation": "ER now",
            "reasoning_brief": "Never-miss high-risk symptom(s) detected, so escalation to ER is safest.",
            "follow_up_questions": [
                "When did these symptoms start?",
                "Are symptoms getting worse right now?",
                "Do you have any major medical conditions, medications, or allergies?",
            ],
            "intake_summary": _default_intake_summary(latest_user_message, flags),
            "never_miss_triggered": flags,
        }

    result = _gemini_generate(messages)
    result.setdefault("never_miss_triggered", [])
    result.setdefault("self_care_tips", [])
    result.setdefault("next_steps", [])
    if "intake_summary" not in result or not isinstance(result["intake_summary"], dict):
        result["intake_summary"] = _default_intake_summary(latest_user_message)

    result = _ensure_specific_followups(result, latest_user_message)
    if _count_user_messages(messages) >= 3:
        result = _force_wrap_up_if_ready(result, messages)

    return result
