# Telecommande Universelle

Cette application est une telecommande universelle web en HTML, CSS et JavaScript, prevue pour etre installable comme application via les fonctionnalites PWA.

Elle inclut maintenant un serveur local Node.js qui :

- sert l'interface web
- scanne reellement le reseau local
- detecte les appareils via ping, ARP et SSDP/UPnP
- prepare l'envoi de commandes selon le protocole de l'appareil detecte

## Fichiers

- `index.html` : structure de l'interface
- `styles.css` : style responsive
- `script.js` : logique de la telecommande
- `manifest.json` : configuration d'installation
- `sw.js` : cache hors ligne
- `server.js` : serveur local + scan reseau + API

## Lancer le projet

Lancement recommande :

```powershell
launch.bat
```

Le fichier `launch.bat` :

- demarre le serveur local si besoin
- attend qu'il reponde
- ouvre automatiquement l'application dans le navigateur

Le bouton `Scanner le reseau` lance ensuite une detection reelle des appareils presents sur le LAN.

## Installation en application

Dans Chrome, Edge ou un navigateur compatible PWA :

1. Ouvrir le site en local ou en HTTPS.
2. Cliquer sur le bouton `Installer l'application` ou utiliser l'option d'installation du navigateur.
3. L'application s'ouvrira ensuite en mode fenetre autonome.

## Remarque

Le scan reseau est reel.

Important :

- si tu ouvres `index.html` directement en double-cliquant dessus, le navigateur utilisera `file://`
- dans ce mode, il est impossible de lancer automatiquement le serveur Node ou de faire un vrai scan reseau depuis la page seule
- pour un demarrage en un clic avec scan integre, utilise `launch.bat`

Le pilotage depend ensuite du protocole supporte par chaque appareil :

- `Roku` : un pilote HTTP ECP est prevu
- `Chromecast` : detection reelle, mais commandes avancees a ajouter
- appareils HTTP/UPnP generiques : detection reelle, adaptation a faire selon le constructeur

Une vraie telecommande totalement universelle demande des connecteurs par marque ou protocole :

- Roku ECP
- Chromecast Cast v2
- LG webOS
- Samsung SmartThings / Tizen
- Android TV / Google TV
- Sonos
- MQTT / Home Assistant
