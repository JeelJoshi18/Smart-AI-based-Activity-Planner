import React, { useState } from 'react';
import axios from 'axios';
import './App.css';
import EmotionLog from './components/EmotionLog';
import PlannerCalendar from './components/PlannerCalendar';


function App() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('analyze');
  const [calRefreshKey, setCalRefreshKey] = useState(0);

  // ---------------------------
  // 🧩 Handle AI Planning
  // ---------------------------
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const response = await axios.post('http://localhost:5000/api/plan', { text });
      const data = response.data;

      // Combine main tasks + suggestions, sort by start time
      const allTasks = [...data.tasks, ...(data.suggestions || [])].sort(
        (a, b) => new Date(a.start) - new Date(b.start)
      );

      setResult({
        ...data,
        combinedTasks: allTasks,
      });

      setCalRefreshKey((prev) => prev + 1);
      setTab('calendar');
      setText('');
    } catch (error) {
      console.error('Error sending data to backend:', error);
      setResult({ error: 'Could not connect to server.' });
    }
    setLoading(false);
  };

  // ---------------------------
  // 🧩 Handle AI-based Delete
  // ---------------------------
  const handleDeleteQuery = async (e) => {
    e.preventDefault();
    if (!text.trim()) {
      alert('Please enter a delete instruction.');
      return;
    }

    setLoading(true);
    try {
      const parseRes = await axios.post('http://localhost:5001/api/delete', { text });
      const aiParsed = parseRes.data;

      if (!aiParsed.tasks || aiParsed.tasks.length === 0) {
        alert('❌ No valid tasks detected to delete.');
        return;
      }

      const delRes = await axios.post('http://localhost:5000/api/delete', aiParsed);
      alert(`🗑️ ${delRes.data.message}`);
      setCalRefreshKey((prev) => prev + 1);
      setTab('calendar');
      setText('');
    } catch (error) {
      console.error('Error processing delete request:', error);
      alert('❌ Could not process delete command.');
    }
    setLoading(false);
  };

  // ---------------------------
  // 🧠 Render
  // ---------------------------
  return (
    <div className="App">
      <header className="App-header">
        <h1>Smart AI Activity Planner</h1>
        <p>Plan your day/week with emotional awareness.</p>

        <div className="tabs">
          <button className={tab === 'analyze' ? 'active' : ''} onClick={() => setTab('analyze')}>
            Analyze
          </button>
          <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
            Emotion Log
          </button>
          <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>
            Calendar
          </button>
        </div>

        {tab === 'analyze' && (
          <form onSubmit={handleSubmit} className="card">
            <textarea
              rows="6"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='e.g., On Wednesday 12th Nov, schedule project work 12–3am, meeting 10–11, etc.'
            />
            <br />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button type="submit" disabled={loading}>
                {loading ? 'Planning…' : 'Plan & Save'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleDeleteQuery}
                style={{ backgroundColor: '#ff5555', color: 'white' }}
              >
                {loading ? 'Deleting…' : 'Delete Tasks'}
              </button>
            </div>

            {/* ✨ Organized Task Section */}
            {result && result.combinedTasks && result.combinedTasks.length > 0 && (
              <div className="task-summary">
                <h3>Your Planned Tasks</h3>

                {/* Overall Emotion Display */}
                {result.detectedEmotion && (
                  <div className="overall-emotion">
                    Overall Mood:{" "}
                    <span className={`overall-emotion-tag ${result.detectedEmotion.toLowerCase()}`}>
                      {result.detectedEmotion}
                    </span>
                  </div>
                )}

                <div className="task-grid">
                  {result.combinedTasks.map((task, index) => {
                    const isSuggestion = result.suggestions?.some(
                      (s) => s.title === task.title && s.start === task.start
                    );
                    return (
                      <div
                        key={index}
                        className={`task-card ${isSuggestion ? 'suggested' : 'regular'}`}
                      >
                        {isSuggestion && <div className="ai-badge">✨ AI Suggestion</div>}

                        <h4>{task.title}</h4>
                        <p>
                          🕒{' '}
                          {new Date(task.start).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          -{' '}
                          {new Date(task.end).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {result && result.error && (
              <div className="error-box">{result.error}</div>
            )}
          </form>
        )}

        {tab === 'log' && <EmotionLog />}
        {tab === 'calendar' && <PlannerCalendar key={calRefreshKey} refreshKey={calRefreshKey} />}
      </header>
    </div>
  );
}

export default App;
