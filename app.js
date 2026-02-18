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

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
  // { id, text }

  let todayTasks = [];
  // { id, text, done, recurringId? }

  function loadToday() {
    const key = todayKey();
    const saved = loadJSON("dr_day_" + key, null);

    if (saved) {
      todayTasks = saved;
    } else {
      // New day: seed from recurring tasks
      todayTasks = recurringTasks.map((r) => ({
        id: generateId(),
        text: r.text,
        done: false,
        recurringId: r.id,
      }));
    }

    // Also add any new recurring tasks not yet in today's list
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

  // --- Rendering ---
  function renderTodayList() {
    const list = $("#task-list");
    const empty = $("#empty-state");

    if (todayTasks.length === 0) {
      list.innerHTML = "";
      empty.style.display = "flex";
      updateProgress();
      return;
    }

    empty.style.display = "none";
    list.innerHTML = todayTasks
      .map(
        (task) => `
      <li class="task-item ${task.done ? "completed" : ""}" data-id="${task.id}">
        <div class="checkbox ${task.done ? "checked" : ""}" role="checkbox" aria-checked="${task.done}" tabindex="0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <span class="task-text">${escapeHtml(task.text)}</span>
        ${task.recurringId ? '<span class="recurring-badge">Daily</span>' : ""}
        <button class="delete-btn" aria-label="Delete task">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </li>
    `
      )
      .join("");

    updateProgress();
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
      .map(
        (task) => `
      <li class="task-item" data-id="${task.id}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" style="flex-shrink:0"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        <span class="task-text">${escapeHtml(task.text)}</span>
        <button class="delete-btn" aria-label="Delete recurring task" style="opacity:0.6">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </li>
    `
      )
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

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Event Handlers ---
  function addTodayTask() {
    const input = $("#new-task-input");
    const text = input.value.trim();
    if (!text) return;

    todayTasks.push({ id: generateId(), text, done: false });
    saveToday();
    renderTodayList();
    input.value = "";
    input.focus();
  }

  function addRecurringTask() {
    const input = $("#new-recurring-input");
    const text = input.value.trim();
    if (!text) return;

    const task = { id: generateId(), text };
    recurringTasks.push(task);
    saveRecurring();

    // Also add to today's list
    todayTasks.push({
      id: generateId(),
      text: task.text,
      done: false,
      recurringId: task.id,
    });
    saveToday();

    renderRecurringList();
    renderTodayList();
    input.value = "";
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
      s.classList.toggle(
        "active",
        s.id === tabName + "-section"
      );
    });
  }

  // --- Menu ---
  function showMenu() {
    $("#menu-overlay").classList.remove("hidden");
  }

  function hideMenu() {
    $("#menu-overlay").classList.add("hidden");
  }

  // --- Init ---
  function init() {
    // Set date
    $("#date-display").textContent = formatDate(todayKey());

    // Load data
    loadToday();
    renderTodayList();
    renderRecurringList();

    // Tab events
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    // Add task events
    $("#add-task-btn").addEventListener("click", addTodayTask);
    $("#new-task-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addTodayTask();
    });

    $("#add-recurring-btn").addEventListener("click", addRecurringTask);
    $("#new-recurring-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addRecurringTask();
    });

    // Task list click delegation (today)
    $("#task-list").addEventListener("click", (e) => {
      const item = e.target.closest(".task-item");
      if (!item) return;
      const id = item.dataset.id;

      if (e.target.closest(".delete-btn")) {
        deleteTodayTask(id);
      } else if (e.target.closest(".checkbox") || e.target.closest(".task-text")) {
        toggleTask(id);
      }
    });

    // Keyboard accessibility for checkboxes
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
      if (e.target.closest(".delete-btn")) {
        const item = e.target.closest(".task-item");
        if (item) deleteRecurringTask(item.dataset.id);
      }
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
        }));
        saveToday();
        renderTodayList();
        hideMenu();
      }
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
      }
    }, 60000);

    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
