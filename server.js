require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


// ─── Doctor Data ───────────────────────────────────────────────────────────────
const doctors = [
  {
    id: 'dr-chen',
    name: 'Dr. Emily Chen',
    specialty: 'Orthopedics',
    bodyParts: ['knee', 'hip', 'shoulder', 'elbow', 'wrist', 'ankle', 'bone', 'joint', 'back', 'spine', 'fracture', 'orthopedic'],
    availability: generateSlots('2026-03-27', 45, [9,10,11,14,15,16]),
  },
  {
    id: 'dr-patel',
    name: 'Dr. Raj Patel',
    specialty: 'Cardiology',
    bodyParts: ['heart', 'chest', 'cardiac', 'cardiovascular', 'blood pressure', 'cholesterol', 'palpitation', 'artery'],
    availability: generateSlots('2026-03-28', 45, [8,9,10,13,14,15]),
  },
  {
    id: 'dr-nguyen',
    name: 'Dr. Sarah Nguyen',
    specialty: 'Dermatology',
    bodyParts: ['skin', 'rash', 'acne', 'mole', 'eczema', 'psoriasis', 'hair', 'nail', 'dermatology', 'itching'],
    availability: generateSlots('2026-03-29', 45, [10,11,12,14,15,16]),
  },
  {
    id: 'dr-okonkwo',
    name: 'Dr. James Okonkwo',
    specialty: 'Neurology',
    bodyParts: ['head', 'brain', 'migraine', 'headache', 'nerve', 'neurological', 'seizure', 'memory', 'dizziness', 'numbness'],
    availability: generateSlots('2026-03-30', 45, [9,10,11,14,15]),
  },
];

function generateSlots(startDate, daysAhead, hours) {
  const slots = [];
  // Parse date parts manually to avoid timezone issues
  const [year, month, day] = startDate.split('-').map(Number);
  for (let d = 0; d < daysAhead; d++) {
    const date = new Date(Date.UTC(year, month - 1, day + d));
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // skip weekends
    for (const hour of hours) {
      slots.push({
        id: uuidv4(),
        datetime: new Date(Date.UTC(year, month - 1, day + d, hour, 0)),
        booked: false,
      });
    }
  }
  return slots;
}

function formatSlotDisplay(datetime) {
  return new Date(datetime).toLocaleString('en-US', {
    timeZone: 'UTC',
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function matchDoctor(reason) {
  const lower = reason.toLowerCase();
  for (const doc of doctors) {
    if (doc.bodyParts.some(bp => lower.includes(bp))) return doc;
  }
  return null;
}

function getAvailableSlots(doctorId, preferredDay) {
  const doc = doctors.find(d => d.id === doctorId);
  if (!doc) return [];
  let slots = doc.availability.filter(s => !s.booked);
  if (preferredDay) {
    const dayMap = { monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6, sunday:0 };
    const targetDay = dayMap[preferredDay.toLowerCase()];
    if (targetDay !== undefined) {
      const filtered = slots.filter(s => new Date(s.datetime).getUTCDay() === targetDay);
      if (filtered.length > 0) slots = filtered;
    }
  }
  return slots.slice(0, 5).map(s => ({
    id: s.id,
    display: formatSlotDisplay(s.datetime),
    datetime: s.datetime,
  }));
}

function bookSlot(doctorId, slotId) {
  const doc = doctors.find(d => d.id === doctorId);
  if (!doc) return null;
  const slot = doc.availability.find(s => s.id === slotId && !s.booked);
  if (!slot) return null;
  slot.booked = true;
  return slot;
}

// ─── Session Store ─────────────────────────────────────────────────────────────
const sessions = {};

function getSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = { messages: [], patient: {}, matchedDoctor: null, bookedSlot: null, lastOfferedSlots: null };
  }
  return sessions[sessionId];
}

// ─── System Prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(session) {
  const docList = doctors.map(d => `- ${d.name} (${d.specialty}): treats ${d.bodyParts.slice(0,5).join(', ')}`).join('\n');
  return `You are a friendly, professional medical receptionist AI for Kyron Medical practice. Your job is to help patients schedule appointments, answer questions about office hours and locations, and check on prescription refills.

OFFICE INFO:
- Address: 123 Medical Center Drive, San Francisco, CA 94102
- Hours: Monday-Friday 8am-5pm
- Phone: (415) 555-0100

DOCTORS:
${docList}

APPOINTMENT SCHEDULING FLOW:
1. Greet the patient warmly
2. Collect: first name, last name, date of birth, phone number, email, reason for visit
3. Match them to the correct doctor based on body part/reason
4. Offer up to 5 available time slots
5. Confirm their chosen slot
6. Tell them a confirmation email will be sent

IMPORTANT RULES:
- Never provide medical advice or diagnoses
- Never recommend medications or treatments
- If asked medical questions, say "I'm not able to provide medical advice, but your doctor will be happy to discuss that at your appointment"
- Always be warm, empathetic, and professional
- If the practice doesn't treat the patient's condition, say so politely and suggest they contact their primary care physician
- Keep responses concise and conversational

Current patient info collected so far: ${JSON.stringify(session.patient)}
${session.matchedDoctor ? `Matched doctor: ${session.matchedDoctor.name} (${session.matchedDoctor.specialty})` : ''}
${session.bookedSlot ? `Booked appointment: ${formatSlotDisplay(session.bookedSlot.datetime)}` : ''}`;
}

// ─── Chat Endpoint ─────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'Missing message or sessionId' });

  const session = getSession(sessionId);

  extractPatientInfo(message, session);

  if (session.patient.reason && !session.matchedDoctor) {
    session.matchedDoctor = matchDoctor(session.patient.reason);
  }
  if (!session.matchedDoctor) {
    session.matchedDoctor = matchDoctor(message);
  }

if (session.bookedSlot) {
    console.log('BLOCKED: Appointment already exists');
    return res.json({
      reply: "You already have a confirmed appointment. If you need to reschedule, please call our office at (415) 555-0100.",
      patient: session.patient,
      matchedDoctor: session.matchedDoctor,
      bookedSlot: session.bookedSlot,
      availableSlots: []
    });
  }

  session.messages.push({ role: 'user', content: message });

  let availableSlots = [];
  if (session.matchedDoctor && !session.bookedSlot) {
    const dayMatch = message.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    availableSlots = getAvailableSlots(session.matchedDoctor.id, dayMatch?.[1]);
    if (availableSlots.length > 0) session.lastOfferedSlots = availableSlots;
  }

  const slotsToCheck = availableSlots.length > 0 ? availableSlots : (session.lastOfferedSlots || []);
  const isSlotSelection = message.trim().split(/\s+/).length <= 6 && !message.includes('@') && !message.includes('/');
  if (session.matchedDoctor && !session.bookedSlot && slotsToCheck.length > 0 && isSlotSelection) {
    const numMatch = message.match(/\b([1-5]|one|two|three|four|five|first|second|third|fourth|fifth)\b/i);
    if (numMatch) {
      const numMap = { '1':0,'one':0,'first':0,'2':1,'two':1,'second':1,'3':2,'three':2,'third':2,'4':3,'four':3,'fourth':3,'5':4,'five':4,'fifth':4 };
      const idx = numMap[numMatch[1].toLowerCase()];
      if (idx !== undefined && slotsToCheck[idx]) {
        const slot = bookSlot(session.matchedDoctor.id, slotsToCheck[idx].id);
        if (slot) {
          session.bookedSlot = slot;
          session.lastOfferedSlots = null;
          if (session.patient.email) {
            console.log('Sending confirmation email to:', session.patient.email);
            await sendConfirmationEmail(session);
          }
        }
      }
    }
  }

  const slotsContext = availableSlots.length > 0 && !session.bookedSlot
    ? `\n\nAvailable slots for ${session.matchedDoctor.name}:\n${availableSlots.map((s,i) => `${i+1}. ${s.display}`).join('\n')}\n\nPresent these options to the patient.`
    : '';

  const systemPrompt = buildSystemPrompt(session) + slotsContext;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...session.messages,
      ],
      max_tokens: 400,
    });

    const reply = completion.choices[0].message.content;
    session.messages.push({ role: 'assistant', content: reply });

    res.json({
      reply,
      sessionId,
      patient: session.patient,
      matchedDoctor: session.matchedDoctor ? { name: session.matchedDoctor.name, specialty: session.matchedDoctor.specialty } : null,
      bookedSlot: session.bookedSlot,
      availableSlots: availableSlots.length > 0 && !session.bookedSlot ? availableSlots : [],
    });
  } catch (err) {
    console.error('OpenAI error:', err);
    res.status(500).json({ error: 'AI service error' });
  }
});

// ─── Vapi Context Endpoint ─────────────────────────────────────────────────────
app.get('/api/session/:sessionId', (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    patient: session.patient,
    matchedDoctor: session.matchedDoctor ? { name: session.matchedDoctor.name, specialty: session.matchedDoctor.specialty } : null,
    bookedSlot: session.bookedSlot,
    conversationSummary: session.messages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n'),
  });
});

// ─── Email ─────────────────────────────────────────────────────────────────────
async function sendConfirmationEmail(session) {
  const { patient, matchedDoctor, bookedSlot } = session;
  
  const datetime = new Date(bookedSlot.datetime).toLocaleString('en-US', {
    timeZone: 'UTC',
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .header h1 { color: #2563eb; margin: 0; }
        .content { background: #f8fafc; border-radius: 8px; padding: 30px; }
        .info-row { display: flex; margin: 15px 0; }
        .info-label { font-weight: 600; min-width: 120px; }
        .info-value { color: #475569; }
        .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Appointment Confirmed</h1>
      </div>
      <div class="content">
        <p>Dear ${patient.firstName} ${patient.lastName},</p>
        <p>Your appointment has been successfully scheduled.</p>
        <div class="info-row"><div class="info-label">Doctor</div><div class="info-value">${matchedDoctor.name}</div></div>
        <div class="info-row"><div class="info-label">Specialty</div><div class="info-value">${matchedDoctor.specialty}</div></div>
        <div class="info-row"><div class="info-label">Date & Time</div><div class="info-value">${datetime}</div></div>
        <div class="info-row"><div class="info-label">Reason</div><div class="info-value">${patient.reason}</div></div>
        <div class="info-row"><div class="info-label">Location</div><div class="info-value">123 Medical Center Drive, San Francisco, CA 94102</div></div>
        <p style="margin-top: 30px;">Please arrive 15 minutes early to complete any required paperwork.</p>
        <p>If you need to reschedule, please call us at (415) 555-0100.</p>
      </div>
      <div class="footer">
        <p>Kyron Medical Practice</p>
      </div>
    </body>
    </html>
  `;

  try {
    console.log('Sending confirmation email to:', patient.email);
    await resend.emails.send({
      from: 'Kyron Medical <onboarding@resend.dev>',
      to: [patient.email],
      subject: 'Appointment Confirmed - Kyron Medical',
      html: emailHtml,
    });
    console.log('Confirmation email sent to', patient.email);
  } catch (error) {
    console.error('Email error:', error);
  }
}

// ─── Patient Info Extractor ────────────────────────────────────────────────────
function extractPatientInfo(message, session) {
  const p = session.patient;
  const emailMatch = message.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) p.email = emailMatch[0];
  const phoneMatch = message.match(/(\+?1?\s?)?(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  if (phoneMatch) p.phone = phoneMatch[0].trim();
  const dobMatch = message.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
  if (dobMatch) p.dob = dobMatch[0];
  const nameMatch = message.match(/(?:my name is|i'm|i am|this is)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i);
  if (nameMatch) { p.firstName = nameMatch[1]; p.lastName = nameMatch[2]; }
  if (!p.firstName) {
    const words = message.trim().split(/[\s\n]+/);
    if (words.length >= 2 && /^[A-Z][a-z]+$/.test(words[0]) && /^[A-Z][a-z]+$/.test(words[1])) {
      p.firstName = words[0]; p.lastName = words[1];
    }
  }
  const reasonMatch = message.match(/(?:here for|reason|coming in for|appointment for|issue with|problem with|have a|suffering from|experiencing)\s+(.{5,60}?)(?:\.|,|$)/i);
  if (reasonMatch && !p.reason) p.reason = reasonMatch[1].trim();
  if (!p.reason) {
    const bodyMatch = message.match(/\b(knee|hip|shoulder|back|heart|chest|skin|head|migraine|headache|rash|acne)\b/i);
    if (bodyMatch) p.reason = bodyMatch[1].toLowerCase() + ' pain';
  }
}

// ─── Phone Format ──────────────────────────────────────────────────────────────
function formatPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

// ─── Vapi Call Endpoint ────────────────────────────────────────────────────────
app.post('/api/vapi/call', async (req, res) => {
  const { sessionId, phoneNumber, patient: reqPatient } = req.body;
  const session = sessions[sessionId];
  
  // Use phoneNumber from request body if provided, otherwise fall back to patient object
  const phone = phoneNumber || reqPatient?.phone || session?.patient?.phone || '';
  const patientData = reqPatient || session?.patient || {};
  
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }
  
  // ← ADD THIS: Update session with phone number
  if (session && phone) {
    if (!session.patient) session.patient = {};
    session.patient.phone = phone;
    console.log('Updated session with phone:', phone);
  }
  
  const context = session ? session.messages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n') : '';
  
  try {
    const response = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
body: JSON.stringify({
        assistantId: process.env.VAPI_ASSISTANT_ID,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: { number: formatPhone(phone) },
        assistantOverrides: {
          firstMessage: `Hello ${patientData?.firstName || 'there'}! I can see you were just chatting with us online. ${session?.matchedDoctor ? `You were being matched with ${session.matchedDoctor.name} for ${session.patient?.reason || 'your concern'}.` : ''} ${session?.bookedSlot ? `You have an appointment booked for ${formatSlotDisplay(session.bookedSlot.datetime)}.` : ''} How can I help you continue?`,
          model: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are the Kyron Medical AI receptionist. Here is the context from the patient's web chat:\n\n${context}\n\nPatient name: ${patientData?.firstName || ''} ${patientData?.lastName || ''}\nDOB: ${patientData?.dob || 'not provided'}\nPhone: ${phone}\nEmail: ${patientData?.email || 'not provided'}\nReason: ${patientData?.reason || 'not provided'}\n\nContinue helping this patient warmly. Never provide medical advice.`
              }
            ]
          }
        }
      }),
    });
    
    const data = await response.json();
if (!response.ok) {
      console.error('Vapi API error:', data);
      return res.status(response.status).json({ success: false, error: data });
    }
    
    if (data.id) {
      res.json({ success: true, callId: data.id });
    } else {
      res.json({ success: false, error: data });
    }
  } catch (err) {
    console.error('Vapi error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/vapi/inbound', async (req, res) => {
  const { message } = req.body;
  if (message?.type === 'assistant-request') {
    const callerPhone = message?.call?.customer?.number || '';
    const normalizedPhone = callerPhone.replace(/\D/g, '');
    const session = Object.values(sessions).find(s => {
      const sessionPhone = (s.patient?.phone || '').replace(/\D/g, '');
      return sessionPhone && normalizedPhone.endsWith(sessionPhone) || sessionPhone.endsWith(normalizedPhone.slice(-10));
    });
const context = session ? session.messages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n') : '';
    const hasContext = session && context;
 res.json({
      assistant: {
        firstMessage: hasContext
          ? `Hello ${session.patient?.firstName || 'there'}! Welcome back to Kyron Medical. I can see you were chatting with us recently${session.bookedSlot ? ` and have an appointment booked for ${formatSlotDisplay(session.bookedSlot.datetime)}` : ''}. How can I help you today?`
          : `Hello! Thank you for calling Kyron Medical. I'm your AI receptionist. How can I help you today?`,
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          messages: [{
            role: 'system',
            content: hasContext
              ? `You are the Kyron Medical AI receptionist. This patient called back. Previous context:\n\n${context}\n\nPatient: ${session.patient?.firstName || ''} ${session.patient?.lastName || ''}, DOB: ${session.patient?.dob || ''}, Reason: ${session.patient?.reason || ''}. Continue helping them warmly. Never provide medical advice.`
              : `You are the Kyron Medical AI receptionist. Help this patient warmly with scheduling, prescription refills, or office information. Never provide medical advice. Office: 123 Medical Center Drive, San Francisco. Hours: Mon-Fri 8am-5pm. Phone: (415) 555-0100.`
          }]
        },
        voice: { provider: '11labs', voiceId: 'paula' }
      }
});
  } else {
    res.json({});
  }
});

// ─── Vapi Tool: Get Available Slots ───────────────────────────────────────────
app.post('/api/vapi/tool/get-slots', async (req, res) => {
  const { reason } = req.body.message?.toolCallList?.[0]?.function?.arguments || req.body;
  const doctor = matchDoctor(reason || '');
  if (!doctor) {
    return res.json({ results: [{ toolCallId: req.body.message?.toolCallList?.[0]?.id, result: 'No doctor found for that condition. We may not treat that at this practice.' }] });
  }
  const slots = getAvailableSlots(doctor.id);
  const slotText = slots.map((s, i) => `${i+1}. ${s.display}`).join(', ');
  const toolCallId = req.body.message?.toolCallList?.[0]?.id;
  res.json({ results: [{ toolCallId, result: `Matched with ${doctor.name} (${doctor.specialty}). Available slots: ${slotText}` }] });
});

// ─── Vapi Tool: Book Appointment ──────────────────────────────────────────────
app.post('/api/vapi/tool/book-appointment', async (req, res) => {
  const args = req.body.message?.toolCallList?.[0]?.function?.arguments || req.body;
  const toolCallId = req.body.message?.toolCallList?.[0]?.id;
  const { firstName, lastName, dob, phone, email, reason, slotNumber } = args;

  const doctor = matchDoctor(reason || '');
  if (!doctor) {
    return res.json({ results: [{ toolCallId, result: 'Could not match a doctor for that condition.' }] });
  }

  const slots = getAvailableSlots(doctor.id);
  const idx = parseInt(slotNumber) - 1;
  if (idx < 0 || idx >= slots.length) {
    return res.json({ results: [{ toolCallId, result: 'Invalid slot number. Please choose between 1 and ' + slots.length }] });
  }

  const slot = bookSlot(doctor.id, slots[idx].id);
  if (!slot) {
    return res.json({ results: [{ toolCallId, result: 'That slot is no longer available. Please choose another.' }] });
  }

// Find session by phone number and update it
const normalizedPhone = phone.replace(/\D/g, '');
console.log('Looking for session with phone:', normalizedPhone);
console.log('Active sessions:', Object.keys(sessions).length);
console.log('Session phones:', Object.values(sessions).map(s => s.patient?.phone));

const session = Object.values(sessions).find(s => {
  const sessionPhone = (s.patient?.phone || '').replace(/\D/g, '');
  console.log('Comparing:', normalizedPhone, 'vs', sessionPhone);
  return sessionPhone && (normalizedPhone.endsWith(sessionPhone) || sessionPhone.endsWith(normalizedPhone.slice(-10)));
});

console.log('Found session:', session ? 'YES' : 'NO');

if (session) {
  session.patient = { firstName, lastName, dob, phone, email, reason };
  session.matchedDoctor = doctor;
  session.bookedSlot = slot;
  console.log('Updated session:', session.patient);
}

  if (email) {
    const sessionData = {
      patient: { firstName, lastName, dob, phone, email, reason },
      matchedDoctor: doctor,
      bookedSlot: slot
    };
    await sendConfirmationEmail(sessionData);
  }

  res.json({ results: [{ toolCallId, result: `Appointment confirmed with ${doctor.name} for ${formatSlotDisplay(slot.datetime)}. A confirmation email has been sent to ${email}.` }] });
});

// ─── Health Check ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Kyron Medical server running on port ${PORT}`));
