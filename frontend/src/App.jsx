import { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

const API_BASE = "http://127.0.0.1:5000";

const INITIAL_ASSISTANT_MESSAGE = {
  role: "assistant",
  content: "Hi, I am your triage assistant. Tell me what is going on, and I will ask a few quick intake-style questions.",
  time: new Date(),
};

const redIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function makePinIcon(color = "#194fb7") {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.941 14 22 14 22S28 23.941 28 14C28 6.268 21.732 0 14 0z"
        fill="${color}" stroke="white" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="5" fill="white"/>
    </svg>`.trim();
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
  });
}

const primaryPinIcon = makePinIcon("#194fb7");
const erPinIcon = makePinIcon("#b91c1c");

const EMPTY_SUMMARY = {
  chief_complaint: "",
  symptoms: [],
  onset_and_timeline: "",
  severity: "",
  related_event_or_injury: "",
  medical_history_relevant: "",
  medications_allergies: "",
  vitals_if_known: "",
  red_flags: [],
  disclaimer: "This summary is AI-generated for intake support and is not medical diagnosis.",
};

function formatTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function FlyToMarker({ facility }) {
  const map = useMap();
  useEffect(() => {
    if (!facility) return;
    map.flyTo([facility.lat, facility.lng], 14, { duration: 0.8 });
  }, [facility, map]);
  return null;
}

function App() {
  const [activePage, setActivePage] = useState("chat");
  const [messages, setMessages] = useState([INITIAL_ASSISTANT_MESSAGE]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [triageResult, setTriageResult] = useState(null);
  const [intakeSummary, setIntakeSummary] = useState(EMPTY_SUMMARY);
  const [isEditingSummary, setIsEditingSummary] = useState(false);

  const [address, setAddress] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [careType, setCareType] = useState("both");
  const [openNow, setOpenNow] = useState(true);
  const [facilityBusy, setFacilityBusy] = useState(false);
  const [facilityData, setFacilityData] = useState({ ranked_results: [], unknown_wait_results: [] });
  const [facilityError, setFacilityError] = useState("");
  const [selectedFacility, setSelectedFacility] = useState(null);
  const markerRefs = useRef([]);
  const chatboxRef = useRef(null);

  const sessionId = useMemo(() => `CL-${Math.floor(1000 + Math.random() * 9000)}`, []);
  const canSend = chatInput.trim().length > 0 && !chatBusy;
  const summaryJson = useMemo(() => JSON.stringify(intakeSummary, null, 2), [intakeSummary]);

  const mapFacilities = useMemo(
    () => [...(facilityData.ranked_results || []), ...(facilityData.unknown_wait_results || [])],
    [facilityData]
  );
  const mapCenter = useMemo(() => {
    if (mapFacilities.length > 0) return [mapFacilities[0].lat, mapFacilities[0].lng];
    return [49.2827, -123.1207];
  }, [mapFacilities]);

  const appendMessage = (role, content) => {
    setMessages((prev) => [...prev, { role, content, time: new Date() }]);
  };

  const handleSend = async (event) => {
    event.preventDefault();
    if (!canSend) return;
    const userMessage = { role: "user", content: chatInput.trim(), time: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatBusy(true);
    try {
      const payloadMessages = [...messages, userMessage].map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch(`${API_BASE}/api/triage/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat request failed");
      appendMessage("assistant", data.assistant_message || "I could not generate a response.");
      setTriageResult(data);
      if (data.intake_summary) setIntakeSummary(data.intake_summary);
      if (data.triage_recommendation === "ER now") setCareType("er");
      else if (data.triage_recommendation === "Urgent care today") setCareType("urgent_care");
    } catch (error) {
      appendMessage("assistant", `Error: ${error.message}`);
    } finally {
      setChatBusy(false);
    }
  };

  const handleChatInputKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) handleSend(event);
    }
  };

  const handleSummaryFieldChange = (field, value) => {
    setIntakeSummary((prev) => ({ ...prev, [field]: value }));
  };

  const handleSummaryListChange = (field, value) => {
    const list = value.split(",").map((item) => item.trim()).filter(Boolean);
    setIntakeSummary((prev) => ({ ...prev, [field]: list }));
  };

  const downloadPdf = () => {
    const doc = new jsPDF();
    const recommendation = triageResult?.triage_recommendation || "Pending";
    const generatedAt = new Date().toLocaleString();
    doc.setFillColor(34, 82, 161);
    doc.rect(0, 0, 210, 34, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Emergency Intake Summary", 14, 15);
    doc.setFontSize(10);
    doc.text("AI-generated intake summary", 14, 23);
    doc.setTextColor(16, 42, 67);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated: ${generatedAt}`, 14, 42);
    doc.text(`Triage recommendation: ${recommendation}`, 14, 48);
    const sections = [
      ["Chief complaint", intakeSummary.chief_complaint || "N/A"],
      ["Symptoms", (intakeSummary.symptoms || []).join(", ") || "N/A"],
      ["Onset and timeline", intakeSummary.onset_and_timeline || "N/A"],
      ["Severity", intakeSummary.severity || "N/A"],
      ["Related event/injury", intakeSummary.related_event_or_injury || "N/A"],
      ["Relevant medical history", intakeSummary.medical_history_relevant || "N/A"],
      ["Medications and allergies", intakeSummary.medications_allergies || "N/A"],
      ["Vitals if known", intakeSummary.vitals_if_known || "N/A"],
      ["Red flags", (intakeSummary.red_flags || []).join(", ") || "N/A"],
    ];
    let y = 58;
    for (const [label, value] of sections) {
      if (y > 268) { doc.addPage(); y = 14; }
      doc.setFillColor(247, 250, 252);
      doc.roundedRect(12, y - 6, 186, 14, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(label, 16, y);
      doc.setFont("helvetica", "normal");
      const wrapped = doc.splitTextToSize(value, 170);
      doc.text(wrapped, 16, y + 6);
      y += 8 + wrapped.length * 5;
    }
    const disclaimer = intakeSummary.disclaimer || "This summary is AI-generated for intake support and is not medical diagnosis.";
    if (y > 260) { doc.addPage(); y = 14; }
    doc.setTextColor(120, 53, 15);
    doc.setFontSize(9);
    doc.text(doc.splitTextToSize(disclaimer, 180), 14, y + 6);
    doc.save("intake-summary.pdf");
  };

  const copySummary = async () => {
    await navigator.clipboard.writeText(summaryJson);
  };

  const loadFacilities = async (event) => {
    event.preventDefault();
    if (!address.trim()) { setFacilityError("Address is required."); return; }
    setFacilityBusy(true);
    setFacilityError("");
    try {
      const params = new URLSearchParams({ address: address.trim(), care_type: careType, open_now: String(openNow), limit: "7" });
      const res = await fetch(`${API_BASE}/api/facilities?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Facility lookup failed");
      setFacilityData(data);
    } catch (error) {
      setFacilityError(error.message);
    } finally {
      setFacilityBusy(false);
    }
  };

  const fetchAddressSuggestions = async (inputValue) => {
    setAddress(inputValue);
    setSuggestionIndex(-1);
    if (inputValue.trim().length < 3) { setAddressSuggestions([]); return; }
    try {
      const params = new URLSearchParams({ q: inputValue.trim() });
      const res = await fetch(`${API_BASE}/api/address_suggest?${params.toString()}`);
      const data = await res.json();
      setAddressSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch {
      setAddressSuggestions([]);
    }
  };

  const handleAddressKeyDown = (e) => {
    if (!addressSuggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestionIndex((i) => Math.min(i + 1, addressSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestionIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && suggestionIndex >= 0) {
      e.preventDefault();
      setAddress(addressSuggestions[suggestionIndex]);
      setAddressSuggestions([]);
      setSuggestionIndex(-1);
    } else if (e.key === "Escape") {
      setAddressSuggestions([]);
      setSuggestionIndex(-1);
    }
  };

  const handleCardClick = (idx) => {
    const facility = mapFacilities[idx];
    setSelectedFacility(facility);
    markerRefs.current[idx]?.openPopup();
  };

  const hasSummary = Boolean(triageResult && intakeSummary && intakeSummary.chief_complaint);

  const triageGradient = triageResult?.triage_recommendation === "ER now"
    ? "linear-gradient(135deg, #7f1d1d, #b91c1c)"
    : triageResult?.triage_recommendation === "Urgent care today"
    ? "linear-gradient(135deg, #194fb7, #3b69d1)"
    : "linear-gradient(135deg, #064e3b, #059669)";

  const triageLabel = triageResult?.triage_recommendation === "ER now" ? "Red"
    : triageResult?.triage_recommendation === "Urgent care today" ? "Yellow"
    : "Green";

  useEffect(() => {
    if (!chatboxRef.current) return;
    chatboxRef.current.scrollTop = chatboxRef.current.scrollHeight;
  }, [messages, chatBusy]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface text-on-surface">

      {/* ── Navbar ──────────────────────────────────────── */}
      <nav className="bg-white/80 backdrop-blur-xl shadow-sm fixed top-0 w-full z-50">
        <div className="flex justify-between items-center h-16 px-8 max-w-full mx-auto">
          <div className="flex items-center gap-8">
            <span className="text-xl font-bold tracking-tighter text-blue-700 font-headline">
              AI Medical Triage Assistant
            </span>
            <div className="hidden md:flex gap-6 items-center">
              <button
                onClick={() => setActivePage("chat")}
                className={`text-sm font-semibold pb-1 transition-colors border-b-2 ${
                  activePage === "chat"
                    ? "text-blue-700 border-blue-700"
                    : "text-slate-500 border-transparent hover:text-blue-600"
                }`}
              >
                Triage Chat
              </button>
              <button
                onClick={() => setActivePage("finder")}
                className={`text-sm font-semibold pb-1 transition-colors border-b-2 ${
                  activePage === "finder"
                    ? "text-blue-700 border-blue-700"
                    : "text-slate-500 border-transparent hover:text-blue-600"
                }`}
              >
                Clinic Finder
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="bg-primary text-on-primary px-6 py-2 rounded-full font-semibold text-sm hover:opacity-90 active:scale-95 duration-150 transition-all flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>call</span>
              Emergency Call
            </button>
            <div className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-slate-100/50 transition-all cursor-pointer">
              <span className="material-symbols-outlined text-slate-600">account_circle</span>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Main ────────────────────────────────────────── */}
      <main className="pt-16 flex-1 flex overflow-hidden">

        {/* ── Page: Triage Chat ──────────────────────────── */}
        {activePage === "chat" && (
          <>
            {/* Chat Area */}
            <section className="flex-1 flex flex-col overflow-hidden bg-surface-container-low">
              <div className="px-8 py-6 flex-shrink-0">
                <h1 className="text-2xl font-bold tracking-tight text-on-surface font-headline">Triage Chat</h1>
                <p className="text-sm text-on-surface-variant font-medium mt-0.5">
                  Session ID: #{sessionId} &bull; AI-Assisted Assessment
                </p>
              </div>

              {/* Messages */}
              <div
                ref={chatboxRef}
                className="flex-1 overflow-y-auto px-8 pb-4 no-scrollbar"
                style={{ display: "flex", flexDirection: "column", gap: "24px" }}
              >
                <div className="flex justify-center">
                  <span className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-widest bg-surface-container-highest/40 px-3 py-1 rounded-full">
                    Today, {formatTime(messages[0]?.time)}
                  </span>
                </div>

                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex flex-col max-w-[80%] ${
                      m.role === "user" ? "items-end self-end" : "items-start self-start"
                    }`}
                  >
                    <div
                      className={`px-5 py-4 shadow-sm text-sm leading-relaxed ${
                        m.role === "assistant"
                          ? "bg-surface-container-highest text-on-surface rounded-xl rounded-bl-none"
                          : "bg-primary text-on-primary rounded-xl rounded-br-none"
                      }`}
                    >
                      {m.content}
                    </div>
                    <div className="flex items-center gap-1 mt-1 mx-1">
                      <span className="text-[10px] text-on-surface-variant font-medium">
                        {m.role === "assistant" ? "Assistant" : "You"} &bull; {formatTime(m.time)}
                      </span>
                      {m.role === "user" && (
                        <span className="material-symbols-outlined text-primary" style={{ fontSize: "12px" }}>
                          check_circle
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {chatBusy && (
                  <div className="flex flex-col items-start self-start max-w-[80%]">
                    <div className="bg-surface-container-highest px-5 py-4 rounded-xl rounded-bl-none shadow-sm">
                      <div className="typing-indicator">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input Bar */}
              <div className="p-6 bg-surface-container-low flex-shrink-0">
                <div className="max-w-4xl mx-auto">
                  <form
                    onSubmit={handleSend}
                    className="flex items-center gap-3 bg-surface-container-lowest p-2 rounded-2xl shadow-sm border border-outline-variant/10"
                  >
                    <button
                      type="button"
                      className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high rounded-full transition-all flex-shrink-0"
                      style={{ background: "transparent", boxShadow: "none" }}
                    >
                      <span className="material-symbols-outlined">add</span>
                    </button>
                    <input
                      type="text"
                      className="flex-1 bg-transparent border-none text-sm font-medium text-on-surface outline-none placeholder:text-outline"
                      placeholder="Type your response here..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={handleChatInputKeyDown}
                    />
                    <button
                      type="submit"
                      disabled={!canSend}
                      className="w-10 h-10 flex items-center justify-center bg-primary text-on-primary rounded-full hover:opacity-90 active:scale-95 transition-all flex-shrink-0 disabled:opacity-40"
                      style={{ boxShadow: "none" }}
                    >
                      <span className="material-symbols-outlined">send</span>
                    </button>
                  </form>
                </div>
              </div>
            </section>

            {/* Clinical Summary Panel */}
            <aside className="w-96 flex-shrink-0 bg-surface-container-lowest border-l border-outline-variant/10 overflow-y-auto hidden xl:flex flex-col no-scrollbar">
              <div className="p-8" style={{ display: "flex", flexDirection: "column", gap: "32px" }}>

                {/* Header */}
                <div>
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <h2 className="text-lg font-bold tracking-tight text-on-surface font-headline">Clinical Summary</h2>
                      <p className="text-xs text-on-surface-variant mt-1 font-medium">Real-time patient synthesis</p>
                    </div>
                    {hasSummary && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setIsEditingSummary((p) => !p)}
                          className="text-xs font-semibold text-on-surface-variant border border-outline-variant rounded-full px-3 py-1 hover:border-primary hover:text-primary transition-colors"
                          style={{ background: "transparent", boxShadow: "none" }}
                        >
                          {isEditingSummary ? "Done" : "Edit"}
                        </button>
                        <button
                          type="button"
                          onClick={copySummary}
                          className="text-xs font-semibold text-on-surface-variant border border-outline-variant rounded-full px-3 py-1 hover:border-primary hover:text-primary transition-colors"
                          style={{ background: "transparent", boxShadow: "none" }}
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={downloadPdf}
                          className="text-xs font-semibold text-on-surface-variant border border-outline-variant rounded-full px-3 py-1 hover:border-primary hover:text-primary transition-colors"
                          style={{ background: "transparent", boxShadow: "none" }}
                        >
                          PDF
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Empty state */}
                {!hasSummary && (
                  <div className="bg-surface-container-low p-5 rounded-xl text-center text-sm text-on-surface-variant font-medium leading-relaxed border border-dashed border-outline-variant">
                    Continue the chat — your clinical summary will build here in real time.
                  </div>
                )}

                {/* Summary view */}
                {hasSummary && !isEditingSummary && (
                  <>
                    {/* Primary Concern Card */}
                    <div className="bg-surface-container-low p-5 rounded-xl" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center"
                          style={{ background: "rgba(25, 79, 183, 0.1)" }}
                        >
                          <span className="material-symbols-outlined text-primary">medical_services</span>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Primary Concern</p>
                          <p className="text-sm font-bold text-on-surface">{intakeSummary.chief_complaint}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-2">
                        {intakeSummary.onset_and_timeline && (
                          <div>
                            <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-tighter">Onset</p>
                            <p className="text-sm font-semibold text-on-surface">{intakeSummary.onset_and_timeline}</p>
                          </div>
                        )}
                        {intakeSummary.severity && (
                          <div>
                            <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-tighter">Severity</p>
                            <p className="text-sm font-semibold text-on-surface">{intakeSummary.severity}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Symptom Log */}
                    {(intakeSummary.symptoms || []).length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <div className="flex justify-between items-center">
                          <h3 className="text-sm font-bold text-on-surface font-headline">Symptom Log</h3>
                          <span className="text-[10px] font-bold text-on-surface-variant px-2 py-0.5 bg-surface-container-high rounded uppercase tracking-tighter">
                            Live
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                          {[
                            ...(intakeSummary.symptoms || []).map((s) => ({ text: s, isFlag: false })),
                            ...(intakeSummary.red_flags || []).map((f) => ({ text: f, isFlag: true })),
                          ].map((item, i, arr) => (
                            <div key={i} className="flex gap-4 items-start relative pb-4">
                              {i < arr.length - 1 && (
                                <div className="absolute left-[11px] top-6 bottom-0 w-[1px] bg-outline-variant/30" />
                              )}
                              <div
                                className={`w-6 h-6 rounded-full flex items-center justify-center z-10 flex-shrink-0 ${
                                  item.isFlag ? "bg-red-100" : "bg-blue-100"
                                }`}
                              >
                                <div
                                  className={`w-2 h-2 rounded-full ${item.isFlag ? "bg-error" : "bg-primary"}`}
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-semibold ${item.isFlag ? "text-error" : "text-on-surface"}`}>
                                  {item.text}
                                </p>
                                <p className="text-xs text-on-surface-variant mt-0.5">
                                  {item.isFlag ? "Red flag detected" : "Reported via text description"}
                                </p>
                              </div>
                              <span className="text-[10px] font-medium text-on-surface-variant flex-shrink-0">
                                {formatTime(messages[messages.length - 1]?.time)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Triage Result Card */}
                    {triageResult && (
                      <div
                        className="p-6 rounded-2xl text-white"
                        style={{ background: triageGradient }}
                      >
                        <div className="flex justify-between items-start mb-4">
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                            Preliminary Triage
                          </span>
                          <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>info</span>
                        </div>
                        <div className="text-3xl font-bold mb-2 font-headline">{triageLabel}</div>
                        <p className="text-xs leading-relaxed opacity-90 font-medium">{triageResult.reasoning_brief}</p>
                        {(triageResult.never_miss_triggered || []).length > 0 && (
                          <p className="text-xs font-bold text-yellow-300 mt-2">
                            ⚠ {triageResult.never_miss_triggered.join(", ")}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => setActivePage("finder")}
                          className="w-full mt-6 text-white text-xs font-bold py-3 rounded-xl transition-all border border-white/20 hover:bg-white/20"
                          style={{ background: "rgba(255,255,255,0.1)", boxShadow: "none" }}
                        >
                          Find Care Near You
                        </button>
                      </div>
                    )}

                    {/* Extra fields */}
                    {(intakeSummary.medical_history_relevant || intakeSummary.medications_allergies || intakeSummary.vitals_if_known) && (
                      <div className="bg-surface-container-low rounded-xl overflow-hidden">
                        {intakeSummary.medical_history_relevant && (
                          <div className="flex gap-3 px-4 py-3 border-b border-surface-container-high">
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-tighter min-w-[90px] flex-shrink-0 pt-0.5">
                              Medical History
                            </span>
                            <span className="text-sm text-on-surface">{intakeSummary.medical_history_relevant}</span>
                          </div>
                        )}
                        {intakeSummary.medications_allergies && (
                          <div className="flex gap-3 px-4 py-3 border-b border-surface-container-high">
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-tighter min-w-[90px] flex-shrink-0 pt-0.5">
                              Meds / Allergies
                            </span>
                            <span className="text-sm text-on-surface">{intakeSummary.medications_allergies}</span>
                          </div>
                        )}
                        {intakeSummary.vitals_if_known && (
                          <div className="flex gap-3 px-4 py-3">
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-tighter min-w-[90px] flex-shrink-0 pt-0.5">
                              Vitals
                            </span>
                            <span className="text-sm text-on-surface">{intakeSummary.vitals_if_known}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Edit form */}
                {hasSummary && isEditingSummary && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {[
                      ["Chief complaint", "chief_complaint", false],
                      ["Symptoms (comma-separated)", "symptoms", true],
                      ["Onset and timeline", "onset_and_timeline", false],
                      ["Severity", "severity", false],
                      ["Related event/injury", "related_event_or_injury", false],
                      ["Relevant medical history", "medical_history_relevant", false],
                      ["Medications and allergies", "medications_allergies", false],
                      ["Vitals if known", "vitals_if_known", false],
                      ["Red flags (comma-separated)", "red_flags", true],
                    ].map(([label, field, isList]) => (
                      <label key={field} className="block">
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-tighter block mb-1.5">
                          {label}
                        </span>
                        <input
                          className="w-full border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface bg-surface-container-low focus:outline-none focus:ring-2 focus:border-primary"
                          value={
                            isList
                              ? (intakeSummary[field] || []).join(", ")
                              : intakeSummary[field] || ""
                          }
                          onChange={(e) =>
                            isList
                              ? handleSummaryListChange(field, e.target.value)
                              : handleSummaryFieldChange(field, e.target.value)
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </>
        )}

        {/* ── Page: Clinic Finder ────────────────────────── */}
        {activePage === "finder" && (
          <>
            {/* Left: Clinic List */}
            <aside className="w-full md:w-[450px] flex-shrink-0 bg-surface-container-low flex flex-col z-10 shadow-xl shadow-black/5 overflow-hidden">
              {/* Search & Filters */}
              <div className="p-6 bg-surface-container-lowest flex-shrink-0">
                <h1 className="font-bold text-on-surface mb-6 tracking-tight text-lg font-headline">
                  Find Care Near You
                </h1>
                <form onSubmit={loadFacilities}>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <span className="material-symbols-outlined text-outline" style={{ fontSize: "20px" }}>
                        location_on
                      </span>
                    </div>
                    <input
                      className="block w-full pl-11 pr-20 py-3.5 bg-surface-container-low border-none rounded-xl text-sm focus:ring-2 outline-none transition-all placeholder:text-outline"
                      placeholder="Search city, zip, or address..."
                      type="text"
                      value={address}
                      onChange={(e) => fetchAddressSuggestions(e.target.value)}
                      onKeyDown={handleAddressKeyDown}
                      onBlur={() => setTimeout(() => { setAddressSuggestions([]); setSuggestionIndex(-1); }, 150)}
                      autoComplete="off"
                    />
                    <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1">
                      {address && (
                        <button
                          type="button"
                          onClick={() => setAddress("")}
                          className="p-1 rounded-full text-outline hover:text-on-surface transition-colors"
                          style={{ background: "transparent", boxShadow: "none" }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={facilityBusy}
                        className="p-2 text-primary rounded-lg transition-colors disabled:opacity-40"
                        style={{ background: "transparent", boxShadow: "none" }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>my_location</span>
                      </button>
                    </div>
                    {addressSuggestions.length > 0 && (
                      <ul
                        role="listbox"
                        className="absolute top-full left-0 right-0 mt-1 z-20 bg-white border border-outline-variant rounded-xl shadow-lg overflow-hidden"
                      >
                        {addressSuggestions.map((s, i) => (
                          <li key={s} role="option" aria-selected={i === suggestionIndex}>
                            <button
                              type="button"
                              className={`w-full text-left px-4 py-2.5 text-sm text-on-surface transition-colors flex items-center gap-2 ${
                                i === suggestionIndex
                                  ? "bg-primary/10 text-primary"
                                  : "hover:bg-surface-container-low"
                              }`}
                              style={{ background: i === suggestionIndex ? undefined : "transparent", boxShadow: "none", borderRadius: "0", fontWeight: "400" }}
                              onMouseEnter={() => setSuggestionIndex(i)}
                              onMouseDown={() => { setAddress(s); setAddressSuggestions([]); setSuggestionIndex(-1); }}
                            >
                              <span className="material-symbols-outlined text-outline flex-shrink-0" style={{ fontSize: "16px" }}>location_on</span>
                              {s}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex gap-2 mt-4 overflow-x-auto no-scrollbar pb-1">
                    {[
                      ["both", "All Clinics"],
                      ["urgent_care", "Urgent Care"],
                      ["er", "ER"],
                    ].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setCareType(val)}
                        className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                          careType === val
                            ? "bg-primary text-on-primary"
                            : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                        }`}
                        style={{ boxShadow: "none" }}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setOpenNow((p) => !p)}
                      className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                        openNow
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                      }`}
                      style={{ boxShadow: "none" }}
                    >
                      Open Now
                    </button>
                  </div>
                </form>
              </div>

              {/* Scrollable Clinic Cards */}
              <div className="flex-1 overflow-y-auto px-4 py-6 no-scrollbar" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {facilityError && (
                  <p className="text-error text-sm font-semibold px-1">{facilityError}</p>
                )}

                {(facilityData.ranked_results || []).length === 0 &&
                  (facilityData.unknown_wait_results || []).length === 0 ? (
                  <div className="text-center text-sm text-on-surface-variant font-medium py-10 px-4 leading-relaxed">
                    Enter an address above to find nearby care facilities.
                  </div>
                ) : (
                  <>
                    {(facilityData.ranked_results || []).map((item, idx) => (
                      <div
                        key={`${item.name}-${idx}`}
                        onClick={() => handleCardClick(idx)}
                        className={`bg-surface-container-lowest rounded-xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer ${
                          idx === 0 ? "border-l-4 border-primary" : ""
                        } ${selectedFacility?.name === item.name ? "ring-2 ring-primary/40" : ""}`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            {idx === 0 && (
                              <span className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1 block">
                                Recommended
                              </span>
                            )}
                            <h3 className="font-bold text-on-surface text-base leading-tight font-headline">
                              {item.name}
                            </h3>
                          </div>
                          <div className="flex flex-col items-end flex-shrink-0 ml-3">
                            {item.wait_time_readable && (
                              <div className="bg-secondary-container px-3 py-1 rounded-lg">
                                <span className="text-xs font-bold text-on-secondary-container">
                                  {item.wait_time_readable} wait
                                </span>
                              </div>
                            )}
                            <span className="text-[11px] text-outline mt-1 font-medium">
                              {item.distance_km ?? "?"} km away
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs font-semibold text-on-surface-variant mt-2 flex-wrap">
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>schedule</span>
                            {item.is_open_now ? "Open Now" : "Closed"}
                          </span>
                          <span
                            className={`flex items-center gap-1 ${
                              item.care_type === "er" ? "text-error" : "text-primary"
                            }`}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                              {item.care_type === "er" ? "emergency" : "local_hospital"}
                            </span>
                            {item.care_type === "er" ? "Emergency Room" : "Urgent Care"}
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-2">
                          Drive: {item.commute_time_readable}
                          {item.commute_source === "estimate" ? " (est.)" : ""} &bull; Total:{" "}
                          {item.total_time_readable}
                        </p>
                      </div>
                    ))}

                    {(facilityData.unknown_wait_results || []).map((item, idx) => {
                      const globalIdx = (facilityData.ranked_results || []).length + idx;
                      return (
                      <div
                        key={`${item.name}-u-${idx}`}
                        onClick={() => handleCardClick(globalIdx)}
                        className={`bg-surface-container-lowest rounded-xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer ${selectedFacility?.name === item.name ? "ring-2 ring-primary/40" : ""}`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-bold text-on-surface text-base leading-tight font-headline">
                            {item.name}
                          </h3>
                          <div className="bg-surface-container-high px-3 py-1 rounded-lg flex-shrink-0 ml-3">
                            <span className="text-xs font-bold text-on-surface-variant">Wait unknown</span>
                          </div>
                        </div>
                        <span className="text-[11px] text-outline font-medium">
                          {item.distance_km ?? "?"} km away
                        </span>
                        <div className="flex items-center gap-4 text-xs font-semibold text-on-surface-variant mt-2">
                          <span
                            className={item.care_type === "er" ? "text-error" : "text-primary"}
                          >
                            {item.care_type === "er" ? "Emergency Room" : "Urgent Care"}
                          </span>
                          <span>{item.is_open_now ? "Open" : "Closed"}</span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-2">
                          Drive: {item.commute_time_readable}
                          {item.commute_source === "estimate" ? " (est.)" : ""}
                        </p>
                      </div>
                      );
                    })}
                  </>
                )}
              </div>
            </aside>

            {/* Right: Map */}
            <MapContainer center={mapCenter} zoom={10} className="care-map">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FlyToMarker facility={selectedFacility} />
              {mapFacilities.map((item, idx) => (
                <Marker
                  key={`${item.name}-marker-${idx}`}
                  position={[item.lat, item.lng]}
                  icon={item.care_type === "er" ? erPinIcon : primaryPinIcon}
                  ref={(el) => { markerRefs.current[idx] = el; }}
                >
                  <Popup>
                    <strong>{item.name}</strong>
                    <br />
                    {item.total_time_readable ? `Total: ${item.total_time_readable}` : "Total: Unknown"}
                    <br />
                    Drive: {item.commute_time_readable}
                    {item.commute_source === "estimate" ? " (estimated)" : ""}
                    <br />
                    Wait: {item.wait_time_readable || "Unknown"}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
