from flask import Flask, request, jsonify
from flask_cors import CORS
from transformers import pipeline
from dotenv import load_dotenv
from groq import Groq
from pathlib import Path
import os, re, json
from datetime import datetime

# --------------------------------------------------------------------
# ✅ Load environment variables safely
# --------------------------------------------------------------------
env_path = Path(__file__).resolve().parent / ".env"
if not env_path.exists():
    print("❌ .env file not found:", env_path)
else:
    print("✅ Found .env at:", env_path)

load_dotenv(dotenv_path=env_path)
print("🧩 GROQ_API_KEY (first 10 chars):", os.getenv("GROQ_API_KEY")[:10] if os.getenv("GROQ_API_KEY") else "❌ None")

# --------------------------------------------------------------------
# ✅ Flask + Groq setup
# --------------------------------------------------------------------
app = Flask(__name__)
CORS(app)

try:
    client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    print("✅ Groq client initialized successfully.")
except Exception as e:
    print("❌ Failed to initialize Groq client:", e)
    client = None

# --------------------------------------------------------------------
# ✅ Sentiment model (DistilBERT)
# --------------------------------------------------------------------
try:
    sentiment_pipeline = pipeline("sentiment-analysis", model="distilbert-base-uncased-finetuned-sst-2-english")
    print("✅ Sentiment analysis model loaded.")
except Exception as e:
    print(f"❌ Error loading sentiment model: {e}")
    sentiment_pipeline = None


# --------------------------------------------------------------------
# 🧩 Helper utilities
# --------------------------------------------------------------------
def parse_time_range(text):
    """Extract time expressions like '10 to 11', '3:15', '12 am to 3 am'."""
    return re.findall(r'(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)', text, flags=re.I)


def build_tasks_from_text(raw_text):
    """Extract structured tasks from user’s free-form text."""
    sentences = [s.strip() for s in re.split(r'[.,;]', raw_text) if s.strip()]
    tasks = []
    for s in sentences:
        times = parse_time_range(s)
        if not times:
            continue
        start, end = (times + [None])[:2]
        title = re.sub(r'\b\d.*$', '', s).strip().capitalize()
        if not title:
            title = "Task"
        tasks.append({
            "title": title,
            "start": start,
            "end": end
        })
    return tasks


# --------------------------------------------------------------------
# 🤖 Groq (LLaMA3) – Dynamic Wellness Suggestions
# --------------------------------------------------------------------
def generate_dynamic_suggestions(tasks, emotion):
    """
    Use Groq’s LLaMA3 model to generate personalized wellness suggestions.
    Returns structured JSON, fallback-safe.
    """
    if not tasks or not client:
        return []

    schedule_text = "\n".join(
        [f"- {t['title']} ({t['start']} - {t['end']})" for t in tasks]
    )

    prompt = f"""
You are a mindful productivity assistant.
The user has this schedule:
{schedule_text}

The user's emotional state is: {emotion}.

Generate 3 short, *time-specific* wellness or rest activities that fit between tasks.
Each suggestion must include:
- "title": short label (e.g., "Tea break ☕", "Stretch 🧘", "Quick walk 🚶")
- "start": start time (HH:MM 24h or 12h with am/pm)
- "end": end time (HH:MM 24h or 12h with am/pm)

⚠️ Respond only with valid JSON — no extra text, no explanations.

Example:
[
  {{ "title": "Stretch break 🧘", "start": "10:45", "end": "10:55" }},
  {{ "title": "Mindful tea ☕", "start": "15:10", "end": "15:25" }}
]
"""

    try:
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4
        )

        raw_output = completion.choices[0].message.content.strip()
        print("🧠 Raw LLaMA Output:", raw_output)

        # Extract JSON block only
        match = re.search(r'\[.*\]', raw_output, re.DOTALL)
        if match:
            return json.loads(match.group())
        else:
            print("⚠️ No valid JSON found in LLaMA output.")
            return []
    except Exception as e:
        print("⚠️ LLaMA suggestion generation failed:", e)
        return []


# --------------------------------------------------------------------
# 🌤 Main API: Smart Planner
# --------------------------------------------------------------------
@app.route('/api/plan', methods=['POST'])
def plan_day():
    data = request.json
    text = data.get("text", "")
    if not text:
        return jsonify({"error": "No text provided"}), 400

    if not sentiment_pipeline:
        return jsonify({"error": "Sentiment model not loaded"}), 500

    # 1️⃣ Sentiment
    senti = sentiment_pipeline(text[:500])[0]
    sentiment, score = senti["label"], senti["score"]

    # 2️⃣ Extract structured tasks
    tasks = build_tasks_from_text(text)
    workload = len(tasks)
    hectic = workload >= 8
    emotion = "Stressed" if sentiment == "NEGATIVE" or hectic else "Balanced"

    # 3️⃣ Generate Groq-based dynamic suggestions
    suggestions = generate_dynamic_suggestions(tasks, emotion)

    # 4️⃣ Response
    response = {
        "sentiment": sentiment,
        "score": score,
        "detectedEmotion": emotion,
        "taskCount": workload,
        "tasks": tasks,
        "suggestions": suggestions,
        "message": (
            "Day looks hectic. I’ve suggested some breaks below."
            if hectic else "Your plan seems balanced. Here are some gentle wellness suggestions."
        ),
    }
    return jsonify(response)


# --------------------------------------------------------------------
# 🟢 Health Check
# --------------------------------------------------------------------
@app.route('/')
def home():
    return "✅ AI Microservice (Flask + Groq LLaMA3) is running!"


# --------------------------------------------------------------------
# 🚀 Run Server
# --------------------------------------------------------------------
if __name__ == "__main__":
    app.run(port=5001, debug=True)
