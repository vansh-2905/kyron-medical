import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

const WELCOME_MESSAGE = {
  role: "assistant",
  content: "Hello! Welcome to Kyron Medical. I'm your virtual medical receptionist. I can help you schedule an appointment, check on a prescription refill, or answer questions about our office. How can I assist you today?",
};

export default function App() {
  const [sessionId] = useState(() => uuidv4());
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [callPhone, setCallPhone] = useState("");
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [patient, setPatient] = useState(null);
  const [matchedDoctor, setMatchedDoctor] = useState(null);
  const [bookedSlot, setBookedSlot] = useState(null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [callActive, setCallActive] = useState(false);
  const [callStatus, setCallStatus] = useState("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    setAvailableSlots([]);

    try {
      const { data } = await axios.post(`${API_BASE}/api/chat`, {
        message: userMsg,
        sessionId,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      if (data.patient) setPatient(data.patient);
      if (data.matchedDoctor) setMatchedDoctor(data.matchedDoctor);
      if (data.bookedSlot) setBookedSlot(data.bookedSlot);
      if (data.availableSlots?.length > 0) setAvailableSlots(data.availableSlots);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "I'm sorry, I'm having trouble connecting. Please try again in a moment." }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const initiateCall = () => {
    if (!patient?.phone) {
      setShowPhoneModal(true);
      return;
    }
    triggerCall(patient);
  };

  const triggerCall = async (patientData) => {
    setShowPhoneModal(false);
    setCallActive(true);
    setCallStatus("Connecting...");
    try {
      const { data } = await axios.post(`${API_BASE}/api/vapi/call`, {
        sessionId,
        patient: patientData,
      });
      if (data.success) {
        setCallStatus("Call incoming from +1 (747) 494 9286");
      } else {
        setCallStatus("Unable to initiate call. Please try again.");
        setTimeout(() => setCallActive(false), 3000);
      }
    } catch {
      setCallStatus("Call feature unavailable. Please call (415) 555-0100.");
      setTimeout(() => setCallActive(false), 4000);
    }
  };

  const formatTime = (datetime) => {
    return new Date(datetime).toLocaleString("en-US", {
      timeZone: "UTC",
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  };

  return (
    <div className="app">
      <div className="bg-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <header className="header glass">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-icon">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M14 3L14 25M3 14H25M7 7L21 21M21 7L7 21" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div className="logo-name">Kyron Medical</div>
              <div className="logo-sub">Patient Services</div>
            </div>
          </div>
          <div className="header-status">
            <span className="status-dot" />
            <span className="status-text">AI Receptionist Online</span>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="sidebar glass">
          <div className="sidebar-section">
            <div className="sidebar-title">Office Hours</div>
            <div className="sidebar-item">Mon – Fri</div>
            <div className="sidebar-item accent">8:00 AM – 5:00 PM</div>
          </div>
          <div className="sidebar-section">
            <div className="sidebar-title">Location</div>
            <div className="sidebar-item">123 Medical Center Dr</div>
            <div className="sidebar-item">San Francisco, CA 94102</div>
          </div>
          <div className="sidebar-section">
            <div className="sidebar-title">Contact</div>
            <div className="sidebar-item accent">(415) 555-0100</div>
          </div>

          {matchedDoctor && (
            <div className="sidebar-section doctor-card glass-inner">
              <div className="sidebar-title">Your Doctor</div>
              <div className="doctor-name">{matchedDoctor.name}</div>
              <div className="doctor-specialty">{matchedDoctor.specialty}</div>
            </div>
          )}

          {bookedSlot && (
            <div className="sidebar-section booked-card glass-inner">
              <div className="sidebar-title">Appointment</div>
              <div className="booked-time">{formatTime(bookedSlot.datetime)}</div>
              <div className="booked-badge">Confirmed</div>
            </div>
          )}

          <button
            className={`call-btn ${callActive ? "call-active" : ""}`}
            onClick={initiateCall}
            disabled={callActive}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z" />
            </svg>
            {callActive ? callStatus : "Switch to Phone Call"}
          </button>
        </div>

        <div className="chat-container glass">
          <div className="chat-header">
            <div className="chat-avatar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
              </svg>
            </div>
            <div>
              <div className="chat-title">Medical Receptionist</div>
              <div className="chat-subtitle">Powered by Kyron AI</div>
            </div>
          </div>

          <div className="messages">
            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role}`}>
                {msg.role === "assistant" && (
                  <div className="msg-avatar">K</div>
                )}
                <div className="msg-bubble">{msg.content}</div>
              </div>
            ))}

            {availableSlots.length > 0 && (
              <div className="slots-container">
                <div className="slots-title">Available appointments:</div>
                <div className="slots-grid">
                  {availableSlots.map((slot, i) => (
                    <button
                      key={slot.id}
                      className="slot-btn"
                      onClick={() => sendMessage(`I'll take option ${i + 1}`)}
                    >
                      <span className="slot-num">{i + 1}</span>
                      <span className="slot-time">{slot.display}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="message assistant">
                <div className="msg-avatar">K</div>
                <div className="msg-bubble typing">
                  <span /><span /><span />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="quick-replies">
            {["Schedule an appointment", "Prescription refill", "Office hours & location"].map((q) => (
              <button key={q} className="quick-btn" onClick={() => sendMessage(q)}>
                {q}
              </button>
            ))}
          </div>

          <div className="input-area">
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              rows={1}
            />
            <button
              className="send-btn"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </main>

      {showPhoneModal && (
        <div style={{
          position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100
        }}>
          <div className="glass" style={{ padding: 28, borderRadius: 16, width: 340, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Enter your phone number</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>We'll call you at this number to continue with Emma, our AI receptionist.</div>
            <input
              className="chat-input"
              placeholder="+14805551234"
              value={callPhone}
              onChange={e => setCallPhone(e.target.value)}
              onKeyDown={e => e.key === "Enter" && triggerCall({ ...patient, phone: callPhone })}
              autoFocus
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button className="quick-btn" onClick={() => setShowPhoneModal(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="send-btn" onClick={() => triggerCall({ ...patient, phone: callPhone })} style={{ flex: 2, width: "auto", padding: "0 16px" }}>
                Call me
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
