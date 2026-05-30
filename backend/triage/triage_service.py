from flask import Blueprint, request, jsonify
from triage.symptomQuery import queryGem
user_bp = Blueprint('user_routes', __name__)


@user_bp.route("/triage", methods=['POST'])
def triage():
    
    #access the symptoms from json
    data = request.get_json()
    symptoms = data.get('symptoms', [])
    
    #give gemini the symptoms
    response = queryGem(symptoms)
    
    
    return jsonify(response)
