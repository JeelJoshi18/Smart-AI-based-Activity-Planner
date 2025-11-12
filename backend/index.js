const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const mongoose = require('mongoose');
const chrono = require('chrono-node');

dotenv.config();

/* =========================
   MongoDB Connection
========================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected!'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

/* =========================
   Schemas
========================= */
const ScheduleSchema = new mongoose.Schema({
  text: { type: String, required: true },
  sentiment: { type: String },
  detectedEmotion: { type: String },
  score: { type: Number },
  createdAt: { type: Date, default: Date.now },
});
const Schedule = mongoose.model('Schedule', ScheduleSchema);

const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  emotion: { type: String },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now },
});
const Task = mongoose.model('Task', TaskSchema);

/* =========================
   App setup
========================= */
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

/* ============================================================
   Helpers for delete parsing
============================================================ */
const dayNames = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

function startOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfLocalDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Parse a single date like “on 12 Nov” or “on Friday”. */
function parseSingleDate(text) {
  // Try chrono first
  const d = chrono.parseDate(text, new Date(), { forwardDate: true });
  if (d) return d;

  // Fallback short “12th Nov (opt year)”
  const rx = /(\d{1,2})(st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*(\d{4})?/i;
  const m = text.toLowerCase().match(rx);
  if (m) {
    const monthMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11 };
    const day = parseInt(m[1], 10);
    const month = monthMap[m[3].slice(0,3)];
    const year = m[4] ? parseInt(m[4],10) : new Date().getFullYear();
    return new Date(year, month, day);
  }

  // Fallback weekday only (“on Wednesday”)
  const lower = text.toLowerCase();
  const idx = dayNames.findIndex(dn => lower.includes(dn));
  if (idx !== -1) {
    const now = new Date();
    const diff = (idx - now.getDay() + 7) % 7;
    const t = new Date(now);
    t.setDate(now.getDate() + diff);
    return t;
  }

  return null;
}

/** Parse a range like “between Wed and Fri”, “from 12 Nov to 14 Nov” */
function parseDateRange(text) {
  const lower = text.toLowerCase();
  // “from X to Y / between X and Y”
  const rangeMatch =
    lower.match(/from (.+?) to (.+)$/i) ||
    lower.match(/between (.+?) and (.+)$/i);

  if (!rangeMatch) return null;

  const a = parseSingleDate(rangeMatch[1]);
  const b = parseSingleDate(rangeMatch[2]);
  if (!a || !b) return null;

  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  return { start, end };
}

/** Try to pull a title filter out of the command, e.g. “delete short meditation from friday” */
function extractTitleLike(text) {
  // remove obvious command/temporal words to leave probable title
  let s = text.toLowerCase();

  // strip common verbs and preps
  s = s
    .replace(/\b(delete|remove|clear|erase|drop)\b/gi, '')
    .replace(/\b(all|every|tasks|events|entries|everything)\b/gi, '')
    .replace(/\b(on|for|from|at|in|between|to|by|this|next|coming)\b/gi, '')
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\b(today|tomorrow|tonight)\b/gi, '')
    .replace(/\d{1,2}(st|nd|rd|th)?/gi, '')
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b/gi, '')
    .replace(/\b(\d{4})\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // quoted title takes precedence “delete "team sync" on wednesday”
  const quoted = text.match(/"(.*?)"|'(.*?)'/);
  if (quoted && (quoted[1] || quoted[2])) {
    return (quoted[1] || quoted[2]).trim();
  }

  // if after removing temporals we still have 2+ words, consider it a title hint
  if (s.split(' ').filter(Boolean).length >= 2) return s;
  return null;
}

/* ============================================================
   🧹 DELETE TASKS (by explicit list, by natural language, ranges)
============================================================ */
app.post('/api/delete', async (req, res) => {
  try {
    const { tasks, text } = req.body;

    // 1) Explicit task array (old flow)
    if (tasks && Array.isArray(tasks) && tasks.length > 0) {
      const summary = [];
      for (const t of tasks) {
        const q = { title: { $regex: new RegExp(t.title, 'i') } };
        if (t.date) {
          const s = startOfLocalDay(new Date(t.date));
          const e = endOfLocalDay(new Date(t.date));
          q.start = { $gte: s, $lte: e };
        }
        const result = await Task.deleteMany(q);
        if (result.deletedCount > 0) summary.push({ title: t.title, count: result.deletedCount });
      }
      return res.json({ message: `🗑️ ${summary.reduce((a,b)=>a+b.count,0) || 0} tasks removed.`, deleted: summary });
    }

    // 2) Natural language
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });
    const cmd = text.trim();

    // 2a) date range?
    const range = parseDateRange(cmd);
    if (range) {
      const s = startOfLocalDay(range.start);
      const e = endOfLocalDay(range.end);
      // optional title filter within range
      const titleLike = extractTitleLike(cmd);
      const q = { start: { $gte: s, $lte: e } };
      if (titleLike) q.title = { $regex: new RegExp(titleLike, 'i') };

      console.log(`🧹 Range delete ${s.toISOString()} -> ${e.toISOString()} title~${titleLike || '*'}`);
      const out = await Task.deleteMany(q);
      return res.json({ message: `🗑️ ${out.deletedCount} task(s) deleted in range.` });
    }

    // 2b) single day?
    const day = parseSingleDate(cmd);
    if (!day) {
      return res.status(400).json({ message: '❌ No valid date or weekday detected.' });
    }

    const start = startOfLocalDay(day);
    const end = endOfLocalDay(day);

    // optional title filter for single day
    const titleLike = extractTitleLike(cmd);
    const query = { start: { $gte: start, $lte: end } };
    if (titleLike) query.title = { $regex: new RegExp(titleLike, 'i') };

    console.log(`🧹 Day delete ${start.toISOString()} -> ${end.toISOString()} title~${titleLike || '*'}`);
    const del = await Task.deleteMany(query);

    return res.json({
      message: `🗑️ ${del.deletedCount} task(s) deleted for ${day.toDateString()}.`,
    });
  } catch (e) {
    console.error('❌ /api/delete error:', e);
    res.status(500).json({ error: 'Failed to delete tasks' });
  }
});

/* ============================================================
   🧠 AI-Driven Smart Planning
============================================================ */
app.post('/api/plan', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    const aiRes = await axios.post('http://localhost:5001/api/plan', { text });
    const { tasks, suggestions, sentiment, detectedEmotion, message } = aiRes.data;

    // detect a date to anchor times
    const dateRegex = /(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)/i;
    const match = text.match(dateRegex);
    let referenceDate = new Date();
    if (match) {
      const day = parseInt(match[1], 10);
      const month = new Date(`${match[2]} 1, 2000`).getMonth();
      const year = new Date().getFullYear();
      referenceDate = new Date(year, month, day);
      console.log(`📅 Explicit date detected: ${referenceDate}`);
    } else {
      const chronoParsed = chrono.parseDate(text, new Date(), { forwardDate: true });
      if (chronoParsed) {
        referenceDate = chronoParsed;
        console.log(`📆 Chrono detected date: ${referenceDate}`);
      }
    }

    const resolveTime = (timeStr) => {
      if (!timeStr) return null;
      const parsed = chrono.parseDate(timeStr, referenceDate, { forwardDate: true });
      if (!parsed) return null;
      parsed.setFullYear(referenceDate.getFullYear());
      parsed.setMonth(referenceDate.getMonth());
      parsed.setDate(referenceDate.getDate());
      return parsed;
    };

    const allEvents = [...(tasks || []), ...(suggestions || [])].map((ev) => {
      const start = resolveTime(ev.start) || referenceDate;
      const end = resolveTime(ev.end) || new Date(start.getTime() + 30 * 60 * 1000);
      return {
        title: (ev.title || 'Untitled').trim(),
        start,
        end,
        emotion: detectedEmotion,
        notes: message,
      };
    });

    const saved = [];
    for (const ev of allEvents) {
      const doc = new Task(ev);
      await doc.save();
      saved.push(doc);
    }

    res.json({
      tasks: saved,
      detectedEmotion,
      sentiment,
      message,
      referenceDate,
    });
  } catch (err) {
    console.error('❌ /api/plan error:', err.message);
    res.status(500).json({ error: 'AI planning failed' });
  }
});

/* ============================================================
   🧠 Emotion Analysis + Storage
============================================================ */
app.post('/api/analyze', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    const aiResponse = await axios.post('http://localhost:5001/api/plan', { text });
    const { sentiment, detectedEmotion, score } = aiResponse.data;

    const newSchedule = new Schedule({ text, sentiment, detectedEmotion, score });
    await newSchedule.save();

    res.json(aiResponse.data);
  } catch (error) {
    console.error('Error in /api/analyze:', error.message);
    res.status(500).json({ error: 'Error processing your request' });
  }
});

/* ============================================================
   📋 Emotion Log (GET)
============================================================ */
app.get('/api/schedules', async (req, res) => {
  try {
    const schedules = await Schedule.find().sort({ createdAt: -1 });
    res.json(schedules);
  } catch (error) {
    console.error('Error in /api/schedules:', error.message);
    res.status(500).json({ error: 'Error fetching schedules' });
  }
});

/* ============================================================
   📅 Task Routes
============================================================ */
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await Task.find().sort({ start: 1 });
    res.json(tasks);
  } catch (e) {
    console.error('GET /api/tasks:', e.message);
    res.status(500).json({ error: 'Error fetching tasks' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { title, start, end, emotion, notes } = req.body;
    if (!title || !start || !end)
      return res.status(400).json({ error: 'title, start, end required' });
    const t = new Task({ title, start, end, emotion, notes });
    await t.save();
    res.json(t);
  } catch (e) {
    console.error('POST /api/tasks:', e.message);
    res.status(500).json({ error: 'Error creating task' });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const update = {};
    ['title', 'start', 'end', 'emotion', 'notes'].forEach((k) => {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    });
    const t = await Task.findByIdAndUpdate(id, update, { new: true });
    if (!t) return res.status(404).json({ error: 'Task not found' });
    res.json(t);
  } catch (e) {
    console.error('PUT /api/tasks/:id', e.message);
    res.status(500).json({ error: 'Error updating task' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await Task.findByIdAndDelete(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error deleting task' });
  }
});

/* ============================================================
   Root
============================================================ */
app.get('/', (req, res) => res.send('Smart AI Planner Backend is running!'));

/* ============================================================
   Start
============================================================ */
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
