import os
import requests
from dotenv import load_dotenv
from utils.distance import calculate_distance

load_dotenv()   # Loads from root .env

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")

def geocode_address(address):
    url = "https://maps.googleapis.com/maps/api/geocode/json"

    params = {
        "address": address,
        "key": GOOGLE_MAPS_API_KEY
    }

    res = requests.get(url, params=params, timeout=20)
    data = res.json()

    if data["status"] != "OK":
        raise Exception(f"Geocoding failed: {data.get('status', 'UNKNOWN')}")

    location = data["results"][0]["geometry"]["location"]

    return location["lat"], location["lng"]


def get_driving_times_minutes(origin_lat, origin_lng, destinations):
    if not destinations:
        return []

    if not GOOGLE_MAPS_API_KEY:
        raise Exception("Missing GOOGLE_MAPS_API_KEY")

    url = "https://maps.googleapis.com/maps/api/distancematrix/json"
    destination_text = "|".join(f"{lat},{lng}" for lat, lng in destinations)

    params = {
        "origins": f"{origin_lat},{origin_lng}",
        "destinations": destination_text,
        "mode": "driving",
        "units": "metric",
        "departure_time": "now",
        "key": GOOGLE_MAPS_API_KEY,
    }

    try:
        res = requests.get(url, params=params, timeout=20)
        data = res.json()

        if data.get("status") != "OK":
            raise Exception(data.get("status", "UNKNOWN"))

        elements = data.get("rows", [{}])[0].get("elements", [])
        output = []
        for element in elements:
            if element.get("status") != "OK":
                output.append(None)
                continue

            duration = element.get("duration_in_traffic") or element.get("duration")
            if not duration:
                output.append(None)
                continue

            minutes = int(round(duration["value"] / 60))
            distance_km = None
            if element.get("distance") and element["distance"].get("value") is not None:
                distance_km = round(element["distance"]["value"] / 1000, 1)
            output.append({
                "minutes": minutes,
                "distance_km": distance_km,
                "commute_source": "google",
            })

        # If some elements fail, fill blanks with rough estimate fallback.
        for i, value in enumerate(output):
            if value is None:
                d_lat, d_lng = destinations[i]
                km = calculate_distance(origin_lat, origin_lng, d_lat, d_lng)
                output[i] = {
                    "minutes": max(3, int(round((km / 35) * 60))),
                    "distance_km": round(km, 1),
                    "commute_source": "estimate",
                }
        return output
    except Exception:
        # Fallback estimate keeps demo usable even if Distance Matrix API is disabled.
        fallback = []
        for d_lat, d_lng in destinations:
            km = calculate_distance(origin_lat, origin_lng, d_lat, d_lng)
            fallback.append(
                {
                    "minutes": max(3, int(round((km / 35) * 60))),
                    "distance_km": round(km, 1),
                    "commute_source": "estimate",
                }
            )
        return fallback


def autocomplete_address(input_text):
    if not GOOGLE_MAPS_API_KEY:
        raise Exception("Missing GOOGLE_MAPS_API_KEY")

    url = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
    params = {
        "input": input_text,
        "components": "country:ca",
        "location": "49.2827,-123.1207",
        "radius": 60000,
        "key": GOOGLE_MAPS_API_KEY,
    }
    res = requests.get(url, params=params, timeout=20)
    data = res.json()

    status = data.get("status")
    if status not in {"OK", "ZERO_RESULTS"}:
        raise Exception(f"Autocomplete failed: {status}")

    return [item.get("description") for item in data.get("predictions", []) if item.get("description")]