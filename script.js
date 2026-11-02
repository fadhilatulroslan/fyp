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

  cameraIP: "10.75.100.114",

  aiEndpoint:
    "https://fkfgimyelgvlsbtxhvih.supabase.co/functions/v1/glips-ai",

  telegramAlertEndpoint: "",

  telegramPhotoEndpoint: "",

  enableBackendActions: true
};

/* =====================================================
   SENSOR THRESHOLDS
   ===================================================== */

const THRESHOLD = {
  SAFE_MAX: 100,
  DANGER_MIN: 300
};

/* =====================================================
   CAMERA CONFIGURATION
   ===================================================== */

const CAMERA = {
  stream: `http://${CONFIG.cameraIP}:81/stream`,
  capture: `http://${CONFIG.cameraIP}/capture`
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

let cameraImageElement = null;
let capturedImageData = null;

let alertHistory = [];
let historyLastLoadedAt = 0;
let historyLoading = false;
let historyLoadedFromServer = false;
let systemEvents = [];
let aiConversation = [];

let currentChartPeriod = 20;

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
    element.textContent = value;
  }
}

function setHTML(id, value) {
  const element = $(id);

  if (element) {
    element.innerHTML = value;
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
    value === ""
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

  return null;
}

function normalizeState(value) {
  if (value === null || value === undefined) {
    return "UNKNOWN";
  }

  if (typeof value === "boolean") {
    return value ? "ON" : "OFF";
  }

  return String(value).trim().toUpperCase();
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

  const hasRecord = Boolean(currentSensor);

  const recordedStatus = hasRecord
    ? getGasStatus(currentSensor.gas_ppm)
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

  updateHardware(null);

  console.warn("[GLiPS]", message);
}

/* =====================================================
   DASHBOARD INITIALIZATION
   ===================================================== */

async function initializeGLiPS() {
  console.log("[GLiPS] Initializing...");

  hideLoading();

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
      .limit(500);

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

    const recordedStatus = getGasStatus(
      currentSensor.gas_ppm
    );

    // Check if sensor reading is recent.
    lastReadingFresh =
      recordedStatus !== "UNKNOWN" &&
      !isReadingStale(currentSensor);

    // Update charts and alert history.
    updateChart(data);
    if (!historyLoadedFromServer) loadAlertHistoryFromData(data);
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
        "ESP32 has not sent a recent valid reading."
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
    formatNumber(record.gas_ppm)
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
      title: "SYSTEM SAFE",
      description:
        "Live LPG reading is within the configured safe range.",
      icon: "ti ti-shield-check"
    },

    WARNING: {
      title: "WARNING",
      description:
        "Elevated LPG reading detected. Check the area.",
      icon: "ti ti-alert-triangle"
    },

    DANGER: {
      title: "DANGER DETECTED",
      description:
        "High LPG reading detected. Follow emergency safety procedures.",
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

  setText("heroStatus", content.title);
  setText("heroMessage", content.description);

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
  const ppm = numberOrNull(record.gas_ppm);

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
  },

  {
    ids: ["voiceAlertStatus"],
    fields: [
      "voice_alert",
      "voice_status"
    ]
  }
];

/* =====================================================
   UPDATE HARDWARE STATUS
   ===================================================== */

function updateHardware(record) {
  HARDWARE_DEVICES.forEach(device => {
    const value =
      lastReadingFresh && record
        ? normalizeState(
            getField(record, device.fields)
          )
        : "UNKNOWN";

    device.ids.forEach(id => {
      const element = $(id);

      if (!element) return;

      element.textContent = value;

      element.classList.remove(
        "on",
        "off",
        "active",
        "offline",
        "closed"
      );

      if (value === "UNKNOWN") {
        element.classList.add("offline");

      } else if (
        ["ON", "ACTIVE", "TRUE", "1"]
          .includes(value)
      ) {
        element.classList.add("on");

      } else if (value === "CLOSED") {
        element.classList.add("closed");

      } else {
        element.classList.add("off");
      }
    });
  });
}

/* =====================================================
   HARDWARE CARD EXPANSION
   ===================================================== */

function toggleHardware(card) {
  card?.classList.toggle("expanded");
}

/* =====================================================
   CONNECTIVITY STATUS
   ===================================================== */

function updateConnectivity(record) {
  setText("quickEsp32", "Reporting");
  setText("quickESP32", "Reporting");

  setText("esp32Status", "REPORTING");
  setText("esp32StatusBadge", "ONLINE");

  const wifi = getField(record, [
    "wifi_status",
    "wifi_connected"
  ]);

  setText(
    "wifiStatus",
    wifi === null
      ? "NOT REPORTED"
      : normalizeState(wifi)
  );

  setText(
    "quickTelegram",
    "Not verified"
  );

  setText(
    "quickUpdate",
    formatTime(record.created_at)
  );
}

/* =====================================================
   SENSOR CHART
   ===================================================== */

function initializeChart() {
  const canvas = $("sensorChart");

  if (!canvas || !window.Chart) {
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
            label: "LPG (ppm)",
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
            label: "Warning threshold",
            data: [],
            borderColor: "#d97706",
            borderDash: [5, 5],
            borderWidth: 1.5,
            pointRadius: 0
          },

          {
            label: "Danger threshold",
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
            suggestedMax: 350,

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
  if (!sensorChart) return;

  const selected = records
    .slice(0, currentChartPeriod)
    .reverse();

  sensorChart.data.labels = selected.map(
    row => formatTimeOnly(row.created_at)
  );

  sensorChart.data.datasets[0].data =
    selected.map(
      row => numberOrNull(row.gas_ppm)
    );

  sensorChart.data.datasets[1].data =
    selected.map(
      () => THRESHOLD.SAFE_MAX
    );

  sensorChart.data.datasets[2].data =
    selected.map(
      () => THRESHOLD.DANGER_MIN
    );

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
    const status = getGasStatus(
      record.gas_ppm
    );

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
        `${date.getFullYear()}-${String(
          date.getMonth() + 1
        ).padStart(2, "0")}`
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
  const selected =
    $("monthFilter")?.value || "all";

  if (selected === "all") {
    return alertHistory;
  }

  return alertHistory.filter(alert => {
    const date = new Date(
      alert.created_at
    );

    const month =
      `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;

    return month === selected;
  });
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
    tableBody.innerHTML = alerts.length
      ? alerts.map(alert => `<tr>
          <td>${escapeHTML(formatDate(alert.created_at))}</td>
          <td>${escapeHTML(formatTimeOnly(alert.created_at))}</td>
          <td>${escapeHTML(formatNumber(alert.gas_ppm))} ppm</td>
          <td><span class="status-badge ${escapeHTML(alert.status.toLowerCase())}">${escapeHTML(alert.status)}</span></td>
        </tr>`).join("")
      : '<tr><td colspan="4">No alert records found for this month.</td></tr>';
  }
  if (list) {
    list.innerHTML = alerts.length
      ? alerts.map(alert => `<div class="alert-item ${escapeHTML(alert.status.toLowerCase())}">
          <div><strong>${escapeHTML(alert.status)}</strong><div>${escapeHTML(formatTime(alert.created_at))}</div></div>
          <strong>${escapeHTML(formatNumber(alert.gas_ppm))} ppm</strong>
        </div>`).join("")
      : '<div class="event-empty">No alert records found for this month.</div>';
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
        .select("id,created_at,gas_ppm")
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!Array.isArray(data) || !data.length) break;
      rows.push(...data);
      if (data.length < pageSize) break;
    }
    loadAlertHistoryFromData(rows);
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
    cameraStatus(
      true,
      "Streaming"
    );
  };

  image.onerror = () => {
    cameraStatus(
      false,
      "Connection failed"
    );

    showToast(
      "Camera stream unavailable. Check camera IP and network.",
      "warning"
    );

    stopCamera();
  };

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
        '<i class="ti ti-camera-off"></i> Stop Camera';
    }

    if ($("captureBtn")) {
      $("captureBtn").disabled = false;
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

function stopCamera() {
  isCameraOn = false;

  if (cameraImageElement) {
    cameraImageElement.onload = null;
    cameraImageElement.onerror = null;
    cameraImageElement.src = "";

    cameraImageElement.style.display =
      "none";
  }

  if ($("cameraPlaceholder")) {
    $("cameraPlaceholder").style.display =
      "flex";
  }

  if ($("cameraToggleBtn")) {
    $("cameraToggleBtn").innerHTML =
      '<i class="ti ti-camera"></i> Start Camera';
  }

  if ($("captureBtn")) {
    $("captureBtn").disabled = true;
  }

  cameraStatus(
    false,
    "Offline"
  );
}

/* =====================================================
   CAPTURE CAMERA IMAGE
   ===================================================== */

async function captureImage() {
  if (!isCameraOn) {
    showToast(
      "Start camera first.",
      "warning"
    );

    return;
  }

  try {
    const response = await fetch(
      `${CAMERA.capture}?t=${Date.now()}`,
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const blob = await response.blob();

    if (!blob.type.startsWith("image/")) {
      throw new Error(
        "Invalid image response."
      );
    }

    capturedImageData = await new Promise(
      (resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () =>
          resolve(reader.result);

        reader.onerror = reject;

        reader.readAsDataURL(blob);
      }
    );

    const preview = $("capturedPreview");

    if ($("capturedImage")) {
      $("capturedImage").src =
        capturedImageData;
    }

    if (preview) {
      preview.style.display = "flex";
      preview.classList.add("show");
    }

    const time = formatTimeOnly(
      new Date()
    );

    setText(
      "captureTime",
      `Captured: ${time}`
    );

    setText(
      "camLastCapture",
      time
    );

    if ($("sendPhotoBtn")) {
      $("sendPhotoBtn").disabled = false;
    }

    showToast(
      "Image captured successfully.",
      "success"
    );

    addEvent(
      "info",
      "Camera image captured."
    );

  } catch (error) {
    console.error(
      "[GLiPS] Camera capture:",
      error
    );

    showToast(
      `Camera capture failed: ${error.message}`,
      "danger",
      6000
    );
  }
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
  if (
    !currentSensor ||
    !lastReadingFresh
  ) {
    showToast(
      "No live sensor reading available.",
      "warning"
    );

    return;
  }

  try {
    await callBackend(
      CONFIG.telegramAlertEndpoint,
      {
        status: currentStatus,

        gas_ppm: numberOrNull(
          currentSensor.gas_ppm
        ),

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

    showToast(
      "Telegram alert sent.",
      "success"
    );

    addEvent(
      "info",
      "Manual Telegram alert sent."
    );

  } catch (error) {
    showToast(
      `Telegram: ${error.message}`,
      "warning",
      6000
    );
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
   SEND CAPTURED IMAGE TO TELEGRAM
   ===================================================== */

async function sendCapturedImageToTelegram() {
  if (!capturedImageData) {
    showToast(
      "Capture an image first.",
      "warning"
    );

    return;
  }

  try {
    await callBackend(
      CONFIG.telegramPhotoEndpoint,
      {
        image: capturedImageData,

        status: currentStatus,

        gas_ppm: numberOrNull(
          currentSensor?.gas_ppm
        )
      }
    );

    showToast(
      "Photo sent to Telegram.",
      "success"
    );

  } catch (error) {
    showToast(
      `Photo upload: ${error.message}`,
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
   AUTOMATIC CAMERA CAPTURE ON DANGER
   ===================================================== */

async function autoCaptureOnDanger() {
  // Automatic capture should run on ESP32/backend
  // so it works even when dashboard is closed.

  console.info(
    "[GLiPS] Automatic camera capture requires device/backend integration."
  );
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

  if (!modal) {
    showToast(
      "AI modal not found in HTML.",
      "danger"
    );
    return;
  }

  modal.classList.add("show");
  modal.style.display = "flex";

  $("chatInput")?.focus();
}

function closeAI() {
  closeAIChat();
}

function closeAIChat() {
  const modal = getAIModal();

  if (!modal) return;

  modal.classList.remove("show");
  modal.style.display = "none";
}

/* =====================================================
   FLOATING AI CHAT
   ===================================================== */

function openFloatingChat() {
  const panel = $("floatingChat");

  if (panel) {
    panel.classList.add("show");
    panel.style.display = "flex";
  }

  $("floatingChatInput")?.focus();
}

function closeFloatingChat() {
  const panel = $("floatingChat");

  if (panel) {
    panel.classList.remove("show");
    panel.style.display = "none";
  }
}

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
  const container =
    target === "floating"
      ? $("floatingChatBody")
      : $("chatHistory");

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
    const recordedStatus = currentSensor
      ? getGasStatus(
          currentSensor.gas_ppm
        )
      : "UNKNOWN";

    // Sensor data sent as context to AI.
    const telemetry = currentSensor
      ? {
          gas_ppm: numberOrNull(
            currentSensor.gas_ppm
          ),

          temperature: numberOrNull(
            currentSensor.temperature
          ),

          humidity: numberOrNull(
            currentSensor.humidity
          ),

          status: lastReadingFresh
            ? recordedStatus
            : "MONITORING OFFLINE",

          last_recorded_status:
            recordedStatus,

          is_live: lastReadingFresh,

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

async function sendFloatingChat() {
  const input = $("floatingChatInput");

  if (!input || isAIWorking) return;

  const question = input.value.trim();

  if (!question) return;

  input.value = "";

  await callAI(
    question,
    "floating"
  );
}

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
  document.querySelectorAll(
    "#ai-panel button, #chatModal button, #floatingChat button"
  ).forEach(button => {
    button.disabled = disabled;
  });
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

    clearInterval(refreshTimer);
    clearInterval(countdownTimer);

    stopCamera();

    window.location.href =
      "login.html";

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
  const canvas = document.getElementById("gaugeCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = 200;
  const height = 120;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const cx = 100;
  const cy = 105;
  const radius = 78;
  const lineWidth = 13;

  const value =
    ppm === null || ppm === undefined || ppm === ""
      ? null
      : Number(ppm);

  const valid = value !== null && Number.isFinite(value) && value >= 0;

  const safeMax = THRESHOLD.SAFE_MAX;
  const dangerMin = THRESHOLD.DANGER_MIN;
  const scaleMax = Math.max(dangerMin * 1.5, 500);

  function angleFor(number) {
    const fraction = Math.max(0, Math.min(1, number / scaleMax));
    return Math.PI + fraction * Math.PI;
  }

  function arc(start, end, color) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "butt";
    ctx.stroke();
  }

  // Background track
  arc(Math.PI, Math.PI * 2, "#e2e8f0");

  // SAFE, WARNING, DANGER sections
  arc(Math.PI, angleFor(safeMax), "#22c55e");
  arc(angleFor(safeMax), angleFor(dangerMin), "#f59e0b");
  arc(angleFor(dangerMin), Math.PI * 2, "#ef4444");

  // Needle
  if (valid) {
    const angle = angleFor(value);
    const needleLength = 65;

    const nx = cx + Math.cos(angle) * needleLength;
    const ny = cy + Math.sin(angle) * needleLength;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#334155";
    ctx.fill();
  }

  // Offline / historical indicator
  const wrap = canvas.closest(".gauge-wrap");

  if (wrap) {
    let mode = wrap.querySelector(".glips-gauge-mode");

    if (!mode) {
      mode = document.createElement("div");
      mode.className = "glips-gauge-mode";
      wrap.appendChild(mode);
    }

    mode.textContent = !valid
  ? "NO READING"
  : isLive
    ? "LIVE READING"
    : "LAST RECORDED";
    mode.style.fontSize = "10px";
    mode.style.fontWeight = "700";
    mode.style.letterSpacing = "0.5px";
    mode.style.textAlign = "center";
    mode.style.position = "absolute";
    mode.style.bottom = "-10px";
    mode.style.left = "0";
    mode.style.right = "0";
    mode.style.color = isLive ? "#16a34a" : "#64748b";
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
    record?.gas_ppm ?? null,
    lastReadingFresh
  );
};

// Shorter offline message
const originalShowOffline = showOffline;

// Bila ESP32 OFFLINE (takde data baru > 20 saat)
showOffline = function (message) {
  originalShowOffline(message);

  const hasRecord = Boolean(currentSensor);

  setText(
    "heroStatus",
    hasRecord ? "ESP32 DISCONNECTED" : "MONITORING UNAVAILABLE"
  );

  setText(
    "heroMessage",
    hasRecord
      ? `⚠️ SENSOR OFFLINE. Showing last saved reading from ${formatTime(currentSensor.created_at)}.`
      : "No sensor data found in database."
  );

  drawGasGauge(
    hasRecord ? currentSensor.gas_ppm : null,
    false // Memaksa gauge tunjuk "LAST RECORDED"
  );
};

// Initialize UI fixes
function initializeGLiPSUIFixes() {
  updateSoundButton();

  drawGasGauge(
    currentSensor?.gas_ppm ?? null,
    lastReadingFresh
  );

  window.addEventListener("resize", () => {
    drawGasGauge(
      currentSensor?.gas_ppm ?? null,
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
