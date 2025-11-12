import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function EmotionLog() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get('http://localhost:5000/api/schedules');
        setItems(res.data || []);
      } catch {
        setErr('Failed to fetch emotion log.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="card">Loading logs…</div>;
  if (err) return <div className="card error">{err}</div>;
  if (!items.length) return <div className="card">No entries yet. Analyze something to see it here.</div>;

  return (
    <div className="log">
      <h2>Emotion Log</h2>
      <ul className="log-list">
        {items.map((it) => (
          <li key={it._id} className="log-item">
            <div className="log-top">
              <span className={`badge ${it.detectedEmotion?.toLowerCase() || 'neutral'}`}>
                {it.detectedEmotion || 'Neutral'}
              </span>
              <span className="timestamp">{new Date(it.createdAt).toLocaleString()}</span>
            </div>
            <div className="log-text">{it.text}</div>
            <div className="log-meta">
              <span className="pill">Sentiment: {it.sentiment}</span>
              {it.score && <span className="pill">Score: {it.score.toFixed(2)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
