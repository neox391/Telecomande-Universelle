const fallbackDevices = [
  {
    id: "tv",
    name: "Salon TV",
    type: "Television",
    meta: "Samsung Neo QLED",
    status: "Allumee",
  },
  {
    id: "audio",
    name: "Barre de son",
    type: "Audio",
    meta: "Dolby Atmos",
    status: "En veille",
  },
  {
    id: "stream",
    name: "Streaming Box",
    type: "Streaming",
    meta: "4K UHD",
    status: "Connectee",
  },
  {
    id: "lights",
    name: "Lumieres",
    type: "Maison",
    meta: "Philips Hue",
    status: "Ambiance tamisee",
  },
];

const scenes = [
  {
    name: "Soiree cinema",
    description: "Allume TV + audio, baisse la lumiere, lance la page d'accueil.",
    actions: ["power", "mute-off", "home"],
  },
  {
    name: "Mode musique",
    description: "Active l'audio, augmente le volume et passe sur streaming.",
    actions: ["power", "volume-up", "volume-up", "source-stream"],
  },
  {
    name: "Nuit",
    description: "Eteint les appareils medias et coupe les lumieres principales.",
    actions: ["mute", "power", "lights-off"],
  },
];

const actionLabels = {
  power: "Marche / Arret",
  mute: "Muet",
  "mute-off": "Sortie du mode muet",
  home: "Accueil",
  up: "Navigation haut",
  down: "Navigation bas",
  left: "Navigation gauche",
  right: "Navigation droite",
  ok: "Validation",
  "volume-up": "Volume +",
  "volume-down": "Volume -",
  "channel-up": "Chaine +",
  "channel-down": "Chaine -",
  previous: "Piste precedente",
  "play-pause": "Lecture / Pause",
  next: "Piste suivante",
  rewind: "Retour rapide",
  record: "Enregistrement",
  forward: "Avance rapide",
  "lights-off": "Lumieres eteintes",
  "source-stream": "Source streaming",
};

const state = {
  devices: [...fallbackDevices],
  activeDeviceId: fallbackDevices[0].id,
  history: [],
};

const deviceGrid = document.querySelector("#deviceGrid");
const sceneList = document.querySelector("#sceneList");
const historyList = document.querySelector("#historyList");
const activeDeviceName = document.querySelector("#activeDeviceName");
const activeDeviceStatus = document.querySelector("#activeDeviceStatus");
const connectionState = document.querySelector("#connectionState");
const networkSummary = document.querySelector("#networkSummary");
const launchHint = document.querySelector("#launchHint");
const clearHistoryButton = document.querySelector("#clearHistory");
const installButton = document.querySelector("#installButton");
const scanButton = document.querySelector("#scanButton");
const deviceCardTemplate = document.querySelector("#deviceCardTemplate");
const sceneButtonTemplate = document.querySelector("#sceneButtonTemplate");
let deferredInstallPrompt = null;

if (window.location.protocol === "file:") {
  launchHint.hidden = false;
  networkSummary.textContent =
    "Mode fichier local detecte. Le scan reseau reel et les commandes necessitent le serveur Node.";
  connectionState.textContent = "Lancer via launch.bat";
}

function getActiveDevice() {
  return (
    state.devices.find((device) => device.id === state.activeDeviceId) ??
    state.devices[0]
  );
}

function renderDevices() {
  deviceGrid.innerHTML = "";

  for (const device of state.devices) {
    const fragment = deviceCardTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".device-card");

    button.classList.toggle("active", device.id === state.activeDeviceId);
    button.dataset.deviceId = device.id;
    fragment.querySelector(".device-type").textContent = device.type;
    fragment.querySelector(".device-name").textContent = device.name;
    fragment.querySelector(".device-meta").textContent =
      `${device.meta} · ${device.status}` + (device.ip ? ` · ${device.ip}` : "");

    deviceGrid.appendChild(fragment);
  }
}

function renderScenes() {
  sceneList.innerHTML = "";

  for (const scene of scenes) {
    const fragment = sceneButtonTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".scene-button");

    fragment.querySelector(".scene-name").textContent = scene.name;
    fragment.querySelector(".scene-description").textContent = scene.description;
    button.dataset.sceneName = scene.name;

    button.addEventListener("click", () => {
      runScene(scene);
    });

    sceneList.appendChild(fragment);
  }
}

function renderNumberPad() {
  const numberPad = document.querySelector("#numberPad");
  const values = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

  values.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = `key-${value}`;
    button.textContent = value;
    numberPad.appendChild(button);
  });
}

function renderActiveDevice() {
  const activeDevice = getActiveDevice();
  activeDeviceName.textContent = activeDevice.name;
  activeDeviceStatus.textContent = activeDevice.status;
}

function renderHistory() {
  historyList.innerHTML = "";

  if (state.history.length === 0) {
    const item = document.createElement("li");
    item.innerHTML = "<strong>Aucune action</strong><span class='history-meta'>Les commandes effectuees apparaissent ici.</span>";
    historyList.appendChild(item);
    return;
  }

  state.history.forEach((entry) => {
    const item = document.createElement("li");
    item.innerHTML = `<strong>${entry.label}</strong><span class="history-meta">${entry.device} · ${entry.time}</span>`;
    historyList.appendChild(item);
  });
}

function addHistory(actionKey, triggerLabel = null, deviceOverride = null) {
  const activeDevice = getActiveDevice();
  const timestamp = new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const label = triggerLabel
    ? `${triggerLabel} · ${actionLabels[actionKey] ?? actionKey}`
    : actionLabels[actionKey] ?? `Commande ${actionKey}`;

  state.history.unshift({
    label,
    device: deviceOverride ?? activeDevice.name,
    time: timestamp,
  });

  state.history = state.history.slice(0, 8);
  connectionState.textContent = `Commande envoyee a ${activeDevice.name}`;
  renderHistory();
}

async function sendCommand(actionKey, device = getActiveDevice(), source = null) {
  const payload = {
    action: actionKey,
    deviceId: device.id,
    deviceName: device.name,
    ip: device.ip ?? null,
    protocol: device.protocol ?? "generic",
    source,
  };

  try {
    const response = await fetch("/api/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error("Commande refusee");
    }

    const result = await response.json();
    addHistory(actionKey, source, device.name);
    connectionState.textContent = result.message;
  } catch (error) {
    addHistory(actionKey, source ? `${source} (local)` : null, device.name);
    connectionState.textContent = "Serveur local indisponible";
  }
}

async function runScene(scene) {
  const activeDevice = getActiveDevice();

  for (const action of scene.actions) {
    await sendCommand(action, activeDevice, scene.name);
  }
}

function normalizeDiscoveredDevices(scanResult) {
  const discovered = scanResult.devices.map((device, index) => ({
    id: device.id ?? `scan-${index}`,
    name: device.name ?? `Appareil ${index + 1}`,
    type: device.type ?? "Reseau",
    meta: device.meta ?? "Appareil detecte",
    status: device.status ?? "Disponible",
    ip: device.ip ?? "",
    protocol: device.protocol ?? "generic",
  }));

  if (discovered.length > 0) {
    return discovered;
  }

  return [...fallbackDevices];
}

async function scanNetwork() {
  if (window.location.protocol === "file:") {
    state.devices = [...fallbackDevices];
    renderDevices();
    renderActiveDevice();
    connectionState.textContent = "Serveur requis";
    networkSummary.textContent =
      "Ouvre l'application avec launch.bat pour lancer automatiquement le serveur et activer le scan.";
    return;
  }

  connectionState.textContent = "Scan en cours...";
  scanButton.disabled = true;
  networkSummary.textContent =
    "Analyse du reseau local, detection ARP et recherche SSDP/UPnP en cours.";

  try {
    const response = await fetch("/api/scan");
    if (!response.ok) {
      throw new Error("Echec du scan");
    }

    const result = await response.json();
    state.devices = normalizeDiscoveredDevices(result);
    state.activeDeviceId = state.devices[0].id;
    renderDevices();
    renderActiveDevice();

    networkSummary.textContent = `${result.summary}. Sous-reseaux: ${result.networks.join(", ") || "indisponibles"}.`;
    connectionState.textContent = `${result.devices.length} appareil(s) detecte(s)`;
  } catch (error) {
    state.devices = [...fallbackDevices];
    state.activeDeviceId = state.devices[0].id;
    renderDevices();
    renderActiveDevice();
    networkSummary.textContent =
      "Le backend local n'a pas repondu. Lancez le serveur Node pour activer le scan reseau reel.";
    connectionState.textContent = "Mode local de demonstration";
  } finally {
    scanButton.disabled = false;
  }
}

function handleDeviceSelection(event) {
  const target = event.target.closest("[data-device-id]");
  if (!target) {
    return;
  }

  state.activeDeviceId = target.dataset.deviceId;
  renderDevices();
  renderActiveDevice();
  connectionState.textContent = `${getActiveDevice().name} selectionne`;
}

function handleCommand(event) {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  sendCommand(target.dataset.action);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("sw.js");
        await registration.update();
      } catch (error) {
        connectionState.textContent = "Mode hors ligne indisponible";
      }
    });
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

clearHistoryButton.addEventListener("click", () => {
  state.history = [];
  connectionState.textContent = "Historique efface";
  renderHistory();
});

scanButton.addEventListener("click", scanNetwork);
deviceGrid.addEventListener("click", handleDeviceSelection);
document.body.addEventListener("click", handleCommand);

renderDevices();
renderScenes();
renderNumberPad();
renderActiveDevice();
renderHistory();
registerServiceWorker();
scanNetwork();
