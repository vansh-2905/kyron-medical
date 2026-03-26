# Kyron Medical - AI Patient Receptionist

A full-stack web app where patients can chat with an AI medical receptionist, schedule appointments, receive confirmation emails, and switch to a voice call — all with context preserved.

## Live Demo
https://kyron-demo.site

## Tech Stack
- **Frontend**: React + Vite, liquid glass UI
- **Backend**: Node.js + Express on AWS EC2
- **AI Chat**: GPT-4o
- **Voice AI**: Vapi.ai (Emma voice)
- **Email**: Resend
- **HTTPS**: Caddy

## Features
- Patient intake (name, DOB, phone, email, reason)
- Semantic doctor matching across 4 specialties
- Appointment scheduling with real-time slot selection
- Email confirmation on booking
- Seamless handoff from web chat to phone call with context
- Caller ID memory for return calls
