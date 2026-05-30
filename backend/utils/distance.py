from math import radians, sin, cos, sqrt, atan2

def calculate_distance(lat1, lng1, lat2, lng2):
    R = 6371   # Earth radius in km

    lat1_rad = radians(lat1)
    lng1_rad = radians(lng1)
    lat2_rad = radians(lat2)
    lng2_rad = radians(lng2)

    dlat = lat2_rad - lat1_rad
    dlng = lng2_rad - lng1_rad

    a = sin(dlat/2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(dlng/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return R * c