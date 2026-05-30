# Health Triage AI (Hackathon MVP)

Demo web app for Greater Vancouver that combines:
- AI triage intake chat (Gemini 2.5 Flash)
- Fastest-care finder using drive time + ED/UPCC wait time

## Stack

- Frontend: React + Vite
- Backend: Flask
- APIs: Gemini API, Google Geocoding + Distance Matrix, edwaittimes

## MVP Features

- Symptom chat with follow-up intake questions
- Early escalation to ER for never-miss symptoms
- Triage recommendation: `ER now`, `Urgent care today`, `Self-care / monitor`
- Editable intake summary
- Download intake summary as PDF
- Address-based facility ranking by total time:
  - `total time = drive time + wait time`
- Filters:
  - care type (`ER`, `Urgent care`, `Both`)
  - open now only
- Facilities with unknown wait time shown separately and sorted by drive time

## Project Structure

```text
GDSC-Team1/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/
│   ├── app.py
│   ├── services/
│   │   ├── maps_service.py
│   │   ├── triage_service.py
│   │   └── wait_time_service.py
│   ├── triage/
│   │   ├── symptomQuery.py
│   │   ├── triage_service.py
│   └── utils/
│       └── distance.py
├── .env_template
├── requirements.txt
└── README.md
```

## Prerequisites

- Python 3.10+
- Node.js 18+

## Setup

1. Create and activate Python env:

```bash
python -m venv .venv
.venv\Scripts\activate
```

2. Install backend dependencies:

```bash
pip install -r requirements.txt
```

3. Create `.env` from template:

```bash
copy .env_template .env
```

4. Fill `.env` values:

```text
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

5. Install frontend dependencies:

```bash
cd frontend
npm install
```

## Run

1. Start backend (from repo root):

```bash
python backend/app.py
```

2. Start frontend (new terminal):

```bash
cd frontend
npm run dev
```

3. Open:

```text
http://localhost:5173
```

## API Endpoints

- `POST /api/triage/chat`
  - body: `{ "messages": [{"role":"user|assistant","content":"..."}] }`
- `GET /api/facilities?address=...&care_type=both|er|urgent_care&open_now=true|false&limit=7`

## Important Note

This is a demo/prototype for hackathon use only.
It is not a medical device and does not provide diagnosis.
If symptoms are severe, call 911.
