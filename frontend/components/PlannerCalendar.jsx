import React, { useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import axios from 'axios';
import './PlannerCalendar.css';

/* ==========================================================
   🔐 Axios Global Auth Setup
   (Ensures all requests carry your JWT token)
========================================================== */
axios.defaults.baseURL = "http://localhost:5000";
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function PlannerCalendar({ refreshKey }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const calendarRef = useRef(null);

  // detect AI suggestion
  const isSuggestionFlag = (t) => {
    const notes = (t.notes || '').toLowerCase();
    return (
      t.source === 'suggestion' ||
      t.isSuggestion === true ||
      notes.includes('ai suggestion') ||
      notes.includes('recommended')
    );
  };

  // assign consistent pastel color by index
  const getColorPair = (index) => {
    const pastelPairs = [
      ['#a1c4fd', '#c2e9fb'],
      ['#fbc2eb', '#a6c1ee'],
      ['#fad0c4', '#ffd1ff'],
      ['#84fab0', '#8fd3f4'],
      ['#ffecd2', '#fcb69f'],
      ['#d4fc79', '#96e6a1'],
    ];
    return pastelPairs[index % pastelPairs.length];
  };

  // fetch all events
  const fetchEvents = async () => {
    try {
      const res = await axios.get('/api/tasks');  // no need to include baseURL now
      const evts = res.data.map((t, i) => {
        const [bg1, bg2] = getColorPair(i);
        return {
          id: t._id,
          title: t.title,
          start: t.start,
          end: t.end,
          isSuggestion: isSuggestionFlag(t),
          bg1,
          bg2,
        };
      });
      setEvents(evts);
      if (evts.length && calendarRef.current) {
        const earliest = evts.reduce(
          (min, e) => (new Date(e.start) < new Date(min.start) ? e : min),
          evts[0]
        );
        calendarRef.current.getApi().gotoDate(new Date(earliest.start));
      }
    } catch (e) {
      console.log('No tasks found yet.', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchEvents();
  }, [refreshKey]);

  const handleSelect = async (selectInfo) => {
    const title = prompt('Task title?');
    if (!title) return;
    const tempId = `temp-${Date.now()}`;
    const [bg1, bg2] = getColorPair(events.length);
    const newEvent = {
      id: tempId,
      title,
      start: selectInfo.startStr,
      end: selectInfo.endStr,
      bg1,
      bg2,
    };
    setEvents((prev) => [...prev, newEvent]);
    try {
      const res = await axios.post('/api/tasks', {
        title,
        start: selectInfo.startStr,
        end: selectInfo.endStr,
      });
      setEvents((prev) =>
        prev.map((e) => (e.id === tempId ? { ...e, id: res.data._id } : e))
      );
    } catch {
      setEvents((prev) => prev.filter((e) => e.id !== tempId));
    }
  };

  const handleEventClick = (clickInfo) => {
    setSelectedEvent(clickInfo.event);
    setNewTitle(clickInfo.event.title);
  };

  const handleEventDrop = async (info) => {
    try {
      await axios.put(`/api/tasks/${info.event.id}`, {
        start: info.event.start.toISOString(),
        end: info.event.end.toISOString(),
      });
    } catch {
      info.revert();
    }
  };

  const handleEditSave = async () => {
    if (!selectedEvent) return;
    const oldTitle = selectedEvent.title;
    selectedEvent.setProp('title', newTitle);
    try {
      await axios.put(`/api/tasks/${selectedEvent.id}`, { title: newTitle });
      setSelectedEvent(null);
    } catch {
      selectedEvent.setProp('title', oldTitle);
      alert('❌ Failed to update task.');
    }
  };

  const handleDelete = async () => {
    if (!selectedEvent) return;
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    try {
      await axios.delete(`/api/tasks/${selectedEvent.id}`);
      setEvents((prev) => prev.filter((e) => e.id !== selectedEvent.id));
      setSelectedEvent(null);
    } catch {
      alert('❌ Failed to delete task.');
    }
  };

  const eventClassNames = () => ['planner-event'];
  const eventContent = (arg) => {
    const props = arg.event.extendedProps;
    return (
      <div
        className="evt-wrap"
        style={{
          background: `linear-gradient(145deg, ${props.bg1}, ${props.bg2})`,
          borderRadius: '8px',
          padding: '4px 6px',
        }}
      >
        <div className="evt-time">{arg.timeText}</div>
        <div className="evt-title">{arg.event.title}</div>
      </div>
    );
  };

  return (
    <div className="calendar-wrap">
      <h2>Planner Calendar</h2>

      {loading ? (
        <div className="card">Loading calendar…</div>
      ) : (
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          selectable
          select={handleSelect}
          editable
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          events={events}
          eventClassNames={eventClassNames}
          eventContent={eventContent}
          nowIndicator
          height="auto"
        />
      )}

      <p className="hint">💡 Tip: Drag to create events or click to edit/delete.</p>

      {selectedEvent && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Edit or Delete Task</h3>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Task title"
            />
            <div className="modal-buttons">
              <button onClick={handleEditSave} className="save-btn">💾 Save</button>
              <button onClick={handleDelete} className="delete-btn">🗑️ Delete</button>
              <button onClick={() => setSelectedEvent(null)} className="cancel-btn">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
