(function () {
  "use strict";

  // --- Helpers ---
  const $ = (sel) => document.querySelector(sel);
  const todayKey = () => new Date().toISOString().slice(0, 10);

  function formatDate(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatTime12h(time24) {
    if (!time24) return "";
    const [h, m] = time24.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return h12 + ":" + String(m).padStart(2, "0") + " " + ampm;
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Password / Lock ---
  async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function hasPassword() {
    return !!localStorage.getItem("dr_password_hash");
  }

  function isUnlocked() {
    return sessionStorage.getItem("dr_unlocked") === "true";
  }

  function showLockScreen(mode) {
    const lockScreen = $("#lock-screen");
    const title = $("#lock-title");
    const subtitle = $("#lock-subtitle");
    const passwordInput = $("#lock-password");
    const confirmInput = $("#lock-confirm");
    const submitBtn = $("#lock-submit");
    const error = $("#lock-error");

    lockScreen.classList.remove("hidden");
    $("#app").classList.add("app-hidden");
    error.textContent = "";
    passwordInput.value = "";
    confirmInput.value = "";

    if (mode === "set" || mode === "change") {
      title.textContent = mode === "change" ? "Change Password" : "Set a Password";
      subtitle.textContent = mode === "change"
        ? "Enter a new password for your app"
        : "Protect your Daily Reminder";
      confirmInput.classList.remove("hidden");
      confirmInput.placeholder = "Confirm password";
      passwordInput.placeholder = mode === "change" ? "New password" : "Enter password";
      submitBtn.textContent = mode === "change" ? "Update Password" : "Set Password";
      submitBtn.onclick = async () => {
        const pw = passwordInput.value;
        const confirm = confirmInput.value;
        if (pw.length < 4) {
          error.textContent = "Password must be at least 4 characters";
          return;
        }
        if (pw !== confirm) {
          error.textContent = "Passwords don't match";
          return;
        }
        const hash = await hashPassword(pw);
        localStorage.setItem("dr_password_hash", hash);
        sessionStorage.setItem("dr_unlocked", "true");
        lockScreen.classList.add("hidden");
        $("#app").classList.remove("app-hidden");
        if (mode === "change") hideMenu();
      };
    } else {
      title.textContent = "Welcome Back";
      subtitle.textContent = "Enter your password to continue";
      confirmInput.classList.add("hidden");
      passwordInput.placeholder = "Enter password";
      submitBtn.textContent = "Unlock";
      submitBtn.onclick = async () => {
        const pw = passwordInput.value;
        if (!pw) return;
        const hash = await hashPassword(pw);
        const stored = localStorage.getItem("dr_password_hash");
        if (hash === stored) {
          sessionStorage.setItem("dr_unlocked", "true");
          lockScreen.classList.add("hidden");
          $("#app").classList.remove("app-hidden");
        } else {
          error.textContent = "Incorrect password";
          passwordInput.value = "";
          passwordInput.focus();
        }
      };
    }

    passwordInput.focus();
    passwordInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        if (confirmInput.classList.contains("hidden")) {
          submitBtn.click();
        } else {
          confirmInput.focus();
        }
      }
    };
    confirmInput.onkeydown = (e) => {
      if (e.key === "Enter") submitBtn.click();
    };
  }

  function lockApp() {
    sessionStorage.removeItem("dr_unlocked");
    showLockScreen("unlock");
  }

  // --- Storage ---
  function loadJSON(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // --- State ---
  let recurringTasks = loadJSON("dr_recurring", []);
  // { id, text, time? }

  let todayTasks = [];
  // { id, text, done, recurringId?, time? }

  let calendarEvents = [];
  // { id, title, start, end, allDay }

  let editingTaskId = null;

  function loadToday() {
    const key = todayKey();
    const saved = loadJSON("dr_day_" + key, null);

    if (saved) {
      todayTasks = saved;
    } else {
      todayTasks = recurringTasks.map((r) => ({
        id: generateId(),
        text: r.text,
        done: false,
        recurringId: r.id,
        time: r.time || null,
      }));
    }

    const existingRecurringIds = new Set(
      todayTasks.filter((t) => t.recurringId).map((t) => t.recurringId)
    );
    for (const r of recurringTasks) {
      if (!existingRecurringIds.has(r.id)) {
        todayTasks.push({
          id: generateId(),
          text: r.text,
          done: false,
          recurringId: r.id,
          time: r.time || null,
        });
      }
    }

    saveToday();
  }

  function saveToday() {
    saveJSON("dr_day_" + todayKey(), todayTasks);
  }

  function saveRecurring() {
    saveJSON("dr_recurring", recurringTasks);
  }

  // --- Streak ---
  function calculateStreak() {
    let streak = 0;
    const date = new Date();

    // Check today
    const todayStr = todayKey();
    const todayData = loadJSON("dr_day_" + todayStr, null);
    const todayComplete =
      todayData && todayData.length > 0 && todayData.every((t) => t.done);

    if (todayComplete) {
      streak = 1;
    }

    // Walk backward from yesterday
    date.setDate(date.getDate() - 1);
    for (let i = 0; i < 365; i++) {
      const key = date.toISOString().slice(0, 10);
      const data = loadJSON("dr_day_" + key, null);
      if (!data || data.length === 0 || !data.every((t) => t.done)) break;
      streak++;
      date.setDate(date.getDate() - 1);
    }

    return streak;
  }

  function renderStreak() {
    const streak = calculateStreak();
    const el = $("#streak-display");
    if (streak > 0) {
      $("#streak-count").textContent = streak;
      el.style.display = "inline-flex";
    } else {
      el.style.display = "none";
    }
  }

  // --- Rendering ---
  function buildTimelineItems() {
    const items = [];

    for (const task of todayTasks) {
      items.push({
        type: "task",
        time: task.time || null,
        sortTime: task.time || "99:99",
        data: task,
      });
    }

    for (const ev of calendarEvents) {
      const evTime = ev.allDay ? null : ev.start.slice(11, 16);
      items.push({
        type: "event",
        time: evTime,
        sortTime: evTime || "00:00",
        data: ev,
      });
    }

    items.sort((a, b) => {
      const aHas = a.time !== null;
      const bHas = b.time !== null;
      if (aHas && bHas) return a.sortTime.localeCompare(b.sortTime);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return 0;
    });

    return items;
  }

  function renderTaskItem(task) {
    const timeStr = task.time ? formatTime12h(task.time) : "";
    return `
      <li class="task-item ${task.done ? "completed" : ""}" data-id="${task.id}" data-type="task">
        <div class="checkbox ${task.done ? "checked" : ""}" role="checkbox" aria-checked="${task.done}" tabindex="0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        ${timeStr ? `<span class="task-time">${timeStr}</span>` : ""}
        <span class="task-text">${escapeHtml(task.text)}</span>
        ${task.recurringId ? '<span class="recurring-badge">Daily</span>' : ""}
        <button class="delete-btn" aria-label="Delete task">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </li>`;
  }

  function renderEventItem(ev) {
    const timeStr = ev.allDay
      ? "All day"
      : formatTime12h(ev.start.slice(11, 16));
    const endStr =
      ev.allDay ? "" : " \u2013 " + formatTime12h(ev.end.slice(11, 16));
    return `
      <li class="event-item" data-type="event">
        <div class="event-dot"></div>
        <span class="event-time">${timeStr}${endStr}</span>
        <span class="event-title">${escapeHtml(ev.title)}</span>
      </li>`;
  }

  function renderTodayList() {
    const list = $("#task-list");
    const empty = $("#empty-state");

    // Don't re-render if user is editing
    if (editingTaskId) return;

    const items = buildTimelineItems();

    if (todayTasks.length === 0 && calendarEvents.length === 0) {
      list.innerHTML = "";
      empty.style.display = "flex";
      updateProgress();
      renderStreak();
      return;
    }

    empty.style.display = "none";
    list.innerHTML = items
      .map((item) =>
        item.type === "task"
          ? renderTaskItem(item.data)
          : renderEventItem(item.data)
      )
      .join("");

    updateProgress();
    renderStreak();
  }

  function renderRecurringList() {
    const list = $("#recurring-list");
    const empty = $("#recurring-empty");

    if (recurringTasks.length === 0) {
      list.innerHTML = "";
      empty.style.display = "flex";
      return;
    }

    empty.style.display = "none";
    list.innerHTML = recurringTasks
      .map((task) => {
        const timeStr = task.time ? formatTime12h(task.time) : "";
        return `
      <li class="task-item" data-id="${task.id}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" style="flex-shrink:0"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        ${timeStr ? `<span class="task-time">${timeStr}</span>` : ""}
        <span class="task-text">${escapeHtml(task.text)}</span>
        <button class="delete-btn" aria-label="Delete recurring task" style="opacity:0.6">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </li>`;
      })
      .join("");
  }

  function updateProgress() {
    const total = todayTasks.length;
    const done = todayTasks.filter((t) => t.done).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);

    $("#progress-bar").style.width = pct + "%";
    $("#progress-text").textContent =
      total === 0 ? "" : `${done} of ${total} completed`;

    if (total > 0 && done === total) {
      $("#progress-bar").style.background =
        "linear-gradient(90deg, #51cf66, #20c997)";
    } else {
      $("#progress-bar").style.background =
        "linear-gradient(90deg, var(--accent), #a78bfa)";
    }
  }

  // --- History ---
  function renderHistory() {
    const list = $("#history-list");
    const empty = $("#history-empty");
    const days = [];

    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const data = loadJSON("dr_day_" + key, null);
      if (data && data.length > 0) {
        const done = data.filter((t) => t.done).length;
        const total = data.length;
        days.push({
          date: key,
          label: d.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
          done,
          total,
          allDone: done === total,
        });
      }
    }

    if (days.length === 0) {
      list.innerHTML = "";
      empty.style.display = "flex";
      return;
    }

    empty.style.display = "none";
    list.innerHTML = days
      .map((day) => {
        const pct = Math.round((day.done / day.total) * 100);
        const barColor = day.allDone
          ? "linear-gradient(90deg, #51cf66, #20c997)"
          : "linear-gradient(90deg, var(--accent), #a78bfa)";
        return `
      <div class="history-day ${day.allDone ? "all-done" : ""}">
        <span class="history-date">${escapeHtml(day.label)}</span>
        <div class="history-bar-container">
          <div class="history-bar" style="width:${pct}%; background:${barColor}"></div>
        </div>
        <span class="history-count">${day.done}/${day.total}</span>
        ${day.allDone ? '<svg class="history-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ""}
      </div>`;
      })
      .join("");
  }

  // --- Inline Editing ---
  function startEditTask(li, id, list) {
    if (editingTaskId) return;
    editingTaskId = id;

    const taskArr = list === "today" ? todayTasks : recurringTasks;
    const task = taskArr.find((t) => t.id === id);
    if (!task) return;

    const textSpan = li.querySelector(".task-text");
    const origText = task.text;
    const origTime = task.time || "";

    const editWrap = document.createElement("div");
    editWrap.className = "edit-wrap";

    const timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.className = "edit-time-input";
    timeInput.value = origTime;

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "task-edit-input";
    textInput.value = origText;

    editWrap.appendChild(timeInput);
    editWrap.appendChild(textInput);
    textSpan.replaceWith(editWrap);

    // Hide badges and delete btn during edit
    const badge = li.querySelector(".recurring-badge");
    const timeEl = li.querySelector(".task-time");
    const delBtn = li.querySelector(".delete-btn");
    if (badge) badge.style.display = "none";
    if (timeEl) timeEl.style.display = "none";
    if (delBtn) delBtn.style.display = "none";

    textInput.focus();
    textInput.select();

    function save() {
      const newText = textInput.value.trim();
      const newTime = timeInput.value || null;
      if (newText && newText !== origText) {
        task.text = newText;
      }
      task.time = newTime;

      if (list === "today") {
        saveToday();
      } else {
        saveRecurring();
      }
      editingTaskId = null;
      if (list === "today") {
        renderTodayList();
      } else {
        renderRecurringList();
      }
    }

    function cancel() {
      editingTaskId = null;
      if (list === "today") {
        renderTodayList();
      } else {
        renderRecurringList();
      }
    }

    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });

    timeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        textInput.focus();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });

    let blurTimeout;
    function handleBlur() {
      blurTimeout = setTimeout(() => {
        if (
          document.activeElement !== textInput &&
          document.activeElement !== timeInput
        ) {
          save();
        }
      }, 150);
    }

    textInput.addEventListener("blur", handleBlur);
    timeInput.addEventListener("blur", handleBlur);
    textInput.addEventListener("focus", () => clearTimeout(blurTimeout));
    timeInput.addEventListener("focus", () => clearTimeout(blurTimeout));
  }

  // --- AI Suggestions (Claude) ---
  let aiSuggestions = [];
  let aiLoading = false;

  function getAiKey() {
    return localStorage.getItem("dr_anthropic_key");
  }

  function showAiSetup() {
    const overlay = $("#ai-setup-overlay");
    overlay.classList.remove("hidden");
    const input = $("#ai-key-input");
    const removeBtn = $("#remove-ai-key-btn");
    const error = $("#ai-key-error");
    error.textContent = "";

    if (getAiKey()) {
      input.value = "";
      input.placeholder = "Key saved (enter new to replace)";
      removeBtn.style.display = "block";
    } else {
      input.value = "";
      input.placeholder = "sk-ant-...";
      removeBtn.style.display = "none";
    }
    input.focus();
  }

  function hideAiSetup() {
    $("#ai-setup-overlay").classList.add("hidden");
  }

  function saveAiKey() {
    const input = $("#ai-key-input");
    const val = input.value.trim();
    if (!val) {
      if (getAiKey()) {
        hideAiSetup();
        return;
      }
      $("#ai-key-error").textContent = "Please enter an API key";
      return;
    }
    if (!val.startsWith("sk-")) {
      $("#ai-key-error").textContent = "API key should start with sk-";
      return;
    }
    localStorage.setItem("dr_anthropic_key", val);
    $("#ai-key-error").textContent = "";
    hideAiSetup();
    updateAiButtonState();
  }

  function removeAiKey() {
    localStorage.removeItem("dr_anthropic_key");
    hideAiSetup();
    updateAiButtonState();
  }

  function updateAiButtonState() {
    const btn = $("#ai-suggest-btn");
    if (getAiKey()) {
      btn.classList.add("ai-btn-active");
    } else {
      btn.classList.remove("ai-btn-active");
    }
  }

  function buildAiPrompt() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const dayStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    let context = `It is ${dayStr}, currently ${timeStr}.\n\n`;

    // Existing tasks
    if (todayTasks.length > 0) {
      context += "Current tasks for today:\n";
      for (const t of todayTasks) {
        const time = t.time ? ` (${formatTime12h(t.time)})` : "";
        const status = t.done ? " [DONE]" : "";
        context += `- ${t.text}${time}${status}\n`;
      }
      context += "\n";
    }

    // Calendar events
    if (calendarEvents.length > 0) {
      context += "Google Calendar events today:\n";
      for (const ev of calendarEvents) {
        const time = ev.allDay
          ? "All day"
          : formatTime12h(ev.start.slice(11, 16)) +
            " - " +
            formatTime12h(ev.end.slice(11, 16));
        context += `- ${ev.title} (${time})\n`;
      }
      context += "\n";
    }

    // Recurring tasks
    if (recurringTasks.length > 0) {
      context += "Recurring daily tasks:\n";
      for (const r of recurringTasks) {
        const time = r.time ? ` (${formatTime12h(r.time)})` : "";
        context += `- ${r.text}${time}\n`;
      }
      context += "\n";
    }

    return context;
  }

  async function fetchAiSuggestions() {
    const key = getAiKey();
    if (!key) {
      showAiSetup();
      return;
    }

    if (aiLoading) return;
    aiLoading = true;
    renderAiLoading();

    const context = buildAiPrompt();

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content:
                context +
                "Based on my schedule and existing tasks, suggest 3-5 additional tasks I should do today. " +
                "Consider preparation for upcoming events, follow-ups, breaks, and things people commonly forget. " +
                "Be specific and practical.\n\n" +
                'Respond ONLY with a JSON array of objects, each with "text" (task description) and "time" (optional, HH:MM 24h format or null). ' +
                "No markdown, no explanation, just the JSON array.",
            },
          ],
        }),
      });

      if (res.status === 401) {
        localStorage.removeItem("dr_anthropic_key");
        updateAiButtonState();
        throw new Error("Invalid API key. Please re-enter your key.");
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error?.message || "API error: " + res.status
        );
      }

      const data = await res.json();
      const text = data.content[0].text.trim();

      // Parse JSON from response (handle possible markdown wrapping)
      let jsonStr = text;
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) jsonStr = jsonMatch[0];

      aiSuggestions = JSON.parse(jsonStr).map((s) => ({
        text: s.text,
        time: s.time || null,
      }));

      aiLoading = false;
      renderAiSuggestions();
    } catch (err) {
      aiLoading = false;
      aiSuggestions = [];
      renderAiError(err.message);
    }
  }

  function renderAiLoading() {
    const container = $("#ai-suggestions");
    const list = $("#ai-suggestions-list");
    container.style.display = "block";
    list.innerHTML =
      '<div class="ai-loading"><div class="ai-spinner"></div>Thinking...</div>';
  }

  function renderAiError(msg) {
    const container = $("#ai-suggestions");
    const list = $("#ai-suggestions-list");
    container.style.display = "block";
    list.innerHTML = `<div class="ai-error">${escapeHtml(msg)}</div>`;
  }

  function renderAiSuggestions() {
    const container = $("#ai-suggestions");
    const list = $("#ai-suggestions-list");

    if (aiSuggestions.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    list.innerHTML = aiSuggestions
      .map(
        (s, i) => `
      <div class="ai-suggestion-item" data-index="${i}">
        <div class="ai-suggestion-content">
          ${s.time ? `<span class="task-time">${formatTime12h(s.time)}</span>` : ""}
          <span class="ai-suggestion-text">${escapeHtml(s.text)}</span>
        </div>
        <button class="ai-add-btn" data-index="${i}" aria-label="Add this task">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>`
      )
      .join("");
  }

  function addSuggestionAsTask(index) {
    const suggestion = aiSuggestions[index];
    if (!suggestion) return;

    todayTasks.push({
      id: generateId(),
      text: suggestion.text,
      done: false,
      time: suggestion.time,
    });
    saveToday();

    // Remove from suggestions
    aiSuggestions.splice(index, 1);
    renderAiSuggestions();
    renderTodayList();
  }

  function dismissAiSuggestions() {
    aiSuggestions = [];
    $("#ai-suggestions").style.display = "none";
  }

  // --- Google Calendar ---
  const SCOPES = "https://www.googleapis.com/auth/calendar.readonly";
  let tokenClient = null;

  function getClientId() {
    return localStorage.getItem("dr_google_client_id");
  }

  function getStoredToken() {
    const data = loadJSON("dr_google_token", null);
    if (!data) return null;
    if (Date.now() > data.expires_at) return null;
    return data.access_token;
  }

  function storeToken(tokenResponse) {
    const expiresAt =
      Date.now() + tokenResponse.expires_in * 1000 - 60000;
    saveJSON("dr_google_token", {
      access_token: tokenResponse.access_token,
      expires_at: expiresAt,
    });
  }

  function initTokenClient() {
    const clientId = getClientId();
    if (!clientId || typeof google === "undefined" || !google.accounts)
      return;

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (tokenResponse) => {
        if (tokenResponse.error) {
          console.error("OAuth error:", tokenResponse);
          return;
        }
        storeToken(tokenResponse);
        fetchCalendarEvents();
      },
    });
  }

  function connectGoogle() {
    const clientId = getClientId();
    if (!clientId) {
      showClientIdSetup();
      return;
    }

    if (!tokenClient) initTokenClient();
    if (!tokenClient) {
      alert("Google sign-in unavailable. Check your internet connection.");
      return;
    }

    tokenClient.requestAccessToken({ prompt: "consent" });
  }

  function disconnectGoogle() {
    const token = getStoredToken();
    if (token && typeof google !== "undefined" && google.accounts) {
      google.accounts.oauth2.revoke(token);
    }
    localStorage.removeItem("dr_google_token");
    localStorage.removeItem("dr_calendar_cache");
    calendarEvents = [];
    renderCalendarSection();
    renderTodayList();
  }

  function showClientIdSetup() {
    $("#calendar-setup-main").style.display = "none";
    $("#client-id-form").style.display = "block";
    $("#client-id-input").focus();
  }

  function saveClientId() {
    const input = $("#client-id-input");
    const val = input.value.trim();
    if (!val || !val.includes(".apps.googleusercontent.com")) {
      $("#client-id-error").textContent =
        "Please enter a valid Google Client ID";
      return;
    }
    localStorage.setItem("dr_google_client_id", val);
    $("#client-id-error").textContent = "";
    $("#client-id-form").style.display = "none";
    $("#calendar-setup-main").style.display = "block";
    initTokenClient();
    connectGoogle();
  }

  async function fetchCalendarEvents() {
    const token = getStoredToken();
    if (!token) return;

    const today = todayKey();
    const timeMin = today + "T00:00:00.000Z";
    const tomorrow = new Date(new Date(today + "T12:00:00Z").getTime() + 86400000)
      .toISOString()
      .slice(0, 10);
    const timeMax = tomorrow + "T00:00:00.000Z";

    const url =
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?" +
      "timeMin=" + encodeURIComponent(timeMin) +
      "&timeMax=" + encodeURIComponent(timeMax) +
      "&singleEvents=true&orderBy=startTime&maxResults=50";

    try {
      const res = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
      });

      if (res.status === 401) {
        localStorage.removeItem("dr_google_token");
        if (tokenClient) {
          tokenClient.requestAccessToken({ prompt: "" });
        }
        return;
      }

      if (!res.ok) throw new Error("Calendar API error: " + res.status);

      const data = await res.json();
      calendarEvents = (data.items || []).map((ev) => ({
        id: ev.id,
        title: ev.summary || "(No title)",
        start: ev.start.dateTime || ev.start.date,
        end: ev.end.dateTime || ev.end.date,
        allDay: !ev.start.dateTime,
      }));

      // Cache for offline
      const cache = loadJSON("dr_calendar_cache", {});
      cache[today] = { events: calendarEvents, fetched_at: Date.now() };
      // Clean old entries
      for (const k of Object.keys(cache)) {
        const cutoff = new Date(Date.now() - 3 * 86400000)
          .toISOString()
          .slice(0, 10);
        if (k < cutoff) delete cache[k];
      }
      saveJSON("dr_calendar_cache", cache);

      renderCalendarSection();
      renderTodayList();
    } catch (err) {
      console.error("Failed to fetch calendar:", err);
      loadCachedEvents();
      renderCalendarSection();
      renderTodayList();
    }
  }

  function loadCachedEvents() {
    const cache = loadJSON("dr_calendar_cache", {});
    const today = todayKey();
    if (cache[today]) {
      calendarEvents = cache[today].events;
    }
  }

  function renderCalendarSection() {
    const token = getStoredToken();
    const clientId = getClientId();
    const hasConnection = !!token || (!!clientId && calendarEvents.length > 0);

    if (hasConnection && calendarEvents.length >= 0 && token) {
      // Connected state
      $("#calendar-setup").style.display = "none";
      $("#calendar-connected").style.display = "block";
      $("#disconnect-google-btn").style.display = "block";

      const list = $("#events-list");
      const empty = $("#events-empty");

      if (calendarEvents.length === 0) {
        list.innerHTML = "";
        empty.style.display = "flex";
      } else {
        empty.style.display = "none";
        list.innerHTML = calendarEvents
          .map((ev) => {
            const timeStr = ev.allDay
              ? "All day"
              : formatTime12h(ev.start.slice(11, 16));
            const endStr = ev.allDay
              ? ""
              : " \u2013 " + formatTime12h(ev.end.slice(11, 16));
            return `
            <div class="event-card">
              <div class="event-dot"></div>
              <div class="event-details">
                <span class="event-card-title">${escapeHtml(ev.title)}</span>
                <span class="event-card-time">${timeStr}${endStr}</span>
              </div>
            </div>`;
          })
          .join("");
      }
    } else {
      // Disconnected state
      $("#calendar-setup").style.display = "block";
      $("#calendar-connected").style.display = "none";
      $("#disconnect-google-btn").style.display = "none";
    }
  }

  // --- Event Handlers ---
  function addTodayTask() {
    const input = $("#new-task-input");
    const timeInput = $("#new-task-time");
    const text = input.value.trim();
    if (!text) return;

    const time = timeInput.value || null;
    todayTasks.push({ id: generateId(), text, done: false, time });
    saveToday();
    renderTodayList();
    input.value = "";
    timeInput.value = "";
    input.focus();
  }

  function addRecurringTask() {
    const input = $("#new-recurring-input");
    const timeInput = $("#new-recurring-time");
    const text = input.value.trim();
    if (!text) return;

    const time = timeInput.value || null;
    const task = { id: generateId(), text, time };
    recurringTasks.push(task);
    saveRecurring();

    todayTasks.push({
      id: generateId(),
      text: task.text,
      done: false,
      recurringId: task.id,
      time,
    });
    saveToday();

    renderRecurringList();
    renderTodayList();
    input.value = "";
    timeInput.value = "";
    input.focus();
  }

  function toggleTask(id) {
    const task = todayTasks.find((t) => t.id === id);
    if (task) {
      task.done = !task.done;
      saveToday();
      renderTodayList();
    }
  }

  function deleteTodayTask(id) {
    todayTasks = todayTasks.filter((t) => t.id !== id);
    saveToday();
    renderTodayList();
  }

  function deleteRecurringTask(id) {
    recurringTasks = recurringTasks.filter((t) => t.id !== id);
    saveRecurring();
    renderRecurringList();
  }

  // --- Tab switching ---
  function switchTab(tabName) {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-content").forEach((s) => {
      s.classList.toggle("active", s.id === tabName + "-section");
    });

    if (tabName === "history") renderHistory();
    if (tabName === "calendar") renderCalendarSection();
  }

  // --- Menu ---
  function showMenu() {
    $("#menu-overlay").classList.remove("hidden");
  }

  function hideMenu() {
    $("#menu-overlay").classList.add("hidden");
  }

  // --- Cleanup ---
  function cleanupOldData() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("dr_day_")) {
        const dateStr = key.replace("dr_day_", "");
        if (dateStr < cutoffStr) {
          localStorage.removeItem(key);
        }
      }
    }
  }

  // --- Init ---
  function init() {
    // Check password lock
    if (!hasPassword()) {
      showLockScreen("set");
    } else if (!isUnlocked()) {
      showLockScreen("unlock");
    } else {
      $("#lock-screen").classList.add("hidden");
      $("#app").classList.remove("app-hidden");
    }

    // Set date
    $("#date-display").textContent = formatDate(todayKey());

    // Load data
    loadToday();
    loadCachedEvents();
    renderTodayList();
    renderRecurringList();
    renderCalendarSection();

    // Cleanup old data
    cleanupOldData();

    // Init Google Calendar if previously connected
    if (getClientId() && typeof google !== "undefined" && google.accounts) {
      initTokenClient();
      if (getStoredToken()) {
        fetchCalendarEvents();
      }
    }

    // Tab events
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    // Add task events
    $("#add-task-btn").addEventListener("click", addTodayTask);
    $("#new-task-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addTodayTask();
    });
    $("#new-task-time").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addTodayTask();
    });

    $("#add-recurring-btn").addEventListener("click", addRecurringTask);
    $("#new-recurring-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addRecurringTask();
    });
    $("#new-recurring-time").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addRecurringTask();
    });

    // Task list click delegation (today)
    $("#task-list").addEventListener("click", (e) => {
      const item = e.target.closest(".task-item");
      if (!item) return;
      const id = item.dataset.id;

      if (e.target.closest(".delete-btn")) {
        deleteTodayTask(id);
      } else if (e.target.closest(".checkbox")) {
        toggleTask(id);
      } else if (e.target.closest(".task-text")) {
        startEditTask(item, id, "today");
      }
    });

    // Keyboard accessibility
    $("#task-list").addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const checkbox = e.target.closest(".checkbox");
        if (checkbox) {
          e.preventDefault();
          const item = checkbox.closest(".task-item");
          if (item) toggleTask(item.dataset.id);
        }
      }
    });

    // Recurring list click delegation
    $("#recurring-list").addEventListener("click", (e) => {
      const item = e.target.closest(".task-item");
      if (!item) return;

      if (e.target.closest(".delete-btn")) {
        deleteRecurringTask(item.dataset.id);
      } else if (e.target.closest(".task-text")) {
        startEditTask(item, item.dataset.id, "recurring");
      }
    });

    // AI suggestions
    $("#ai-suggest-btn").addEventListener("click", fetchAiSuggestions);
    $("#dismiss-suggestions-btn").addEventListener("click", dismissAiSuggestions);
    $("#ai-suggestions-list").addEventListener("click", (e) => {
      const btn = e.target.closest(".ai-add-btn");
      if (btn) addSuggestionAsTask(Number(btn.dataset.index));
    });
    $("#setup-ai-btn").addEventListener("click", () => {
      hideMenu();
      showAiSetup();
    });
    $("#save-ai-key-btn").addEventListener("click", saveAiKey);
    $("#ai-key-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveAiKey();
    });
    $("#remove-ai-key-btn").addEventListener("click", removeAiKey);
    $("#close-ai-setup-btn").addEventListener("click", hideAiSetup);
    $("#ai-setup-overlay").addEventListener("click", (e) => {
      if (e.target === $("#ai-setup-overlay")) hideAiSetup();
    });
    updateAiButtonState();

    // Google Calendar events
    $("#connect-google-btn").addEventListener("click", connectGoogle);
    $("#save-client-id-btn").addEventListener("click", saveClientId);
    $("#client-id-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveClientId();
    });
    $("#refresh-calendar-btn").addEventListener("click", fetchCalendarEvents);
    $("#show-setup-link").addEventListener("click", (e) => {
      e.preventDefault();
      showClientIdSetup();
    });
    $("#disconnect-google-btn").addEventListener("click", () => {
      disconnectGoogle();
      hideMenu();
    });

    // Menu
    $("#menu-btn").addEventListener("click", showMenu);
    $("#menu-close-btn").addEventListener("click", hideMenu);
    $("#menu-overlay").addEventListener("click", (e) => {
      if (e.target === $("#menu-overlay")) hideMenu();
    });

    $("#clear-completed-btn").addEventListener("click", () => {
      todayTasks = todayTasks.filter((t) => !t.done);
      saveToday();
      renderTodayList();
      hideMenu();
    });

    $("#reset-today-btn").addEventListener("click", () => {
      if (confirm("Reset today's task list? This cannot be undone.")) {
        todayTasks = recurringTasks.map((r) => ({
          id: generateId(),
          text: r.text,
          done: false,
          recurringId: r.id,
          time: r.time || null,
        }));
        saveToday();
        renderTodayList();
        hideMenu();
      }
    });

    // Password / lock menu items
    $("#change-password-btn").addEventListener("click", () => {
      hideMenu();
      showLockScreen("change");
    });

    $("#lock-now-btn").addEventListener("click", () => {
      hideMenu();
      lockApp();
    });

    // Check for day change every minute
    let lastDay = todayKey();
    setInterval(() => {
      const now = todayKey();
      if (now !== lastDay) {
        lastDay = now;
        $("#date-display").textContent = formatDate(now);
        loadToday();
        renderTodayList();
        if (getStoredToken()) fetchCalendarEvents();
      }
    }, 60000);

    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  // GIS library loaded callback
  window.onGisLoaded = function () {
    if (getClientId()) {
      initTokenClient();
      if (getStoredToken()) {
        fetchCalendarEvents();
      }
    }
  };

  document.addEventListener("DOMContentLoaded", init);
})();
