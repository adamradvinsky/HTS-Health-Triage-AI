from flask import Flask, request, jsonify
from flask_cors import CORS
from services.wait_time_service import rank_hospitals
from services.maps_service import geocode_address, autocomplete_address
from services.triage_service import triage_chat

app = Flask(__name__)
CORS(app)

@app.route("/")
def home():
    return "Health Triage API Running"

@app.route("/api/facilities")
def get_wait_times():
    address = request.args.get("address")
    care_type = request.args.get("care_type", "both")
    open_now = request.args.get("open_now", "false").lower() == "true"
    limit = int(request.args.get("limit", "5"))

    if not address:
        return jsonify({"error": "Address is required"}), 400

    try:
        lat, lng = geocode_address(address)
        ranked_data = rank_hospitals(lat, lng, care_type=care_type, open_now=open_now)

        return jsonify({
            "input_address": address,
            "care_type": care_type,
            "open_now": open_now,
            "ranked_results": ranked_data["ranked"][:limit],
            "unknown_wait_results": ranked_data["unknown_wait"][:limit],
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/triage/chat", methods=["POST"])
def triage_chat_endpoint():
    payload = request.get_json(silent=True) or {}
    messages = payload.get("messages", [])

    if not isinstance(messages, list) or len(messages) == 0:
        return jsonify({"error": "messages array is required"}), 400

    try:
        result = triage_chat(messages)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/address_suggest")
def address_suggest():
    q = request.args.get("q", "").strip()
    if len(q) < 3:
        return jsonify({"suggestions": []})

    try:
        suggestions = autocomplete_address(q)
        return jsonify({"suggestions": suggestions[:6]})
    except Exception as e:
        return jsonify({"error": str(e), "suggestions": []}), 500

if __name__ == "__main__":
    app.run(debug=True)
    