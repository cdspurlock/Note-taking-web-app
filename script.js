// -------------------- Elements --------------------
const noteListEl = document.getElementById("noteList");
const noteCountEl = document.getElementById("noteCount");

const newNoteBtn = document.getElementById("newNoteBtn");
const emptyNewBtn = document.getElementById("emptyNewBtn");

const searchInput = document.getElementById("searchInput");

const emptyState = document.getElementById("emptyState");
const editorPanel = document.getElementById("editorPanel");

const titleInput = document.getElementById("titleInput");
const bodyInput = document.getElementById("bodyInput");
const metaText = document.getElementById("metaText");

const pinBtn = document.getElementById("pinBtn");
const deleteBtn = document.getElementById("deleteBtn");

const recordBtn = document.getElementById("recordBtn");
const recordStatus = document.getElementById("recordStatus");

// -------------------- Storage --------------------
const STORAGE_KEY = "notes_app_v1";

function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

// -------------------- State --------------------
let notes = loadNotes();
let selectedNoteId = null;
let currentSearch = "";

// Debounced saving
let saveTimer = null;
function queueSaveFromEditor() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCurrentNote();
  }, 250);
}

// -------------------- Helpers --------------------
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
}

function nowISO() {
  return new Date().toISOString();
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function getFilteredNotes() {
  const q = currentSearch.trim().toLowerCase();
  let list = [...notes];

  // Pin first, then newest
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  if (!q) return list;

  return list.filter((n) => {
    return (
      (n.title || "").toLowerCase().includes(q) ||
      (n.body || "").toLowerCase().includes(q)
    );
  });
}

function setEditorVisible(visible) {
  if (visible) {
    emptyState.classList.add("hidden");
    editorPanel.classList.remove("hidden");
  } else {
    editorPanel.classList.add("hidden");
    emptyState.classList.remove("hidden");
  }
}

function setActiveListItem() {
  const items = noteListEl.querySelectorAll(".note-item");
  items.forEach((el) => {
    const id = el.getAttribute("data-id");
    el.classList.toggle("active", id === selectedNoteId);
  });
}

function renderList() {
  const list = getFilteredNotes();

  noteCountEl.textContent = String(list.length);
  noteListEl.innerHTML = "";

  if (list.length === 0) {
    noteListEl.innerHTML = `<div class="muted" style="padding:10px;">No notes found.</div>`;
    return;
  }

  for (const note of list) {
    const item = document.createElement("div");
    item.className = "note-item";
    item.setAttribute("data-id", note.id);

    const title = (note.title || "Untitled").trim() || "Untitled";
    const preview = (note.body || "").trim() || "No content yet…";

    item.innerHTML = `
      <div class="note-top">
        <h3 class="note-title">${escapeHtml(title)}</h3>
        ${note.pinned ? `<span class="badge" title="Pinned">📌</span>` : ""}
      </div>
      <div class="note-preview">${escapeHtml(preview)}</div>
      <div class="note-date">Updated: ${escapeHtml(formatDate(note.updatedAt))}</div>
    `;

    item.addEventListener("click", () => selectNote(note.id));
    noteListEl.appendChild(item);
  }

  setActiveListItem();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function findSelectedNote() {
  return notes.find((n) => n.id === selectedNoteId) || null;
}

// -------------------- Note Actions --------------------
function createNote() {
  stopRecordingIfNeeded();

  const note = {
    id: uid(),
    title: "New note",
    body: "",
    pinned: false,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  notes.unshift(note);
  saveNotes(notes);

  selectedNoteId = note.id;
  setEditorVisible(true);
  fillEditorFromNote(note);

  renderList();
  setActiveListItem();

  titleInput.focus();
  titleInput.select();
}

function selectNote(id) {
  stopRecordingIfNeeded();

  selectedNoteId = id;
  const note = findSelectedNote();
  if (!note) {
    setEditorVisible(false);
    return;
  }

  setEditorVisible(true);
  fillEditorFromNote(note);
  setActiveListItem();
}

function fillEditorFromNote(note) {
  titleInput.value = note.title || "";
  bodyInput.value = note.body || "";
  metaText.textContent = `Last edited: ${formatDate(note.updatedAt)}`;
  pinBtn.textContent = note.pinned ? "📌 Unpin" : "📌 Pin";

  setRecordUI("idle", "Idle");
}

function saveCurrentNote() {
  const note = findSelectedNote();
  if (!note) return;

  note.title = titleInput.value;
  note.body = bodyInput.value;
  note.updatedAt = nowISO();

  saveNotes(notes);
  metaText.textContent = `Last edited: ${formatDate(note.updatedAt)}`;
  renderList();
  setActiveListItem();
}

function togglePin() {
  const note = findSelectedNote();
  if (!note) return;

  note.pinned = !note.pinned;
  note.updatedAt = nowISO();
  saveNotes(notes);

  pinBtn.textContent = note.pinned ? "📌 Unpin" : "📌 Pin";
  metaText.textContent = `Last edited: ${formatDate(note.updatedAt)}`;

  renderList();
}

function deleteNote() {
  const note = findSelectedNote();
  if (!note) return;

  stopRecordingIfNeeded();

  notes = notes.filter((n) => n.id !== selectedNoteId);
  saveNotes(notes);

  selectedNoteId = null;
  setEditorVisible(false);
  renderList();
}

// -------------------- Speech-to-text --------------------
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isRecording = false;

// buffers for interim handling
let finalBuffer = "";
let lastInterim = "";

function setRecordUI(state, text) {
  recordStatus.textContent = text;
  recordStatus.classList.remove("live", "error");

  if (state === "live") recordStatus.classList.add("live");
  if (state === "error") recordStatus.classList.add("error");

  recordBtn.textContent = isRecording ? "⏹ Stop" : "🎙️ Record";
}

function ensureRecognition() {
  if (!SpeechRecognition) return false;

  if (!recognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      isRecording = true;
      setRecordUI("live", "Listening…");
    };

    recognition.onend = () => {
      isRecording = false;
      setRecordUI("idle", "Idle");
      lastInterim = "";
      finalBuffer = "";
    };

    recognition.onerror = (e) => {
      isRecording = false;
      setRecordUI("error", `Error: ${e.error}`);
    };

    recognition.onresult = (event) => {
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0].transcript;

        if (res.isFinal) {
          finalBuffer += transcript;
        } else {
          interimText += transcript;
        }
      }

      // Replace last interim, then add final + current interim
      const base = bodyInput.value.replace(lastInterim, "");
      bodyInput.value = base + finalBuffer + interimText;
      lastInterim = interimText;

      queueSaveFromEditor();
    };
  }

  return true;
}

function startRecording() {
  if (!selectedNoteId) {
    setRecordUI("error", "Select a note first");
    return;
  }

  const ok = ensureRecognition();
  if (!ok) {
    setRecordUI("error", "Speech not supported");
    return;
  }

  finalBuffer = "";
  lastInterim = "";

  try {
    recognition.start();
  } catch {
    // ignore double-start errors
  }
}

function stopRecording() {
  if (!recognition) return;
  try {
    recognition.stop();
  } catch {}
}

function stopRecordingIfNeeded() {
  if (isRecording) stopRecording();
}

recordBtn.addEventListener("click", () => {
  if (!selectedNoteId) {
    setRecordUI("error", "Select a note first");
    return;
  }
  if (!isRecording) startRecording();
  else stopRecording();
});

// -------------------- Events --------------------
newNoteBtn.addEventListener("click", createNote);
emptyNewBtn.addEventListener("click", createNote);

searchInput.addEventListener("input", (e) => {
  currentSearch = e.target.value;
  renderList();
});

titleInput.addEventListener("input", queueSaveFromEditor);
bodyInput.addEventListener("input", queueSaveFromEditor);

pinBtn.addEventListener("click", togglePin);
deleteBtn.addEventListener("click", deleteNote);

// -------------------- Init --------------------
renderList();

if (notes.length > 0) {
  // auto-open first note in list order
  const first = getFilteredNotes()[0];
  if (first) selectNote(first.id);
} else {
  setEditorVisible(false);
}
