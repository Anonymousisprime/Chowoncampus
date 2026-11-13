(() => {
  const $ = selector => document.querySelector(selector);
  const state = { account: null, data: null, activeLessonId: null };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }
  const roleNames = { student: "Student", restaurant: "Restaurant partner", agent: "Delivery agent", admin: "Administrator" };
  function completedIds() {
    return new Set((state.data.progress || []).filter(item => item.completed).map(item => item.lessonId));
  }
  function renderLessons() {
    const lessons = state.data.lessons || [];
    const done = completedIds();
    $("#lessonTotal").textContent = String(lessons.length);
    $("#completedTotal").textContent = String(done.size);
    $("#faqTotal").textContent = String((state.data.faqs || []).length);
    const percent = lessons.length ? Math.round(done.size / lessons.length * 100) : 0;
    $("#progressFill").style.width = percent + "%";
    $("#progressLabel").textContent = percent + "% complete · " + done.size + " of " + lessons.length + " lessons";
    $("#lessonList").innerHTML = lessons.length ? lessons.map(lesson => `
      <article class="lesson-card">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:start;flex-wrap:wrap">
          <h3>${esc(lesson.title)}</h3><span class="pill">${done.has(lesson.id) ? "Completed" : "Not completed"}</span>
        </div>
        <p class="muted">${esc(lesson.summary)}</p>
        <button class="btn light" type="button" data-lesson="${esc(lesson.id)}">Open lesson</button>
        ${state.data.canManage ? '<button class="btn light" type="button" data-edit-kind="lesson" data-edit-id="' + esc(lesson.id) + '">Edit</button><button class="btn light" type="button" data-delete-kind="lesson" data-delete-id="' + esc(lesson.id) + '">Remove</button>' : ""}
      </article>`).join("") : '<div class="empty">No lessons have been published for this role yet.</div>';
    if (state.activeLessonId && lessons.some(item => item.id === state.activeLessonId)) renderLesson(state.activeLessonId);
  }
  function renderLesson(id) {
    const lesson = (state.data.lessons || []).find(item => item.id === id);
    if (!lesson) return;
    state.activeLessonId = id;
    const done = completedIds().has(id);
    $("#lessonBody").innerHTML = `
      <span class="pill">${esc(roleNames[lesson.role] || lesson.role)} training</span>
      <h3>${esc(lesson.title)}</h3><p class="muted">${esc(lesson.summary)}</p>
      ${(lesson.steps || []).map((step, index) => '<div class="step"><strong>Step ' + (index + 1) + '.</strong> ' + esc(step) + '</div>').join("")}
      <button class="btn primary" type="button" id="completeLesson" ${done ? "disabled" : ""}>${done ? "Lesson completed ✓" : "Mark lesson complete"}</button>
      <p id="lessonStatus" class="status" role="status"></p>`;
    $("#lessonViewer").scrollIntoView({ behavior: "smooth", block: "start" });
    const button = $("#completeLesson");
    if (button) button.addEventListener("click", async () => {
      button.disabled = true;
      $("#lessonStatus").textContent = "Saving your progress…";
      try {
        const result = await api("/api/academy/progress", { method: "POST", body: JSON.stringify({ lessonId: id }) });
        state.data.progress = result.progress || state.data.progress;
        renderLessons();
        $("#lessonStatus").textContent = result.message;
      } catch (error) {
        $("#lessonStatus").textContent = error.message;
        button.disabled = false;
      }
    });
  }
  function renderFaqs() {
    const query = ($("#faqSearch").value || "").trim().toLowerCase();
    const faqs = (state.data.faqs || []).filter(item => !query || (item.question + " " + item.answer).toLowerCase().includes(query));
    $("#faqList").innerHTML = faqs.length ? faqs.map(item => `
      <details class="faq-card"><summary>${esc(item.question)}</summary><p>${esc(item.answer)}</p>
      ${state.data.canManage ? '<button class="btn light" type="button" data-edit-kind="faq" data-edit-id="' + esc(item.id) + '">Edit</button><button class="btn light" type="button" data-delete-kind="faq" data-delete-id="' + esc(item.id) + '">Remove</button>' : ""}</details>`).join("") : '<div class="empty">No matching approved answers. Try another phrase or contact support.</div>';
  }
  function renderQuiz() {
    const quiz = state.data.quizzes || [];
    $("#quizQuestions").innerHTML = quiz.length ? quiz.map((item, index) => `
      <fieldset style="border:0;border-top:1px solid #e6eee8;padding:14px 0;margin:10px 0">
        <legend style="font-weight:800;padding:8px 0">${index + 1}. ${esc(item.question)}</legend>
        ${(item.choices || []).map((choice, choiceIndex) => `
          <label class="quiz-option"><input type="radio" name="${esc(item.id)}" value="${choiceIndex}" required>${esc(choice)}</label>
        `).join("")}
      </fieldset>`).join("") : '<div class="empty">A knowledge check is not available for this account.</div>';
    $("#quizForm button[type=submit]").classList.toggle("hidden", !quiz.length);
    const previous = (state.data.quizResults || []).slice(-1)[0];
    if (previous) $("#quizStatus").textContent = "Latest result: " + previous.score + "/" + previous.total + ".";
  }
  function setContentKind() {
    const lesson = $("#contentKind").value === "lesson";
    $("#lessonFields").classList.toggle("hidden", !lesson);
    $("#faqFields").classList.toggle("hidden", lesson);
  }
  function renderAdminContent() {
    if (!state.data.canManage) return;
    const items = [
      ...(state.data.lessons || []).map(item => ({ ...item, kind: "lesson", label: item.title })),
      ...(state.data.faqs || []).map(item => ({ ...item, kind: "faq", label: item.question }))
    ];
    $("#adminContentList").innerHTML = items.length ? items.map(item => `
      <div class="admin-item"><strong>${esc(item.label)}</strong><p class="muted">${esc(item.role)} · ${item.published ? "Published" : "Draft"} · ${esc(item.kind)}</p>
      <button class="btn light" type="button" data-edit-kind="${esc(item.kind)}" data-edit-id="${esc(item.id)}">Edit</button>
      <button class="btn light" type="button" data-delete-kind="${esc(item.kind)}" data-delete-id="${esc(item.id)}">Remove</button></div>`).join("") : '<div class="empty">No Academy content found.</div>';
  }
  function editContent(kind, id) {
    const list = kind === "lesson" ? state.data.lessons : state.data.faqs;
    const item = (list || []).find(value => value.id === id);
    if (!item) return;
    const form = $("#contentForm");
    form.elements.id.value = item.id;
    form.elements.kind.value = kind;
    form.elements.role.value = item.role;
    form.elements.published.checked = Boolean(item.published);
    if (kind === "lesson") {
      form.elements.title.value = item.title || "";
      form.elements.summary.value = item.summary || "";
      form.elements.steps.value = (item.steps || []).join("\n");
    } else {
      form.elements.question.value = item.question || "";
      form.elements.answer.value = item.answer || "";
    }
    setContentKind();
    $("#adminStatus").textContent = "Editing: " + (item.title || item.question);
    $("#adminPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function deleteContent(kind, id) {
    if (!confirm("Remove this Academy content?")) return;
    try {
      await api("/api/superadmin/academy/content/" + encodeURIComponent(kind) + "/" + encodeURIComponent(id), { method: "DELETE" });
      await loadAcademy();
      $("#adminStatus").textContent = "Content removed.";
    } catch (error) { $("#adminStatus").textContent = error.message; }
  }
  async function loadAcademy() {
    const data = await api("/api/academy", { cache: "no-store" });
    state.data = data;
    $("#accountLabel").textContent = roleNames[data.role] || data.role;
    $("#heroDescription").textContent = data.role === "admin"
      ? "Review role-based learning content and manage the approved Academy library."
      : "Training prepared for " + (roleNames[data.role] || "your account") + " accounts. Learn at your own pace.";
    $("#lessonHeading").textContent = data.role === "admin" ? "Published and draft lessons" : "Your " + (roleNames[data.role] || "") + " lessons";
    $("#adminPanel").classList.toggle("hidden", !data.canManage);
    renderLessons(); renderFaqs(); renderQuiz(); renderAdminContent();
  }
  $("#lessonList").addEventListener("click", event => {
    const button = event.target.closest("[data-lesson]");
    if (button) renderLesson(button.dataset.lesson);
  });
  document.addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-kind]");
    if (edit && state.data?.canManage) editContent(edit.dataset.editKind, edit.dataset.editId);
    const remove = event.target.closest("[data-delete-kind]");
    if (remove && state.data?.canManage) deleteContent(remove.dataset.deleteKind, remove.dataset.deleteId);
  });
  $("#faqSearch").addEventListener("input", renderFaqs);
  $("#contentKind").addEventListener("change", setContentKind);
  $("#resetContent").addEventListener("click", () => { $("#contentForm").reset(); $("#contentForm").elements.id.value = ""; setContentKind(); $("#adminStatus").textContent = ""; });
  $("#contentForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget, kind = form.elements.kind.value;
    const payload = { id: form.elements.id.value || undefined, kind, role: form.elements.role.value, published: form.elements.published.checked };
    if (kind === "lesson") Object.assign(payload, { title: form.elements.title.value, summary: form.elements.summary.value, steps: form.elements.steps.value.split("\n").map(value => value.trim()).filter(Boolean) });
    else Object.assign(payload, { question: form.elements.question.value, answer: form.elements.answer.value });
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true; $("#adminStatus").textContent = "Saving…";
    try {
      await api("/api/superadmin/academy/content", { method: "POST", body: JSON.stringify(payload) });
      form.reset(); form.elements.id.value = ""; setContentKind();
      await loadAcademy(); $("#adminStatus").textContent = "Academy content saved.";
    } catch (error) { $("#adminStatus").textContent = error.message; }
    finally { button.disabled = false; }
  });
  $("#quizForm").addEventListener("submit", async event => {
    event.preventDefault();
    const answers = {};
    for (const item of state.data.quizzes || []) {
      const selected = $("#quizForm").querySelector('input[name="' + CSS.escape(item.id) + '"]:checked');
      if (!selected) { $("#quizStatus").textContent = "Please answer every question."; return; }
      answers[item.id] = Number(selected.value);
    }
    const button = $("#quizForm button[type=submit]");
    button.disabled = true; $("#quizStatus").textContent = "Checking your answers…";
    try {
      const result = await api("/api/academy/quiz", { method: "POST", body: JSON.stringify({ answers }) });
      $("#quizStatus").textContent = result.message + " Your score: " + result.score + "/" + result.total + ".";
      state.data.quizResults = [...(state.data.quizResults || []), result];
    } catch (error) { $("#quizStatus").textContent = error.message; }
    finally { button.disabled = false; }
  });
  $("#logoutButton").addEventListener("click", async () => {
    try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } finally { location.href = "/"; }
  });
  (async () => {
    try {
      const me = await api("/api/me");
      if (!me.account) { location.href = "/student-login.html?next=/academy.html"; return; }
      state.account = me.account;
      await loadAcademy();
    } catch (error) {
      $("#lessonList").innerHTML = '<div class="empty error">' + esc(error.message) + '</div>';
      $("#faqList").textContent = error.message;
    }
  })();
})();