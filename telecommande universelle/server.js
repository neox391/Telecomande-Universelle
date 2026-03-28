const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const dgram = require("dgram");
const dns = require("dns").promises;
const { execFile } = require("child_process");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ROOT = __dirname;
const COMMON_PORTS = [
  { port: 80, label: "HTTP" },
  { port: 443, label: "HTTPS" },
  { port: 8008, label: "Chromecast/Google Cast" },
  { port: 8009, label: "Chromecast Secure" },
  { port: 5555, label: "Android ADB" },
  { port: 8060, label: "Roku ECP" },
  { port: 1400, label: "Sonos" },
  { port: 554, label: "RTSP Camera" },
  { port: 1883, label: "MQTT" },
];
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function getLanNetworks() {
  const interfaces = os.networkInterfaces();
  const networks = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }

      if (entry.address.startsWith("169.254.")) {
        continue;
      }

      networks.push({
        address: entry.address,
        netmask: entry.netmask,
        cidr: entry.cidr,
        networkAddress: numberToIp(ipToNumber(entry.address) & ipToNumber(entry.netmask)),
        broadcastAddress: numberToIp(
          (ipToNumber(entry.address) & ipToNumber(entry.netmask)) |
            (~ipToNumber(entry.netmask) >>> 0)
        ),
        range: buildRange(entry.address, entry.netmask),
      });
    }
  }

  return networks;
}

function ipToNumber(ip) {
  return ip
    .split(".")
    .map(Number)
    .reduce((accumulator, current) => ((accumulator << 8) + current) >>> 0, 0);
}

function numberToIp(number) {
  return [
    (number >>> 24) & 255,
    (number >>> 16) & 255,
    (number >>> 8) & 255,
    number & 255,
  ].join(".");
}

function buildRange(address, netmask) {
  const addressNumber = ipToNumber(address);
  const maskNumber = ipToNumber(netmask);
  const network = addressNumber & maskNumber;
  const broadcast = network | (~maskNumber >>> 0);
  const hosts = [];

  for (let current = network + 1; current < broadcast; current += 1) {
    hosts.push(numberToIp(current >>> 0));
  }

  return hosts;
}

function probeHost(ip) {
  return new Promise((resolve) => {
    execFile("ping", ["-n", "1", "-w", "120", ip], { windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

async function pingSweep(hosts, concurrency = 32) {
  const active = [];
  let index = 0;

  async function worker() {
    while (index < hosts.length) {
      const currentIndex = index;
      index += 1;
      const ip = hosts[currentIndex];

      if (await probeHost(ip)) {
        active.push(ip);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return active.sort((left, right) => ipToNumber(left) - ipToNumber(right));
}

function readArpTable() {
  return new Promise((resolve) => {
    execFile("arp", ["-a"], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(new Map());
        return;
      }

      const map = new Map();
      const lines = stdout.split(/\r?\n/);
      const arpPattern = /^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]{17})\s+(\S+)/i;

      for (const line of lines) {
        const match = line.match(arpPattern);
        if (!match) {
          continue;
        }

        map.set(match[1], {
          mac: match[2].toUpperCase(),
          arpType: match[3],
        });
      }

      resolve(map);
    });
  });
}

function checkPort(ip, port, timeout = 180) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finalize = (isOpen) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(isOpen);
    };

    socket.setTimeout(timeout);
    socket.once("connect", () => finalize(true));
    socket.once("timeout", () => finalize(false));
    socket.once("error", () => finalize(false));
    socket.connect(port, ip);
  });
}

async function fingerprintHost(ip) {
  const openPorts = [];

  await Promise.all(
    COMMON_PORTS.map(async ({ port, label }) => {
      if (await checkPort(ip, port)) {
        openPorts.push({ port, label });
      }
    })
  );

  return openPorts.sort((left, right) => left.port - right.port);
}

function discoverSsdp(timeoutMs = 1800) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const results = new Map();
    const message = Buffer.from(
      [
        "M-SEARCH * HTTP/1.1",
        "HOST: 239.255.255.250:1900",
        'MAN: "ssdp:discover"',
        "MX: 1",
        "ST: ssdp:all",
        "",
        "",
      ].join("\r\n")
    );

    socket.on("message", (buffer, remoteInfo) => {
      const text = buffer.toString("utf8");
      const location = /location:\s*(.+)/i.exec(text)?.[1]?.trim() ?? "";
      const server = /server:\s*(.+)/i.exec(text)?.[1]?.trim() ?? "";
      const st = /st:\s*(.+)/i.exec(text)?.[1]?.trim() ?? "";

      results.set(remoteInfo.address, {
        location,
        server,
        st,
      });
    });

    socket.on("error", () => {
      socket.close();
      resolve(results);
    });

    socket.bind(0, () => {
      socket.setBroadcast(true);
      socket.setMulticastTTL(2);
      socket.send(message, 1900, "239.255.255.250");
    });

    setTimeout(() => {
      socket.close();
      resolve(results);
    }, timeoutMs);
  });
}

function extractXmlTag(xml, tagName) {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(xml);
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
}

function fetchTextFromUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;
    const request = client.get(
      url,
      {
        timeout: 1800,
        headers: {
          "User-Agent": "TelecommandeUniverselle/1.0",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );

    request.on("timeout", () => request.destroy(new Error("Request timeout")));
    request.on("error", reject);
  });
}

async function fetchSsdpDescription(location) {
  if (!location) {
    return null;
  }

  try {
    const xml = await fetchTextFromUrl(location);
    return {
      friendlyName: extractXmlTag(xml, "friendlyName"),
      modelName: extractXmlTag(xml, "modelName"),
      manufacturer: extractXmlTag(xml, "manufacturer"),
      deviceType: extractXmlTag(xml, "deviceType"),
    };
  } catch {
    return null;
  }
}

async function lookupHostname(ip) {
  try {
    const hostnames = await dns.reverse(ip);
    return hostnames[0] ?? "";
  } catch {
    return "";
  }
}

function classifyDevice(ip, fingerprints, arpEntry, ssdpEntry, hostname, description) {
  const labels = fingerprints.map((entry) => entry.label);
  const searchable = [
    labels.join(" "),
    ssdpEntry?.server ?? "",
    ssdpEntry?.st ?? "",
    ssdpEntry?.location ?? "",
    hostname ?? "",
    description?.friendlyName ?? "",
    description?.modelName ?? "",
    description?.manufacturer ?? "",
    description?.deviceType ?? "",
  ]
    .join(" ")
    .toLowerCase();
  let type = "Reseau";
  let name = ip;
  let status = "En ligne";
  let protocol = "generic";

  if (
    searchable.includes("bouygtel4k") ||
    searchable.includes("bouygues 4k") ||
    searchable.includes("bbox 4k")
  ) {
    type = "TV";
    name =
      description?.friendlyName ||
      description?.modelName ||
      "Bouygues Telecom TV 4K";
    protocol = searchable.includes("chromecast") ? "chromecast" : "generic";
  } else if (
    searchable.includes("fast5330") ||
    (searchable.includes("bbox") && searchable.includes("miniupnpd"))
  ) {
    type = "Routeur";
    name = description?.friendlyName || description?.modelName || "Bbox";
  } else if (searchable.includes("bouygues") || searchable.includes("bbox")) {
    type = "TV";
    name = description?.friendlyName || description?.modelName || "Bbox 4K / Bouygues TV";
    protocol = searchable.includes("roku") ? "roku" : searchable.includes("chromecast") ? "chromecast" : "generic";
  } else if (searchable.includes("android tv") || searchable.includes("google tv")) {
    type = "TV";
    name = description?.friendlyName || description?.modelName || "Android TV";
    protocol = searchable.includes("chromecast") ? "chromecast" : "generic";
  } else if (searchable.includes("roku")) {
    type = "Streaming";
    name = description?.friendlyName || "Roku";
    protocol = "roku";
  } else if (searchable.includes("chromecast") || searchable.includes("google cast")) {
    type = searchable.includes("dial-multiscreen") ? "TV" : "Streaming";
    name = description?.friendlyName || description?.modelName || "Chromecast";
    protocol = "chromecast";
  } else if (searchable.includes("sonos")) {
    type = "Audio";
    name = description?.friendlyName || "Sonos";
  } else if (searchable.includes("dlna") || searchable.includes("media")) {
    type = "Media";
    name = description?.friendlyName || description?.modelName || "Lecteur multimedia";
  } else if (searchable.includes("rtsp")) {
    type = "Camera";
    name = description?.friendlyName || description?.modelName || "Camera IP";
  } else if (fingerprints.some((entry) => entry.port === 80 || entry.port === 443)) {
    type = "Appareil IP";
    name = description?.friendlyName || description?.modelName || hostname || "Appareil web";
  } else if (hostname) {
    name = hostname;
  }

  if (arpEntry?.mac) {
    status = `MAC ${arpEntry.mac}`;
  }

  const metaParts = [];
  if (description?.manufacturer) {
    metaParts.push(description.manufacturer);
  }
  if (description?.modelName && description.modelName !== name) {
    metaParts.push(description.modelName);
  }
  if (hostname) {
    metaParts.push(`Nom reseau: ${hostname}`);
  }
  if (fingerprints.length > 0) {
    metaParts.push(fingerprints.map((entry) => `${entry.label}:${entry.port}`).join(", "));
  }
  if (ssdpEntry?.server) {
    metaParts.push(ssdpEntry.server);
  }
  if (ssdpEntry?.st) {
    metaParts.push(ssdpEntry.st);
  }

  return {
    id: ip.replaceAll(".", "-"),
    name,
    type,
    meta: metaParts.join(" · ") || "Appareil detecte sur le reseau local",
    status,
    ip,
    protocol,
  };
}

async function scanNetwork() {
  const networks = getLanNetworks();
  const ssdp = await discoverSsdp();
  const arpEntries = await readArpTable();
  const discoveredDevices = [];
  const seen = new Set();

  for (const network of networks) {
    const hosts = network.range.filter((ip) => ip !== network.address);
    const responsiveHosts = await pingSweep(hosts);

    for (const ip of responsiveHosts) {
      seen.add(ip);
    }
  }

  for (const ip of arpEntries.keys()) {
    if (!ip.startsWith("192.168.") && !ip.startsWith("10.") && !ip.startsWith("172.")) {
      continue;
    }

    seen.add(ip);
  }

  for (const ip of ssdp.keys()) {
    seen.add(ip);
  }

  const ignoredIps = new Set();
  for (const network of networks) {
    ignoredIps.add(network.address);
    ignoredIps.add(network.networkAddress);
    ignoredIps.add(network.broadcastAddress);
  }

  const sortedIps = [...seen]
    .filter((ip) => !ignoredIps.has(ip))
    .sort((left, right) => ipToNumber(left) - ipToNumber(right));

  for (const ip of sortedIps) {
    const ssdpEntry = ssdp.get(ip);
    const [fingerprints, hostname, description] = await Promise.all([
      fingerprintHost(ip),
      lookupHostname(ip),
      fetchSsdpDescription(ssdpEntry?.location ?? ""),
    ]);
    const device = classifyDevice(
      ip,
      fingerprints,
      arpEntries.get(ip),
      ssdpEntry,
      hostname,
      description
    );
    discoveredDevices.push(device);
  }

  return {
    scannedAt: new Date().toISOString(),
    networks: networks.map((network) => network.cidr ?? `${network.address}/${network.netmask}`),
    summary:
      discoveredDevices.length > 0
        ? `${discoveredDevices.length} appareil(s) trouves sur le reseau local`
        : "Aucun appareil IP repondu au scan",
    devices: discoveredDevices,
  };
}

function sendHttpRequest(url, method = "POST") {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, timeout: 1500 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Request timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}

async function dispatchCommand(body) {
  const action = body.action ?? "commande";
  const target = body.deviceName ?? body.ip ?? "appareil inconnu";
  const protocol = body.protocol ?? "generic";

  if (protocol === "roku" && body.ip) {
    const rokuActions = {
      home: "Home",
      up: "Up",
      down: "Down",
      left: "Left",
      right: "Right",
      ok: "Select",
      rewind: "Rev",
      forward: "Fwd",
      previous: "InstantReplay",
      "play-pause": "Play",
      mute: "VolumeMute",
      "volume-up": "VolumeUp",
      "volume-down": "VolumeDown",
      "channel-up": "ChannelUp",
      "channel-down": "ChannelDown",
      power: "Power",
    };

    const rokuKey = rokuActions[action] ?? (action.startsWith("key-") ? `Lit_${action.slice(4)}` : null);
    if (!rokuKey) {
      return {
        ok: false,
        message: `Commande "${action}" non supportee pour Roku`,
      };
    }

    const result = await sendHttpRequest(`http://${body.ip}:8060/keypress/${rokuKey}`);
    return {
      ok: result.statusCode >= 200 && result.statusCode < 300,
      message: `Commande "${action}" envoyee a ${target} via Roku ECP`,
    };
  }

  return {
    ok: true,
    message: `Commande "${action}" preparee pour ${target}. Aucun pilote direct disponible pour le protocole ${protocol}.`,
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function serveStaticFile(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  let filePath = decodeURIComponent(requestUrl.pathname);

  if (filePath === "/") {
    filePath = "/index.html";
  }

  const normalizedPath = path.normalize(path.join(ROOT, filePath));
  if (!normalizedPath.startsWith(ROOT)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(normalizedPath, (error, content) => {
    if (error) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    const extension = path.extname(normalizedPath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
      "Cache-Control":
        extension === ".html" || extension === ".js" || extension === ".css"
          ? "no-store"
          : "public, max-age=3600",
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Bad request" });
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/scan") {
    try {
      const result = await scanNetwork();
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, {
        error: "Scan failed",
        details: error.message,
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/command") {
    try {
      const rawBody = await readRequestBody(request);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = await dispatchCommand(body);
      sendJson(response, 200, {
        ...result,
        payload: body,
      });
    } catch (error) {
      sendJson(response, 400, {
        error: "Invalid request",
        details: error.message,
      });
    }
    return;
  }

  serveStaticFile(request, response);
});

server.listen(PORT, () => {
  console.log(`Telecommande universelle disponible sur http://localhost:${PORT}`);
});
