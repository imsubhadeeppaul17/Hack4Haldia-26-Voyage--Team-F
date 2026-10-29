"use strict";

const STORAGE_KEY = "team-f-ticketing-v5";
const QR_CODE_LIBRARY =
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
const QR_SCAN_LIBRARY =
  "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";

const emptyState = () => ({
  role: "attendee",
  identity: "",
  events: [],
  tickets: [],
  checkins: [],
  history: [],
  offlineQueue: [],
  revision: 0
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const defaults = emptyState();

    return {
      ...defaults,
      ...saved,
      events: Array.isArray(saved.events) ? saved.events : [],
      tickets: Array.isArray(saved.tickets) ? saved.tickets : [],
      checkins: Array.isArray(saved.checkins) ? saved.checkins : [],
      history: Array.isArray(saved.history) ? saved.history : [],
      offlineQueue: Array.isArray(saved.offlineQueue) ? saved.offlineQueue : []
    };
  } catch {
    return emptyState();
  }
}

let state = loadState();
const expandedEvents = new Set();

let qrCodePromise = null;
let qrScannerPromise = null;
let cameraStream = null;
let scanning = false;
let scanFrameId = null;

document.body.innerHTML = `
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: #f5f7ff;
      background: #101326;
      font: 16px system-ui, sans-serif;
    }
    body::before, body::after {
      content: "";
      position: fixed;
      z-index: -1;
      width: 35rem;
      height: 35rem;
      border-radius: 50%;
      filter: blur(85px);
      opacity: .35;
      animation: float 14s ease-in-out infinite alternate;
    }
    body::before { background: #673de6; top: -12rem; left: -12rem; }
    body::after {
      background: #00c2a8;
      right: -14rem;
      bottom: -15rem;
      animation-delay: -7s;
    }
    @keyframes float {
      from { transform: translate(0, 0) scale(.9); }
      to { transform: translate(5rem, 3rem) scale(1.2); }
    }
    main { width: min(1050px, 94%); margin: auto; padding: 2rem 0 4rem; }
    header, section {
      border: 1px solid #ffffff20;
      background: #171a31dd;
      backdrop-filter: blur(12px);
      border-radius: 16px;
      padding: 1.25rem;
      margin-bottom: 1rem;
      box-shadow: 0 12px 35px #0003;
    }
    h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.5rem); }
    h2 { margin-top: 0; }
    .tagline { color: #a9b5ff; font-size: 1.1rem; }
    .muted { color: #b6bdd5; }
    label { display: block; margin: .65rem 0 .25rem; }
    input, select, button {
      max-width: 100%;
      padding: .7rem .8rem;
      border: 1px solid #ffffff35;
      border-radius: 9px;
      color: #f5f7ff;
      background: #101326;
      font: inherit;
    }
    input, select { width: 100%; }
    button { cursor: pointer; margin: .35rem .25rem .35rem 0; }
    button.primary { background: #6951e8; border-color: #8876ff; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .row { display: flex; flex-wrap: wrap; gap: .8rem; align-items: end; }
    .row > div { flex: 1 1 210px; }
    .card {
      border: 1px solid #ffffff25;
      background: #ffffff08;
      border-radius: 12px;
      padding: 1rem;
      margin: .7rem 0;
    }
    .event-details {
      border-top: 1px solid #ffffff22;
      margin-top: .8rem;
      padding-top: .8rem;
    }
    .qr {
      display: inline-block;
      min-height: 18px;
      padding: 8px;
      border-radius: 8px;
      background: white;
      color: #222;
    }
    .qr img { display: block; }
    .badge {
      display: inline-block;
      border-radius: 99px;
      padding: .2rem .55rem;
      background: #174e42;
      color: #a9f5d6;
      font-size: .8rem;
      vertical-align: middle;
    }
    .hidden { display: none !important; }
    video {
      display: block;
      width: min(100%, 500px);
      border-radius: 12px;
      background: #000;
    }
    .status { min-height: 1.5rem; }
    .good { color: #7ff0b1; }
    .bad { color: #ff9a9a; }
    .history-item { border-bottom: 1px solid #ffffff20; padding: .5rem 0; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; }
    }
  </style>

  <main>
    <header>
      <h1>Event Tickets</h1>
      <p class="tagline">Make memories. We’ll take care of the details.</p>
      <div class="row">
        <div>
          <label for="role">Role</label>
          <select id="role">
            <option value="attendee">Attendee</option>
            <option value="organizer">Organizer</option>
            <option value="staff">Staff</option>
          </select>
        </div>
        <div>
          <label for="identity">Your name</label>
          <input id="identity" placeholder="Enter your name">
        </div>
        <div><button id="saveIdentity" type="button">Save name</button></div>
      </div>
      <p id="status" class="status muted" aria-live="polite"></p>
    </header>

    <section id="organizerSection" class="hidden">
      <h2>Create and publish an event</h2>
      <form id="eventForm">
        <div class="row">
          <div>
            <label for="eventName">Event name</label>
            <input id="eventName" required maxlength="120" placeholder="Community Hackathon">
          </div>
          <div>
            <label for="ticketPrice">Ticket price per person</label>
            <input id="ticketPrice" type="number" min="0" step="0.01" required placeholder="0.00">
          </div>
          <div>
            <label for="capacity">Capacity (people)</label>
            <input id="capacity" type="number" min="1" step="1" required placeholder="100">
          </div>
        </div>
        <label for="eventAddress">Event address</label>
        <input id="eventAddress" required maxlength="250" placeholder="Venue, street, city">
        <div class="row">
          <div>
            <label for="eventPassword">Event password (organizer ticket)</label>
            <input id="eventPassword" type="password" required minlength="4" autocomplete="new-password">
          </div>
          <div>
            <label for="staffPassword">Staff password (staff ticket)</label>
            <input id="staffPassword" type="password" required minlength="4" autocomplete="new-password">
          </div>
        </div>
        <label for="eventDate">Date and time (optional)</label>
        <input id="eventDate" type="datetime-local">
        <p><button class="primary" type="submit">Publish event</button></p>
      </form>
    </section>

    <section>
      <h2>Published events</h2>
      <div id="eventsList"></div>
    </section>

    <section id="bookingSection">
      <h2>Book a ticket</h2>
      <p id="bookingPriceNote" class="muted"></p>

      <label for="bookingEvent">Choose an event</label>
      <select id="bookingEvent"></select>

      <div class="row">
        <div>
          <label for="bookingQuantity">Number of people</label>
          <input id="bookingQuantity" type="number" min="1" step="1" value="1">
        </div>
        <div>
          <label for="bookingPassword">Required password for your role</label>
          <input id="bookingPassword" type="password" autocomplete="off">
        </div>
      </div>

      <p id="passwordHelp" class="muted"></p>
      <button class="primary" id="bookTicket" type="button">Book ticket</button>
      <div id="bookingResult"></div>
    </section>

    <section>
      <h2>Check in</h2>
      <p class="muted">Check in by ticket code, camera QR scan, or image upload.</p>
      <label for="checkinEvent">Event filter (optional)</label>
      <select id="checkinEvent"></select>
      <label for="ticketCode">Ticket code</label>
      <input id="ticketCode" placeholder="Paste or scan a ticket code">
      <label for="admitCount">Number of people to check in</label>
      <input id="admitCount" type="number" min="1" step="1" value="1">
      <button class="primary" id="checkIn" type="button">Check in by code</button>
      <button id="scanTicket" type="button">Scan ticket QR with camera</button>
      <label for="ticketImage">Or scan a QR from an image</label>
      <input id="ticketImage" type="file" accept="image/*" capture="environment">
      <div id="checkinResult" class="status" aria-live="polite"></div>
      <h3>Offline check-in queue</h3>
      <p id="queueStatus" class="muted"></p>
      <button id="syncQueue" type="button">Process queued check-ins</button>
    </section>

    <section id="myTicketsSection">
      <h2>My tickets</h2>
      <div id="myTickets"></div>
    </section>

    <section>
      <h2>Live attendance dashboard <span class="badge">This browser</span></h2>
      <label for="dashboardEvent">Event filter</label>
      <select id="dashboardEvent"></select>
      <button id="refreshDashboard" type="button">Refresh dashboard</button>
      <div id="dashboard"></div>
    </section>

    <section id="scannerSection" class="hidden">
      <h2>QR scanner</h2>
      <video id="video" playsinline muted></video>
      <p id="scannerStatus" class="muted"></p>
      <button id="stopScanner" type="button">Stop camera</button>
    </section>
  </main>
`;

const $ = (id) => document.getElementById(id);

function persist() {
  state.revision = (Number(state.revision) || 0) + 1;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel("team-f-ticketing");
      channel.postMessage({ revision: state.revision });
      channel.close();
    }
  } catch (error) {
    showStatus("Could not save data in browser storage: " + error.message, true);
  }
}

function showStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").className = "status " + (isError ? "bad" : "muted");
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function currentName() {
  return $("identity").value.trim();
}

function getEvent(id) {
  return state.events.find((event) => event.id === id);
}

function getTicket(code) {
  return state.tickets.find((ticket) => ticket.code === code);
}

function bookedCount(eventId) {
  return state.tickets
    .filter((ticket) => ticket.eventId === eventId)
    .reduce((total, ticket) => total + ticket.quantity, 0);
}

function admittedCount(ticketId) {
  return state.checkins
    .filter((entry) => entry.ticketId === ticketId)
    .reduce((total, entry) => total + entry.count, 0);
}

function addHistory(entry) {
  state.history.unshift({
    id: makeId(),
    time: new Date().toISOString(),
    ...entry
  });
}

function loadExternalScript(url, globalName, promiseName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (window[promiseName]) return window[promiseName];

  window[promiseName] = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    script.onload = () => {
      if (window[globalName]) resolve(window[globalName]);
      else reject(new Error(`${globalName} library failed to initialize`));
    };

    script.onerror = () => {
      window[promiseName] = null;
      reject(new Error("Could not load QR library. Check your internet connection."));
    };

    document.head.append(script);
  });

  return window[promiseName];
}

function getQrCodeLibrary() {
  if (!qrCodePromise) {
    qrCodePromise = loadExternalScript(
      QR_CODE_LIBRARY,
      "QRCode",
      "__teamfQrCodePromise"
    ).catch((error) => {
      qrCodePromise = null;
      throw error;
    });
  }
  return qrCodePromise;
}

function getQrScannerLibrary() {
  if (!qrScannerPromise) {
    qrScannerPromise = loadExternalScript(
      QR_SCAN_LIBRARY,
      "jsQR",
      "__teamfQrScannerPromise"
    ).catch((error) => {
      qrScannerPromise = null;
      throw error;
    });
  }
  return qrScannerPromise;
}

async function drawQr(container, value) {
  container.replaceChildren();
  container.className = "qr";

  try {
    const QRCode = await getQrCodeLibrary();
    if (!container.isConnected) return;

    new QRCode(container, {
      text: value,
      width: 160,
      height: 160,
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (error) {
    container.textContent = "QR unavailable: " + error.message;
  }
}

function eventQrValue(eventId) {
  return "TEAMF-EVENT|" + eventId;
}

function ticketQrValue(ticketCode) {
  return "TEAMF-TICKET|" + ticketCode;
}

function updateRoleUI() {
  const role = $("role").value;

  $("organizerSection").classList.toggle("hidden", role !== "organizer");

  if (role === "attendee") {
    $("bookingPassword").disabled = true;
    $("bookingPassword").value = "";
    $("bookingPassword").placeholder = "No password required";
    $("passwordHelp").textContent = "Attendee tickets use the event price.";
    $("bookingPriceNote").textContent =
      "Ticket price is charged only in this demo calculation; no payment is processed.";
  } else if (role === "organizer") {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Enter this event's event password";
    $("passwordHelp").textContent =
      "Organizer ticket is free. Enter the event password set when publishing.";
    $("bookingPriceNote").textContent = "Organizer entry tickets are free.";
  } else {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Enter this event's staff password";
    $("passwordHelp").textContent =
      "Staff ticket is free. Enter the staff password set when publishing.";
    $("bookingPriceNote").textContent = "Staff entry tickets are free.";
  }
}

function addOption(select, value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  select.append(option);
}

function renderEvents() {
  const list = $("eventsList");
  const bookingSelect = $("bookingEvent");
  const checkinSelect = $("checkinEvent");
  const dashboardSelect = $("dashboardEvent");

  const oldBooking = bookingSelect.value;
  const oldCheckin = checkinSelect.value;
  const oldDashboard = dashboardSelect.value;

  list.replaceChildren();
  bookingSelect.replaceChildren();
  checkinSelect.replaceChildren();
  dashboardSelect.replaceChildren();

  addOption(checkinSelect, "", "Any event");
  addOption(dashboardSelect, "", "All events");

  if (!state.events.length) {
    list.textContent = "No events have been published yet.";
  }

  for (const event of state.events) {
    const optionText =
      `${event.name} — ${bookedCount(event.id)}/${event.capacity} booked`;

    addOption(bookingSelect, event.id, optionText);
    addOption(checkinSelect, event.id, event.name);
    addOption(dashboardSelect, event.id, event.name);

    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = event.name;

    const summary = document.createElement("p");
    summary.className = "muted";
    summary.textContent =
      `${Number(event.price).toFixed(2)} per person · ` +
      `${bookedCount(event.id)}/${event.capacity} booked` +
      (event.date ? ` · ${new Date(event.date).toLocaleString()}` : "");

    const address = document.createElement("p");
    address.textContent = "Address: " + event.address;

    const details = document.createElement("div");
    details.className = "event-details";
    details.classList.toggle("hidden", !expandedEvents.has(event.id));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = expandedEvents.has(event.id)
      ? "Hide event details"
      : "View event details";
    toggle.addEventListener("click", () => {
      if (expandedEvents.has(event.id)) expandedEvents.delete(event.id);
      else expandedEvents.add(event.id);
      renderEvents();
    });

    if (expandedEvents.has(event.id)) {
      const code = document.createElement("p");
      code.textContent = "Event code: " + event.id;

      const label = document.createElement("p");
      label.textContent = "Scan to select this event:";

      const qr = document.createElement("div");
      qr.className = "qr";
      details.append(code, label, qr);
      drawQr(qr, eventQrValue(event.id));

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.textContent = "Select for booking";
      selectButton.addEventListener("click", () => {
        $("bookingEvent").value = event.id;
        $("bookingSection").scrollIntoView({ behavior: "smooth" });
      });
      details.append(selectButton);
    }

    card.append(title, summary, address, toggle, details);
    list.append(card);
  }

  if ([...bookingSelect.options].some((option) => option.value === oldBooking)) {
    bookingSelect.value = oldBooking;
  }
  if ([...checkinSelect.options].some((option) => option.value === oldCheckin)) {
    checkinSelect.value = oldCheckin;
  }
  if ([...dashboardSelect.options].some((option) => option.value === oldDashboard)) {
    dashboardSelect.value = oldDashboard;
  }
}

function renderMyTickets() {
  const list = $("myTickets");
  list.replaceChildren();

  const name = currentName().toLowerCase();
  if (!name) {
    list.textContent = "Enter and save your name to see your tickets.";
    return;
  }

  const tickets = state.tickets.filter(
    (ticket) => ticket.owner.toLowerCase() === name
  );

  if (!tickets.length) {
    list.textContent = "No tickets under this name yet.";
    return;
  }

  for (const ticket of tickets) {
    const event = getEvent(ticket.eventId);
    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = event ? event.name : "Event";

    const details = document.createElement("p");
    details.textContent =
      `${ticket.role} entry · ${ticket.quantity} person(s) · ` +
      `${admittedCount(ticket.id)}/${ticket.quantity} checked in`;

    const code = document.createElement("p");
    code.textContent = "Ticket code: " + ticket.code;

    const qr = document.createElement("div");
    qr.className = "qr";
    qr.setAttribute("aria-label", "Ticket QR code");

    card.append(title, details, code, qr);
    list.append(card);
    drawQr(qr, ticketQrValue(ticket.code));
  }
}

function describeHistory(entry) {
  const event = getEvent(entry.eventId);
  const eventName = event ? event.name : "Event";

  if (entry.type === "event_published") {
    return `Published event: ${eventName}`;
  }
  if (entry.type === "ticket_booked") {
    return `${entry.owner} booked ${entry.quantity} place(s) for ${eventName} (${entry.ticketCode})`;
  }
  if (entry.type === "checked_in") {
    return `${entry.actor} checked in ${entry.count} person(s) for ${eventName} (${entry.ticketCode})`;
  }
  if (entry.type === "checkin_queued") {
    return `${entry.actor} queued check-in for ${eventName} (${entry.ticketCode})`;
  }
  return "Activity";
}

function visibleHistory() {
  const role = $("role").value;
  const name = currentName().toLowerCase();

  if (role === "organizer") return state.history;
  if (!name) return [];

  if (role === "staff") {
    return state.history.filter(
      (entry) => (entry.actor || entry.owner || "").toLowerCase() === name
    );
  }

  return state.history.filter(
    (entry) => (entry.owner || "").toLowerCase() === name
  );
}

function renderDashboard() {
  const dashboard = $("dashboard");
  dashboard.replaceChildren();

  const filterId = $("dashboardEvent").value;
  const events = filterId
    ? state.events.filter((event) => event.id === filterId)
    : state.events;

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Publish an event to see attendance.";
    dashboard.append(empty);
  }

  for (const event of events) {
    const booked = bookedCount(event.id);
    const checkedIn = state.tickets
      .filter((ticket) => ticket.eventId === event.id)
      .reduce((sum, ticket) => sum + admittedCount(ticket.id), 0);

    const card = document.createElement("article");
    card.className = "card";

    const text = document.createElement("p");
    text.textContent =
      `${event.name}: ${booked}/${event.capacity} booked · ${checkedIn} checked in`;

    const progress = document.createElement("progress");
    progress.max = Math.max(Number(event.capacity), 1);
    progress.value = checkedIn;
    progress.setAttribute("aria-label", `${event.name} attendance`);

    card.append(text, progress);
    dashboard.append(card);
  }

  const heading = document.createElement("h3");
  heading.textContent = "Recent activity";
  dashboard.append(heading);

  const entries = visibleHistory().filter(
    (entry) => !filterId || entry.eventId === filterId
  );

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No history to show yet.";
    dashboard.append(empty);
    return;
  }

  for (const entry of entries.slice(0, 100)) {
    const item = document.createElement("div");
    item.className = "history-item";

    const description = document.createElement("p");
    description.textContent = describeHistory(entry);

    const time = document.createElement("small");
    time.className = "muted";
    time.textContent = new Date(entry.time).toLocaleString();

    item.append(description, time);
    dashboard.append(item);
  }
}

function render() {
  const role = $("role").value;
  $("organizerSection").classList.toggle("hidden", role !== "organizer");
  $("bookingPriceNote").textContent =
    role === "attendee"
      ? "Attendee tickets use the displayed event price. No payment is processed."
      : `${role === "organizer" ? "Organizer" : "Staff"} tickets are free.`;

  if (role === "attendee") {
    $("bookingPassword").disabled = true;
    $("bookingPassword").value = "";
    $("bookingPassword").placeholder = "No password required for attendees";
    $("passwordHelp").textContent = "Select an event and press Book ticket.";
  } else if (role === "organizer") {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Enter the event password";
    $("passwordHelp").textContent =
      "Organizer tickets are free; enter the event password to confirm the booking.";
  } else {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Enter the staff password";
    $("passwordHelp").textContent =
      "Staff tickets are free; enter the staff password to confirm the booking.";
  }

  renderEvents();
  renderMyTickets();
  renderDashboard();

  $("queueStatus").textContent =
    `${state.offlineQueue.length} pending check-in(s). ` +
    (navigator.onLine ? "Browser reports online." : "Browser reports offline.");
}

function createTicket({ event, owner, role, quantity, price }) {
  const ticket = {
    id: makeId(),
    code: "TKT-" + makeId().replace(/-/g, "").slice(0, 12).toUpperCase(),
    eventId: event.id,
    owner,
    role,
    quantity,
    price,
    total: price * quantity,
    createdAt: new Date().toISOString()
  };

  state.tickets.push(ticket);
  addHistory({
    type: "ticket_booked",
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: event.id,
    owner,
    role,
    quantity,
    total: ticket.total
  });

  persist();
  render();
  showTicketResult(ticket, event);
  return ticket;
}

function showTicketResult(ticket, event) {
  const result = $("bookingResult");
  result.replaceChildren();

  const summary = document.createElement("p");
  summary.textContent =
    `${ticket.role === "attendee" ? "Booking" : "Free entry"} confirmed for ` +
    `${ticket.quantity} person(s) at ${event.name}. Total: ${ticket.total.toFixed(2)}.`;

  const code = document.createElement("p");
  code.textContent = "Ticket code: " + ticket.code;

  const qr = document.createElement("div");
  qr.className = "qr";

  result.append(summary, code, qr);
  drawQr(qr, ticketQrValue(ticket.code));
}

function recordCheckin(code, count, actor, eventFilter = "") {
  const ticket = getTicket(code);
  if (!ticket) return { ok: false, message: "Ticket code not found." };

  if (eventFilter && ticket.eventId !== eventFilter) {
    return { ok: false, message: "This ticket belongs to a different event." };
  }

  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, message: "Enter a positive whole number of people." };
  }

  const remaining = ticket.quantity - admittedCount(ticket.id);
  if (remaining <= 0) {
    return { ok: false, used: true, message: "All entries on this ticket have already been used." };
  }
  if (count > remaining) {
    return { ok: false, message: `Only ${remaining} admission(s) remain on this ticket.` };
  }

  const entry = {
    id: makeId(),
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: ticket.eventId,
    count,
    actor,
    time: new Date().toISOString()
  };

  state.checkins.push(entry);
  state.history.unshift({ ...entry, type: "checked_in" });
  persist();

  return {
    ok: true,
    message: `Checked in ${count}. ${remaining - count} admission(s) remain.`
  };
}

function checkIn(code, count) {
  const actor = currentName() || $("role").value;
  const eventFilter = $("checkinEvent").value;
  const ticket = getTicket(code);

  if (!ticket) return { ok: false, message: "Ticket code not found." };
  if (eventFilter && ticket.eventId !== eventFilter) {
    return { ok: false, message: "This ticket belongs to a different event." };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, message: "Enter a positive whole number of people." };
  }

  if (!navigator.onLine) {
    const queuedAt = new Date().toISOString();
    state.offlineQueue.push({
      id: makeId(),
      code,
      count,
      actor,
      eventId: ticket.eventId,
      queuedAt
    });

    state.history.unshift({
      id: makeId(),
      type: "checkin_queued",
      ticketId: ticket.id,
      ticketCode: ticket.code,
      eventId: ticket.eventId,
      count,
      actor,
      time: queuedAt
    });

    persist();
    return { queued: true, message: "Offline: check-in queued." };
  }

  return recordCheckin(code, count, actor, eventFilter);
}

function showCheckinResult(result) {
  $("checkinResult").textContent = result.message;
  $("checkinResult").className =
    "status " + (result.ok ? "good" : result.queued ? "muted" : "bad");
  render();
}

function handleCheckin() {
  const code = $("ticketCode").value.trim();
  const count = Number($("admitCount").value);

  if (!code) {
    showCheckinResult({ ok: false, message: "Enter or scan a ticket code first." });
    return;
  }

  const result = checkIn(code, count);
  showCheckinResult(result);
  if (result.ok || result.queued) $("ticketCode").value = "";
}

function parseQr(value, mode) {
  const [kind, ...parts] = String(value).trim().split("|");
  const payload = parts.join("|");

  if (mode === "event" && kind === "TEAMF-EVENT") {
    if (!getEvent(payload)) {
      showStatus("That event is not available in this browser.", true);
      return;
    }
    $("bookingEvent").value = payload;
    showStatus("Event selected. Complete the booking form to create a ticket.");
    $("bookingSection").scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (mode === "ticket" && kind === "TEAMF-TICKET") {
    const ticket = getTicket(payload);
    if (!ticket) {
      showCheckinResult({ ok: false, message: "Ticket code not found." });
      return;
    }
    $("checkinEvent").value = ticket.eventId;
    $("ticketCode").value = payload;
    handleCheckin();
    return;
  }

  showStatus("QR code is not valid for this scan option.", true);
}

function stopScanner() {
  scanning = false;
  if (scanFrameId !== null) {
    cancelAnimationFrame(scanFrameId);
    scanFrameId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  $("video").srcObject = null;
  $("scannerSection").classList.add("hidden");
}

function processOfflineQueue() {
  if (!navigator.onLine) {
    $("checkinResult").textContent = "Browser is offline; pending scans remain queued.";
    return;
  }

  const selectedEvent = $("checkinEvent").value;
  const keep = [];
  const messages = [];

  for (const item of state.offlineQueue) {
    if (selectedEvent && item.eventId !== selectedEvent) {
      keep.push(item);
      messages.push(`${item.code}: still queued; select its event to process it.`);
      continue;
    }

    const result = recordCheckin(item.code, item.count, item.actor, item.eventId);
    messages.push(`${item.code}: ${result.message}`);

    // Keep only transient failures; invalid/used tickets are resolved outcomes.
    if (!result.ok && !result.used &&
        result.message !== "Ticket code not found.") {
      keep.push(item);
    }
  }

  state.offlineQueue = keep;
  persist();
  render();
  $("checkinResult").textContent = messages.join("\n") || "No queued check-ins.";
}

async function startCameraScanner(mode) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus("Camera access requires localhost or HTTPS. Use image scanning or enter the code.", true);
    return;
  }

  try {
    const jsQR = await getQrScannerLibrary();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    const video = $("video");
    video.srcObject = cameraStream;
    $("scannerSection").classList.remove("hidden");
    $("scannerStatus").textContent = "Allow camera access, then point it at the QR code.";
    await video.play();
    scanning = true;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not initialize the QR scanner.");

    const scanFrame = () => {
      if (!scanning) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 && video.videoHeight > 0) {
        const scale = Math.min(1, 1000 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(pixels.data, pixels.width, pixels.height, {
          inversionAttempts: "attemptBoth"
        });

        if (result && result.data) {
          stopScanner();
          parseQr(result.data, mode);
          return;
        }
      }

      if (scanning) scanFrameId = requestAnimationFrame(scanFrame);
    };

    scanFrameId = requestAnimationFrame(scanFrame);
  } catch (error) {
    stopScanner();
    showStatus(`Could not start QR scanner: ${error.message}. Try image scanning or enter the code.`, true);
  }
}

async function scanImage(file, mode) {
  if (!file) return;

  try {
    const jsQR = await getQrScannerLibrary();
    let source;

    if ("createImageBitmap" in window) {
      source = await createImageBitmap(file);
    } else {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Unable to read the selected image."));
        };
        image.src = objectUrl;
      });
    }

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / source.width);
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not initialize image scanning.");

    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (typeof source.close === "function") source.close();

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: "attemptBoth"
    });

    if (!result || !result.data) {
      showStatus("No readable QR code found in that image.", true);
      return;
    }
    parseQr(result.data, mode);
  } catch (error) {
    showStatus("Could not scan image: " + error.message, true);
  } finally {
    $("ticketImage").value = "";
  }
}

function refreshFromStorage() {
  let latest;
  try {
    latest = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return;
  }

  if (!latest || (latest.revision || 0) === (state.revision || 0)) return;

  state = {
    ...emptyState(),
    ...latest,
    events: Array.isArray(latest.events) ? latest.events : [],
    tickets: Array.isArray(latest.tickets) ? latest.tickets : [],
    checkins: Array.isArray(latest.checkins) ? latest.checkins : [],
    history: Array.isArray(latest.history) ? latest.history : [],
    offlineQueue: Array.isArray(latest.offlineQueue) ? latest.offlineQueue : []
  };

  $("role").value = state.role;
  $("identity").value = state.identity;
  render();
}

$("role").value = state.role;
$("identity").value = state.identity;

$("role").addEventListener("change", () => {
  state.role = $("role").value;
  $("bookingPassword").value = "";
  persist();
  render();
});

$("saveIdentity").addEventListener("click", () => {
  state.identity = $("identity").value.trim();
  persist();
  render();
  showStatus(state.identity ? "Name saved. Select an event and press Book ticket when ready." : "Enter your name first.", !state.identity);
});

$("identity").addEventListener("input", () => {
  renderMyTickets();
  renderDashboard();
});

$("eventForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const name = $("eventName").value.trim();
  const price = Number($("ticketPrice").value);
  const capacity = Number($("capacity").value);
  const address = $("eventAddress").value.trim();
  const eventPassword = $("eventPassword").value;
  const staffPassword = $("staffPassword").value;

  if (!name || !address ||
      eventPassword.length < 4 || staffPassword.length < 4 ||
      !Number.isFinite(price) || price < 0 ||
      !Number.isSafeInteger(capacity) || capacity < 1) {
    showStatus("Enter a name, address, both passwords (at least 4 characters), non-negative price, and positive capacity.", true);
    return;
  }

  const createdEvent = {
    id: makeId(),
    name,
    price,
    capacity,
    address,
    eventPassword,
    staffPassword,
    date: $("eventDate").value || "",
    organizer: currentName() || "Organizer",
    createdAt: new Date().toISOString()
  };

  state.events.unshift(createdEvent);
  addHistory({
    type: "event_published",
    eventId: createdEvent.id,
    actor: createdEvent.organizer
  });

  $("eventForm").reset();
  persist();
  render();
  showStatus("Event published.");
});

$("bookTicket").addEventListener("click", () => {
  const event = getEvent($("bookingEvent").value);
  const owner = currentName();
  const role = $("role").value;
  const quantity = Number($("bookingQuantity").value);
  const password = $("bookingPassword").value;

  if (!event) return showStatus("Select an event first.", true);
  if (!owner) return showStatus("Enter and save your name before booking.", true);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return showStatus("Quantity must be a positive whole number.", true);
  }

  if (role === "organizer" && password !== event.eventPassword) {
    return showStatus("The event password is incorrect.", true);
  }
  if (role === "staff" && password !== event.staffPassword) {
    return showStatus("The staff password is incorrect.", true);
  }

  const remaining = event.capacity - bookedCount(event.id);
  if (quantity > remaining) {
    return showStatus(`Only ${remaining} place(s) remain for this event.`, true);
  }

  const price = role === "attendee" ? Number(event.price) : 0;
  const ticket = createTicket({ event, owner, role, quantity, price });

  $("bookingPassword").value = "";
  showStatus(
    role === "attendee"
      ? "Booking complete. Ticket code and QR generated."
      : `${role === "organizer" ? "Organizer" : "Staff"} password accepted. Free ticket generated.`
  );

  return ticket;
});

$("bookingEvent").addEventListener("change", () => {
  $("bookingPassword").value = "";
});

$("eventForm").addEventListener("input", () => {
  // Event form changes do not create or publish a ticket.
});

$("checkIn").addEventListener("click", handleCheckin);
$("syncQueue").addEventListener("click", processOfflineQueue);
$("refreshDashboard").addEventListener("click", renderDashboard);
$("dashboardEvent").addEventListener("change", renderDashboard);

$("scanEvent").addEventListener("click", () => startCameraScanner("event"));
$("scanTicket").addEventListener("click", () => startCameraScanner("ticket"));
$("stopScanner").addEventListener("click", stopScanner);

$("ticketImage").addEventListener("change", (event) => {
  scanImage(event.target.files && event.target.files[0], "ticket");
});

$("checkinEvent").addEventListener("change", () => {
  $("ticketCode").focus();
});

window.addEventListener("online", () => {
  showStatus("Back online. Processing queued check-ins.");
  processOfflineQueue();
});

window.addEventListener("offline", () => {
  showStatus("Offline: check-ins will be queued.");
  render();
});

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) refreshFromStorage();
});

if ("BroadcastChannel" in window) {
  const channel = new BroadcastChannel("team-f-ticketing");
  channel.addEventListener("message", refreshFromStorage);
}

window.addEventListener("beforeunload", stopScanner);
window.setInterval(refreshFromStorage, 3000);

render();
showStatus(navigator.onLine ? "Ready." : "Offline: check-ins will be queued.");

function createTicket({ event, owner, role, quantity, price }) {
  const ticket = {
    id: makeId(),
    code: "TKT-" + makeId().replace(/-/g, "").slice(0, 12).toUpperCase(),
    eventId: event.id,
    owner,
    role,
    quantity,
    price,
    total: price * quantity,
    createdAt: new Date().toISOString()
  };

  state.tickets.push(ticket);
  addHistory({
    type: "ticket_booked",
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: event.id,
    owner,
    role,
    quantity,
    total: ticket.total
  });

  persist();
  render();
  showTicketResult(ticket, event);
  return ticket;
}

function showTicketResult(ticket, event) {
  const result = $("bookingResult");
  result.replaceChildren();

  const summary = document.createElement("p");
  summary.textContent =
    `${ticket.role === "attendee" ? "Booking" : "Free entry"} confirmed for ` +
    `${ticket.quantity} person(s) at ${event.name}. Total: ${ticket.total.toFixed(2)}.`;

  const code = document.createElement("p");
  code.textContent = "Ticket code: " + ticket.code;

  const qr = document.createElement("div");
  qr.className = "qr";

  result.append(summary, code, qr);
  drawQr(qr, ticketQrValue(ticket.code));
}

function renderEvents() {
  const list = $("eventsList");
  const bookingSelect = $("bookingEvent");
  const checkinSelect = $("checkinEvent");
  const dashboardSelect = $("dashboardEvent");

  const oldBooking = bookingSelect.value;
  const oldCheckin = checkinSelect.value;
  const oldDashboard = dashboardSelect.value;

  list.replaceChildren();
  bookingSelect.replaceChildren();
  checkinSelect.replaceChildren();
  dashboardSelect.replaceChildren();

  addOption(checkinSelect, "", "Any event");
  addOption(dashboardSelect, "", "All events");

  if (!state.events.length) list.textContent = "No events have been published yet.";

  for (const event of state.events) {
    const optionText = `${event.name} — ${bookedCount(event.id)}/${event.capacity} booked`;
    addOption(bookingSelect, event.id, optionText);
    addOption(checkinSelect, event.id, event.name);
    addOption(dashboardSelect, event.id, event.name);

    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = event.name;

    const summary = document.createElement("p");
    summary.className = "muted";
    summary.textContent =
      `${Number(event.price).toFixed(2)} per person · ${bookedCount(event.id)}/${event.capacity} booked` +
      (event.date ? ` · ${new Date(event.date).toLocaleString()}` : "");

    const address = document.createElement("p");
    address.textContent = `Address: ${event.address}`;

    const details = document.createElement("div");
    details.className = "event-details";
    details.classList.toggle("hidden", !expandedEvents.has(event.id));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = expandedEvents.has(event.id) ? "Hide event details" : "View event details";
    toggle.addEventListener("click", () => {
      if (expandedEvents.has(event.id)) expandedEvents.delete(event.id);
      else expandedEvents.add(event.id);
      renderEvents();
    });

    if (expandedEvents.has(event.id)) {
      const eventCode = document.createElement("p");
      eventCode.textContent = `Event code: ${event.id}`;

      const qrLabel = document.createElement("p");
      qrLabel.textContent = "Scan this QR to select the event:";

      const qr = document.createElement("div");
      qr.className = "qr";
      details.append(eventCode, qrLabel, qr);
      drawQr(qr, eventQrValue(event.id));

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.textContent = "Select for booking";
      selectButton.addEventListener("click", () => {
        $("bookingEvent").value = event.id;
        $("bookingSection").scrollIntoView({ behavior: "smooth" });
      });
      details.append(selectButton);
    }

    card.append(title, summary, address, toggle, details);
    list.append(card);
  }

  if ([...bookingSelect.options].some((option) => option.value === oldBooking)) {
    bookingSelect.value = oldBooking;
  }
  if ([...checkinSelect.options].some((option) => option.value === oldCheckin)) {
    checkinSelect.value = oldCheckin;
  }
  if ([...dashboardSelect.options].some((option) => option.value === oldDashboard)) {
    dashboardSelect.value = oldDashboard;
  }
}

function renderMyTickets() {
  const list = $("myTickets");
  list.replaceChildren();

  const name = currentName().toLowerCase();
  if (!name) {
    list.textContent = "Enter and save your name to see your tickets.";
    return;
  }

  const tickets = state.tickets.filter((ticket) => ticket.owner.toLowerCase() === name);
  if (!tickets.length) {
    list.textContent = "No tickets under this name yet.";
    return;
  }

  for (const ticket of tickets) {
    const event = getEvent(ticket.eventId);
    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = event ? event.name : "Event";

    const details = document.createElement("p");
    details.textContent =
      `${ticket.role} entry · ${ticket.quantity} person(s) · ` +
      `${admittedCount(ticket.id)}/${ticket.quantity} checked in`;

    const code = document.createElement("p");
    code.textContent = "Ticket code: " + ticket.code;

    const qr = document.createElement("div");
    qr.className = "qr";
    qr.setAttribute("aria-label", "Ticket QR code");

    card.append(title, details, code, qr);
    list.append(card);
    drawQr(qr, ticketQrValue(ticket.code));
  }
}

function renderDashboard() {
  const dashboard = $("dashboard");
  dashboard.replaceChildren();

  const filterId = $("dashboardEvent").value;
  const events = filterId ? state.events.filter((event) => event.id === filterId) : state.events;

  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Publish an event to see attendance.";
    dashboard.append(empty);
  }

  for (const event of events) {
    const booked = bookedCount(event.id);
    const checkedIn = state.tickets
      .filter((ticket) => ticket.eventId === event.id)
      .reduce((sum, ticket) => sum + admittedCount(ticket.id), 0);

    const card = document.createElement("article");
    card.className = "card";

    const summary = document.createElement("p");
    summary.textContent =
      `${event.name}: ${booked}/${event.capacity} booked · ${checkedIn} checked in`;

    const progress = document.createElement("progress");
    progress.max = Math.max(Number(event.capacity), 1);
    progress.value = checkedIn;

    card.append(summary, progress);
    dashboard.append(card);
  }

  const historyHeading = document.createElement("h3");
  historyHeading.textContent = "Recent activity";
  dashboard.append(historyHeading);

  const history = state.history.filter(
    (entry) => !filterId || entry.eventId === filterId
  );

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No history to show yet.";
    dashboard.append(empty);
    return;
  }

  for (const entry of history.slice(0, 100)) {
    const item = document.createElement("div");
    item.className = "history-item";

    const event = getEvent(entry.eventId);
    const eventName = event ? event.name : "Event";
    const text = document.createElement("p");

    if (entry.type === "event_published") {
      text.textContent = `Published event: ${eventName}`;
    } else if (entry.type === "ticket_booked") {
      text.textContent =
        `${entry.owner} (${entry.role}) booked ${entry.quantity} place(s) for ${eventName} — ${entry.ticketCode}`;
    } else if (entry.type === "checked_in") {
      text.textContent =
        `${entry.actor} checked in ${entry.count} person(s) for ${eventName} — ${entry.ticketCode}`;
    } else if (entry.type === "checkin_queued") {
      text.textContent =
        `${entry.actor} queued check-in for ${eventName} — ${entry.ticketCode}`;
    } else {
      text.textContent = "Activity";
    }

    const time = document.createElement("small");
    time.className = "muted";
    time.textContent = new Date(entry.time).toLocaleString();
    item.append(text, time);
    dashboard.append(item);
  }
}

function render() {
  $("organizerSection").classList.toggle("hidden", $("role").value !== "organizer");

  if ($("role").value === "attendee") {
    $("bookingPassword").disabled = true;
    $("bookingPassword").value = "";
    $("bookingPassword").placeholder = "No password required";
    $("passwordHelp").textContent = "Select an event, enter quantity, and press Book ticket.";
    $("bookingPriceNote").textContent = "Attendee ticket price is displayed per person. No payment is processed.";
  } else if ($("role").value === "organizer") {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Event password";
    $("passwordHelp").textContent = "Organizer ticket is free; enter the event password to confirm.";
    $("bookingPriceNote").textContent = "Organizer tickets are free.";
  } else {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Staff password";
    $("passwordHelp").textContent = "Staff ticket is free; enter the staff password to confirm.";
    $("bookingPriceNote").textContent = "Staff tickets are free.";
  }

  renderEvents();
  renderMyTickets();
  renderDashboard();
  $("queueStatus").textContent =
    `${state.offlineQueue.length} pending check-in(s). ` +
    (navigator.onLine ? "Browser reports online." : "Browser reports offline.");
}

function processOfflineQueue() {
  if (!navigator.onLine) {
    $("checkinResult").textContent = "Browser is offline; scans remain queued.";
    return;
  }

  const selectedEvent = $("checkinEvent").value;
  const keep = [];
  const messages = [];

  for (const entry of state.offlineQueue) {
    if (selectedEvent && entry.eventId !== selectedEvent) {
      keep.push(entry);
      messages.push(`${entry.code}: still queued; select its event to process.`);
      continue;
    }

    const result = recordCheckin(entry.code, entry.count, entry.actor, entry.eventId);
    messages.push(`${entry.code}: ${result.message}`);

    if (!result.ok && !result.used && result.message !== "Ticket code not found.") {
      keep.push(entry);
    }
  }

  state.offlineQueue = keep;
  persist();
  render();
  $("checkinResult").textContent = messages.join("\n") || "No queued check-ins.";
}

async function startCameraScanner(mode) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus("Camera access requires localhost or HTTPS. Use image scanning or enter a code.", true);
    return;
  }

  try {
    const jsQR = await getQrScannerLibrary();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    const video = $("video");
    video.srcObject = cameraStream;
    $("scannerSection").classList.remove("hidden");
    $("scannerStatus").textContent = "Allow camera access, then point it at the QR code.";
    await video.play();
    scanning = true;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not initialize QR scanner.");

    const scanFrame = () => {
      if (!scanning) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 && video.videoHeight > 0) {
        const scale = Math.min(1, 1000 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(pixels.data, pixels.width, pixels.height, {
          inversionAttempts: "attemptBoth"
        });

        if (result && result.data) {
          stopScanner();
          parseQr(result.data, mode);
          return;
        }
      }

      if (scanning) scanFrameId = requestAnimationFrame(scanFrame);
    };

    scanFrameId = requestAnimationFrame(scanFrame);
  } catch (error) {
    stopScanner();
    showStatus(`Could not start scanner: ${error.message}. Try image scanning or enter the code.`, true);
  }
}

async function scanImage(file, mode) {
  if (!file) return;

  try {
    const jsQR = await getQrScannerLibrary();
    let source;

    if ("createImageBitmap" in window) {
      source = await createImageBitmap(file);
    } else {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Could not read the selected image."));
        };
        image.src = url;
      });
    }

    const scale = Math.min(1, 1600 / source.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not initialize image scanner.");

    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (typeof source.close === "function") source.close();

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: "attemptBoth"
    });

    if (!result || !result.data) {
      showStatus("No readable QR code found in that image.", true);
      return;
    }
    parseQr(result.data, mode);
  } catch (error) {
    showStatus("Could not scan image: " + error.message, true);
  } finally {
    $("ticketImage").value = "";
  }
}

function stopScanner() {
  scanning = false;
  if (scanFrameId !== null) {
    cancelAnimationFrame(scanFrameId);
    scanFrameId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  $("video").srcObject = null;
  $("scannerSection").classList.add("hidden");
}

function refreshFromStorage() {
  let latest;
  try {
    latest = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return;
  }

  if (!latest || (latest.revision || 0) === (state.revision || 0)) return;

  state = {
    ...emptyState(),
    ...latest,
    events: Array.isArray(latest.events) ? latest.events : [],
    tickets: Array.isArray(latest.tickets) ? latest.tickets : [],
    checkins: Array.isArray(latest.checkins) ? latest.checkins : [],
    history: Array.isArray(latest.history) ? latest.history : [],
    offlineQueue: Array.isArray(latest.offlineQueue) ? latest.offlineQueue : []
  };

  $("role").value = state.role;
  $("identity").value = state.identity;
  render();
}

function handleCheckin() {
  const code = $("ticketCode").value.trim();
  const count = Number($("admitCount").value);

  if (!code) {
    showCheckinResult({ ok: false, message: "Enter or scan a ticket code first." });
    return;
  }

  const result = checkIn(code, count);
  showCheckinResult(result);
  if (result.ok || result.queued) $("ticketCode").value = "";
}

function checkIn(code, count) {
  const ticket = getTicket(code);
  const actor = currentName() || $("role").value;
  const filter = $("checkinEvent").value;

  if (!ticket) return { ok: false, message: "Ticket code not found." };
  if (filter && filter !== ticket.eventId) {
    return { ok: false, message: "This ticket belongs to another event." };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, message: "Enter a positive whole number." };
  }

  if (!navigator.onLine) {
    state.offlineQueue.push({
      id: makeId(),
      code,
      count,
      actor,
      eventId: ticket.eventId,
      queuedAt: new Date().toISOString()
    });
    addHistory({
      type: "checkin_queued",
      ticketId: ticket.id,
      ticketCode: ticket.code,
      eventId: ticket.eventId,
      actor,
      count
    });
    persist();
    return { queued: true, message: "Offline: check-in queued for processing." };
  }

  return recordCheckin(code, count, actor, filter);
}

function recordCheckin(code, count, actor, eventFilter = "") {
  const ticket = getTicket(code);
  if (!ticket) return { ok: false, message: "Ticket code not found." };
  if (eventFilter && ticket.eventId !== eventFilter) {
    return { ok: false, message: "This ticket belongs to another event." };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, message: "Enter a positive whole number." };
  }

  const remaining = ticket.quantity - admittedCount(ticket.id);
  if (remaining <= 0) {
    return { ok: false, used: true, message: "All entries on this ticket have already been used." };
  }
  if (count > remaining) {
    return { ok: false, message: `Only ${remaining} admission(s) remain.` };
  }

  const entry = {
    id: makeId(),
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: ticket.eventId,
    actor,
    count,
    time: new Date().toISOString()
  };
  state.checkins.push(entry);
  state.history.unshift({ ...entry, type: "checked_in" });
  persist();

  return {
    ok: true,
    message: `Checked in ${count}. ${remaining - count} admission(s) remain.`
  };
}

function showCheckinResult(result) {
  $("checkinResult").textContent = result.message;
  $("checkinResult").className =
    "status " + (result.ok ? "good" : result.queued ? "muted" : "bad");
  render();
}

function parseQr(value, mode) {
  const [kind, ...parts] = String(value).trim().split("|");
  const payload = parts.join("|");

  if (mode === "event" && kind === "TEAMF-EVENT") {
    if (!getEvent(payload)) {
      showStatus("That event is not available in this browser.", true);
      return;
    }
    $("bookingEvent").value = payload;
    showStatus("Event selected. Press Book ticket when ready.");
    $("bookingSection").scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (mode === "ticket" && kind === "TEAMF-TICKET") {
    const ticket = getTicket(payload);
    if (!ticket) {
      showCheckinResult({ ok: false, message: "Ticket code not found." });
      return;
    }
    $("checkinEvent").value = ticket.eventId;
    $("ticketCode").value = payload;
    handleCheckin();
    return;
  }

  showStatus("QR code is not valid for this scan option.", true);
}

function showCheckinResult(result) {
  $("checkinResult").textContent = result.message;
  $("checkinResult").className =
    "status " + (result.ok ? "good" : result.queued ? "muted" : "bad");
  render();
}

function processOfflineQueue() {
  if (!navigator.onLine) {
    $("checkinResult").textContent = "Browser is offline; scans remain queued.";
    return;
  }

  const selected = $("checkinEvent").value;
  const keep = [];
  const messages = [];

  for (const queued of state.offlineQueue) {
    if (selected && queued.eventId !== selected) {
      keep.push(queued);
      messages.push(`${queued.code}: still queued; select its event.`);
      continue;
    }

    const result = recordCheckin(
      queued.code,
      queued.count,
      queued.actor,
      queued.eventId
    );
    messages.push(`${queued.code}: ${result.message}`);

    if (!result.ok && !result.used && result.message !== "Ticket code not found.") {
      keep.push(queued);
    }
  }

  state.offlineQueue = keep;
  persist();
  render();
  $("checkinResult").textContent = messages.join("\n") || "No queued check-ins.";
}

function createTicket({ event, owner, role, quantity, price }) {
  const ticket = {
    id: makeId(),
    code: "TKT-" + makeId().replace(/-/g, "").slice(0, 12).toUpperCase(),
    eventId: event.id,
    owner,
    role,
    quantity,
    price,
    total: price * quantity,
    createdAt: new Date().toISOString()
  };

  state.tickets.push(ticket);
  addHistory({
    type: "ticket_booked",
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: event.id,
    owner,
    role,
    quantity,
    total: ticket.total
  });

  persist();
  render();

  const result = $("bookingResult");
  result.replaceChildren();

  const summary = document.createElement("p");
  summary.textContent =
    `${role === "attendee" ? "Booking" : "Free entry"} confirmed for ` +
    `${quantity} person(s) at ${event.name}. Total: ${ticket.total.toFixed(2)}.`;

  const code = document.createElement("p");
  code.textContent = "Ticket code: " + ticket.code;

  const qr = document.createElement("div");
  qr.className = "qr";
  result.append(summary, code, qr);
  drawQr(qr, ticketQrValue(ticket.code));

  return ticket;
}

function addHistory(entry) {
  state.history.unshift({
    id: makeId(),
    time: new Date().toISOString(),
    ...entry
  });
}

function updateRoleUI() {
  const role = $("role").value;

  $("organizerSection").classList.toggle("hidden", role !== "organizer");

  if (role === "attendee") {
    $("bookingPassword").disabled = true;
    $("bookingPassword").value = "";
    $("bookingPassword").placeholder = "No password required";
    $("passwordHelp").textContent = "Choose an event and press Book ticket.";
    $("bookingPriceNote").textContent = "Attendee tickets are priced per person. No payment is processed.";
  } else if (role === "organizer") {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Event password";
    $("passwordHelp").textContent = "Organizer tickets are free; enter the event password to confirm.";
    $("bookingPriceNote").textContent = "Organizer tickets are free.";
  } else {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Staff password";
    $("passwordHelp").textContent = "Staff tickets are free; enter the staff password to confirm.";
    $("bookingPriceNote").textContent = "Staff tickets are free.";
  }
}

function addOption(select, value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  select.append(option);
}

function renderEvents() {
  const list = $("eventsList");
  const booking = $("bookingEvent");
  const checkin = $("checkinEvent");
  const dashboardSelect = $("dashboardEvent");

  const previous = {
    booking: booking.value,
    checkin: checkin.value,
    dashboard: dashboardSelect.value
  };

  list.replaceChildren();
  booking.replaceChildren();
  checkin.replaceChildren();
  dashboardSelect.replaceChildren();

  addOption(checkin, "", "Any event");
  addOption(dashboardSelect, "", "All events");

  if (!state.events.length) list.textContent = "No events have been published yet.";

  for (const event of state.events) {
    const optionText = `${event.name} — ${bookedCount(event.id)}/${event.capacity} booked`;
    addOption(booking, event.id, optionText);
    addOption(checkin, event.id, event.name);
    addOption(dashboardSelect, event.id, event.name);

    const card = document.createElement("article");
    card.className = "card";

    const heading = document.createElement("h3");
    heading.textContent = event.name;

    const summary = document.createElement("p");
    summary.className = "muted";
    summary.textContent =
      `${Number(event.price).toFixed(2)} per person · ${bookedCount(event.id)}/${event.capacity} booked` +
      (event.date ? ` · ${new Date(event.date).toLocaleString()}` : "");

    const address = document.createElement("p");
    address.textContent = `Address: ${event.address}`;

    const details = document.createElement("div");
    details.className = "event-details";
    details.classList.toggle("hidden", !expandedEvents.has(event.id));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = expandedEvents.has(event.id) ? "Hide event details" : "View event details";
    toggle.addEventListener("click", () => {
      if (expandedEvents.has(event.id)) expandedEvents.delete(event.id);
      else expandedEvents.add(event.id);
      renderEvents();
    });

    if (expandedEvents.has(event.id)) {
      const code = document.createElement("p");
      code.textContent = `Event code: ${event.id}`;

      const label = document.createElement("p");
      label.textContent = "Scan to select this event:";

      const qr = document.createElement("div");
      qr.className = "qr";
      details.append(code, label, qr);
      drawQr(qr, eventQrValue(event.id));

      const select = document.createElement("button");
      select.type = "button";
      select.textContent = "Select for booking";
      select.addEventListener("click", () => {
        $("bookingEvent").value = event.id;
        $("bookingSection").scrollIntoView({ behavior: "smooth" });
      });
      details.append(select);
    }

    card.append(heading, summary, address, toggle, details);
    list.append(card);
  }

  if ([...booking.options].some((option) => option.value === previous.booking)) {
    booking.value = previous.booking;
  }
  if ([...checkin.options].some((option) => option.value === previous.checkin)) {
    checkin.value = previous.checkin;
  }
  if ([...dashboardSelect.options].some((option) => option.value === previous.dashboard)) {
    dashboardSelect.value = previous.dashboard;
  }
}

function renderMyTickets() {
  const list = $("myTickets");
  list.replaceChildren();

  const name = currentName().toLowerCase();
  if (!name) {
    list.textContent = "Enter and save your name to see your tickets.";
    return;
  }

  const tickets = state.tickets.filter((ticket) => ticket.owner.toLowerCase() === name);
  if (!tickets.length) {
    list.textContent = "No tickets under this name yet.";
    return;
  }

  for (const ticket of tickets) {
    const event = getEvent(ticket.eventId);
    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = event ? event.name : "Event";

    const description = document.createElement("p");
    description.textContent =
      `${ticket.role} entry · ${ticket.quantity} person(s) · ` +
      `${admittedCount(ticket.id)}/${ticket.quantity} checked in`;

    const code = document.createElement("p");
    code.textContent = "Ticket code: " + ticket.code;

    const qr = document.createElement("div");
    qr.className = "qr";
    qr.setAttribute("aria-label", "Ticket QR code");

    card.append(title, description, code, qr);
    list.append(card);
    drawQr(qr, ticketQrValue(ticket.code));
  }
}

function renderDashboard() {
  const dashboard = $("dashboard");
  dashboard.replaceChildren();

  const eventFilter = $("dashboardEvent").value;
  const events = eventFilter
    ? state.events.filter((event) => event.id === eventFilter)
    : state.events;

  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Publish an event to see attendance.";
    dashboard.append(empty);
  }

  for (const event of events) {
    const booked = bookedCount(event.id);
    const admitted = state.tickets
      .filter((ticket) => ticket.eventId === event.id)
      .reduce((sum, ticket) => sum + admittedCount(ticket.id), 0);

    const card = document.createElement("article");
    card.className = "card";

    const text = document.createElement("p");
    text.textContent =
      `${event.name}: ${booked}/${event.capacity} booked · ${admitted} checked in`;

    const progress = document.createElement("progress");
    progress.max = Math.max(Number(event.capacity), 1);
    progress.value = admitted;

    card.append(text, progress);
    dashboard.append(card);
  }

  const heading = document.createElement("h3");
  heading.textContent = "Recent activity";
  dashboard.append(heading);

  const history = state.history.filter(
    (entry) => !eventFilter || entry.eventId === eventFilter
  );

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No history to show yet.";
    dashboard.append(empty);
    return;
  }

  for (const entry of history.slice(0, 100)) {
    const item = document.createElement("div");
    item.className = "history-item";

    const event = getEvent(entry.eventId);
    const eventName = event ? event.name : "Event";
    const description = document.createElement("p");

    if (entry.type === "event_published") {
      description.textContent = `Published event: ${eventName}`;
    } else if (entry.type === "ticket_booked") {
      description.textContent =
        `${entry.owner} (${entry.role}) booked ${entry.quantity} place(s) for ${eventName} — ${entry.ticketCode}`;
    } else if (entry.type === "checked_in") {
      description.textContent =
        `${entry.actor} checked in ${entry.count} person(s) for ${eventName} — ${entry.ticketCode}`;
    } else if (entry.type === "checkin_queued") {
      description.textContent =
        `${entry.actor} queued check-in for ${eventName} — ${entry.ticketCode}`;
    } else {
      description.textContent = "Activity";
    }

    const time = document.createElement("small");
    time.className = "muted";
    time.textContent = new Date(entry.time).toLocaleString();

    item.append(description, time);
    dashboard.append(item);
  }
}

function render() {
  updateRoleUI();
  renderEvents();
  renderMyTickets();
  renderDashboard();

  $("queueStatus").textContent =
    `${state.offlineQueue.length} pending check-in(s). ` +
    (navigator.onLine ? "Browser reports online." : "Browser reports offline.");
}

function refreshFromStorage() {
  let latest;
  try {
    latest = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return;
  }

  if (!latest || (latest.revision || 0) === (state.revision || 0)) return;

  state = {
    ...emptyState(),
    ...latest,
    events: Array.isArray(latest.events) ? latest.events : [],
    tickets: Array.isArray(latest.tickets) ? latest.tickets : [],
    checkins: Array.isArray(latest.checkins) ? latest.checkins : [],
    history: Array.isArray(latest.history) ? latest.history : [],
    offlineQueue: Array.isArray(latest.offlineQueue) ? latest.offlineQueue : []
  };

  $("role").value = state.role;
  $("identity").value = state.identity;
  render();
}

function bookingPasswordMatches(event, role, password) {
  if (role === "attendee") return true;
  if (role === "organizer") return password === event.eventPassword;
  if (role === "staff") return password === event.staffPassword;
  return false;
}

function createTicket({ event, owner, role, quantity, price }) {
  const ticket = {
    id: makeId(),
    code: "TKT-" + makeId().replace(/-/g, "").slice(0, 12).toUpperCase(),
    eventId: event.id,
    owner,
    role,
    quantity,
    price,
    total: price * quantity,
    createdAt: new Date().toISOString()
  };

  state.tickets.push(ticket);
  addHistory({
    type: "ticket_booked",
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: event.id,
    owner,
    role,
    quantity,
    total: ticket.total
  });

  persist();
  render();

  const result = $("bookingResult");
  result.replaceChildren();

  const message = document.createElement("p");
  message.textContent =
    `${role === "attendee" ? "Booking" : "Free entry"} confirmed for ` +
    `${quantity} person(s) at ${event.name}. Total: ${ticket.total.toFixed(2)}.`;

  const code = document.createElement("p");
  code.textContent = "Ticket code: " + ticket.code;

  const qr = document.createElement("div");
  qr.className = "qr";
  result.append(message, code, qr);
  drawQr(qr, ticketQrValue(ticket.code));

  return ticket;
}

function recordCheckin(code, count, actor, eventFilter = "") {
  const ticket = getTicket(code);
  if (!ticket) return { ok: false, message: "Ticket code not found." };

  if (eventFilter && ticket.eventId !== eventFilter) {
    return { ok: false, message: "This ticket belongs to a different event." };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, message: "Enter a positive whole number of people." };
  }

  const remaining = ticket.quantity - admittedCount(ticket.id);
  if (remaining <= 0) {
    return { ok: false, used: true, message: "All entries on this ticket have already been used." };
  }
  if (count > remaining) {
    return { ok: false, message: `Only ${remaining} admission(s) remain on this ticket.` };
  }

  const entry = {
    id: makeId(),
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: ticket.eventId,
    actor,
    count,
    time: new Date().toISOString()
  };

  state.checkins.push(entry);
  state.history.unshift({ ...entry, type: "checked_in" });
  persist();

  return {
    ok: true,
    message: `Checked in ${count}. ${remaining - count} admission(s) remain.`
  };
}

function checkIn(code, count) {
  const ticket = getTicket(code);
  const actor = currentName() || $("role").value;
  const filter = $("checkinEvent").value;

  if (!ticket) return { ok: false, message: "Ticket code not found." };
  if (filter && ticket.eventId !== filter) {
    return { ok: false, message: "This ticket belongs to another event." };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, message: "Enter a positive whole number." };
  }

  if (!navigator.onLine) {
    const queuedAt = new Date().toISOString();
    state.offlineQueue.push({
      id: makeId(),
      code,
      count,
      actor,
      eventId: ticket.eventId,
      queuedAt
    });

    state.history.unshift({
      id: makeId(),
      type: "checkin_queued",
      ticketId: ticket.id,
      ticketCode: ticket.code,
      eventId: ticket.eventId,
      actor,
      count,
      time: queuedAt
    });

    persist();
    return { queued: true, message: "Offline: check-in queued." };
  }

  return recordCheckin(code, count, actor, filter);
}

function showCheckinResult(result) {
  $("checkinResult").textContent = result.message;
  $("checkinResult").className =
    "status " + (result.ok ? "good" : result.queued ? "muted" : "bad");
  render();
}

function handleCheckin() {
  const code = $("ticketCode").value.trim();
  const count = Number($("admitCount").value);

  if (!code) {
    showCheckinResult({ ok: false, message: "Enter or scan a ticket code first." });
    return;
  }

  const result = checkIn(code, count);
  showCheckinResult(result);
  if (result.ok || result.queued) $("ticketCode").value = "";
}

function processOfflineQueue() {
  if (!navigator.onLine) {
    $("checkinResult").textContent = "Browser is offline; scans remain queued.";
    return;
  }

  const selectedEvent = $("checkinEvent").value;
  const keep = [];
  const messages = [];

  for (const queued of state.offlineQueue) {
    if (selectedEvent && queued.eventId !== selectedEvent) {
      keep.push(queued);
      messages.push(`${queued.code}: still queued; select its event.`);
      continue;
    }

    const result = recordCheckin(
      queued.code,
      queued.count,
      queued.actor,
      queued.eventId
    );
    messages.push(`${queued.code}: ${result.message}`);

    if (!result.ok && !result.used && result.message !== "Ticket code not found.") {
      keep.push(queued);
    }
  }

  state.offlineQueue = keep;
  persist();
  render();
  $("checkinResult").textContent = messages.join("\n") || "No queued check-ins.";
}

function parseQr(value, mode) {
  const [kind, ...parts] = String(value).trim().split("|");
  const payload = parts.join("|");

  if (mode === "event" && kind === "TEAMF-EVENT") {
    if (!getEvent(payload)) {
      showStatus("That event is not available in this browser.", true);
      return;
    }
    $("bookingEvent").value = payload;
    showStatus("Event selected. Press Book ticket when ready.");
    $("bookingSection").scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (mode === "ticket" && kind === "TEAMF-TICKET") {
    const ticket = getTicket(payload);
    if (!ticket) {
      showCheckinResult({ ok: false, message: "Ticket code not found." });
      return;
    }
    $("checkinEvent").value = ticket.eventId;
    $("ticketCode").value = payload;
    handleCheckin();
    return;
  }

  showStatus("QR code is not valid for this scan option.", true);
}

async function startCameraScanner(mode) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus("Camera access requires localhost or HTTPS. Use image scanning or enter the code.", true);
    return;
  }

  try {
    const jsQR = await getQrScannerLibrary();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    const video = $("video");
    video.srcObject = cameraStream;
    $("scannerSection").classList.remove("hidden");
    $("scannerStatus").textContent = "Allow camera access, then point it at the QR code.";
    await video.play();
    scanning = true;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not initialize QR scanner.");

    const scanFrame = () => {
      if (!scanning) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 && video.videoHeight > 0) {
        const scale = Math.min(1, 1000 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(pixels.data, pixels.width, pixels.height, {
          inversionAttempts: "attemptBoth"
        });

        if (result && result.data) {
          stopScanner();
          parseQr(result.data, mode);
          return;
        }
      }

      if (scanning) scanFrameId = requestAnimationFrame(scanFrame);
    };

    scanFrameId = requestAnimationFrame(scanFrame);
  } catch (error) {
    stopScanner();
    showStatus(`Could not start scanner: ${error.message}. Try image scanning or enter the code.`, true);
  }
}

async function scanImage(file, mode) {
  if (!file) return;

  try {
    const jsQR = await getQrScannerLibrary();
    let source;

    if ("createImageBitmap" in window) {
      source = await createImageBitmap(file);
    } else {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Could not read the selected image."));
        };
        image.src = url;
      });
    }

    const scale = Math.min(1, 1600 / source.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not initialize image scanner.");

    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (typeof source.close === "function") source.close();

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: "attemptBoth"
    });

    if (!result || !result.data) {
      showStatus("No readable QR code found in that image.", true);
      return;
    }
    parseQr(result.data, mode);
  } catch (error) {
    showStatus("Could not scan image: " + error.message, true);
  } finally {
    $("ticketImage").value = "";
  }
}

function stopScanner() {
  scanning = false;
  if (scanFrameId !== null) {
    cancelAnimationFrame(scanFrameId);
    scanFrameId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  $("video").srcObject = null;
  $("scannerSection").classList.add("hidden");
}

function refreshFromStorage() {
  let latest;
  try {
    latest = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return;
  }

  if (!latest || (latest.revision || 0) === (state.revision || 0)) return;

  state = {
    ...emptyState(),
    ...latest,
    events: Array.isArray(latest.events) ? latest.events : [],
    tickets: Array.isArray(latest.tickets) ? latest.tickets : [],
    checkins: Array.isArray(latest.checkins) ? latest.checkins : [],
    history: Array.isArray(latest.history) ? latest.history : [],
    offlineQueue: Array.isArray(latest.offlineQueue) ? latest.offlineQueue : []
  };

  $("role").value = state.role;
  $("identity").value = state.identity;
  render();
}

function currentName() {
  return $("identity").value.trim();
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function getEvent(id) {
  return state.events.find((event) => event.id === id);
}

function getTicket(code) {
  return state.tickets.find((ticket) => ticket.code === code);
}

function bookedCount(eventId) {
  return state.tickets
    .filter((ticket) => ticket.eventId === eventId)
    .reduce((sum, ticket) => sum + ticket.quantity, 0);
}

function admittedCount(ticketId) {
  return state.checkins
    .filter((entry) => entry.ticketId === ticketId)
    .reduce((sum, entry) => sum + entry.count, 0);
}

function loadExternalScript(url, globalName, promiseName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (window[promiseName]) return window[promiseName];

  window[promiseName] = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      if (window[globalName]) resolve(window[globalName]);
      else reject(new Error(`${globalName} library failed to initialize`));
    };
    script.onerror = () => {
      window[promiseName] = null;
      reject(new Error("Could not load QR library. Check your internet connection."));
    };
    document.head.append(script);
  });

  return window[promiseName];
}

function getQrCodeLibrary() {
  if (!qrCodePromise) {
    qrCodePromise = loadExternalScript(
      QR_CODE_LIBRARY,
      "QRCode",
      "__teamfQrCodePromise"
    ).catch((error) => {
      qrCodePromise = null;
      throw error;
    });
  }
  return qrCodePromise;
}

function getQrScannerLibrary() {
  if (!qrScannerPromise) {
    qrScannerPromise = loadExternalScript(
      QR_SCAN_LIBRARY,
      "jsQR",
      "__teamfQrScannerPromise"
    ).catch((error) => {
      qrScannerPromise = null;
      throw error;
    });
  }
  return qrScannerPromise;
}

async function drawQr(container, value) {
  container.replaceChildren();
  container.className = "qr";
  try {
    const QRCode = await getQrCodeLibrary();
    if (!container.isConnected) return;
    new QRCode(container, {
      text: value,
      width: 160,
      height: 160,
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (error) {
    container.textContent = "QR unavailable: " + error.message;
  }
}

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function eventQrValue(eventId) {
  return "TEAMF-EVENT|" + eventId;
}

function ticketQrValue(code) {
  return "TEAMF-TICKET|" + code;
}

function renderEvents() {
  const list = $("eventsList");
  const bookingSelect = $("bookingEvent");
  const checkinSelect = $("checkinEvent");
  const dashboardSelect = $("dashboardEvent");

  const oldBooking = bookingSelect.value;
  const oldCheckin = checkinSelect.value;
  const oldDashboard = dashboardSelect.value;

  list.replaceChildren();
  bookingSelect.replaceChildren();
  checkinSelect.replaceChildren();
  dashboardSelect.replaceChildren();

  addOption(checkinSelect, "", "Any event");
  addOption(dashboardSelect, "", "All events");

  if (!state.events.length) list.textContent = "No events have been published yet.";

  for (const event of state.events) {
    const sold = bookedCount(event.id);
    const optionText = `${event.name} — ${sold}/${event.capacity} booked`;

    addOption(bookingSelect, event.id, optionText);
    addOption(checkinSelect, event.id, event.name);
    addOption(dashboardSelect, event.id, event.name);

    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = event.name;

    const info = document.createElement("p");
    info.className = "muted";
    info.textContent =
      `${Number(event.price).toFixed(2)} per person · ${sold}/${event.capacity} booked` +
      (event.date ? ` · ${new Date(event.date).toLocaleString()}` : "");

    const address = document.createElement("p");
    address.textContent = `Address: ${event.address}`;

    const details = document.createElement("div");
    details.className = "event-details";
    details.classList.toggle("hidden", !expandedEvents.has(event.id));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = expandedEvents.has(event.id)
      ? "Hide event details"
      : "View event details";
    toggle.addEventListener("click", () => {
      if (expandedEvents.has(event.id)) expandedEvents.delete(event.id);
      else expandedEvents.add(event.id);
      renderEvents();
    });

    if (expandedEvents.has(event.id)) {
      const code = document.createElement("p");
      code.textContent = `Event code: ${event.id}`;

      const qrLabel = document.createElement("p");
      qrLabel.textContent = "Scan this QR to select this event:";

      const qr = document.createElement("div");
      qr.className = "qr";
      details.append(code, qrLabel, qr);
      drawQr(qr, eventQrValue(event.id));

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.textContent = "Select for booking";
      selectButton.addEventListener("click", () => {
        $("bookingEvent").value = event.id;
        $("bookingSection").scrollIntoView({ behavior: "smooth" });
      });
      details.append(selectButton);
    }

    card.append(title, info, address, toggle, details);
    list.append(card);
  }

  if ([...bookingSelect.options].some((option) => option.value === oldBooking)) {
    bookingSelect.value = oldBooking;
  }
  if ([...checkinSelect.options].some((option) => option.value === oldCheckin)) {
    checkinSelect.value = oldCheckin;
  }
  if ([...dashboardSelect.options].some((option) => option.value === oldDashboard)) {
    dashboardSelect.value = oldDashboard;
  }
}

function renderMyTickets() {
  const list = $("myTickets");
  list.replaceChildren();

  const name = currentName().toLowerCase();
  if (!name) {
    list.textContent = "Enter and save your name to see your tickets.";
    return;
  }

  const tickets = state.tickets.filter(
    (ticket) => ticket.owner.toLowerCase() === name
  );

  if (!tickets.length) {
    list.textContent = "No tickets under this name yet.";
    return;
  }

  for (const ticket of tickets) {
    const event = getEvent(ticket.eventId);
    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = event ? event.name : "Event";

    const details = document.createElement("p");
    details.textContent =
      `${ticket.role} entry · ${ticket.quantity} person(s) · ` +
      `${admittedCount(ticket.id)}/${ticket.quantity} checked in`;

    const code = document.createElement("p");
    code.textContent = "Ticket code: " + ticket.code;

    const qr = document.createElement("div");
    qr.className = "qr";
    qr.setAttribute("aria-label", "Ticket QR code");

    card.append(title, details, code, qr);
    list.append(card);
    drawQr(qr, ticketQrValue(ticket.code));
  }
}

function renderDashboard() {
  const dashboard = $("dashboard");
  dashboard.replaceChildren();

  const eventFilter = $("dashboardEvent").value;
  const events = eventFilter
    ? state.events.filter((event) => event.id === eventFilter)
    : state.events;

  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Publish an event to see attendance.";
    dashboard.append(empty);
  }

  for (const event of events) {
    const booked = bookedCount(event.id);
    const checkedIn = state.tickets
      .filter((ticket) => ticket.eventId === event.id)
      .reduce((sum, ticket) => sum + admittedCount(ticket.id), 0);

    const card = document.createElement("article");
    card.className = "card";

    const text = document.createElement("p");
    text.textContent =
      `${event.name}: ${booked}/${event.capacity} booked · ${checkedIn} checked in`;

    const progress = document.createElement("progress");
    progress.max = Math.max(Number(event.capacity), 1);
    progress.value = checkedIn;

    card.append(text, progress);
    dashboard.append(card);
  }

  const heading = document.createElement("h3");
  heading.textContent = "Recent activity";
  dashboard.append(heading);

  const history = state.history.filter(
    (entry) => !eventFilter || entry.eventId === eventFilter
  );

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No history to show yet.";
    dashboard.append(empty);
    return;
  }

  for (const entry of history.slice(0, 100)) {
    const item = document.createElement("div");
    item.className = "history-item";
    const event = getEvent(entry.eventId);
    const eventName = event ? event.name : "Event";
    const text = document.createElement("p");

    if (entry.type === "event_published") {
      text.textContent = `Published event: ${eventName}`;
    } else if (entry.type === "ticket_booked") {
      text.textContent =
        `${entry.owner} (${entry.role}) booked ${entry.quantity} place(s) for ${eventName} — ${entry.ticketCode}`;
    } else if (entry.type === "checked_in") {
      text.textContent =
        `${entry.actor} checked in ${entry.count} person(s) for ${eventName} — ${entry.ticketCode}`;
    } else if (entry.type === "checkin_queued") {
      text.textContent =
        `${entry.actor} queued check-in for ${eventName} — ${entry.ticketCode}`;
    } else {
      text.textContent = "Activity";
    }

    const time = document.createElement("small");
    time.className = "muted";
    time.textContent = new Date(entry.time).toLocaleString();
    item.append(text, time);
    dashboard.append(item);
  }
}

function render() {
  updateRoleUI();
  renderEvents();
  renderMyTickets();
  renderDashboard();
  $("queueStatus").textContent =
    `${state.offlineQueue.length} pending check-in(s). ` +
    (navigator.onLine ? "Browser reports online." : "Browser reports offline.");
}

function updateRoleUI() {
  const role = $("role").value;

  $("organizerSection").classList.toggle("hidden", role !== "organizer");

  if (role === "attendee") {
    $("bookingPassword").disabled = true;
    $("bookingPassword").value = "";
    $("bookingPassword").placeholder = "No password required";
    $("passwordHelp").textContent = "Select an event and press Book ticket.";
    $("bookingPriceNote").textContent =
      "Attendee tickets use the event price. No payment is processed.";
  } else if (role === "organizer") {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Event password";
    $("passwordHelp").textContent =
      "Organizer tickets are free. Enter this event's event password to book.";
    $("bookingPriceNote").textContent = "Organizer tickets are free.";
  } else {
    $("bookingPassword").disabled = false;
    $("bookingPassword").placeholder = "Staff password";
    $("passwordHelp").textContent =
      "Staff tickets are free. Enter this event's staff password to book.";
    $("bookingPriceNote").textContent = "Staff tickets are free.";
  }
}

function bookTicket() {
  const event = getEvent($("bookingEvent").value);
  const owner = currentName();
  const role = $("role").value;
  const quantity = Number($("bookingQuantity").value);
  const password = $("bookingPassword").value;

  if (!event) return showStatus("Select an event first.", true);
  if (!owner) return showStatus("Enter and save your name before booking.", true);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return showStatus("Quantity must be a positive whole number.", true);
  }

  if (role === "organizer" && password !== event.eventPassword) {
    return showStatus("The event password is incorrect.", true);
  }
  if (role === "staff" && password !== event.staffPassword) {
    return showStatus("The staff password is incorrect.", true);
  }

  const remaining = event.capacity - bookedCount(event.id);
  if (quantity > remaining) {
    return showStatus(`Only ${remaining} place(s) remain for this event.`, true);
  }

  const price = role === "attendee" ? Number(event.price) : 0;
  createTicket({ event, owner, role, quantity, price });
  $("bookingPassword").value = "";
  showStatus(
    role === "attendee"
      ? "Booking complete. Ticket code and QR generated."
      : `${role === "organizer" ? "Event" : "Staff"} password accepted. Free ticket generated.`
  );
}

function showCheckinResult(result) {
  $("checkinResult").textContent = result.message;
  $("checkinResult").className =
    "status " + (result.ok ? "good" : result.queued ? "muted" : "bad");
  render();
}

function handleCheckin() {
  const code = $("ticketCode").value.trim();
  const count = Number($("admitCount").value);

  if (!code) {
    showCheckinResult({ ok: false, message: "Enter or scan a ticket code first." });
    return;
  }

  const result = checkIn(code, count);
  showCheckinResult(result);
  if (result.ok || result.queued) $("ticketCode").value = "";
}

function checkIn(code, count) {
  const ticket = getTicket(code);
  const actor = currentName() || $("role").value;
  const eventFilter = $("checkinEvent").value;

  if (!ticket) return { ok: false, message: "Ticket code not found." };
  if (eventFilter && ticket.eventId !== eventFilter) {
    return { ok: false, message: "This ticket belongs to a different event." };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, message: "Enter a positive whole number of people." };
  }

  if (!navigator.onLine) {
    const queuedAt = new Date().toISOString();
    state.offlineQueue.push({
      id: makeId(),
      code,
      count,
      actor,
      eventId: ticket.eventId,
      queuedAt
    });
    addHistory({
      type: "checkin_queued",
      ticketId: ticket.id,
      ticketCode: ticket.code,
      eventId: ticket.eventId,
      actor,
      count
    });
    persist();
    return { queued: true, message: "Offline: check-in queued for processing." };
  }

  return recordCheckin(code, count, actor, eventFilter);
}

function recordCheckin(code, count, actor, eventFilter = "") {
  const ticket = getTicket(code);
  if (!ticket) return { ok: false, message: "Ticket code not found." };
  if (eventFilter && ticket.eventId !== eventFilter) {
    return { ok: false, message: "This ticket belongs to a different event." };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, message: "Enter a positive whole number of people." };
  }

  const remaining = ticket.quantity - admittedCount(ticket.id);
  if (remaining <= 0) {
    return { ok: false, used: true, message: "All entries on this ticket have already been used." };
  }
  if (count > remaining) {
    return { ok: false, message: `Only ${remaining} admission(s) remain on this ticket.` };
  }

  const entry = {
    id: makeId(),
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: ticket.eventId,
    actor,
    count,
    time: new Date().toISOString()
  };
  state.checkins.push(entry);
  state.history.unshift({ ...entry, type: "checked_in" });
  persist();

  return {
    ok: true,
    message: `Checked in ${count}. ${remaining - count} admission(s) remain.`
  };
}

function processOfflineQueue() {
  if (!navigator.onLine) {
    $("checkinResult").textContent = "Browser is offline; scans remain queued.";
    return;
  }

  const selectedEvent = $("checkinEvent").value;
  const keep = [];
  const messages = [];

  for (const item of state.offlineQueue) {
    if (selectedEvent && item.eventId !== selectedEvent) {
      keep.push(item);
      messages.push(`${item.code}: still queued; select its event.`);
      continue;
    }

    const result = recordCheckin(item.code, item.count, item.actor, item.eventId);
    messages.push(`${item.code}: ${result.message}`);

    if (!result.ok && !result.used && result.message !== "Ticket code not found.") {
      keep.push(item);
    }
  }

  state.offlineQueue = keep;
  persist();
  render();
  $("checkinResult").textContent = messages.join("\n") || "No queued check-ins.";
}

function createTicket({ event, owner, role, quantity, price }) {
  const ticket = {
    id: makeId(),
    code: "TKT-" + makeId().replace(/-/g, "").slice(0, 12).toUpperCase(),
    eventId: event.id,
    owner,
    role,
    quantity,
    price,
    total: price * quantity,
    createdAt: new Date().toISOString()
  };

  state.tickets.push(ticket);
  addHistory({
    type: "ticket_booked",
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: event.id,
    owner,
    role,
    quantity,
    total: ticket.total
  });

  persist();
  render();

  const result = $("bookingResult");
  result.replaceChildren();

  const message = document.createElement("p");
  message.textContent =
    `${role === "attendee" ? "Booking" : "Free entry"} confirmed for ` +
    `${quantity} person(s) at ${event.name}. Total: ${ticket.total.toFixed(2)}.`;

  const code = document.createElement("p");
  code.textContent = "Ticket code: " + ticket.code;

  const qr = document.createElement("div");
  qr.className = "qr";
  result.append(message, code, qr);
  drawQr(qr, ticketQrValue(ticket.code));

  return ticket;
}

function addHistory(entry) {
  state.history.unshift({
    id: makeId(),
    time: new Date().toISOString(),
    ...entry
  });
}

function parseQr(value, mode) {
  const [kind, ...parts] = String(value).trim().split("|");
  const payload = parts.join("|");

  if (mode === "event" && kind === "TEAMF-EVENT") {
    if (!getEvent(payload)) {
      showStatus("That event is not available in this browser.", true);
      return;
    }
    $("bookingEvent").value = payload;
    showStatus("Event selected. Press Book ticket to create a ticket.");
    $("bookingSection").scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (mode === "ticket" && kind === "TEAMF-TICKET") {
    const ticket = getTicket(payload);
    if (!ticket) {
      showCheckinResult({ ok: false, message: "Ticket code not found." });
      return;
    }
    $("checkinEvent").value = ticket.eventId;
    $("ticketCode").value = payload;
    handleCheckin();
    return;
  }

  showStatus("QR code is not valid for this scan option.", true);
}

function loadQrLibrary(url, globalName, promiseName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (window[promiseName]) return window[promiseName];

  window[promiseName] = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      if (window[globalName]) resolve(window[globalName]);
      else reject(new Error(`${globalName} library failed to initialize`));
    };
    script.onerror = () => {
      window[promiseName] = null;
      reject(new Error("Could not load QR library. Check your internet connection."));
    };
    document.head.append(script);
  });

  return window[promiseName];
}

function getQrCodeLibrary() {
  if (!qrCodePromise) {
    qrCodePromise = loadQrLibrary(
      QR_CODE_LIBRARY,
      "QRCode",
      "__teamfQrCodePromise"
    ).catch((error) => {
      qrCodePromise = null;
      throw error;
    });
  }
  return qrCodePromise;
}

function getQrScannerLibrary() {
  if (!qrScannerPromise) {
    qrScannerPromise = loadQrLibrary(
      QR_SCAN_LIBRARY,
      "jsQR",
      "__teamfJsQrPromise"
    ).catch((error) => {
      qrScannerPromise = null;
      throw error;
    });
  }
  return qrScannerPromise;
}

async function drawQr(container, value) {
  container.replaceChildren();
  container.className = "qr";

  try {
    const QRCode = await getQrCodeLibrary();
    if (!container.isConnected) return;
    new QRCode(container, {
      text: value,
      width: 160,
      height: 160,
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (error) {
    container.textContent = "QR unavailable: " + error.message;
  }
}

async function startCameraScanner(mode) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus("Camera access requires localhost or HTTPS. Upload a QR image or enter the code.", true);
    return;
  }

  try {
    const jsQR = await getQrScannerLibrary();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    const video = $("video");
    video.srcObject = cameraStream;
    $("scannerSection").classList.remove("hidden");
    $("scannerStatus").textContent = "Allow camera access, then point it at the QR code.";
    await video.play();
    scanning = true;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not initialize QR scanner.");

    const frame = () => {
      if (!scanning) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 && video.videoHeight > 0) {
        const scale = Math.min(1, 1000 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(pixels.data, pixels.width, pixels.height, {
          inversionAttempts: "attemptBoth"
        });

        if (result && result.data) {
          stopScanner();
          parseQr(result.data, mode);
          return;
        }
      }

      if (scanning) scanFrameId = requestAnimationFrame(frame);
    };

    scanFrameId = requestAnimationFrame(frame);
  } catch (error) {
    stopScanner();
    showStatus(`Could not start scanner: ${error.message}. Try image scanning or enter the code.`, true);
  }
}

async function scanImage(file, mode) {
  if (!file) return;

  try {
    const jsQR = await getQrScannerLibrary();
    let source;

    if ("createImageBitmap" in window) {
      source = await createImageBitmap(file);
    } else {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Could not read the selected image."));
        };
        image.src = url;
      });
    }

    const scale = Math.min(1, 1600 / source.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not initialize image scanner.");

    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (typeof source.close === "function") source.close();

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: "attemptBoth"
    });

    if (!result || !result.data) {
      showStatus("No readable QR code found in that image.", true);
      return;
    }
    parseQr(result.data, mode);
  } catch (error) {
    showStatus("Could not scan image: " + error.message, true);
  } finally {
    $("ticketImage").value = "";
  }
}

function stopScanner() {
  scanning = false;
  if (scanFrameId !== null) {
    cancelAnimationFrame(scanFrameId);
    scanFrameId = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  $("video").srcObject = null;
  $("scannerSection").classList.add("hidden");
}

function refreshFromStorage() {
  let latest;
  try {
    latest = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return;
  }
  if (!latest || (latest.revision || 0) === (state.revision || 0)) return;

  state = {
    ...emptyState(),
    ...latest,
    events: Array.isArray(latest.events) ? latest.events : [],
    tickets: Array.isArray(latest.tickets) ? latest.tickets : [],
    checkins: Array.isArray(latest.checkins) ? latest.checkins : [],
    history: Array.isArray(latest.history) ? latest.history : [],
    offlineQueue: Array.isArray(latest.offlineQueue) ? latest.offlineQueue : []
  };

  $("role").value = state.role;
  $("identity").value = state.identity;
  render();
}

function processOfflineQueue() {
  if (!navigator.onLine) {
    $("checkinResult").textContent = "Browser is offline; scans remain queued.";
    return;
  }

  const selected = $("checkinEvent").value;
  const keep = [];
  const messages = [];

  for (const item of state.offlineQueue) {
    if (selected && item.eventId !== selected) {
      keep.push(item);
      messages.push(`${item.code}: still queued; select its event.`);
      continue;
    }

    const result = recordCheckin(item.code, item.count, item.actor, item.eventId);
    messages.push(`${item.code}: ${result.message}`);

    if (!result.ok && !result.used && result.message !== "Ticket code not found.") {
      keep.push(item);
    }
  }

  state.offlineQueue = keep;
  persist();
  render();
  $("checkinResult").textContent = messages.join("\n") || "No queued check-ins.";
}

function handleCheckin() {
  const code = $("ticketCode").value.trim();
  const count = Number($("admitCount").value);

  if (!code) {
    showCheckinResult({ ok: false, message: "Enter or scan a ticket code first." });
    return;
  }

  const result = checkIn(code, count);
  showCheckinResult(result);
  if (result.ok || result.queued) $("ticketCode").value = "";
}

function checkIn(code, count) {
  const ticket = getTicket(code);
  const actor = currentName() || $("role").value;
  const filter = $("checkinEvent").value;

  if (!ticket) return { ok: false, message: "Ticket code not found." };
  if (filter && ticket.eventId !== filter) {
    return { ok: false, message: "This ticket belongs to another event." };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return { ok: false, message: "Enter a positive whole number." };
  }

  if (!navigator.onLine) {
    const queuedAt = new Date().toISOString();
    state.offlineQueue.push({
      id: makeId(),
      code,
      count,
      actor,
      eventId: ticket.eventId,
      queuedAt
    });
    addHistory({
      type: "checkin_queued",
      ticketId: ticket.id,
      ticketCode: ticket.code,
      eventId: ticket.eventId,
      actor,
      count
    });
    persist();
    return { queued: true, message: "Offline: check-in queued for processing." };
  }

  return recordCheckin(code, count, actor, filter);
}

function recordCheckin(code, count, actor, eventFilter = "") {
  const ticket = getTicket(code);
  if (!ticket) return { ok: false, message: "Ticket code not found." };
  if (eventFilter && ticket.eventId !== eventFilter) {
    return { ok: false, message: "This ticket belongs to another event." };
  }

  const remaining = ticket.quantity - admittedCount(ticket.id);
  if (remaining <= 0) {
    return { ok: false, used: true, message: "All entries on this ticket have already been used." };
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > remaining) {
    return { ok: false, message: `Enter 1 to ${remaining} people for this ticket.` };
  }

  const entry = {
    id: makeId(),
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: ticket.eventId,
    actor,
    count,
    time: new Date().toISOString()
  };
  state.checkins.push(entry);
  state.history.unshift({ ...entry, type: "checked_in" });
  persist();

  return {
    ok: true,
    message: `Checked in ${count}. ${remaining - count} admission(s) remain.`
  };
}

function createTicket({ event, owner, role, quantity, price }) {
  const ticket = {
    id: makeId(),
    code: "TKT-" + makeId().replace(/-/g, "").slice(0, 12).toUpperCase(),
    eventId: event.id,
    owner,
    role,
    quantity,
    price,
    total: price * quantity,
    createdAt: new Date().toISOString()
  };

  state.tickets.push(ticket);
  addHistory({
    type: "ticket_booked",
    ticketId: ticket.id,
    ticketCode: ticket.code,
    eventId: event.id,
    owner,
    role,
    quantity,
    total: ticket.total
  });

  persist();
  render();

  const result = $("bookingResult");
  result.replaceChildren();

  const summary = document.createElement("p");
  summary.textContent =
    `${role === "attendee" ? "Booking" : "Free entry"} confirmed for ` +
    `${quantity} person(s) at ${event.name}. Total: ${ticket.total.toFixed(2)}.`;

  const code = document.createElement("p");
  code.textContent = "Ticket code: " + ticket.code;

  const qr = document.createElement("div");
  qr.className = "qr";
  result.append(summary, code, qr);
  drawQr(qr, ticketQrValue(ticket.code));

  return ticket;
}

$("role").value = state.role;
$("identity").value = state.identity;

$("role").addEventListener("change", () => {
  state.role = $("role").value;
  $("bookingPassword").value = "";
  persist();
  render();
});

$("identity").addEventListener("input", () => {
  renderMyTickets();
  renderDashboard();
});

$("saveIdentity").addEventListener("click", () => {
  state.identity = currentName();
  persist();
  render();
  showStatus(
    state.identity
      ? "Name saved. No ticket was booked; press Book ticket when ready."
      : "Enter your name first.",
    !state.identity
  );
});

$("eventForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const name = $("eventName").value.trim();
  const address = $("eventAddress").value.trim();
  const price = Number($("ticketPrice").value);
  const capacity = Number($("capacity").value);
  const eventPassword = $("eventPassword").value;
  const staffPassword = $("staffPassword").value;

  if (
    !name || !address ||
    eventPassword.length < 4 || staffPassword.length < 4 ||
    !Number.isFinite(price) || price < 0 ||
    !Number.isSafeInteger(capacity) || capacity < 1
  ) {
    showStatus("Enter a name, address, passwords of at least 4 characters, non-negative price, and positive capacity.", true);
    return;
  }

  const created = {
    id: makeId(),
    name,
    address,
    price,
    capacity,
    eventPassword,
    staffPassword,
    date: $("eventDate").value || "",
    organizer: currentName() || "Organizer",
    createdAt: new Date().toISOString()
  };

  state.events.unshift(created);
  addHistory({
    type: "event_published",
    eventId: created.id,
    actor: created.organizer
  });

  $("eventForm").reset();
  persist();
  render();
  showStatus("Event published.");
});

$("bookTicket").addEventListener("click", () => {
  const event = getEvent($("bookingEvent").value);
  const owner = currentName();
  const role = $("role").value;
  const quantity = Number($("bookingQuantity").value);
  const password = $("bookingPassword").value;

  if (!event) return showStatus("Select an event first.", true);
  if (!owner) return showStatus("Enter and save your name first.", true);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return showStatus("Quantity must be a positive whole number.", true);
  }

  // Password is checked only after the user explicitly presses Book ticket.
  if (role === "organizer" && password !== event.eventPassword) {
    return showStatus("Incorrect event password; no ticket was booked.", true);
  }
  if (role === "staff" && password !== event.staffPassword) {
    return showStatus("Incorrect staff password; no ticket was booked.", true);
  }

  const available = event.capacity - bookedCount(event.id);
  if (quantity > available) {
    return showStatus(`Only ${available} place(s) remain; no ticket was booked.`, true);
  }

  const unitPrice = role === "attendee" ? Number(event.price) : 0;
  createTicket({
    event,
    owner,
    role,
    quantity,
    price: unitPrice
  });

  $("bookingPassword").value = "";
  showStatus(
    role === "attendee"
      ? "Booking complete. Ticket code and QR generated."
      : `${role === "organizer" ? "Event" : "Staff"} password accepted. Free ticket generated.`
  );
});

$("bookingEvent").addEventListener("change", () => {
  $("bookingPassword").value = "";
  $("bookingResult").replaceChildren();
});

$("eventDate").addEventListener("change", () => {});
$("checkIn").addEventListener("click", handleCheckin);
$("syncQueue").addEventListener("click", processOfflineQueue);
$("refreshDashboard").addEventListener("click", renderDashboard);
$("dashboardEvent").addEventListener("change", renderDashboard);

$("scanEvent").addEventListener("click", () => startCameraScanner("event"));
$("scanTicket").addEventListener("click", () => startCameraScanner("ticket"));
$("stopScanner").addEventListener("click", stopScanner);
$("ticketImage").addEventListener("change", (event) => {
  scanImage(event.target.files && event.target.files[0], "ticket");
});

window.addEventListener("online", () => {
  showStatus("Back online. Processing queued check-ins.");
  processOfflineQueue();
});
window.addEventListener("offline", () => {
  showStatus("Offline: check-ins will be queued.");
  render();
});
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) refreshFromStorage();
});
if ("BroadcastChannel" in window) {
  const channel = new BroadcastChannel("team-f-ticketing");
  channel.addEventListener("message", refreshFromStorage);
}
window.addEventListener("beforeunload", stopScanner);
window.setInterval(refreshFromStorage, 3000);

render();
showStatus(navigator.onLine ? "Ready." : "Offline: check-ins will be queued.");