import requests
from datetime import datetime
from zoneinfo import ZoneInfo

from services.maps_service import get_driving_times_minutes

API_URL = "https://edwaittimes.ca/api/wait-times"

def _care_type_from_raw(raw_type):
    if raw_type == "ed":
        return "er"
    if raw_type == "upcc":
        return "urgent_care"
    return "other"


def _parse_hh_mm(raw):
    if not raw:
        return None
    try:
        dt = datetime.strptime(raw, "%a, %d %b %Y %H:%M:%S GMT")
        return dt.hour, dt.minute
    except ValueError:
        return None


def _is_open_now(entry):
    if entry.get("open247"):
        return True

    days = entry.get("operatingHours", {}).get("days", [])
    if not days:
        return None

    # edwaittimes uses a 7-day array; for MVP we assume Python weekday alignment.
    now = datetime.now(ZoneInfo("America/Vancouver"))
    day_idx = now.weekday()
    if day_idx >= len(days):
        return None

    day_info = days[day_idx]
    open_time = _parse_hh_mm(day_info.get("open"))
    close_time = _parse_hh_mm(day_info.get("close"))
    if not open_time or not close_time:
        return None

    open_minutes = open_time[0] * 60 + open_time[1]
    close_minutes = close_time[0] * 60 + close_time[1]
    current_minutes = now.hour * 60 + now.minute

    if close_minutes <= open_minutes:
        return current_minutes >= open_minutes or current_minutes <= close_minutes

    return open_minutes <= current_minutes <= close_minutes


def fetch_wait_times():
    res = requests.get(API_URL, timeout=20)
    data = res.json()

    hospitals = []

    for h in data:
        wait = h.get("waitTime")
        wait_minutes = None
        if wait and wait.get("waitTimeMinutes") is not None:
            wait_minutes = int(wait["waitTimeMinutes"])

        hospitals.append({
            "name": h["name"],
            "address": h["address"],
            "lat": h["latitude"],
            "lng": h["longitude"],
            "wait_time_min": wait_minutes,
            "wait_time_readable": format_time(wait_minutes) if wait_minutes is not None else "Unknown",
            "care_type": _care_type_from_raw(h.get("type")),
            "is_open_now": _is_open_now(h),
            "open_24_7": bool(h.get("open247", False)),
        })

    return hospitals

def format_time(minutes):
    if minutes is None:
        return "Unknown"
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours}h {mins}m"

def rank_hospitals(user_lat, user_lng, care_type="both", open_now=False):
    hospitals = fetch_wait_times()

    if care_type in {"er", "urgent_care"}:
        hospitals = [h for h in hospitals if h["care_type"] == care_type]

    if open_now:
        hospitals = [h for h in hospitals if h["is_open_now"] is True]

    destinations = [(h["lat"], h["lng"]) for h in hospitals]
    driving_minutes = get_driving_times_minutes(user_lat, user_lng, destinations)

    ranked = []
    unknown_wait = []

    for index, h in enumerate(hospitals):
        commute_info = driving_minutes[index] if index < len(driving_minutes) else None
        if commute_info is None:
            continue

        commute = commute_info.get("minutes")
        if commute is None:
            continue

        row = dict(h)
        row["commute_time_min"] = commute
        row["commute_time_readable"] = format_time(commute)
        row["distance_km"] = commute_info.get("distance_km")
        row["commute_source"] = commute_info.get("commute_source", "estimate")

        if row["wait_time_min"] is None:
            row["total_time_min"] = None
            unknown_wait.append(row)
        else:
            row["total_time_min"] = commute + row["wait_time_min"]
            row["total_time_readable"] = format_time(row["total_time_min"])
            ranked.append(row)

    ranked.sort(key=lambda x: x["total_time_min"])
    unknown_wait.sort(key=lambda x: x["commute_time_min"])

    return {
        "ranked": ranked,
        "unknown_wait": unknown_wait,
    }