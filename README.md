# RevivePay — AI Recovery Desk for Payments at Risk ⚡

![RevivePay Banner](https://img.shields.io/badge/Status-Live_Demo-emerald?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/Stack-FastAPI_%7C_React_%7C_MongoDB-blue?style=for-the-badge)

Revenue loss rarely happens in one clean step. A payment degrades, a checkout gets abandoned, a subscription fails, or an invoice goes overdue. 

**RevivePay** is an autonomous, multi-agent AI system that closes the loop from detecting the problem, diagnosing it, choosing the right intervention, and recovering the money using real-world payment links.

---

## 🎯 The Problem & Solution

**The Prompt:** *Build an agent that detects revenue at risk, determines the right intervention, and executes a bounded recovery workflow: from payment failures and checkout abandonment to overdue receivables.*

**The Solution:** Instead of just identifying the problem, RevivePay executes a **bounded recovery workflow**. It processes batches of failed payments through a sophisticated pipeline of AI agents, strictly governed by policy guardrails, and outputs measurable, recovered money with an end-to-end audit trail.

---

## 🧠 Multi-Agent Architecture

RevivePay operates using three specialized Gemini AI agents, governed by a hard-coded policy guard:

1. **Diagnosis Agent 🩺**: Analyzes raw payment failure codes or abandonment contexts to definitively classify the root cause (e.g., `insufficient_funds`, `technical_decline`, `checkout_abandoned`).
2. **Value Agent 💰**: Evaluates the customer profile (LTV, repeat buyer status, cart value) to determine the maximum acceptable discount required to win the customer back.
3. **Planner Agent 🗺️**: Synthesizes the diagnosis and value assessment to recommend a precise intervention plan (e.g., *Send standard payment link* vs. *Send 10% discounted payment link*).
4. **Policy Guard 🛡️**: A deterministic compliance layer that intercepts the AI's plan. It enforces strict "stopping rules" (e.g., maximum contact caps, minimum threshold amounts, consent verification) and halts the workflow if a rule is violated.

If the Policy Guard approves the plan, the **Orchestrator** generates a live, real-world **Razorpay Payment Link** (or discounted link) and executes the recovery.

---

## 🛠️ Tech Stack

- **Frontend:** React, Vite, Tailwind CSS
- **Backend:** FastAPI, Python, Motor (Async MongoDB)
- **Database:** MongoDB (Beanie ODM)
- **AI Models:** Google Gemini (`gemini-3.1-flash-lite`, `gemini-1.5-flash`)
- **Payments:** Razorpay API

---

## 🚀 Setup & Execution

### 1. Prerequisites
- Node.js (v18+)
- Python (3.11+)
- MongoDB connection string
- Razorpay API Keys
- Google Gemini API Key

### 2. Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in the `backend` directory:
```env
MONGODB_URI=your_mongodb_connection_string
GEMINI_API_KEY_DIAGNOSIS=your_gemini_api_key
RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret
```

Start the backend server:
```bash
uvicorn app.main:app --reload --port 5000
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### 4. Running the Demo
1. Make sure your database is seeded. You can run `python app/data/generate_synthetic_data.py` to seed 8 demo cases.
2. Open the dashboard at `http://localhost:5173`.
3. Click **Reset Cases** to pull the fresh batch.
4. Click **Run Batch** to watch the AI evaluate, block, and execute live Razorpay links.
5. Click on an "Approved" case in the table to view the audit trail, grab the generated Razorpay link, and pay it live to see the net recovery metrics update!

---
*Built for the Agentic AI Hackathon.*
