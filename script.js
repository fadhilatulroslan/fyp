"use strict";

/* =====================================================
   GLiPS - LPG GAS LEAK DETECTION DASHBOARD
   PART 1: CONFIGURATION, GLOBAL VARIABLES & HELPERS
   ===================================================== */

/* =====================================================
   CONFIGURATION
   ===================================================== */

const CONFIG = {
  supabaseUrl:
    "https://fkfgimyelgvlsbtxhvih.supabase.co",

  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrZmdpbXllbGd2bHNidHhodmloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NDY1MzgsImV4cCI6MjA5NzQyMjUzOH0." +
    "gZT9mgZtSOpWYs7PkQ8RYmuMI3UgXLwxsYCQfbWtwFM",

  sensorTable: "sensor_data",

  refreshInterval: 10000,

  staleAfterMs: 20000,

  cameraStreamUrl: "https://include-soviet-iowa-mere.trycloudflare.com/stream",

  aiEndpoint:
    "https://fkfgimyelgvlsbtxhvih.supabase.co/functions/v1/glips-ai",

  telegramAlertEndpoint: "",

  enableBackendActions: true
};

/* =====================================================
   SENSOR THRESHOLDS
   ===================================================== */

const THRESHOLD = {
  SAFE_MAX: 100,
  DANGER_CLEAR: 250,
  DANGER_MIN: 300
};

/* =====================================================
   CAMERA CONFIGURATION
   ===================================================== */

const CAMERA = {
  stream: CONFIG.cameraStreamUrl
};

/* =====================================================
   GLOBAL VARIABLES
   ===================================================== */

let sb = null;
let sensorChart = null;

let allSensors = [];
let currentSensor = null;
let currentStatus = "UNKNOWN";

let lastReadingFresh = false;
let databaseConnected = false;

let isLoading = false;
let isCameraOn = false;
let isSoundOn = true;
let isAIWorking = false;
let aiReturnFocus = null;
let aiPreviousBodyOverflow = "";

let cameraImageElement = null;

let alertHistory = [];
let historyLastLoadedAt = 0;
let historyLoading = false;
let historyLoadedFromServer = false;
let historySensorRows = [];
let systemEvents = [];
let observedValveLatch = null;
let observedConnection = null;
let aiConversation = [];

let currentChartPeriod = 10;
let cameraConnectTimer = null;
let telegramSending = false;

let lastRecordKey = null;
let lastAlertStatus = null;
let alertsInitialized = false;

let countdown = CONFIG.refreshInterval / 1000;

let refreshTimer = null;
let countdownTimer = null;
let audioContext = null;

/* =====================================================
   BASIC HELPERS
   ===================================================== */

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = $(id);

  if (element) {
    if (element.textContent !== String(value)) element.textContent = value;
  }
}

function setHTML(id, value) {
  const element = $(id);

  if (element) {
    if (element.innerHTML !== value) element.innerHTML = value;
  }
}

/* =====================================================
   HTML ESCAPING
   ===================================================== */

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =====================================================
   NUMBER HELPERS
   ===================================================== */

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    !["string", "number"].includes(typeof value)
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function formatNumber(value, decimals = 0) {
  const number = numberOrNull(value);

  return number === null
    ? "--"
    : number.toFixed(decimals);
}

/* =====================================================
   DATE & TIME HELPERS
   ===================================================== */

function formatDate(value) {
  if (!value) return "--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleDateString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}

function formatTimeOnly(value) {
  if (!value) return "--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatTime(value) {
  return `${formatDate(value)} ${formatTimeOnly(value)}`;
}

/* =====================================================
   GAS STATUS
   ===================================================== */

function hasSensorFault(record) {
  return record?.sensor_valid === false ||
    ["SENSOR ERROR", "SENSOR_ERROR", "ERROR", "INVALID"].includes(
      String(record?.status ?? "").trim().toUpperCase()
    );
}

function getSensorGas(record) {
  return hasSensorFault(record) ? null : numberOrNull(record?.gas_ppm);
}

function getGasStatus(ppm) {
  const value = numberOrNull(ppm);

  if (value === null || value < 0) {
    return "UNKNOWN";
  }

  if (value >= THRESHOLD.DANGER_MIN) {
    return "DANGER";
  }

  if (value > THRESHOLD.SAFE_MAX) {
    return "WARNING";
  }

  return "SAFE";
}

function getReadingStatus(record) {
  const fallback = getGasStatus(getSensorGas(record));
  if (fallback === "UNKNOWN" || fallback === "DANGER") return fallback;
  const reported = String(record?.status ?? "").trim().toUpperCase();
  // Hold an ESP-reported DANGER only above the 250 ppm clear threshold.
  return reported === "DANGER" && getSensorGas(record) > THRESHOLD.DANGER_CLEAR
    ? "DANGER" : fallback;
}

function getStatusColor(status) {
  if (status === "SAFE") {
    return "#16a34a";
  }

  if (status === "WARNING") {
    return "#d97706";
  }

  if (status === "DANGER") {
    return "#dc2626";
  }

  return "#94a3b8";
}

/* =====================================================
   SENSOR FIELD HELPERS
   ===================================================== */

function getField(record, names) {
  if (!record) return null;

  for (const name of names) {
    if (
      record[name] !== undefined &&
      record[name] !== null
    ) {
      return record[name];
    }
  }

  for (const name of names) {
    const value = record.hardware_outputs?.[name];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function normalizeState(value) {
  if (value === null || value === undefined) {
    return "UNKNOWN";
  }

  if (typeof value === "boolean") {
    return value ? "ON" : "OFF";
  }

  return String(value).trim().toUpperCase() || "UNKNOWN";
}

/* =====================================================
   CHECK SENSOR DATA FRESHNESS
   ===================================================== */

function isReadingStale(record) {
  if (!record?.created_at) {
    return true;
  }

  const timestamp = new Date(
    record.created_at
  ).getTime();

  if (!Number.isFinite(timestamp)) {
    return true;
  }

  const age = Date.now() - timestamp;

  return (
    age > CONFIG.staleAfterMs ||
    age < -CONFIG.staleAfterMs
  );
}

/* =====================================================
   TOAST NOTIFICATION
   ===================================================== */

function showToast(
  message,
  type = "info",
  duration = 4000
) {
  document.querySelectorAll(
    ".glips-toast"
  ).forEach(element => element.remove());

  const toast = document.createElement("div");

  toast.className = "glips-toast";
  toast.textContent = message;

  const colors = {
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
    info: "#1d4ed8"
  };

  Object.assign(toast.style, {
    position: "fixed",
    right: "22px",
    bottom: "22px",
    zIndex: "99999",
    maxWidth: "380px",
    padding: "14px 18px",
    borderRadius: "12px",
    background: colors[type] || colors.info,
    color: "#fff",
    fontSize: "13px",
    fontWeight: "500",
    boxShadow: "0 10px 30px rgba(0,0,0,.15)"
  });

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration);
}

/* =====================================================
   LOADING AND OFFLINE HANDLING
   ===================================================== */

function hideLoading() {
  const loading = $("loadingScreen");
  const dashboard = document.querySelector(".dash");

  if (loading) {
    loading.style.display = "none";
    loading.hidden = true;
  }

  if (dashboard) {
    dashboard.style.display = "flex";
    dashboard.hidden = false;
  }

  document.body.style.overflow = "";
}

/* =====================================================
   MONITORING BADGE
   ===================================================== */

function setMonitoringBadge(label, online) {
  const ids = [
    "monitoringStatus",
    "monitoringBadge",
    "readingMode",
    "dataStatus"
  ];

  ids.forEach(id => {
    const element = $(id);

    if (!element) return;

    element.textContent = label;
    element.dataset.online = String(online);
  });
}

/* =====================================================
   OFFLINE STATUS
   ===================================================== */

function showOffline(message) {
  currentStatus = "UNKNOWN";
  lastReadingFresh = false;
  updateChart([]);

  const hasRecord = Boolean(currentSensor);

  const recordedStatus = hasRecord
    ? getReadingStatus(currentSensor)
    : "UNKNOWN";

  setText(
    "heroStatus",
    hasRecord
      ? "MONITORING OFFLINE"
      : "MONITORING UNAVAILABLE"
  );

  setText(
    "heroMessage",
    hasRecord
      ? `${message} Last recorded gas status: ${recordedStatus}. Current safety status is unknown.`
      : message
  );

  setMonitoringBadge(
    hasRecord ? "LAST RECORDED" : "NO DATA",
    false
  );

  if (hasRecord) {
    // Preserve historical values.
    // Never label old readings as live.

    updateHeroValues(currentSensor);

    updateSensorCards(
      currentSensor,
      recordedStatus,
      false
    );

    setText(
      "quickUpdate",
      formatTime(currentSensor.created_at)
    );

    setText(
      "lastUpdate",
      formatTime(currentSensor.created_at)
    );

  } else {
    updateSensorCards({}, "UNKNOWN", false);
    setText("heroGas", "--");
    setText("heroTemp", "--");
    setText("heroHumid", "--");
    setText("humidity", "--");
    setText("heroTime", "--");

    setText("gasPpm", "--");
    setText("temperature", "--");

    setText("quickUpdate", "--");
    setText("lastUpdate", "--");
  }

  setText("sysStatus", "UNKNOWN");
  setText("currentRangeStatus", "UNKNOWN");

  setText("quickEsp32", "Not reporting");
  setText("quickESP32", "Not reporting");

  setText("esp32Status", "OFFLINE");
  setText("esp32StatusBadge", "OFFLINE");

  const pill = $("systemStatusPill");

  if (pill) {
    pill.classList.remove(
      "safe",
      "warning",
      "danger"
    );

    const label = pill.querySelector(
      ".status-text"
    );

    if (label) {
      label.textContent = "OFFLINE";
    }
  }

  const hero = $("heroAlert");

  if (hero) {
    hero.classList.remove(
      "safe",
      "warning",
      "danger"
    );

    hero.classList.add("offline");
  }

  updateHardware(currentSensor);
  updateConnectivity(currentSensor);
  setHTML("heroIcon", '<i class="ti ti-wifi-off"></i>');

  console.warn("[GLiPS]", message);
}

/* =====================================================
   DASHBOARD INITIALIZATION
   ===================================================== */

async function initializeGLiPS() {
  console.log("[GLiPS] Initializing...");

  try {
    // Initialize dashboard components.
    initializeChart();
    initializeChartButtons();
    initializeKeyboardEvents();
    initializeChatInputs();

    setText("countdownVal", countdown);

    // Check Supabase library.
    if (!window.supabase?.createClient) {
      throw new Error(
        "Supabase library is not loaded."
      );
    }

    // Create Supabase client.
    sb = window.supabase.createClient(
      CONFIG.supabaseUrl,
      CONFIG.supabaseAnonKey
    );

    // Authenticate navigation before requesting dashboard data.
    const { data: authData, error: authError } = await sb.auth.getSession();
    if (authError) throw authError;
    if (!authData?.session) {
      window.location.replace("index.html");
      return;
    }

    // Load first sensor readings.
    await loadData();

    // Start automatic refresh.
    startRefreshTimers();

    console.log("[GLiPS] Initialized.");

  } catch (error) {
    console.error(
      "[GLiPS] Initialization:",
      error
    );

    showOffline(error.message);

    showToast(
      `Dashboard: ${error.message}`,
      "danger",
      6000
    );

  } finally {
    hideLoading();
  }
}

/* =====================================================
   DOM READY
   ===================================================== */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeGLiPS,
    { once: true }
  );

} else {
  initializeGLiPS();
}

/* =====================================================
   AUTO REFRESH
   ===================================================== */

function startRefreshTimers() {
  clearInterval(refreshTimer);
  clearInterval(countdownTimer);

  countdown = CONFIG.refreshInterval / 1000;

  refreshTimer = setInterval(() => {
    loadData();
  }, CONFIG.refreshInterval);

  countdownTimer = setInterval(() => {
    if (lastReadingFresh && isReadingStale(currentSensor)) {
      showOffline("ESP32 has not sent a recent valid reading.");
    }

    updateLastSeen();
    countdown = Math.max(
      0,
      countdown - 1
    );

    setText("countdownVal", countdown);
  }, 1000);
}

/* =====================================================
   MANUAL REFRESH
   ===================================================== */

async function manualRefresh() {
  countdown = CONFIG.refreshInterval / 1000;

  await loadData();
}

/* =====================================================
   SUPABASE SENSOR DATA
   ===================================================== */

async function loadData() {
  if (isLoading) return;

  if (!sb) {
    showOffline(
      "Supabase is not connected."
    );

    return;
  }

  isLoading = true;

  try {
    const { data, error } = await sb
      .from(CONFIG.sensorTable)
      .select("*")
      .order("created_at", {
        ascending: false
      })
      .limit(500)
      .abortSignal(AbortSignal.timeout(15000));

    if (error) {
      throw error;
    }

    if (!databaseConnected) {
      console.info("[GLiPS] Supabase sensor_data connected successfully.");
    }
    databaseConnected = true;

    // No sensor data available.
    if (!Array.isArray(data) || data.length === 0) {
      allSensors = [];
      currentSensor = null;

      updateChart([]);
      loadAlertHistoryFromData([]);

      showOffline(
        "No sensor readings found in Supabase."
      );

      return;
    }

    // Save latest sensor data.
    allSensors = data;
    currentSensor = data[0];

    const recordedStatus = getReadingStatus(currentSensor);

    // Check if sensor reading is recent.
    lastReadingFresh =
      recordedStatus !== "UNKNOWN" &&
      !isReadingStale(currentSensor);

    // Update charts and alert history.
    updateChart(data);
    if (historyLoadedFromServer) {
      mergeHistoryRows(data);
    } else {
      loadAlertHistoryFromData(data);
    }
    if (Date.now() - historyLastLoadedAt > 300000) {
      void loadCompleteAlertHistory();
    }

    setText(
      "lastUpdate",
      formatTime(currentSensor.created_at)
    );

    // Sensor offline or invalid reading.
    if (!lastReadingFresh) {
      showOffline(
        hasSensorFault(currentSensor)
          ? "ESP32 reports a sensor error. Gas concentration is unavailable."
          : "ESP32 has not sent a recent valid reading."
      );

      return;
    }

    // Valid live reading.
    currentStatus = recordedStatus;

    setMonitoringBadge("LIVE", true);

    // Update dashboard UI.
    updateHeroAlert(
      currentSensor,
      recordedStatus
    );

    updateSensorCards(
      currentSensor,
      recordedStatus,
      true
    );

    updateHardware(currentSensor);
    updateConnectivity(currentSensor);
    updateSystemPill(recordedStatus);

    // Process status changes.
    processNewReading(
      currentSensor,
      recordedStatus
    );

  } catch (error) {
    databaseConnected = false;

    console.error(
      "[GLiPS] Database:",
      error
    );

    // Preserve existing readings; network failures do not mean an empty database.
    const detail = error?.message || "Unknown error";
    showOffline(
      `Database disconnected: ${detail}`
    );

  } finally {
    isLoading = false;

    countdown = CONFIG.refreshInterval / 1000;

    setText(
      "countdownVal",
      countdown
    );

    hideLoading();
  }
}


/* =====================================================
   HERO AND SENSOR CARDS
   ===================================================== */

function updateHeroValues(record) {
  setText(
    "heroGas",
    formatNumber(getSensorGas(record))
  );

  setText(
    "heroTemp",
    formatNumber(getField(record, ["temperature", "temp"]), 1)
  );
  setText("heroHumid", formatNumber(getField(record, ["humidity", "humid"]), 1));

  setText(
    "heroTime",
    formatTimeOnly(record.created_at)
  );
}

/* =====================================================
   HERO ALERT STATUS
   ===================================================== */

function updateHeroAlert(record, status) {
  const messages = {
    SAFE: {
      title: "Gas level is normal",
      description:
        "Monitoring is active. Continue your normal safety checks.",
      icon: "ti ti-shield-check"
    },

    WARNING: {
      title: "Gas level is above normal",
      description:
        "Keep clear of suspected leaks and ask the operator to check the area.",
      icon: "ti ti-alert-triangle"
    },

    DANGER: {
      title: "Gas leak warning",
      description:
        "Leave the affected area and follow your site emergency procedures. Do not assume the gas supply is shut off.",
      icon: "ti ti-alert-octagon"
    }
  };

  const content = messages[status];

  if (!content) return;

  const hero = $("heroAlert");

  if (hero) {
    hero.classList.remove(
      "safe",
      "warning",
      "danger",
      "offline"
    );

    hero.classList.add(
      status.toLowerCase()
    );
  }

  const latched = getField(record, ["valve_latched"]) === true;
  setText("heroStateLabel", status === "SAFE" ? "Safe" : status === "WARNING" ? "Warning" : "Danger");
  setText("heroReadingNote", "Current sensor reading");
  setText("heroStatus", status === "SAFE" && latched ? "Gas level has dropped" : content.title);
  setText("heroMessage", status === "SAFE" && latched
    ? "The gas reading has dropped. Manual valve reset is still required before normal operation resumes." : content.description);

  updateHeroValues(record);

  setHTML(
    "heroIcon",
    `<i class="${content.icon}"></i>`
  );
}

/* =====================================================
   SENSOR STATUS CARDS
   ===================================================== */

function updateSensorCards(
  record,
  status,
  isLive = true
) {
  const ppm = getSensorGas(record);

  const temp = numberOrNull(
    getField(record, ["temperature", "temp"])
  );

  setText(
    "sysStatus",
    isLive ? status : "UNKNOWN"
  );

  setText(
    "currentRangeStatus",
    isLive ? status : "UNKNOWN"
  );

  setText(
    "gasPpm",
    formatNumber(ppm)
  );

  setText(
    "temperature",
    formatNumber(temp, 1)
  );
  setText("humidity", formatNumber(getField(record, ["humidity", "humid"]), 1));

  setText(
    "sysStatusInfo",
    isLive
      ? `Current LPG status: ${status}`
      : `Last recorded status: ${status}. Current status unknown.`
  );

  setText(
    "gasStatusInfo",
    `${isLive ? "Live" : "Last recorded"} MQ-6 reading: ${formatNumber(ppm)} ppm`
  );

  setText(
    "tempStatusInfo",
    temp === null
      ? "DHT22 temperature unavailable"
      : `${isLive ? "Live" : "Last recorded"} temperature: ${temp.toFixed(1)}°C`
  );

  const gasBadge = $("gasBadge");
  if (gasBadge) {
    gasBadge.textContent = isLive ? status : "Not live";
    gasBadge.className = `sensor-badge-status ${isLive ? status.toLowerCase() : "offline"}`;
  }
  const tempBadge = $("tempBadge");
  if (tempBadge) {
    tempBadge.textContent = temp === null ? "Not available" : isLive ? "Live" : "Last recorded";
    tempBadge.className = `sensor-badge-status ${isLive && temp !== null ? "info" : "offline"}`;
  }
  const bar = $("gasBarFill");
  if (bar) {
    bar.style.width = isLive && ppm !== null ? `${Math.max(0, Math.min(100, ppm / 500 * 100))}%` : "0%";
    bar.style.backgroundColor = isLive ? getStatusColor(status) : "#94a3b8";
    bar.parentElement?.setAttribute("role", "img");
    bar.parentElement?.setAttribute("aria-label", isLive ? `Gas reading ${formatNumber(ppm)} ppm, ${status}` : "No live gas reading");
  }

  const card = $("systemStatus");

  if (card) {
    card.classList.remove(
      "safe",
      "warning",
      "danger",
      "offline"
    );

    card.classList.add(
      isLive
        ? status.toLowerCase()
        : "offline"
    );
  }
}

/* =====================================================
   SYSTEM STATUS PILL
   ===================================================== */

function updateSystemPill(status) {
  const pill = $("systemStatusPill");

  if (!pill) return;

  pill.classList.remove(
    "safe",
    "warning",
    "danger"
  );

  pill.classList.add(
    status.toLowerCase()
  );

  const label = pill.querySelector(
    ".status-text"
  );

  if (label) {
    label.textContent = status;
  }
}

/* =====================================================
   SENSOR INFORMATION POPUPS
   ===================================================== */

function toggleThresholdInfo() {
  $("thresholdPopup")?.classList.toggle(
    "show"
  );
}

function toggleTempInfo() {
  $("tempPopup")?.classList.toggle(
    "show"
  );
}

/* =====================================================
   HARDWARE STATUS
   ===================================================== */

const HARDWARE_DEVICES = [
  {
    ids: ["gasValveStatus"],
    fields: [
      "gas_valve",
      "valve_status",
      "solenoid_valve"
    ]
  },

  {
    ids: ["exhaustFanStatus"],
    fields: [
      "exhaust_fan",
      "fan_status"
    ]
  },

  {
    ids: ["buzzerStatus"],
    fields: [
      "buzzer",
      "buzzer_status"
    ]
  },

  {
    ids: ["redLEDStatus"],
    fields: [
      "red_led",
      "red_led_status"
    ]
  },

  {
    ids: ["greenLEDStatus"],
    fields: [
      "green_led",
      "green_led_status"
    ]
  }
];

/* =====================================================
   UPDATE HARDWARE STATUS
   ===================================================== */

function updateHardware(record) {
  const fresh = databaseConnected && lastReadingFresh && record && !isReadingStale(record);
  const unavailable = !databaseConnected ? "Unknown — database unavailable"
    : !record ? "Not reported"
    : isReadingStale(record) ? "Unknown — ESP offline"
    : hasSensorFault(record) ? "Unknown — sensor error" : "Not reported";
  const states = {};
  const active = value => ["ON", "ACTIVE", "TRUE", "1", "PLAY REQUESTED", "RELAY HIGH"].includes(value);
  HARDWARE_DEVICES.forEach(device => {
    const value = fresh ? normalizeState(getField(record, device.fields)) : "UNKNOWN";
    device.ids.forEach(id => {
      states[id] = value;
      const element = $(id);
      if (!element) return;
      const reported = value !== "UNKNOWN";
      const valveLatch = fresh && id === "gasValveStatus" ? getField(record, ["valve_latched"]) : null;
      element.textContent = valveLatch === true ? "Latched" : reported ? value : unavailable;
      const detail = $(id.replace(/Status$/, "Detail"));
      if (detail) detail.textContent = valveLatch === true
        ? `${reported ? value : "Relay state not reported"} · manual reset required` : element.textContent;
      if (id === "gasValveStatus") setText("valveResetStatus", valveLatch === true
        ? "Manual reset on ESP32 required" : valveLatch === false ? "No reset required" : unavailable);
      const dot = $("dot" + id.replace(/Status$/, "").replace(/^./, letter => letter.toUpperCase()));
      if (dot) {
        dot.classList.toggle("active", reported);
        dot.title = reported ? "Output reported; physical operation is not verified" : unavailable;
      }
      element.title = reported ? "Reported output command; physical operation is not verified" : unavailable;
      element.classList.remove("on", "off", "active", "offline", "closed");
      element.classList.add(valveLatch === true ? "closed" : !reported ? "offline" : value === "CLOSED" ? "closed" : active(value) ? "on" : "off");
    });
  });
  const alarmStates = [states.buzzerStatus, states.redLEDStatus, states.greenLEDStatus];
  const reported = alarmStates.filter(value => value !== "UNKNOWN").length;
  const alarmActive = active(states.buzzerStatus) || active(states.redLEDStatus);
  setText("alarmStatus", !reported ? unavailable
    : reported < 3 ? (alarmActive ? "Active · partial report" : "Partially reported")
    : alarmActive ? "Active" : "Inactive");
  const badge = $("alarmStatus");
  if (badge) {
    badge.classList.remove("on", "off", "closed", "offline");
    badge.classList.add(!reported ? "offline" : alarmActive ? "closed" : reported < 3 ? "offline" : "off");
  }
  $("dotAlarm")?.classList.toggle("active", reported > 0);
  updateResponseSummary(record, Boolean(fresh));
}

function updateResponseSummary(record, fresh) {
  const panel = $("responseSummary");
  if (!panel) return;
  panel.classList.remove("attention", "unavailable");
  setText("assistantContext", fresh ? "Current readings available" : "Live readings unavailable");
  if (!fresh) {
    panel.classList.add("unavailable");
    setText("responseHeadline", "Device response is unknown");
    setText("responseNextStep", "Current gas levels and device actions cannot be confirmed. Check the monitoring device and connection.");
    ["responseValve", "responseFan", "responseAlarm"].forEach(id => setText(id, "Current status unknown"));
    return;
  }
  const state = getReadingStatus(record);
  const latch = getField(record, ["valve_latched"]);
  const valve = normalizeState(getField(record, HARDWARE_DEVICES[0].fields));
  const fan = normalizeState(getField(record, HARDWARE_DEVICES[1].fields));
  const buzzer = normalizeState(getField(record, ["buzzer", "buzzer_status"]));
  const red = normalizeState(getField(record, ["red_led", "red_led_status"]));
  const on = value => ["ON", "ACTIVE", "TRUE", "1"].includes(value);
  const off = value => ["OFF", "INACTIVE", "FALSE", "0"].includes(value);
  setText("responseValve", latch === true ? "Shut-off requested"
    : valve === "UNKNOWN" ? "Status not received" : latch === false ? "Normal valve command reported" : "Valve command reported");
  setText("responseFan", on(fan) ? "Ventilation requested" : off(fan) ? "Ventilation not requested" : "Status not received");
  setText("responseAlarm", on(buzzer) ? "Sound alarm requested" : on(red) ? "Warning light reported"
    : off(buzzer) && off(red) ? "No alarm requested" : "Status not received");
  if (latch === true) {
    panel.classList.add("attention");
    setText("responseHeadline", "Manual valve reset required");
    setText("responseNextStep", state === "SAFE"
      ? "Gas level has dropped. The shut-off request is still active. Have the area checked before an operator resets the valve locally."
      : "Keep clear of the affected area. The shut-off request is still active. Do not reset the valve while gas levels are elevated.");
  } else if (state === "DANGER") {
    panel.classList.add("attention");
    setText("responseHeadline", "Follow emergency procedures");
    setText("responseNextStep", "Gas supply shut-off is not confirmed. Leave the affected area and follow your site emergency procedures.");
  } else {
    const anyReport = valve !== "UNKNOWN" || fan !== "UNKNOWN" || buzzer !== "UNKNOWN";
    setText("responseHeadline", anyReport ? "Latest device reports" : "Waiting for device reports");
    setText("responseNextStep", anyReport
      ? "These are commands reported by the monitoring device. Physical operation has not been confirmed."
      : "Gas readings are available, but device actions have not been reported. Ask the operator to check the monitoring device.");
  }
  if (typeof latch === "boolean") {
    if (latch && observedValveLatch !== true) addEvent("warning", "Gas shut-off request reported. An operator must reset it manually.");
    if (!latch && observedValveLatch === true) addEvent("info", "Valve reset reported by the monitoring device.");
    observedValveLatch = latch;
  }
}

function openDeviceDetails() {
  const details = $("deviceReports");
  if (!details) return;
  details.open = true;
  details.scrollIntoView({behavior: "smooth", block: "start"});
  details.querySelector("summary")?.focus();
}

/* =====================================================
   HARDWARE CARD EXPANSION
   ===================================================== */

function toggleHardware(card) {
  if (!card) return;
  const expanded = card.classList.toggle("expanded");
  card.setAttribute("aria-expanded", String(expanded));
}

/* =====================================================
   CONNECTIVITY STATUS
   ===================================================== */

function updateConnectivity(record) {
  const recent = databaseConnected && record && !isReadingStale(record);
  const label = !databaseConnected ? "Unknown" : recent
    ? hasSensorFault(record) ? "Online · sensor error" : "Online"
    : record ? "Offline" : "Waiting for readings";
  setText("quickESP32", label);
  setText("quickSupabase", databaseConnected ? "Connected" : "Disconnected");
  $("quickESP32")?.classList.toggle("online", Boolean(recent));
  $("quickESP32")?.classList.toggle("offline", Boolean(databaseConnected && record && !recent));
  $("quickSupabase")?.classList.toggle("online", databaseConnected);
  $("quickSupabase")?.classList.toggle("offline", !databaseConnected);
  const connection = !databaseConnected ? "service-unavailable" : recent ? "online" : "sensor-unavailable";
  if (connection !== observedConnection) {
    if (observedConnection !== null && connection === "service-unavailable") addEvent("warning", "Connection to the monitoring service was lost. Current gas level is unknown.");
    if (connection === "online") addEvent("info", observedConnection === null ? "Live gas readings received." : "Live gas readings resumed.");
    if (connection === "sensor-unavailable" && observedConnection === "online") addEvent("warning", "The gas sensor stopped reporting. Current gas level is unknown.");
    observedConnection = connection;
  }
  updateLastSeen();
}

function updateLastSeen() {
  if (!currentSensor?.created_at || !Number.isFinite(new Date(currentSensor.created_at).getTime())) {
    setText("quickUpdate", "No readings received");
    return;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(currentSensor.created_at).getTime()) / 1000));
  const age = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
  setText("quickUpdate", `${age} ago${lastReadingFresh ? "" : " · last recorded"}`);
  if ($("quickUpdate")) $("quickUpdate").title = formatTime(currentSensor.created_at);
}

/* =====================================================
   SENSOR CHART
   ===================================================== */

function initializeChart() {
  const canvas = $("sensorChart");

  if (!canvas || !window.Chart) {
    setText("chartEmptyState", "Graph unavailable — refresh to reload Chart.js.");
    console.warn(
      "[GLiPS] Chart.js unavailable."
    );

    return;
  }

  sensorChart = new Chart(
    canvas.getContext("2d"),
    {
      type: "line",

      data: {
        labels: [],

        datasets: [
          {
            label: "Gas level (ppm)",
            spanGaps: false,
            data: [],
            borderColor: "#2563eb",
            backgroundColor:
              "rgba(37,99,235,0.08)",
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 2
          },

          {
            label: "Safe range limit (100 ppm)",
            data: [],
            borderColor: "#d97706",
            borderDash: [5, 5],
            borderWidth: 1.5,
            pointRadius: 0
          },

          {
            label: "Danger trigger (300 ppm)",
            data: [],
            borderColor: "#dc2626",
            borderDash: [5, 5],
            borderWidth: 1.5,
            pointRadius: 0
          }
        ]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        interaction: {
          mode: "index",
          intersect: false
        },

        plugins: {
          legend: {
            display: false
          }
        },

        scales: {
          x: {
            grid: {
              display: false
            }
          },

          y: {
            beginAtZero: true,
            suggestedMax: 400,

            title: {
              display: true,
              text: "Gas Concentration (ppm)"
            }
          }
        }
      }
    }
  );
}

/* =====================================================
   UPDATE SENSOR CHART
   ===================================================== */

function updateChart(records = allSensors) {
  const live = lastReadingFresh && !isReadingStale(currentSensor);
  const empty = $("chartEmptyState");
  if (empty) {
    empty.hidden = live && Boolean(sensorChart);
    empty.textContent = !sensorChart ? "Graph unavailable — refresh to reload Chart.js." : !databaseConnected
      ? "Database unavailable — retrying connection."
      : !currentSensor
        ? "No sensor data — waiting for the first ESP32 reading."
        : hasSensorFault(currentSensor)
          ? "Sensor error — waiting for a valid LPG reading."
          : "ESP32 offline — waiting for a new valid reading.";
  }
  if (!sensorChart) return;

  // Never show saved readings as a live graph while monitoring is offline.
  const liveRecords = lastReadingFresh && !isReadingStale(currentSensor)
    ? records
    : [];

  const selected = [];
  liveRecords.slice(0, currentChartPeriod).reverse().forEach(row => {
    const previous = selected[selected.length - 1];
    const timestamp = new Date(row.created_at).getTime();
    const previousTime = previous ? new Date(previous.created_at).getTime() : timestamp;
    if (timestamp - previousTime > CONFIG.staleAfterMs) {
      selected.push({created_at: new Date(previousTime + 1).toISOString(), gas_ppm: null});
    }
    selected.push(row);
  });

  // Polling often returns the same rows. Keep the current plot and tooltip
  // intact rather than rebuilding an unchanged chart every refresh.
  const signature = JSON.stringify(selected.map(row => [row.created_at, getReadingStatus(row), getSensorGas(row)]));
  if (sensorChart.glipsDataSignature === signature) return;
  sensorChart.glipsDataSignature = signature;

  sensorChart.data.labels = selected.map(
    row => formatTimeOnly(row.created_at)
  );

  sensorChart.data.datasets[0].data =
    selected.map(
      row => getReadingStatus(row) === "UNKNOWN" ? null : getSensorGas(row)
    );

  sensorChart.data.datasets[1].data =
    selected.map(
      () => THRESHOLD.SAFE_MAX
    );

  sensorChart.data.datasets[2].data = selected.map(() => THRESHOLD.DANGER_MIN);

  sensorChart.update("none");
}

/* =====================================================
   CHART PERIOD BUTTONS
   ===================================================== */

function initializeChartButtons() {
  document.querySelectorAll(
    ".chart-btn"
  ).forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(
        ".chart-btn"
      ).forEach(item => {
        item.classList.remove("active");
      });

      button.classList.add("active");

      currentChartPeriod =
        Number(button.dataset.period) || 20;

      updateChart();
    });
  });
}


/* =====================================================
   ALERT HISTORY
   ===================================================== */

function loadAlertHistoryFromData(records) {
  const ordered = [...records].reverse();
  const alerts = [];

  let previousStatus = null;

  ordered.forEach(record => {
    const status = getReadingStatus(record);

    if (status === "UNKNOWN") return;

    if (status !== previousStatus) {
      alerts.push({
        id: record.id ?? record.created_at,
        created_at: record.created_at,
        gas_ppm: numberOrNull(
          record.gas_ppm
        ),
        status
      });
    }

    previousStatus = status;
  });

  alertHistory = alerts.reverse();

  updateMonthFilter();
  filterAlertsByMonth();
}

/* =====================================================
   MONTH FILTER
   ===================================================== */

function mergeHistoryRows(records) {
  const byId = new Map(historySensorRows.map(row => [String(row.id ?? row.created_at), row]));
  records.forEach(row => byId.set(String(row.id ?? row.created_at), row));
  historySensorRows = [...byId.values()]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10000);
  loadAlertHistoryFromData(historySensorRows);
}

function getMonthKey(date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit"
  }).formatToParts(date);
  return `${parts.find(part => part.type === "year").value}-${parts.find(part => part.type === "month").value}`;
}

function updateMonthFilter() {
  const select = $("monthFilter");

  if (!select) return;

  const previous = select.value || "all";
  const months = new Set();

  alertHistory.forEach(alert => {
    const date = new Date(
      alert.created_at
    );

    if (!Number.isNaN(date.getTime())) {
      months.add(
        getMonthKey(date)
      );
    }
  });

  select.innerHTML =
    '<option value="all">All Months</option>';

  [...months].sort().reverse().forEach(
    month => {
      const option =
        document.createElement("option");

      option.value = month;
      option.textContent = month;

      select.appendChild(option);
    }
  );

  if (
    previous === "all" ||
    months.has(previous)
  ) {
    select.value = previous;
  }
}

/* =====================================================
   FILTER ALERTS BY MONTH
   ===================================================== */

function getFilteredAlerts() {
  const month = $("monthFilter")?.value || "all";
  const status = $("historyStatus")?.value || "all";
  const from = $("historyFrom")?.value || "";
  const to = $("historyTo")?.value || "";
  const error = $("historyFilterError");
  const invalid = from && to && from > to;
  if (error) { error.hidden = !invalid; error.textContent = invalid ? "Choose an end date on or after the start date." : ""; }
  if (invalid) return [];
  const start = from ? new Date(`${from}T00:00:00+08:00`).getTime() : -Infinity;
  const end = to ? new Date(`${to}T00:00:00+08:00`).getTime() + 86400000 : Infinity;
  return alertHistory.filter(alert => {
    const date = new Date(alert.created_at);
    return Number.isFinite(date.getTime()) && date.getTime() >= start && date.getTime() < end
      && (month === "all" || getMonthKey(date) === month)
      && (status === "all" || alert.status === status);
  });
}

function resetHistoryFilters() {
  ["historyFrom", "historyTo"].forEach(id => { if ($(id)) $(id).value = ""; });
  ["monthFilter", "historyStatus"].forEach(id => { if ($(id)) $(id).value = "all"; });
  filterAlertsByMonth();
}

/* =====================================================
   DISPLAY ALERT HISTORY
   ===================================================== */

function filterAlertsByMonth() {
  const alerts = getFilteredAlerts();
  const list = $("alertHistoryList");
  const tableBody = $("alertTableBody");

  setText("totalAlertsMonth", alerts.length);
  setText("dangerAlertsMonth", alerts.filter(a => a.status === "DANGER").length);
  setText("warningAlertsMonth", alerts.filter(a => a.status === "WARNING").length);

  if (tableBody) {
    setHTML("alertTableBody", alerts.length
      ? alerts.map(alert => `<tr>
          <td>${escapeHTML(formatDate(alert.created_at))}</td>
          <td>${escapeHTML(formatTimeOnly(alert.created_at))}</td>
          <td>${escapeHTML(formatNumber(alert.gas_ppm))} ppm</td>
          <td><span class="status-badge ${escapeHTML(alert.status.toLowerCase())}">${escapeHTML(alert.status)}</span></td>
        </tr>`).join("")
      : '<tr><td colspan="4">No records match your filters.</td></tr>');
  }
  if (list) {
    setHTML("alertHistoryList", alerts.length
      ? alerts.map(alert => `<div class="alert-item ${escapeHTML(alert.status.toLowerCase())}">
          <div><strong>${escapeHTML(alert.status)}</strong><div>${escapeHTML(formatTime(alert.created_at))}</div></div>
          <strong>${escapeHTML(formatNumber(alert.gas_ppm))} ppm</strong>
        </div>`).join("")
      : '<div class="event-empty">No records match your filters.</div>');
  }
}

// Fetch historical sensor rows separately from the live 500-row dashboard query.
// A transition into a new gas status is counted as an alert event.
// This does not invent alerts and does not claim to read a separate alert table.
async function loadCompleteAlertHistory() {
  if (!sb || historyLoading) return;
  historyLoading = true;
  try {
    const pageSize = 1000;
    const maxRows = 10000;
    const rows = [];
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const { data, error } = await sb.from(CONFIG.sensorTable)
        .select("id,created_at,gas_ppm,status")
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1)
        .abortSignal(AbortSignal.timeout(15000));
      if (error) throw error;
      if (!Array.isArray(data) || !data.length) break;
      rows.push(...data);
      if (data.length < pageSize) break;
    }
    historySensorRows = rows;
    mergeHistoryRows(allSensors);
    historyLoadedFromServer = true;
    historyLastLoadedAt = Date.now();
    console.info(`[GLiPS] Historical rows loaded: ${rows.length}`);
  } catch (error) {
    console.warn("[GLiPS] History request failed, keeping recent records:", error);
    historyLastLoadedAt = Date.now();
    if (!historyLoadedFromServer) loadAlertHistoryFromData(allSensors);
  } finally {
    historyLoading = false;
  }
}

// Compatibility with newer dashboard.html button onclick handlers.
function exportAlertsToExcel() { return exportAlertHistoryXLSX(); }
function printAlerts() {
  const rows = getFilteredAlerts();
  if (!rows.length) {
    showToast("No alert records available to print.", "warning");
    return;
  }
  const safeRows = rows.map(a => `<tr><td>${escapeHTML(formatDate(a.created_at))}</td><td>${escapeHTML(formatTimeOnly(a.created_at))}</td><td>${escapeHTML(formatNumber(a.gas_ppm))} ppm</td><td>${escapeHTML(a.status)}</td></tr>`).join("");
  const page = window.open("", "_blank", "width=900,height=700");
  if (!page) { showToast("Allow pop-ups to print alert history.", "warning"); return; }
  page.document.write(`<!doctype html><html><head><title>GLiPS Alert History</title><style>body{font:14px Arial,sans-serif;padding:30px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:10px;text-align:left}th{background:#f2f5f9}</style></head><body><h2>GLiPS Alert History</h2><table><thead><tr><th>Date</th><th>Time</th><th>Gas Level</th><th>Status</th></tr></thead><tbody>${safeRows}</tbody></table></body></html>`);
  page.document.close();
  page.focus();
  page.print();
}

/* =====================================================
   PRINT ALERT HISTORY
   ===================================================== */

function printAlertHistory() {
  window.print();
}

function printEventLog() {
  window.print();
}

/* =====================================================
   EXPORT DATA TO EXCEL / CSV
   ===================================================== */

function exportRows(filename, rows) {
  if (!rows.length) {
    showToast(
      "No records available to export.",
      "warning"
    );

    return;
  }

  // Use SheetJS when available.
  if (window.XLSX) {
    const workbook = XLSX.utils.book_new();

    const worksheet =
      XLSX.utils.json_to_sheet(rows);

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "GLiPS"
    );

    XLSX.writeFile(workbook, filename);
    return;
  }

  // CSV fallback.
  const headers = Object.keys(rows[0]);

  const csv = [
    headers.join(","),

    ...rows.map(row =>
      headers.map(header => {
        const value = String(
          row[header] ?? ""
        );

        return `"${value.replaceAll('"', '""')}"`;
      }).join(",")
    )
  ].join("\n");

  const blob = new Blob(
    [csv],
    {
      type: "text/csv;charset=utf-8;"
    }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;

  link.download = filename.replace(
    ".xlsx",
    ".csv"
  );

  link.click();

  URL.revokeObjectURL(url);
}

/* =====================================================
   EXPORT ALERT HISTORY
   ===================================================== */

function exportAlertHistoryXLSX() {
  const rows = getFilteredAlerts().map(
    alert => ({
      Date: formatDate(alert.created_at),

      Time: formatTimeOnly(
        alert.created_at
      ),

      "LPG (ppm)": alert.gas_ppm,

      Status: alert.status
    })
  );

  exportRows(
    "GLiPS_Alerts.xlsx",
    rows
  );
}

/* =====================================================
   EXPORT EVENT LOG
   ===================================================== */

function exportEventLogXLSX() {
  const rows = systemEvents.map(event => ({
    Time: formatTime(event.time),
    Type: event.type,
    Event: event.message
  }));

  exportRows(
    "GLiPS_Event_Log.xlsx",
    rows
  );
}

/* =====================================================
   EVENT LOG
   ===================================================== */

function addEvent(type, message) {
  systemEvents.unshift({
    type,
    message,
    time: new Date()
  });

  systemEvents = systemEvents.slice(
    0,
    100
  );

  renderEvents();
}

/* =====================================================
   RENDER EVENT LOG
   ===================================================== */

function renderEvents() {
  const container = $("eventLog");

  if (!container) return;

  if (!systemEvents.length) {
    container.innerHTML = `
      <div class="event-empty">
        Waiting for system events...
      </div>
    `;

    return;
  }

  container.innerHTML = systemEvents.map(
    event => `
      <div class="event-item ${escapeHTML(event.type)}">
        <span class="event-time">
          ${escapeHTML(formatTimeOnly(event.time))}
        </span>

        <span class="event-message">
          ${escapeHTML(event.message)}
        </span>
      </div>
    `
  ).join("");
}

/* =====================================================
   CLEAR EVENT LOG
   ===================================================== */

function clearEvents() {
  if (!confirm(
    "Clear dashboard event log?"
  )) {
    return;
  }

  systemEvents = [];

  renderEvents();

  showToast(
    "Event log cleared.",
    "success"
  );
}

/* =====================================================
   SOUND AND BROWSER NOTIFICATIONS
   ===================================================== */

/* =====================================================
   PLAY BEEP
   ===================================================== */

function playBeep(
  frequency = 700,
  duration = 0.2
) {
  if (!isSoundOn) return;

  try {
    const AudioClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioClass) return;

    if (!audioContext) {
      audioContext = new AudioClass();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(
        () => {}
      );
    }

    if (audioContext.state !== "running") {
      return;
    }

    const oscillator =
      audioContext.createOscillator();

    const gain =
      audioContext.createGain();

    oscillator.frequency.value =
      frequency;

    gain.gain.setValueAtTime(
      0.05,
      audioContext.currentTime
    );

    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + duration
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();

    oscillator.stop(
      audioContext.currentTime + duration
    );

  } catch (error) {
    console.warn(
      "Sound unavailable:",
      error
    );
  }
}

/* =====================================================
   WARNING SOUND
   ===================================================== */

function playWarningBeep() {
  playBeep(650, 0.3);
}

/* =====================================================
   DANGER ALARM
   ===================================================== */

function playDangerAlarm() {
  playBeep(900, 0.35);

  setTimeout(
    () => playBeep(700, 0.35),
    450
  );
}

/* =====================================================
   SAFE SOUND
   ===================================================== */

function playSafeChime() {
  playBeep(500, 0.2);
}

/* =====================================================
   TOGGLE SOUND
   ===================================================== */

function toggleSound() {
  isSoundOn = !isSoundOn;

  showToast(
    isSoundOn
      ? "Sound alerts enabled."
      : "Sound alerts disabled.",
    "info"
  );

  if (isSoundOn) {
    playBeep(600, 0.1);
  }
}

/* =====================================================
   BROWSER NOTIFICATIONS
   ===================================================== */

function sendBrowserNotification(
  title,
  message
) {
  if (!("Notification" in window)) {
    return;
  }

  if (
    Notification.permission === "granted"
  ) {
    new Notification(title, {
      body: message
    });
  }
}

/* =====================================================
   PROCESS NEW SENSOR READING
   ===================================================== */

function processNewReading(record, status) {
  const key = String(
    record.id ?? record.created_at
  );

  // Avoid processing the same reading twice.
  if (key === lastRecordKey) return;

  lastRecordKey = key;

  // First valid reading.
  if (!alertsInitialized) {
    alertsInitialized = true;
    lastAlertStatus = status;

    if (status === "DANGER") {
      showToast(
        "DANGER: High LPG concentration detected.",
        "danger",
        7000
      );
    }

    return;
  }

  // No status change.
  if (status === lastAlertStatus) {
    return;
  }

  lastAlertStatus = status;

  const ppm = formatNumber(
    record.gas_ppm
  );

  /* ===================================================
     DANGER
     =================================================== */

  if (status === "DANGER") {
    addEvent(
      "danger",
      `DANGER: LPG concentration ${ppm} ppm`
    );

    showToast(
      `DANGER: LPG ${ppm} ppm`,
      "danger",
      7000
    );

    playDangerAlarm();

    sendBrowserNotification(
      "GLiPS DANGER",
      `LPG concentration: ${ppm} ppm`
    );

  /* ===================================================
     WARNING
     =================================================== */

  } else if (status === "WARNING") {
    addEvent(
      "warning",
      `WARNING: LPG concentration ${ppm} ppm`
    );

    showToast(
      `WARNING: LPG ${ppm} ppm`,
      "warning"
    );

    playWarningBeep();

  /* ===================================================
     SAFE
     =================================================== */

  } else {
    addEvent(
      "safe",
      `LPG returned to SAFE: ${ppm} ppm`
    );

    showToast(
      "LPG concentration returned to SAFE.",
      "success"
    );

    playSafeChime();
  }
}


/* =====================================================
   GLiPS DASHBOARD
   PART 5: CAMERA, BACKEND & TELEGRAM
   ===================================================== */

/* =====================================================
   ESP32-S3 CAMERA
   ===================================================== */

function cameraStatus(online, label) {
  setText(
    "cameraStatusText",
    label
  );

  setText(
    "camStatusLabel",
    label
  );

  const dot = $("cameraStatusDot");

  if (dot) {
    dot.classList.toggle(
      "online",
      online
    );

    dot.classList.toggle(
      "offline",
      !online
    );
  }
}

/* =====================================================
   GET CAMERA IMAGE ELEMENT
   ===================================================== */

function getCameraImage() {
  if (cameraImageElement) {
    return cameraImageElement;
  }

  const video = $("cameraVideo");

  const placeholder = $(
    "cameraPlaceholder"
  );

  const image =
    document.createElement("img");

  image.id = "glipsCameraStream";
  image.alt = "ESP32-S3 Camera Stream";

  Object.assign(image.style, {
    display: "none",
    width: "100%",
    height: "100%",
    objectFit: "contain"
  });

  if (video) {
    video.style.display = "none";

    video.insertAdjacentElement(
      "afterend",
      image
    );

  } else if (placeholder?.parentElement) {
    placeholder.parentElement.appendChild(
      image
    );

  } else {
    return null;
  }

  cameraImageElement = image;

  return image;
}

/* =====================================================
   START / STOP CAMERA
   ===================================================== */

function normalizeCameraUrl(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Use an HTTPS camera URL without credentials or a fragment.");
  }
  if (url.pathname === "/") url.pathname = "/stream";
  return url.href;
}

function initializeCameraSettings() {
  try {
    const saved = localStorage.getItem("glips_camera_stream_url");
    if (saved) CAMERA.stream = normalizeCameraUrl(saved);
  } catch {
    // Invalid saved values or unavailable storage use the configured default.
    CAMERA.stream = CONFIG.cameraStreamUrl;
  }
  if ($("cameraStreamUrlInput")) $("cameraStreamUrlInput").value = CAMERA.stream;
}

function saveCameraSettings() {
  try {
    const url = normalizeCameraUrl($("cameraStreamUrlInput")?.value || "");
    // Persist first; leave the working stream unchanged if saving fails.
    localStorage.setItem("glips_camera_stream_url", url);
    stopCamera();
    CAMERA.stream = url;
    $("cameraStreamUrlInput").value = url;
    showToast("Camera URL saved on this browser. Select Connect camera.", "success");
  } catch (error) {
    showToast(`Camera URL not saved: ${error.message}`, "warning", 6000);
  }
}

async function toggleCamera() {
  if (isCameraOn) {
    stopCamera();
    return;
  }

  const image = getCameraImage();

  if (!image) {
    showToast(
      "Camera container not found.",
      "danger"
    );

    return;
  }

  const button = $("cameraToggleBtn");

  if (button) {
    button.disabled = true;
  }

  cameraStatus(
    false,
    "Connecting..."
  );

  image.onload = () => {
    clearTimeout(cameraConnectTimer);
    cameraStatus(
      true,
      "Streaming"
    );
  };

  image.onerror = () => {
    stopCamera("Connection failed");

    showToast(
      "Camera stream unavailable. Check camera IP and network.",
      "warning"
    );
  };

  cameraConnectTimer = setTimeout(() => {
    stopCamera("Connection timed out");
    showToast("Camera did not respond. Check its address and network.", "warning");
  }, 15000);

  try {
    image.src =
      `${CAMERA.stream}?t=${Date.now()}`;

    image.style.display = "block";

    if ($("cameraPlaceholder")) {
      $("cameraPlaceholder").style.display =
        "none";
    }

    isCameraOn = true;

    if (button) {
      button.innerHTML =
        '<i class="ti ti-camera-off"></i> Disconnect camera';
    }


    addEvent(
      "info",
      "ESP32 camera stream requested."
    );

  } catch (error) {
    console.error(error);

    stopCamera();

    showToast(
      "Unable to start camera.",
      "danger"
    );

  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

/* =====================================================
   STOP CAMERA STREAM
   ===================================================== */

function stopCamera(label = "Offline") {
  clearTimeout(cameraConnectTimer);
  isCameraOn = false;

  if (cameraImageElement) {
    cameraImageElement.onload = null;
    cameraImageElement.onerror = null;
    cameraImageElement.removeAttribute("src");

    cameraImageElement.style.display =
      "none";
  }

  if ($("cameraPlaceholder")) {
    $("cameraPlaceholder").style.display =
      "flex";
  }

  if ($("cameraToggleBtn")) {
    $("cameraToggleBtn").innerHTML =
      '<i class="ti ti-camera"></i> Connect camera';
  }


  cameraStatus(false, label);
  if (label !== "Offline" && $("cameraToggleBtn")) $("cameraToggleBtn").innerHTML = '<i class="ti ti-refresh"></i> Retry connection';
}

/* =====================================================
   BACKEND REQUESTS
   ===================================================== */

async function callBackend(endpoint, payload) {
  if (
    !CONFIG.enableBackendActions ||
    !endpoint
  ) {
    throw new Error(
      "Backend not configured yet."
    );
  }

  if (!sb) {
    throw new Error(
      "Supabase client is unavailable."
    );
  }

  const {
    data: sessionData,
    error: sessionError
  } = await sb.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const accessToken =
    sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error(
      "Please log in again to use this feature."
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",

      "Authorization": `Bearer ${accessToken}`,

      "apikey": CONFIG.supabaseAnonKey
    },

    signal: AbortSignal.timeout(30000),
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(
    () => ({})
  );

  if (!response.ok) {
    throw new Error(
      result.error ||
      result.message ||
      `Backend HTTP ${response.status}`
    );
  }

  return result;
}

/* =====================================================
   TELEGRAM FUNCTIONS
   ===================================================== */

/* =====================================================
   SEND MANUAL TELEGRAM ALERT
   ===================================================== */

async function sendTelegramAlert() {
  if (telegramSending) return;
  if (!CONFIG.telegramAlertEndpoint) {
    showToast("Manual Telegram alerts are not configured. Device alerts are separate.", "warning");
    return;
  }
  if (
    !currentSensor ||
    !lastReadingFresh || isReadingStale(currentSensor)
  ) {
    showToast(
      "No live sensor reading available.",
      "warning"
    );

    return;
  }

  telegramSending = true;
  try {
    await callBackend(
      CONFIG.telegramAlertEndpoint,
      {
        status: currentStatus,

        gas_ppm: getSensorGas(currentSensor),

        temperature: numberOrNull(
          currentSensor.temperature
        ),

        humidity: numberOrNull(
          currentSensor.humidity
        ),

        timestamp:
          currentSensor.created_at
      }
    );

    if ($("quickTelegram")) $("quickTelegram").dataset.checked = "true";
    setText("quickTelegram", "Last send succeeded");
    showToast(
      "Manual alert request accepted.",
      "success"
    );

    addEvent(
      "info",
      "Manual alert request accepted by the alert service."
    );

  } catch (error) {
    if ($("quickTelegram")) $("quickTelegram").dataset.checked = "true";
    setText("quickTelegram", "Last send failed");
    showToast(
      `Telegram: ${error.message}`,
      "warning",
      6000
    );
  } finally {
    telegramSending = false;
  }
}

/* =====================================================
   TEST TELEGRAM CONNECTION
   ===================================================== */

async function testTelegram() {
  try {
    await callBackend(
      CONFIG.telegramAlertEndpoint,
      {
        type: "test",

        message:
          "GLiPS Telegram connection test"
      }
    );

    showToast(
      "Telegram test successful.",
      "success"
    );

  } catch (error) {
    showToast(
      `Telegram test: ${error.message}`,
      "warning",
      6000
    );
  }
}

/* =====================================================
   GET TELEGRAM CHAT ID
   ===================================================== */

function getChatId() {
  return $("telegramChatId")
    ?.value?.trim() || "";
}

/* =====================================================
   GLiPS DASHBOARD
   PART 6: AI ASSISTANT, CHAT FORMATTING & FINAL SETUP
   ===================================================== */

/* =====================================================
   AI CHAT MODAL
   ===================================================== */

function getAIModal() {
  return $("chatModal") || $("ai-panel");
}

function openAI() {
  openAIChat();
}

function openAIChat() {
  const modal = getAIModal();
  if (!modal) return;
  if (!modal.classList.contains("show")) {
    aiReturnFocus = document.activeElement;
    aiPreviousBodyOverflow = document.body.style.overflow;
  }
  modal.classList.add("show");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  if (isAIWorking) modal.querySelector('[aria-label="Close AI chat"]')?.focus();
  else $("chatInput")?.focus();
}

function closeAI() { closeAIChat(); }

function closeAIChat() {
  const modal = getAIModal();
  if (!modal?.classList.contains("show")) return;
  modal.classList.remove("show");
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = aiPreviousBodyOverflow;
  const target = aiReturnFocus?.isConnected && !aiReturnFocus.disabled ? aiReturnFocus : $("aiHeaderButton");
  target?.focus();
}

async function submitAssistantQuestion(event) {
  event?.preventDefault();
  if (isAIWorking) return;
  const input = $("assistantQuestion");
  const question = input?.value.trim();
  if (!question) { input?.focus(); showToast("Enter a question to ask the assistant.", "info"); return; }
  input.value = "";
  openAIChat();
  await callAI(question, "main");
}

/* =====================================================
   FLOATING AI CHAT
   ===================================================== */

function openFloatingChat() { openAIChat(); }
function closeFloatingChat() { closeAIChat(); }

/* =====================================================
   SAFE AI MARKDOWN RENDERER

   Supports:
   - Bold and italic
   - Headings
   - Numbered lists
   - Bullet points
   - Paragraphs
   - Inline code
   - Code blocks
   ===================================================== */

function renderAIMarkdown(value) {
  const escaped = escapeHTML(
    String(value ?? "").replace(/\r\n?/g, "\n")
  );

  const lines = escaped.split("\n");

  const output = [];

  let listType = null;
  let inCode = false;
  let codeLines = [];

  function formatInline(line) {
    return line
      .replace(
        /`([^`]+)`/g,
        "<code>$1</code>"
      )
      .replace(
        /\*\*(.+?)\*\*/g,
        "<strong>$1</strong>"
      )
      .replace(
        /__(.+?)__/g,
        "<strong>$1</strong>"
      )
      .replace(
        /(^|[^\*])\*([^\*\n]+)\*(?!\*)/g,
        "$1<em>$2</em>"
      );
  }

  function closeList() {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Code block
    if (/^```/.test(trimmed)) {
      closeList();

      if (inCode) {
        output.push(
          `<pre><code>${codeLines.join("\n")}</code></pre>`
        );

        codeLines = [];
      }

      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Blank line
    if (!trimmed) {
      closeList();
      continue;
    }

    // Headings
    const heading = trimmed.match(
      /^(#{1,4})\s+(.+)$/
    );

    if (heading) {
      closeList();

      const level = Math.min(
        heading[1].length + 2,
        6
      );

      output.push(
        `<h${level}>${formatInline(heading[2])}</h${level}>`
      );

      continue;
    }

    // Ordered lists
    const ordered = trimmed.match(
      /^\d+[.)]\s+(.+)$/
    );

    // Unordered lists
    const unordered = trimmed.match(
      /^[-*+]\s+(.+)$/
    );

    if (ordered || unordered) {
      const nextType = ordered
        ? "ol"
        : "ul";

      if (listType !== nextType) {
        closeList();

        output.push(`<${nextType}>`);
        listType = nextType;
      }

      output.push(
        `<li>${formatInline(
          (ordered || unordered)[1]
        )}</li>`
      );

      continue;
    }

    // Normal paragraph
    closeList();

    output.push(
      `<p>${formatInline(trimmed)}</p>`
    );
  }

  closeList();

  if (inCode) {
    output.push(
      `<pre><code>${codeLines.join("\n")}</code></pre>`
    );
  }

  return output.join("");
}

/* =====================================================
   AI CHAT STYLING
   ===================================================== */

function ensureAIChatStyles() {
  if (
    document.getElementById(
      "glips-ai-markdown-styles"
    )
  ) {
    return;
  }

  const style = document.createElement("style");

  style.id = "glips-ai-markdown-styles";

  style.textContent = `
    .glips-ai-formatted {
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.65;
    }

    .glips-ai-formatted p {
      margin: 0 0 0.8em;
    }

    .glips-ai-formatted p:last-child {
      margin-bottom: 0;
    }

    .glips-ai-formatted ul,
    .glips-ai-formatted ol {
      margin: 0.35em 0 0.85em;
      padding-left: 1.45em;
      list-style-position: outside;
    }

    .glips-ai-formatted ul {
      list-style-type: disc;
    }

    .glips-ai-formatted ol {
      list-style-type: decimal;
    }

    .glips-ai-formatted li {
      display: list-item;
      margin: 0.25em 0;
    }

    .glips-ai-formatted strong {
      font-weight: 700;
    }

    .glips-ai-formatted em {
      font-style: italic;
    }

    .glips-ai-formatted h3,
    .glips-ai-formatted h4,
    .glips-ai-formatted h5,
    .glips-ai-formatted h6 {
      margin: 0.85em 0 0.35em;
      font-size: 1em;
      font-weight: 700;
    }

    .glips-ai-formatted pre {
      overflow-x: auto;
      padding: 0.75em;
      border-radius: 8px;
      background: rgba(127,127,127,.12);
      white-space: pre;
    }

    .glips-ai-formatted code {
      font-family: ui-monospace, monospace;
    }
  `;

  document.head.appendChild(style);
}

/* =====================================================
   ADD CHAT MESSAGE
   ===================================================== */

function addChatMessage(
  text,
  sender,
  target = "main"
) {
  const container = $("chatHistory");

  if (!container) {
    console.warn(
      "Chat container not found:",
      target
    );

    return;
  }

  const wrapper =
    document.createElement("div");

  wrapper.className =
    target === "floating"
      ? `floating-chat-msg ${sender}`
      : `chat-message ${sender}`;

  const bubble =
    document.createElement("div");

  bubble.className =
    target === "floating"
      ? "floating-chat-bubble"
      : "chat-bubble";

  if (sender === "bot") {
    ensureAIChatStyles();

    bubble.classList.add(
      "glips-ai-formatted"
    );

    bubble.innerHTML =
      renderAIMarkdown(text);

  } else {
    // User messages remain plain text.
    bubble.textContent = text;
  }

  wrapper.appendChild(bubble);
  container.appendChild(wrapper);

  container.scrollTop =
    container.scrollHeight;
}

/* =====================================================
   AI BACKEND REQUEST
   ===================================================== */

async function callAI(
  question,
  target = "main"
) {
  const cleanQuestion = String(
    question ?? ""
  ).trim();

  if (
    !cleanQuestion ||
    isAIWorking
  ) {
    return;
  }

  isAIWorking = true;

  addChatMessage(
    cleanQuestion,
    "user",
    target
  );

  setAllButtons(true);

  try {
    const live = lastReadingFresh && !isReadingStale(currentSensor);
    const recordedStatus = currentSensor
      ? getReadingStatus(currentSensor)
      : "UNKNOWN";

    // Sensor data sent as context to AI.
    const telemetry = currentSensor
      ? {
          gas_ppm: getSensorGas(currentSensor),

          temperature: numberOrNull(
            currentSensor.temperature
          ),

          humidity: numberOrNull(
            currentSensor.humidity
          ),

          status: live
            ? recordedStatus
            : "MONITORING OFFLINE",

          last_recorded_status:
            recordedStatus,

          is_live: live,
          // Reported commands only; never imply verified physical movement.
          output_reports_are_commands: true,
          hardware_outputs: live ? {
            gas_valve: getField(currentSensor, ["gas_valve", "valve_status", "solenoid_valve"]),
            valve_latched: getField(currentSensor, ["valve_latched"]),
            exhaust_fan: getField(currentSensor, ["exhaust_fan", "fan_status"]),
            buzzer: getField(currentSensor, ["buzzer", "buzzer_status"]),
            red_led: getField(currentSensor, ["red_led", "red_led_status"]),
            green_led: getField(currentSensor, ["green_led", "green_led_status"]),
            voice_alert: getField(currentSensor, ["voice_alert", "voice_status"])
          } : null,

          timestamp:
            currentSensor.created_at
        }
      : null;

    const result = await callBackend(
      CONFIG.aiEndpoint,
      {
        question: cleanQuestion,
        telemetry,

        // Previous messages for follow-up context.
        history: aiConversation.slice(-10)
      }
    );

    const answer = String(
      result.answer ||
      result.response ||
      ""
    ).trim();

    if (!answer) {
      throw new Error(
        "AI returned an empty answer."
      );
    }

    // Store successful conversation.
    aiConversation.push(
      {
        role: "user",
        content: cleanQuestion
      },
      {
        role: "assistant",
        content: answer
      }
    );

    // Keep recent conversation history.
    aiConversation =
      aiConversation.slice(-20);

    addChatMessage(
      answer,
      "bot",
      target
    );

  } catch (error) {
    console.error(
      "[GLiPS] AI Assistant:",
      error
    );

    addChatMessage(
      `AI Assistant unavailable: ${error.message}`,
      "bot",
      target
    );

    showToast(
      `AI error: ${error.message}`,
      "warning",
      6000
    );

  } finally {
    isAIWorking = false;
    setAllButtons(false);
  }
}

/* =====================================================
   SEND MAIN CHAT MESSAGE
   ===================================================== */

async function sendChat() {
  const input = $("chatInput");

  if (!input || isAIWorking) return;

  const question = input.value.trim();

  if (!question) return;

  input.value = "";

  await callAI(
    question,
    "main"
  );
}

/* =====================================================
   SEND FLOATING CHAT MESSAGE
   ===================================================== */

async function sendFloatingChat() { await sendChat(); }

/* =====================================================
   QUICK AI QUESTIONS
   ===================================================== */

function quickAsk(type) {
  const questions = {
    maintenance:
      "How should I maintain and calibrate the MQ-6 sensor?",

    safety:
      "What should I do when an LPG gas leak is detected?",

    trend:
      "Explain the latest recorded LPG readings and whether they are live."
  };

  const question =
    questions[type] || type;

  openAIChat();

  callAI(
    question,
    "main"
  );
}

/* =====================================================
   SUGGESTED AI QUESTIONS
   ===================================================== */

function triggerSuggestedAI(question) {
  if (isAIWorking) return;
  openAIChat();

  callAI(
    question,
    "main"
  );
}

/* =====================================================
   MARKDOWN COMPATIBILITY HELPER
   ===================================================== */

function parseMarkdown(text) {
  return renderAIMarkdown(text);
}

/* =====================================================
   DISABLE CHAT BUTTONS DURING REQUEST
   ===================================================== */

function setAllButtons(disabled) {
  document.querySelectorAll("#aiAssistantPanel button, #chatModal .chat-input-group button, #assistantQuestion, #chatInput")
    .forEach(element => { element.disabled = disabled; });
  setText("aiRequestStatus", disabled ? "Preparing an explanation..." : "");
}

/* =====================================================
   INITIALIZE CHAT INPUTS
   ===================================================== */

function initializeChatInputs() {
  const mainInput = $("chatInput");

  const floatingInput = $(
    "floatingChatInput"
  );

  if (mainInput) {
    mainInput.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();
          sendChat();
        }
      }
    );
  }

  if (floatingInput) {
    floatingInput.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();
          sendFloatingChat();
        }
      }
    );
  }
}

/* =====================================================
   KEYBOARD EVENTS
   ===================================================== */

function initializeKeyboardEvents() {
  document.addEventListener(
    "keydown",
    event => {
      const modal = getAIModal();
      if (event.key === "Tab" && modal?.classList.contains("show")) {
        const controls = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')]
          .filter(element => element.getClientRects().length);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === "Escape") {
        closeAI();
        closeFloatingChat();

        $("thresholdPopup")
          ?.classList.remove("show");

        $("tempPopup")
          ?.classList.remove("show");
      }
    }
  );
}

/* =====================================================
   LOGOUT
   ===================================================== */

async function logout() {
  if (!confirm(
    "Log out of GLiPS?"
  )) {
    return;
  }

  try {
    if (sb) {
      const { error } =
        await sb.auth.signOut();

      if (error) throw error;
    }

    sessionStorage.removeItem("lpg_logged_in");
    sessionStorage.removeItem("lpg_user");
    clearInterval(refreshTimer);
    clearInterval(countdownTimer);

    stopCamera();

    window.location.href =
      "index.html";

  } catch (error) {
    showToast(
      `Logout failed: ${error.message}`,
      "danger"
    );
  }
}

/* =====================================================
   GLOBAL ERROR HANDLING
   ===================================================== */

window.addEventListener(
  "error",
  event => {
    console.error(
      "[GLiPS] JavaScript error:",
      event.error || event.message
    );
  }
);

window.addEventListener(
  "unhandledrejection",
  event => {
    console.error(
      "[GLiPS] Promise error:",
      event.reason
    );
  }
);

/* =====================================================
   GLiPS DASHBOARD UI FIX
   LPG GAUGE + OFFLINE STATUS + SOUND BUTTON
   ===================================================== */

// Draw LPG gas meter
function drawGasGauge(ppm, isLive = false) {
  const canvas = $("gaugeCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = 260, height = 170;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = "auto";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const value = numberOrNull(ppm);
  const live = Boolean(isLive && !isReadingStale(currentSensor) && value !== null && value >= 0);
  const cx = 130, cy = 145, radius = 102, scaleMax = 500;
  const angle = number => Math.PI + Math.max(0, Math.min(1, number / scaleMax)) * Math.PI;
  function arc(start, end, color) {
    ctx.beginPath();ctx.arc(cx, cy, radius, start, end);
    ctx.strokeStyle = color;ctx.lineWidth = 16;ctx.lineCap = "butt";ctx.stroke();
  }
  arc(Math.PI, Math.PI * 2, "#dfe6e9");
  if (live) {
    arc(Math.PI, angle(THRESHOLD.SAFE_MAX), "#269b6d");
    arc(angle(THRESHOLD.SAFE_MAX), angle(THRESHOLD.DANGER_MIN), "#e7ab3e");
    arc(angle(THRESHOLD.DANGER_MIN), Math.PI * 2, "#d85858");
  }
  ctx.font = "11px system-ui, sans-serif";ctx.fillStyle = "#70828c";ctx.textBaseline = "middle";
  [0, THRESHOLD.SAFE_MAX, THRESHOLD.DANGER_MIN, scaleMax].forEach(number => {
    const theta = angle(number);
    ctx.textAlign = number === 0 ? "left" : number === scaleMax ? "right" : "center";
    ctx.fillText(number === scaleMax ? "500+" : String(number), cx + Math.cos(theta) * 124, cy + Math.sin(theta) * 124 + 7);
  });
  if (live) {
    const theta = angle(value);
    ctx.beginPath();ctx.moveTo(cx, cy);ctx.lineTo(cx + Math.cos(theta) * 79, cy + Math.sin(theta) * 79);
    ctx.strokeStyle = getReadingStatus(currentSensor) === "DANGER" ? "#b83e3e" : "#183f4b";
    ctx.lineWidth = 3;ctx.lineCap = "round";ctx.stroke();
    ctx.beginPath();ctx.arc(cx, cy, 5, 0, Math.PI * 2);ctx.fillStyle = "#183f4b";ctx.fill();
  }
  canvas.dataset.live = String(live);
  canvas.setAttribute("aria-label", live ? `Gas meter: ${formatNumber(value)} ppm. ${getReadingStatus(currentSensor)}.` : "Gas meter: no live reading. Current gas level is unknown.");
  setText("heroReadingNote", live ? "Current sensor reading" : "No live reading");
  const hint = $("meterHint");
  const held = live && value < THRESHOLD.DANGER_MIN && getReadingStatus(currentSensor) === "DANGER";
  if (hint) {
    hint.hidden = !held && !(live && value > scaleMax);
    hint.textContent = held ? "Danger warning remains active."
      : live && value > scaleMax ? "Above meter scale; the full reading is shown above." : "";
  }
}

// Update sound button label and icon
function updateSoundButton() {
  const button = document.getElementById("soundBtn");
  if (!button) return;

  button.innerHTML = isSoundOn
    ? '<i class="ti ti-volume"></i> Sound ON'
    : '<i class="ti ti-volume-off"></i> Sound OFF';

  button.setAttribute("aria-pressed", String(isSoundOn));
  button.title = isSoundOn
    ? "Disable browser sound alerts"
    : "Enable browser sound alerts";
}

// Replace existing sound toggle behavior
toggleSound = function () {
  isSoundOn = !isSoundOn;

  updateSoundButton();

  showToast(
    isSoundOn
      ? "Sound alerts enabled."
      : "Sound alerts disabled.",
    "info"
  );

  if (isSoundOn) {
    playBeep(600, 0.1);
  }
};

// Keep the original hero update behavior
// and add the LPG gauge.
const originalUpdateHeroValues = updateHeroValues;

updateHeroValues = function (record) {
  originalUpdateHeroValues(record);

  drawGasGauge(
    getSensorGas(record),
    lastReadingFresh
  );
};

// Shorter offline message
const originalShowOffline = showOffline;

// Bila ESP32 OFFLINE (takde data baru > 20 saat)
showOffline = function (message) {
  originalShowOffline(message);
  setText("heroStateLabel", "Unavailable");
  setText("heroStatus", !databaseConnected ? "Monitoring connection lost"
    : hasSensorFault(currentSensor) ? "Gas sensor needs attention" : "Gas readings are unavailable");
  setText("heroMessage", "The current gas level is unknown. Check the monitoring device and connection; follow your site procedures if a leak is suspected.");
  setText("heroReadingNote", "No live reading");
  ["heroGas", "heroTemp", "heroHumid", "heroTime"].forEach(id => setText(id, "--"));
  drawGasGauge(getSensorGas(currentSensor), false);
};

// Initialize UI fixes
function initializeGLiPSUIFixes() {
  initializeCameraSettings();
  if ($("manualAlertButton")) $("manualAlertButton").hidden = !CONFIG.telegramAlertEndpoint;
  updateSoundButton();

  drawGasGauge(
    getSensorGas(currentSensor),
    lastReadingFresh
  );

  window.addEventListener("resize", () => {
    drawGasGauge(
      getSensorGas(currentSensor),
      lastReadingFresh
    );
  });
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeGLiPSUIFixes,
    { once: true }
  );
} else {
  initializeGLiPSUIFixes();
}
