/**
 * ================================================
 * Smart Parking Finder — GPS & A* Algorithm
 * Full JavaScript with smooth animations & dark UI
 * ================================================
 */

// ========================
// APPLICATION STATE
// ========================
let map;
let userLocMarker = null;
let routeLine = null;
let userCoords = null;
let parkingMarkers = {};
let lastSelectedMarker = null; // Track selection for visual updates
let selectedNodeId = null;
let aStarLayers = [];       // Temp map overlays for A* visualization
let isAStarRunning = false;  // Prevent double-clicks during animation
let gridLayers = [];        // Temp map overlays for grid route pathfinding
let isRouteRunning = false; // Prevent overlapping grid searches

// Allows backend environment injection or default empty relative path
const BACKEND_URL = window.ENV?.API_URL || ''; 
let currentClusterKey = null; // Store for booking API
let lastSearchedName = "Local Area";
let selectedVehicleType = localStorage.getItem('pk_pref_vtype') || 'all'; // Load from storage
let pendingSearchData = null;    // Stores {lat, lng, name, isSRM} while modal is open
let vehiclesList = [];           // Cached vehicles from backend
let pendingBooking = null;       // Stores {nodeId, slotId} for booking modal
let activePanel = 'map';         // Current sidebar panel: 'map', 'vehicles', 'history'

// Functional Settings State
let searchRadiusKm = parseFloat(localStorage.getItem('pk_radius')) || 2.0;
let mappingMode = localStorage.getItem('pk_map_mode') || 'haversine';
let highDensitySimulation = localStorage.getItem('pk_density') !== 'false';

// ========================
// SRM KTR CAMPUS PARKING DATA
// ========================
// 14 parking zones — positioned from user-marked screenshot on blank map
// bounds: [[southLat, westLng], [northLat, eastLng]]
const SRM_KTR_CENTER = { lat: 12.8235, lng: 80.0440 };
const SRM_KTR_PARKING = [
    // 1. Far-Left Vertical Large (Zone 2 in drawing)
    { id: 'SRM01', name: 'Main Gate Parking', slots: 20, vehicleType: 'car',
      lat: 12.82510, lng: 80.04145,
      bounds: [[12.82468, 80.04119], [12.82552, 80.04172]] },

    // 2. Mid-Left Square (Zone 3 in drawing)
    { id: 'SRM02', name: 'Architecture Block 2W', slots: 15, vehicleType: '2-wheeler',
      lat: 12.82392, lng: 80.04330,
      bounds: [[12.82366, 80.04290], [12.82418, 80.04371]] },

    // 3. Top-Left Vertical (Zone 1 in drawing)
    { id: 'SRM03', name: 'North West Plaza', slots: 12, vehicleType: 'car',
      lat: 12.82549, lng: 80.04330,
      bounds: [[12.82513, 80.04317], [12.82586, 80.04344]] },

    // 4. Center Thin Vertical (Zone 4 in drawing)
    { id: 'SRM04', name: 'Java Parking 2W', slots: 18, vehicleType: '2-wheeler',
      lat: 12.82358, lng: 80.04494,
      bounds: [[12.82293, 80.04484], [12.82424, 80.04505]] },

    // 5. Center Thin Horizontal (Zone 5 in drawing)
    { id: 'SRM05', name: 'TP Ground Parking', slots: 25, vehicleType: 'car',
      lat: 12.82311, lng: 80.04631,
      bounds: [[12.82298, 80.04543], [12.82324, 80.04720]] },

    // 6. Center-Bottom Large Square (Zone 6 in drawing)
    { id: 'SRM06', name: 'Girls Hostel Parking', slots: 35, vehicleType: 'car',
      lat: 12.82185, lng: 80.04540,
      bounds: [[12.82146, 80.04489], [12.82224, 80.04591]] },

    // 7. Top-Right Horizontal (Zone 7 in drawing)
    { id: 'SRM07', name: 'Auditorium North 2W', slots: 22, vehicleType: '2-wheeler',
      lat: 12.82562, lng: 80.04808,
      bounds: [[12.82539, 80.04736], [12.82586, 80.04881]] },

    // 8. Mid-Right Square (Zone 8 in drawing)
    { id: 'SRM08', name: 'DC Roy Parking', slots: 16, vehicleType: 'car',
      lat: 12.82405, lng: 80.04835,
      bounds: [[12.82382, 80.04800], [12.82429, 80.04870]] },

    // 9. Rightmost Vertical Curve (Zone 9 in drawing)
    { id: 'SRM09', name: 'Hospital Parking', slots: 14, vehicleType: 'car',
      lat: 12.82285, lng: 80.04969,
      bounds: [[12.82235, 80.04950], [12.82335, 80.04988]] },

    // 10. Bottom-Right Horizontal (Zone 10 in drawing)
    { id: 'SRM10', name: 'Medical College Parking', slots: 24, vehicleType: '2-wheeler',
      lat: 12.82180, lng: 80.04811,
      bounds: [[12.82162, 80.04763], [12.82198, 80.04859]] },

    // 11. Bottom-Right Vertical Small (Zone 11 in drawing)
    { id: 'SRM11', name: 'Medical College Back Gate Parking', slots: 10, vehicleType: '2-wheeler',
      lat: 12.82151, lng: 80.04902,
      bounds: [[12.82120, 80.04881], [12.82183, 80.04924]] }
];

// P_NODES is the live working array — starts with SRM campus data
const P_NODES = [];
SRM_KTR_PARKING.forEach(n => {
    P_NODES.push({ ...n, slotDetails: generateSlotDetails(n.slots) });
});

/**
 * generateSlotDetails()
 * Creates individual slot entries for a parking node.
 * Total slots = availableSlots + some random booked slots.
 */
function generateSlotDetails(availableCount) {
    const base = highDensitySimulation ? 35 : 10; // Higher density if toggled
    const totalSlots = availableCount + Math.floor(Math.random() * base) + 3;
    const details = [];
    for (let i = 0; i < totalSlots; i++) {
        details.push({
            id: `S${(i + 1).toString().padStart(2, '0')}`,
            status: i < availableCount ? 'available' : 'booked'
        });
    }
    // Shuffle so green/red are mixed
    for (let i = details.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [details[i], details[j]] = [details[j], details[i]];
    }
    return details;
}

// (P_NODES initialized above from SRM_KTR_PARKING)

// ========================
// 1. SPLASH → APP TRANSITION
// ========================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initial auth check happens first
    try { initAuth(); } catch (e) { console.error('Auth error', e); }

    const splash = document.getElementById('splash-screen');
    const app = document.getElementById('app');

    setTimeout(() => {
        splash.classList.add('fade-out');
        setTimeout(() => {
            splash.style.display = 'none';
            app.classList.remove('hidden-initial');
            app.classList.add('visible');
            initMap();
        }, 600);
    }, 2800);

    // Event Bindings
    document.getElementById('find-btn').addEventListener('click', aStarSearch);
    document.getElementById('sim-btn').addEventListener('click', triggerEnvironmentalSim);
    document.getElementById('detail-close').addEventListener('click', hideDetailCard);
    document.getElementById('btn-navigate').addEventListener('click', () => {
        if (selectedNodeId) {
            const node = P_NODES.find(n => n.id === selectedNodeId);
            if (node) drawRoute(node);
        }
    });
    // Search form — geocode any place name to coordinates
    document.getElementById('search-form')?.addEventListener('submit', handleLocationSearch);

    // Vehicle type filter chips in sidebar
    document.querySelectorAll('.vehicle-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.vehicle-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            selectedVehicleType = chip.dataset.vtype;
            renderParkingList();
            drawParkingMarkers();
        });
    });

    // Console toggle handlers
    document.getElementById('console-toggle')?.addEventListener('click', () => {
        document.getElementById('console-panel')?.classList.toggle('hidden');
    });
    document.getElementById('console-close')?.addEventListener('click', () => {
        document.getElementById('console-panel')?.classList.add('hidden');
    });

    // Filter chips removed
    // Vehicle preference modal handlers
    document.querySelectorAll('.vp-card').forEach(card => {
        card.addEventListener('click', () => {
            const vtype = card.dataset.vtype;
            handleVehicleSelection(vtype);
        });
    });
    document.getElementById('vp-show-all').addEventListener('click', () => {
        handleVehicleSelection('all');
    });

    // Redundant filter chips removed (logic migrated to Settings)

    // Navigation tab handlers
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const panelName = tab.id.replace('tab-', '');
            switchPanel(panelName);
        });
    });

    // Add vehicle form
    document.getElementById('add-vehicle-form').addEventListener('submit', handleAddVehicle);

    // Booking modal handlers
    document.getElementById('bm-confirm-btn').addEventListener('click', confirmBookingFromModal);
    document.getElementById('bm-cancel-btn').addEventListener('click', cancelBookingModal);

    // Settings Tab Functionality
    const radiusInput = document.getElementById('settings-radius');
    const radiusVal = document.getElementById('radius-val');
    const vtypeChips = document.querySelectorAll('.vtype-chip');
    const densityToggle = document.getElementById('settings-density-toggle');
    const logoutBtn = document.getElementById('btn-logout');

    // Initialize UI from state
    if (radiusInput) {
        radiusInput.value = searchRadiusKm;
        radiusVal.textContent = searchRadiusKm.toFixed(1);
    }

    if (vtypeChips.length > 0) {
        vtypeChips.forEach(chip => {
            // Default to 'all' if no specific preference saved
            const savedVtype = localStorage.getItem('pk_pref_vtype') || 'all';
            if (chip.dataset.vtype === savedVtype) {
                chip.classList.add('active');
            } else {
                chip.classList.remove('active');
            }
        });
    }
    toggleDensityUI(highDensitySimulation);

    radiusInput?.addEventListener('input', (e) => {
        searchRadiusKm = parseFloat(e.target.value);
        radiusVal.textContent = searchRadiusKm.toFixed(1);
        localStorage.setItem('pk_radius', searchRadiusKm);
    });

    vtypeChips.forEach(chip => {
        chip.addEventListener('click', () => {
            vtypeChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const vtype = chip.dataset.vtype;
            localStorage.setItem('pk_pref_vtype', vtype);
            selectedVehicleType = vtype; // Sync global state
            logToConsole(`> Preferred vehicle: ${vtype}`, 'success');
            
            // Refresh visuals
            drawParkingMarkers();
            renderParkingList();
        });
    });

    densityToggle?.addEventListener('click', () => {
        highDensitySimulation = !highDensitySimulation;
        localStorage.setItem('pk_density', highDensitySimulation);
        toggleDensityUI(highDensitySimulation);
        logToConsole(`> High density simulation: ${highDensitySimulation ? 'On' : 'Off'}`, 'success');
    });

    logoutBtn?.addEventListener('click', () => {
        localStorage.clear();
        window.location.reload();
    });

    // Accessibility btn
    document.getElementById('recenter-btn')?.addEventListener('click', () => {
        if (userCoords) {
            map.flyTo([userCoords.lat, userCoords.lng], 16, { duration: 1 });
            logToConsole('> Centering map on your location...', 'success');
        } else {
            getUserLocation();
        }
    });

    // Cleanup: No duplicate initAuth call at end
});

function toggleDensityUI(isActive) {
    const toggle = document.getElementById('settings-density-toggle');
    const knob = document.getElementById('density-knob');
    if (!toggle || !knob) return;
    
    if (isActive) {
        toggle.style.background = 'var(--accent)';
        knob.style.right = '2px';
        knob.style.left = 'auto';
    } else {
        toggle.style.background = 'var(--bg-hover)';
        knob.style.right = 'auto';
        knob.style.left = '2px';
    }
}

// ========================
// AUTHENTICATION & SETTINGS
// ========================
function initAuth() {
    const authOverlay = document.getElementById('auth-overlay');
    const authForm = document.getElementById('auth-form');
    
    // Check local storage for session
    const loggedInName = localStorage.getItem('parknova_user_name');
    const loggedInEmail = localStorage.getItem('parknova_user_email');

    if (!loggedInName) {
        authOverlay.style.display = 'flex';
        authOverlay.style.opacity = '1';
    } else {
        const footName = document.getElementById('footer-user-name');
        const footEmail = document.getElementById('footer-user-email');
        if (footName) footName.textContent = loggedInName;
        if (footEmail) footEmail.textContent = loggedInEmail || 'user@parknova.local';
        authOverlay.style.display = 'none'; // Ensure it stays hidden
    }

    // Handle Login submission
    authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('auth-name-input').value.trim();
        const email = document.getElementById('auth-email-input').value.trim();
        if (name && email) {
            localStorage.setItem('parknova_user_name', name);
            localStorage.setItem('parknova_user_email', email);
            
            const footName = document.getElementById('footer-user-name');
            const footEmail = document.getElementById('footer-user-email');
            if (footName) footName.textContent = name;
            if (footEmail) footEmail.textContent = email;
            
            authOverlay.style.opacity = '0';
            setTimeout(() => {
                authOverlay.style.display = 'none';
                logToConsole(`> Authenticated securely as ${name}.`, 'success');
            }, 500);
        }
    });

    // Handle Logout in Settings
    document.getElementById('btn-logout').addEventListener('click', () => {
        if(confirm("Are you sure you want to sign out?")) {
            localStorage.removeItem('parknova_user_name');
            localStorage.removeItem('parknova_user_email');
            window.location.reload();
        }
    });
}

function toggleChip(id) {
    document.getElementById('chip-available').classList.remove('active');
    document.getElementById('chip-all').classList.remove('active');
    document.getElementById(id).classList.add('active');
}

// ========================
// 2. MAP INITIALIZATION
// ========================
function initMap() {
    logToConsole('> Booting map engine...');

    try {
        // Dark themed map tiles (CartoDB Dark Matter for premium dark look)
        // Start centered on SRM KTR campus
        map = L.map('map', { zoomControl: false }).setView([SRM_KTR_CENTER.lat, SRM_KTR_CENTER.lng], 16);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(map);

        // Add zoom control to bottom-right
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        logToConsole('> Dark map initialized.', 'success');

        // Load SRM campus data on startup
        currentClusterKey = 'SRM_KTR';
        userCoords = { lat: SRM_KTR_CENTER.lat, lng: SRM_KTR_CENTER.lng };
        lastSearchedName = 'SRM University KTR';

        renderParkingList();
        drawParkingMarkers();
        getUserLocation();
    } catch (err) {
        console.error("Map initialization failed", err);
        logToConsole('> CRITICAL ERROR: Map engine failed to boot.', 'error');
        document.getElementById('map').innerHTML = `
            <div style="display:flex; height:100%; width:100%; align-items:center; justify-content:center; flex-direction:column; background:#1e293b; color:#ef4444; font-family:Inter,sans-serif; text-align:center; padding:20px;">
                <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-bottom:15px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                <h2 style="margin:0 0 10px 0; font-size:1.5rem;">Map Render Failure</h2>
                <p style="color:#94a3b8; max-width:400px;">The mapping engine encountered an error. Please verify your network connection and reload the application.</p>
            </div>
        `;
    }
}

// ========================
// 3. SVG MARKER FACTORIES
// ========================

/**
 * Creates custom circular SVG markers similar to the reference UI.
 * Available = green circle with slot count
 * Full = red circle with X
 */
function createParkingIcon(node) {
    const isAvail = node.slots > 0;
    const vtype = node.vehicleType || 'car';

    // Color-code by vehicle type: blue for 2-wheeler, red for car
    let bg, borderColor, shadowColor;
    if (!isAvail) {
        bg = '#dc2626'; borderColor = '#f87171'; shadowColor = 'rgba(220,38,38,0.4)';
    } else if (vtype === '2-wheeler') {
        bg = '#2563eb'; borderColor = '#60a5fa'; shadowColor = 'rgba(37,99,235,0.4)';
    } else {
        bg = '#059669'; borderColor = '#34d399'; shadowColor = 'rgba(5,150,105,0.4)';
    }

    const label = isAvail ? node.slots : '✕';
    const vtypeIcon = vtype === '2-wheeler' ? '🏍️' : '🚗';

    const svg = `
        <div style="
            width: 42px; height: 42px; 
            background: ${bg}; 
            border-radius: 50%; 
            display: flex; align-items: center; justify-content: center;
            color: white; font-weight: 700; font-size: 0.85rem; font-family: Inter, sans-serif;
            box-shadow: 0 4px 14px ${shadowColor};
            border: 2px solid ${borderColor};
            transition: transform 0.3s ease;
            position: relative;
        ">${label}
            <span style="position:absolute;top:-8px;right:-8px;font-size:0.7rem;">${vtypeIcon}</span>
        </div>
    `;

    return L.divIcon({
        html: svg,
        className: 'custom-parking-marker',
        iconSize: [42, 42],
        iconAnchor: [21, 21],
        popupAnchor: [0, -24]
    });
}

function createUserIcon() {
    const svg = `
        <div style="position: relative;">
            <div style="
                width: 20px; height: 20px;
                background: #3b82f6;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 0 20px rgba(59,130,246,0.5);
                position: relative; z-index: 2;
            "></div>
            <div style="
                width: 40px; height: 40px;
                background: rgba(59,130,246,0.15);
                border-radius: 50%;
                position: absolute; top: -10px; left: -10px;
                animation: userPulsing 2s ease-in-out infinite;
            "></div>
        </div>
    `;

    return L.divIcon({
        html: svg,
        className: 'custom-user-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -14]
    });
}

// Add user pulse animation via injected style
const pulseStyle = document.createElement('style');
pulseStyle.textContent = `
    @keyframes userPulsing {
        0%, 100% { transform: scale(1); opacity: 0.5; }
        50% { transform: scale(1.6); opacity: 0; }
    }
    .custom-parking-marker, .custom-user-marker {
        background: transparent !important;
        border: none !important;
    }
`;
document.head.appendChild(pulseStyle);

// ========================
// 4. DRAW MARKERS ON MAP
// ========================
function drawParkingMarkers() {
    // Remove existing markers / layer groups
    Object.values(parkingMarkers).forEach(m => map.removeLayer(m));
    parkingMarkers = {};

    const filteredNodes = getFilteredNodes();
    filteredNodes.forEach(node => {
        const isAvail = node.slots > 0;
        const vtype = node.vehicleType || 'car';
        const statusClass = isAvail ? 'green' : 'red';
        const statusText = isAvail ? `${node.slots} Available` : 'FULL';
        const vtypeLabel = vtype === '2-wheeler' ? '🏍️ 2-Wheeler' : '🚗 Car';
        const popupContent = `
            <div class="popup-title">${node.name}</div>
            <div class="popup-slots ${statusClass}">${statusText}</div>
            <div style="font-size:0.78rem;margin-top:4px;color:#94a3b8;">${vtypeLabel}</div>
        `;

        // ── Rectangle zone (SRM campus parking) ──
        if (node.bounds) {
            let fillColor, accentColor;
            if (!isAvail) {
                fillColor = 'rgba(220,38,38,0.18)'; accentColor = '#f87171';
            } else if (vtype === '2-wheeler') {
                fillColor = 'rgba(96,165,250,0.14)'; accentColor = '#60a5fa';
            } else {
                fillColor = 'rgba(52,211,153,0.14)'; accentColor = '#34d399';
            }

            const group = L.layerGroup();

            // White-outlined rectangle matching the campus map
            const rect = L.rectangle(node.bounds, {
                color: '#ffffff',
                weight: 2,
                opacity: 0.75,
                fillColor: fillColor,
                fillOpacity: 1,
                dashArray: '6 4',
                lineJoin: 'round',
            });

            // Center label — small badge showing slot count + vehicle icon
            const center = [
                (node.bounds[0][0] + node.bounds[1][0]) / 2,
                (node.bounds[0][1] + node.bounds[1][1]) / 2
            ];
            const slotLabel = isAvail ? node.slots : '✕';
            const vtIcon = vtype === '2-wheeler' ? '🏍️' : '🚗';
            const bgColor = !isAvail ? '#dc2626' : (vtype === '2-wheeler' ? '#2563eb' : '#059669');
            const shadowC = !isAvail ? 'rgba(220,38,38,0.4)' : (vtype === '2-wheeler' ? 'rgba(37,99,235,0.4)' : 'rgba(5,150,105,0.4)');

            const labelHtml = `
                <div style="
                    width:36px; height:36px;
                    background:${bgColor};
                    border-radius:8px;
                    display:flex; align-items:center; justify-content:center;
                    color:white; font-weight:700; font-size:0.82rem; font-family:Inter,sans-serif;
                    box-shadow:0 3px 12px ${shadowC};
                    border:2px solid ${accentColor};
                    position:relative;
                ">${slotLabel}
                    <span style="position:absolute;top:-7px;right:-7px;font-size:0.6rem;">${vtIcon}</span>
                </div>
            `;
            const labelMarker = L.marker(center, {
                icon: L.divIcon({
                    html: labelHtml,
                    className: 'custom-parking-marker',
                    iconSize: [36, 36],
                    iconAnchor: [18, 18],
                    popupAnchor: [0, -20]
                })
            });

            // Click handlers
            rect.on('click', () => selectParkingNode(node.id));
            labelMarker.on('click', () => selectParkingNode(node.id));

            group.addLayer(rect);
            group.addLayer(labelMarker);
            group.addTo(map);

            // Important: Save references for selection highlights
            group.labelMarker = labelMarker; 
            parkingMarkers[node.id] = group;

        } else {
            // ── Circular marker (fallback for non-SRM / backend data) ──
            const icon = createParkingIcon(node);
            const m = L.marker([node.lat, node.lng], { icon })
                .addTo(map);
            m.on('click', () => selectParkingNode(node.id));
            parkingMarkers[node.id] = m;
        }
    });
}

// ========================
// 5. SIDEBAR PARKING LIST
// ========================
/**
 * getFilteredNodes()
 * Returns P_NODES filtered by selectedVehicleType
 */
function getFilteredNodes() {
    if (selectedVehicleType === 'all') return [...P_NODES];
    return P_NODES.filter(n => n.vehicleType === selectedVehicleType);
}

function renderParkingList() {
    const container = document.getElementById('parking-list');
    let nodes = getFilteredNodes();

    // Sort by distance if user location known
    if (userCoords) {
        nodes.sort((a, b) => {
            const dA = calculateDistance(userCoords.lat, userCoords.lng, a.lat, a.lng);
            const dB = calculateDistance(userCoords.lat, userCoords.lng, b.lat, b.lng);
            return dA - dB;
        });
    }

    container.innerHTML = '';
    nodes.forEach(node => {
        const isAvail = node.slots > 0;
        const dist = userCoords ? (calculateDistance(userCoords.lat, userCoords.lng, node.lat, node.lng) / 1000).toFixed(1) : '?';
        const isSelected = node.id === selectedNodeId;

        const item = document.createElement('div');
        item.className = `parking-item${isSelected ? ' selected' : ''}`;
        
        const vehicleLabel = node.vehicleType === '2-wheeler' ? '2-Wheeler' : 'Car';
        const vehicleIcon = node.vehicleType === '2-wheeler' ? 
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="M5 15v-3a4 4 0 0 1 4-4h7l3 3v4"/></svg>' : 
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>';

        item.innerHTML = `
            <div class="pi-header">
                <div class="pi-slots-wrapper">
                    <span class="pi-slots ${isAvail ? '' : 'pi-slots-full'}">${isAvail ? String(node.slots).padStart(2, '0') : '00'}</span>
                    <span class="pi-label">Available</span>
                </div>
                <div class="pi-badge ${isAvail ? '' : 'pi-badge-full'}">${isAvail ? 'Open' : 'Full'}</div>
            </div>
            <h3 class="pi-name">${node.name}</h3>
            <div class="pi-footer">
                <div class="pi-footer-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    ${dist} km
                </div>
                <div class="pi-footer-item">
                    ${vehicleIcon}
                    ${vehicleLabel}
                </div>
            </div>
        `;

        item.addEventListener('click', () => {
            selectParkingNode(node.id);
        });

        container.appendChild(item);
    });
}

// ========================
// 5b. GEOCODE SEARCH
// ========================

// Realistic parking name templates (modelled on real Indian naming conventions)
const PARKING_NAMES = [
    '{loc} NDMC Multi-Level Parking',
    '{loc} MCD Surface Parking Lot',
    '{loc} Automated Tower Parking',
    '{loc} Underground Basement Parking',
    '{loc} Smart Park Zone',
    '{loc} Open-Air Public Parking',
    '{loc} Stack Parking Facility',
    '{loc} Metro Station P&R Lot'
];

/**
 * handleLocationSearch()
 * Geocodes a place name (like "SRM", "Mumbai", "Connaught Place")
 * using OpenStreetMap Nominatim free API, then generates realistic
 * parking spots around the resolved coordinates.
 */
/**
 * isSRMKTRQuery()
 * Checks if the search query matches SRM KTR / SRM University KTR
 */
function isSRMKTRQuery(query) {
    const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    return /(srm\s*ktr|srm\s*university\s*ktr|srmist\s*ktr|srm\s*kattankulathur)/.test(q);
}

/**
 * showVehiclePreferenceModal()
 * Displays the vehicle type selection overlay.
 * Stores pending data so the flow continues after selection.
 */
function showVehiclePreferenceModal(lat, lng, name, isSRM) {
    pendingSearchData = { lat, lng, name, isSRM };
    document.getElementById('vehicle-pref-modal').classList.remove('hidden');
    logToConsole(`> Awaiting vehicle preference...`, 'calc');
}

/**
 * handleVehicleSelection(vtype)
 * Called when user picks a vehicle type from the modal.
 * Continues the search flow with the chosen filter.
 */
function handleVehicleSelection(vtype) {
    selectedVehicleType = vtype;
    document.getElementById('vehicle-pref-modal').classList.add('hidden');
    logToConsole(`> Vehicle preference: ${vtype === 'all' ? 'All Types' : vtype}`, 'success');

    // Show vehicle filter row and set active chip
    document.getElementById('vehicle-filter-row').style.display = 'flex';
    document.querySelectorAll('.vehicle-chip').forEach(c => c.classList.remove('active'));
    const chipId = vtype === 'car' ? 'chip-veh-car' : vtype === '2-wheeler' ? 'chip-veh-2w' : 'chip-veh-all';
    document.getElementById(chipId).classList.add('active');

    if (!pendingSearchData) return;

    const { lat, lng, name, isSRM } = pendingSearchData;
    pendingSearchData = null;

    if (isSRM) {
        applySRMKTRParking(vtype);
    } else {
        applySearchedLocation(lat, lng, name);
    }
}

/**
 * applySRMKTRParking()
 * Loads hardcoded SRM KTR campus parking zones, filtered by vehicle type.
 */
function applySRMKTRParking(vtype) {
    const lat = SRM_KTR_CENTER.lat;
    const lng = SRM_KTR_CENTER.lng;
    logToConsole(`\n> Loading SRM KTR Campus parking data...`, 'success');
    logToConsole(`> Vehicle filter: ${vtype === 'all' ? 'All Types' : vtype}`, 'calc');

    userCoords = { lat, lng };
    lastSearchedName = 'SRM University KTR';

    // Move/create user marker
    if (userLocMarker) map.removeLayer(userLocMarker);
    userLocMarker = L.marker([lat, lng], { icon: createUserIcon() })
        .addTo(map)
        .bindPopup(`<div class="popup-title">📍 SRM University KTR</div>`);

    // Load hardcoded SRM data into P_NODES
    P_NODES.length = 0;
    SRM_KTR_PARKING.forEach(n => {
        P_NODES.push({
            ...n,
            slotDetails: generateSlotDetails(n.slots)
        });
    });

    currentClusterKey = 'SRM_KTR';

    logToConsole(`> ${P_NODES.length} SRM campus parking zones loaded.`, 'success');

    drawParkingMarkers();
    renderParkingList();

    map.flyTo([lat, lng], 16, { duration: 1.5 });

    // Update GPS badge
    const gpsBadge = document.getElementById('gps-badge');
    const gpsText = document.getElementById('gps-text');
    gpsBadge.classList.remove('searching');
    gpsBadge.classList.add('active');
    gpsText.textContent = 'SRM University KTR';

    showLocationBanner('SRM University KTR');
    document.getElementById('find-btn').disabled = false;
    hideDetailCard();
}

async function handleLocationSearch(e) {
    e.preventDefault();
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    const spinner = document.getElementById('search-spinner');
    spinner.classList.remove('hidden');
    logToConsole(`\n> Searching location: "${query}"...`);

    // Check for SRM KTR first
    if (isSRMKTRQuery(query)) {
        spinner.classList.add('hidden');
        document.getElementById('search-input').value = '';
        logToConsole(`> Detected SRM KTR campus query.`, 'success');
        showVehiclePreferenceModal(SRM_KTR_CENTER.lat, SRM_KTR_CENTER.lng, 'SRM University KTR', true);
        return;
    }

    try {
        // Geocode using Nominatim (free, no API key needed)
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`
        );
        const data = await res.json();

        if (!data || data.length === 0) {
            // Fallback: try Photon Komoot for fuzzy matching
            const photonRes = await fetch(
                `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`
            );
            const photonData = await photonRes.json();

            if (photonData?.features?.length > 0) {
                const feat = photonData.features[0];
                const lat = feat.geometry.coordinates[1];
                const lng = feat.geometry.coordinates[0];
                const name = feat.properties.name || feat.properties.city || query;
                // Show vehicle preference modal instead of applying directly
                showVehiclePreferenceModal(lat, lng, name, false);
            } else {
                logToConsole(`> Location "${query}" not found. Try a different name.`, 'error');
                alert(`Location "${query}" not found. Try a landmark, city, or address.`);
            }
        } else {
            const result = data[0];
            const lat = parseFloat(result.lat);
            const lng = parseFloat(result.lon);
            const name = result.display_name.split(',')[0] || query;
            // Show vehicle preference modal instead of applying directly
            showVehiclePreferenceModal(lat, lng, name, false);
        }
    } catch (err) {
        console.error(err);
        logToConsole('> Network error during geocoding.', 'error');
        alert('Search failed. Check your internet connection.');
    } finally {
        spinner.classList.add('hidden');
        document.getElementById('search-input').value = '';
    }
}

/**
 * applySearchedLocation()
 * After geocoding resolves, this function:
 *  1. Moves the map target marker to the searched location
 *  2. Generates 6 realistic parking spots within ~2km radius
 *  3. Updates sidebar list and map markers
 */
function applySearchedLocation(lat, lng, locationName) {
    logToConsole(`> Resolved: "${locationName}" at [${lat.toFixed(4)}, ${lng.toFixed(4)}]`, 'success');

    // Update user/target coordinates
    userCoords = { lat, lng };
    lastSearchedName = locationName;

    // Move or create user marker at searched location
    if (userLocMarker) {
        map.removeLayer(userLocMarker);
    }
    userLocMarker = L.marker([lat, lng], { icon: createUserIcon() })
        .addTo(map)
        .bindPopup(`<div class="popup-title">📍 ${locationName}</div>`);

    // Fetch parking spots from backend
    fetchParkingFromBackend(lat, lng, locationName);

    // Fly map to the new area
    map.flyTo([lat, lng], 15, { duration: 1.5 });

    // Update GPS badge to show searched mode
    const gpsBadge = document.getElementById('gps-badge');
    const gpsText = document.getElementById('gps-text');
    gpsBadge.classList.remove('searching');
    gpsBadge.classList.add('active');
    gpsText.textContent = locationName;

    // Show location banner in sidebar
    showLocationBanner(locationName);

    // Enable find button
    document.getElementById('find-btn').disabled = false;

    // Clear any existing selection
    hideDetailCard();
}

/**
 * fetchParkingFromBackend()
 * Calls the Node.js backend to get or create realistic parking spots
 * near the searched coordinates.
 */
async function fetchParkingFromBackend(lat, lng, locationName) {
    logToConsole(`> Fetching smart parking data from backend...`);
    
    try {
        const res = await fetch(`${BACKEND_URL}/api/facilities?lat=${lat}&lng=${lng}&name=${encodeURIComponent(locationName)}`);
        const data = await res.json();
        
        if (data && data.facilities) {
            currentClusterKey = data.clusterKey;
            
            // Clear and update P_NODES
            P_NODES.length = 0;
            const vtypes = ['car', '2-wheeler'];
            data.facilities.forEach((f, idx) => {
                // Ensure backend data matches frontend expected format
                const availableCount = f.slots.filter(s => s.status === 'available').length;
                P_NODES.push({
                    id: f.id,
                    name: f.name,
                    lat: f.lat,
                    lng: f.lng,
                    slots: availableCount,
                    vehicleType: f.vehicleType || vtypes[idx % 2],
                    slotDetails: f.slots
                });
            });

            logToConsole(`> ${P_NODES.length} nodes synchronized from backend store.`, 'success');
            drawParkingMarkers();
            renderParkingList();
        }
    } catch (err) {
        console.error("Backend fetch error:", err);
        logToConsole(`> Backend connection failed: ${err.message}`, 'error');
        logToConsole(`> Falling back to local generation.`, 'error');
        generateParkingAround(lat, lng, locationName);
    }
}

/**
 * generateParkingAround() 
 * [LOCAL FALLBACK]
 */
function generateParkingAround(lat, lng, baseName) {
    logToConsole(`> Generating local fallback parking nodes...`);

    // Short name for parking prefixes (first word or two)
    const shortName = baseName.split(' ').slice(0, 2).join(' ');

    // Clear and regenerate P_NODES
    P_NODES.length = 0;

    const vtypes = ['car', '2-wheeler'];

    for (let i = 0; i < 6; i++) {
        // Scatter within roughly 0.5-2km radius
        const offsetLat = (Math.random() - 0.5) * 0.025;
        const offsetLng = (Math.random() - 0.5) * 0.025;

        // Pick a random name template
        const nameTemplate = PARKING_NAMES[i % PARKING_NAMES.length];
        const name = nameTemplate.replace('{loc}', shortName);

        // Random slot count (0 = full, for realism ~25% chance full)
        const slots = Math.random() > 0.25 ? Math.floor(Math.random() * 20) + 3 : 0;

        // Assign vehicle type: alternate between car and 2-wheeler
        const vehicleType = vtypes[i % 2];

        P_NODES.push({
            id: `P${i + 1}`,
            name: name,
            lat: lat + offsetLat,
            lng: lng + offsetLng,
            slots: slots,
            vehicleType: vehicleType,
            slotDetails: generateSlotDetails(slots)
        });
    }

    logToConsole(`> ${P_NODES.length} fallback parking spots generated.`, 'success');
    currentClusterKey = 'OFFLINE'; // Enable local simulation for reservations

    drawParkingMarkers();
    renderParkingList();
}

/**
 * Shows a small banner at the top of the parking list indicating
 * what location was searched.
 */
function showLocationBanner(name) {
    // Remove existing banner if any
    const existing = document.querySelector('.search-result-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'search-result-banner';
    banner.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
        Showing parkings near <strong style="margin-left:4px">${name}</strong>
    `;

    // Insert before the parking list
    const list = document.getElementById('parking-list');
    list.parentNode.insertBefore(banner, list);
}

function selectParkingNode(nodeId) {
    selectedNodeId = nodeId;
    const node = P_NODES.find(n => n.id === nodeId);
    if (!node) return;

    // Highlight in sidebar
    renderParkingList();

    // Reset previous selection
    if (lastSelectedMarker) {
        lastSelectedMarker.getElement()?.classList.remove('selected-marker');
    }

    // Fly map to the selected node
    map.flyTo([node.lat, node.lng], 16, { duration: 1 });

    // Open popup & Apply Highlight
    if (parkingMarkers[nodeId]) {
        const layerOrGroup = parkingMarkers[nodeId];
        let targetMarker = layerOrGroup;

        // If it's an SRM Group, we want to open the popup on the label marker
        if (layerOrGroup instanceof L.LayerGroup && layerOrGroup.labelMarker) {
            targetMarker = layerOrGroup.labelMarker;
        }

        if (targetMarker.openPopup) {
            setTimeout(() => {
                const el = targetMarker.getElement();
                if (el) {
                    el.classList.add('selected-marker');
                    lastSelectedMarker = targetMarker;
                }
            }, 300); // Wait for flyTo to settle or marker to be ready
        }
    }

    // Show detail card
    showDetailCard(node);
}

// ========================
// 6. DETAIL CARD
// ========================
function showDetailCard(node) {
    const card = document.getElementById('detail-card');
    const isAvail = node.slots > 0;

    document.getElementById('detail-name').textContent = node.name;
    document.getElementById('detail-status').textContent = isAvail ? 'Available' : 'Full';
    document.getElementById('detail-status').className = `detail-status ${isAvail ? 'available' : 'full'}`;
    document.getElementById('detail-slots-badge').textContent = node.slots;

    const dist = userCoords
        ? (calculateDistance(userCoords.lat, userCoords.lng, node.lat, node.lng) / 1000).toFixed(2) + ' km'
        : '-';
    document.getElementById('detail-dist-badge').textContent = dist;
    document.getElementById('detail-desc').textContent = isAvail
        ? `This parking facility has ${node.slots} available slots. AI analysis recommends this location based on proximity and capacity.`
        : 'This facility is currently at full capacity. Consider alternatives.';

    // Vehicle type badge in detail card
    const vtypeBadge = document.getElementById('detail-vtype-badge');
    const vtype = node.vehicleType || 'car';
    vtypeBadge.style.display = 'flex';
    vtypeBadge.className = `badge vtype-badge vtype-${vtype === '2-wheeler' ? '2wheeler' : 'car'}`;
    vtypeBadge.textContent = vtype === '2-wheeler' ? '🏍️ Two-Wheeler' : '🚗 Car';

    // Render slot grid (green = available, red = booked, yellow = reserved)
    const grid = document.getElementById('slot-grid');
    grid.innerHTML = '';
    const slotData = node.slotDetails || generateSlotDetails(node.slots);
    
    slotData.forEach((slot, idx) => {
        const cell = document.createElement('div');
        cell.className = `slot-cell ${slot.status}`;
        if (slot.status === 'available') {
            cell.classList.add('clickable');
            cell.addEventListener('click', () => reserveSlot(node.id, slot.id));
        }
        
        cell.title = `${slot.id} — ${slot.status.toUpperCase()}`;
        cell.textContent = slot.id.replace('S', '').replace('P', ''); // Handle different ID formats
        cell.style.animationDelay = `${idx * 30}ms`;
        grid.appendChild(cell);
    });

    card.classList.remove('hidden');
}

/**
 * reserveSlot()
 * Opens booking modal with vehicle selection instead of directly booking.
 */
async function reserveSlot(facilityId, slotId) {
    if (!currentClusterKey) {
        logToConsole(`> Cannot reserve: Missing cluster key. Try searching again.`, 'error');
        return;
    }

    // Ensure vehicles are loaded for the modal dropdown
    if (vehiclesList.length === 0) {
        try {
            const res = await fetch(`${BACKEND_URL}/api/vehicles`);
            vehiclesList = await res.json();
        } catch (e) { /* continue without vehicles */ }
    }

    showBookingModal(facilityId, slotId);
}

function hideDetailCard() {
    document.getElementById('detail-card').classList.add('hidden');
    selectedNodeId = null;
    if (routeLine) map.removeLayer(routeLine);
    renderParkingList();
}

// ========================
// 7. GPS LOCATION
// ========================
function getUserLocation() {
    logToConsole('> Requesting browser Geolocation API...');
    const gpsBadge = document.getElementById('gps-badge');
    const gpsText = document.getElementById('gps-text');

    if (!navigator.geolocation) {
        logToConsole('> Geolocation not supported.', 'error');
        gpsText.textContent = 'GPS Unavailable';
        fallbackLocation();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            userCoords = { lat, lng };

            logToConsole(`> GPS Lock: [${lat.toFixed(4)}, ${lng.toFixed(4)}]`, 'success');
            gpsBadge.classList.remove('searching');
            gpsBadge.classList.add('active');
            gpsText.textContent = 'SRM University KTR';

            // Place user marker on map but do NOT fly away from SRM campus
            if (userLocMarker) map.removeLayer(userLocMarker);
            userLocMarker = L.marker([lat, lng], { icon: createUserIcon() })
                .addTo(map)
                .bindPopup('<div class="popup-title">📍 You are here</div>');

            // Do NOT call calibrateNodesToUser — keep SRM campus parking data intact
            // Just re-render the list so distances update based on real GPS
            renderParkingList();
            document.getElementById('find-btn').disabled = false;
        },
        (err) => {
            logToConsole(`> GPS error: ${err.message}. Using SRM campus.`, 'error');
            fallbackLocation();
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
}

function fallbackLocation() {
    // Default to SRM KTR campus center
    userCoords = { lat: SRM_KTR_CENTER.lat, lng: SRM_KTR_CENTER.lng };
    userLocMarker = L.marker([userCoords.lat, userCoords.lng], { icon: createUserIcon() })
        .addTo(map)
        .bindPopup('<div class="popup-title">📍 SRM University KTR</div>');
    document.getElementById('find-btn').disabled = false;

    // Update GPS badge for SRM
    const gpsBadge = document.getElementById('gps-badge');
    const gpsText = document.getElementById('gps-text');
    gpsBadge.classList.remove('searching');
    gpsBadge.classList.add('active');
    gpsText.textContent = 'SRM University KTR';

    renderParkingList();
    drawParkingMarkers();
}

/**
 * If user is far from default nodes, move all nodes near them
 * so the demo works worldwide by fetching from the backend.
 */
function calibrateNodesToUser(lat, lng) {
    logToConsole('> Calibrating parking nodes to local area via backend...');
    fetchParkingFromBackend(lat, lng, "Local Area");
}

// ========================
// 8. MATH: HAVERSINE DISTANCE
// ========================

/**
 * calculateDistance()
 * Uses the Haversine formula for accurate spherical distance.
 * Returns distance in meters.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * aStarSearch()
 *
 * A* Informed Search Algorithm — ANIMATED VISUALIZATION
 *
 * This version evaluates nodes one-by-one with visual effects on the map:
 *  1. Draws a scan line from user → each node
 *  2. Shows f(n) score as a floating tooltip on the map
 *  3. Colors the line green (passed) or red (rejected)
 *  4. After all evaluations, highlights winner and draws final route
 *
 * f(n) = g(n) + h(n)
 * g(n) = Haversine distance | h(n) = Manhattan distance heuristic
 */
function aStarSearch() {
    if (!userCoords) return alert('GPS location not available yet.');
    if (isAStarRunning) return; // Prevent double-click
    isAStarRunning = true;

    // Disable button during animation
    document.getElementById('find-btn').disabled = true;

    logToConsole('\n════════════════════════════════');
    logToConsole('> A* INTELLIGENT SEARCH INITIATED', 'success');
    logToConsole('════════════════════════════════');

    // Open the console panel
    document.getElementById('console-panel').classList.remove('hidden');

    // Clean up previous scan overlays
    clearAStarLayers();
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    hideDetailCard();

    // Remove old result badge if any
    const oldBadge = document.querySelector('.astar-result-badge');
    if (oldBadge) oldBadge.remove();

    // Use only filtered nodes (matching vehicle preference and Search Radius)
    const searchNodes = getFilteredNodes().filter(n => {
        const dist = calculateDistance(userCoords.lat, userCoords.lng, n.lat, n.lng);
        return (dist / 1000) <= searchRadiusKm;
    });

    // Zoom out to see all nodes
    const allCoords = searchNodes.map(n => [n.lat, n.lng]);
    allCoords.push([userCoords.lat, userCoords.lng]);
    map.fitBounds(allCoords, { padding: [60, 60], maxZoom: 15, duration: 1 });

    let openList = [];
    let closedList = [];
    let bestNode = null;
    let bestFCost = Infinity;
    let stepIndex = 0;
    const STEP_DELAY = 800; // ms between each node evaluation

    function evaluateNextNode() {
        if (stepIndex >= searchNodes.length) {
            // All nodes evaluated — show result
            finishAStarAnimation(openList, closedList, bestNode, bestFCost);
            return;
        }

        const node = searchNodes[stepIndex];
        stepIndex++;

        logToConsole(`\n► Evaluating: [${node.name}]`, 'calc');

        // Draw scan line from user to this node
        const scanLine = L.polyline(
            [[userCoords.lat, userCoords.lng], [node.lat, node.lng]],
            { color: '#fbbf24', weight: 2, opacity: 0.7, dashArray: '6, 4' }
        ).addTo(map);
        aStarLayers.push(scanLine);

        // Step 1: Check if node has slots
        if (node.slots === 0) {
            logToConsole(`  ✗ Slots = 0. Added to CLOSED list.`, 'error');
            closedList.push(node.id);

            // Turn line red and add rejected label
            setTimeout(() => {
                scanLine.setStyle({ color: '#ef4444', opacity: 0.5 });
                const label = L.tooltip({
                    permanent: true, direction: 'top', offset: [0, -12],
                    className: 'astar-scan-label'
                }).setContent(`<span style="color:#f87171">✗ FULL</span>`)
                    .setLatLng([node.lat, node.lng]);
                map.addLayer(label);
                aStarLayers.push(label);

                setTimeout(evaluateNextNode, STEP_DELAY);
            }, 300);
            return;
        }

        // Step 2: g(n) — Haversine distance
        const gN = calculateDistance(userCoords.lat, userCoords.lng, node.lat, node.lng);
        logToConsole(`  g(n) = ${gN.toFixed(0)}m  [Haversine distance]`);

        // Step 3: h(n) — heuristic based on mapping mode
        let hN;
        if (mappingMode === 'manhattan') {
            const latDiff = Math.abs(userCoords.lat - node.lat) * 111000;
            const lngDiff = Math.abs(userCoords.lng - node.lng) * 111000;
            hN = latDiff + lngDiff;
            logToConsole(`  h(n) = ${hN.toFixed(0)}m  [Manhattan heuristic]`);
        } else {
            // Haversine distance as a direct-line heuristic
            hN = calculateDistance(userCoords.lat, userCoords.lng, node.lat, node.lng);
            logToConsole(`  h(n) = ${hN.toFixed(0)}m  [Haversine heuristic]`);
        }

        // Step 4: f(n) = g(n) + h(n)
        const fN = gN + hN;
        logToConsole(`  f(n) = ${fN.toFixed(0)}m  ← TOTAL SCORE`, 'calc');

        openList.push({ node, fN, gN });

        if (fN < bestFCost) {
            bestFCost = fN;
            bestNode = { ...node, realDist: gN };
        }

        // Turn line green and show score label
        setTimeout(() => {
            scanLine.setStyle({ color: '#34d399', opacity: 0.6 });
            const label = L.tooltip({
                permanent: true, direction: 'top', offset: [0, -12],
                className: 'astar-scan-label'
            }).setContent(`f(n) = ${fN.toFixed(0)}m`)
                .setLatLng([node.lat, node.lng]);
            map.addLayer(label);
            aStarLayers.push(label);

            setTimeout(evaluateNextNode, STEP_DELAY);
        }, 300);
    }

    // Start the animated evaluation chain
    setTimeout(evaluateNextNode, 600);
}

/**
 * finishAStarAnimation()
 * Called after all nodes are visually evaluated.
 * Highlights the winner and draws the final route.
 */
function finishAStarAnimation(openList, closedList, bestNode, bestFCost) {
    logToConsole(`\n─── Summary ───`);
    logToConsole(`  OPEN list: ${openList.length} nodes`);
    logToConsole(`  CLOSED list: ${closedList.length} nodes`);

    if (bestNode) {
        logToConsole(`\n★ OPTIMAL: "${bestNode.name}" → f(n)=${bestFCost.toFixed(0)}m`, 'success');

        // Clear scan overlays with a short delay for visual effect
        setTimeout(() => {
            clearAStarLayers();

            // Show result badge on map
            const badge = document.createElement('div');
            badge.className = 'astar-result-badge';
            badge.textContent = `★ A* Result: ${bestNode.name} (${(bestNode.realDist / 1000).toFixed(1)} km)`;
            document.querySelector('.map-area').appendChild(badge);

            // Auto-remove badge after 5 seconds
            setTimeout(() => { if (badge.parentNode) badge.remove(); }, 5000);

            // Select it visually
            selectParkingNode(bestNode.id);
            drawRoute(bestNode);

            isAStarRunning = false;
            document.getElementById('find-btn').disabled = false;
        }, 600);
    } else {
        logToConsole(`\n✗ FAILED: No valid parking found. All at capacity.`, 'error');
        alert('No available parking spots found!');
        clearAStarLayers();
        isAStarRunning = false;
        document.getElementById('find-btn').disabled = false;
    }
}

/**
 * clearAStarLayers()
 * Removes all temporary scan lines, labels, and overlays from the map.
 */
function clearAStarLayers() {
    aStarLayers.forEach(layer => {
        try { map.removeLayer(layer); } catch (e) { }
    });
    aStarLayers = [];
}

// ========================
// 10. ROUTE DRAWING
// ========================

/**
 * drawRoute(targetNode)
 * Now runs a localized 2D Cell-by-cell A* Grid Search to visually
 * traverse from User to the selected Parking Spot globally!
 */
function drawRoute(targetNode) {
    if (isRouteRunning) return;
    isRouteRunning = true;
    logToConsole('\n> Generating Secondary Grid Pathfinding...', 'calc');

    // Clean previous routes and grids
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    gridLayers.forEach(layer => { try { map.removeLayer(layer); } catch (e) { } });
    gridLayers = [];

    if (!userCoords) {
        isRouteRunning = false;
        return;
    }

    // 1. Calculate Grid Boundary
    // Add 25% padding around the bounding box of User <--> Target
    const marginLat = Math.abs(userCoords.lat - targetNode.lat) * 0.25 || 0.005;
    const marginLng = Math.abs(userCoords.lng - targetNode.lng) * 0.25 || 0.005;

    const minLat = Math.min(userCoords.lat, targetNode.lat) - marginLat;
    const maxLat = Math.max(userCoords.lat, targetNode.lat) + marginLat;
    const minLng = Math.min(userCoords.lng, targetNode.lng) - marginLng;
    const maxLng = Math.max(userCoords.lng, targetNode.lng) + marginLng;

    // 2. Define Grid Dimensions (20x20)
    const ROWS = 20;
    const COLS = 20;
    const stepLat = (maxLat - minLat) / ROWS;
    const stepLng = (maxLng - minLng) / COLS;

    const grid = [];

    // Helper to get distance heuristic
    function heuristic(r1, c1, r2, c2) {
        return Math.abs(r1 - r2) + Math.abs(c1 - c2);
    }

    // 3. Initialize Grid Nodes
    for (let r = 0; r < ROWS; r++) {
        grid[r] = [];
        for (let c = 0; c < COLS; c++) {
            // Random obstacles: ~15% density for realistic street blocks
            const isObstacle = Math.random() < 0.15;
            grid[r][c] = {
                r, c,
                lat: minLat + r * stepLat + (stepLat / 2),
                lng: minLng + c * stepLng + (stepLng / 2),
                walkable: !isObstacle,
                f: 0, g: 0, h: 0,
                parent: null,
                closed: false,
                opened: false,
                bounds: [
                    [minLat + r * stepLat, minLng + c * stepLng],
                    [minLat + (r + 1) * stepLat, minLng + (c + 1) * stepLng]
                ]
            };
        }
    }

    // 4. Map User & Target to closest grid cells
    let startCell = grid[0][0];
    let endCell = grid[ROWS - 1][COLS - 1];
    let minStartDist = Infinity, minEndDist = Infinity;

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = grid[r][c];
            const dStart = Math.pow(cell.lat - userCoords.lat, 2) + Math.pow(cell.lng - userCoords.lng, 2);
            const dEnd = Math.pow(cell.lat - targetNode.lat, 2) + Math.pow(cell.lng - targetNode.lng, 2);

            if (dStart < minStartDist) { minStartDist = dStart; startCell = cell; }
            if (dEnd < minEndDist) { minEndDist = dEnd; endCell = cell; }
        }
    }

    // Force start and end to be walkable, and clear immediate neighbors
    startCell.walkable = true;
    endCell.walkable = true;
    const clearRegion = (node) => {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = node.r + dr, nc = node.c + dc;
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) grid[nr][nc].walkable = true;
            }
        }
    };
    clearRegion(startCell);
    clearRegion(endCell);

    // 5. Visually render Obstacles on the map
    logToConsole(`  Grid map generated (${ROWS}x${COLS}). Identifying obstacles...`);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!grid[r][c].walkable) {
                const rect = L.rectangle(grid[r][c].bounds, { color: '#ef4444', weight: 0, fillOpacity: 0.25 }).addTo(map);
                gridLayers.push(rect);
            }
        }
    }

    // Zoom map smoothly to the full grid bounding box
    map.flyToBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [40, 40], maxZoom: 16, duration: 1.2 });

    // 6. Grid A* Search Implementation
    let openList = [startCell];
    startCell.opened = true;
    let fallbackToDirect = false;

    const FRAME_DELAY = 15; // ms per grid expansion step

    function gridAStarLoop() {
        if (!isRouteRunning) return; // aborted

        if (openList.length === 0) {
            // No path found in grid
            logToConsole('  Grid path blocked! Plotting direct vector.', 'error');
            fallbackToDirect = true;
            drawFinalPath(null);
            return;
        }

        // Find lowest f cost node
        let lowestIdx = 0;
        for (let i = 1; i < openList.length; i++) {
            if (openList[i].f < openList[lowestIdx].f) {
                lowestIdx = i;
            }
        }

        let currNode = openList[lowestIdx];

        // Goal Reached!
        if (currNode === endCell) {
            logToConsole('  Final Grid Route computed successfully.', 'success');
            drawFinalPath(currNode);
            return;
        }

        // Move current node from open to closed
        openList.splice(lowestIdx, 1);
        currNode.closed = true;

        // Visualize "Closed" (evaluated) cell
        if (currNode !== startCell && currNode !== endCell) {
            const rect = L.rectangle(currNode.bounds, { color: '#8b5cf6', weight: 1, fillOpacity: 0.15 }).addTo(map);
            gridLayers.push(rect);
        }

        // Check 8-way neighbors
        const neighbors = [
            [-1, 0, 10], [1, 0, 10], [0, -1, 10], [0, 1, 10],       // Orthogonal
            [-1, -1, 14], [-1, 1, 14], [1, -1, 14], [1, 1, 14]      // Diagonal
        ];

        neighbors.forEach(n => {
            const nr = currNode.r + n[0];
            const nc = currNode.c + n[1];
            const cost = n[2];

            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                const neighbor = grid[nr][nc];

                if (!neighbor.closed && neighbor.walkable) {
                    const tempG = currNode.g + cost;

                    // If not in open list, or we found a shorter path to it
                    let newPathBetter = false;
                    if (!neighbor.opened) {
                        neighbor.opened = true;
                        newPathBetter = true;
                        openList.push(neighbor);

                        // Visualize "Opened" (frontier) cell
                        if (neighbor !== startCell && neighbor !== endCell) {
                            const rect = L.rectangle(neighbor.bounds, { color: '#fbbf24', weight: 1, fillOpacity: 0.2 }).addTo(map);
                            gridLayers.push(rect);
                        }
                    } else if (tempG < neighbor.g) {
                        newPathBetter = true;
                    }

                    if (newPathBetter) {
                        neighbor.parent = currNode;
                        neighbor.g = tempG;
                        neighbor.h = heuristic(neighbor.r, neighbor.c, endCell.r, endCell.c) * 10;
                        neighbor.f = neighbor.g + neighbor.h;
                    }
                }
            }
        });

        // Loop next frame
        setTimeout(gridAStarLoop, FRAME_DELAY);
    }

    // Start Grid Expansion Phase delayed to allow map to zoom
    setTimeout(gridAStarLoop, 1400);

    // 7. Reconstruct & Draw Path
    function drawFinalPath(endPathNode) {
        let pathCoords = [];

        if (fallbackToDirect) {
            pathCoords = [
                [userCoords.lat, userCoords.lng],
                [targetNode.lat, targetNode.lng]
            ];
        } else {
            // Reconstruct A* path backwards from end to start
            let curr = endPathNode;
            const tempPath = [];
            while (curr && curr.parent) {
                tempPath.push([curr.lat, curr.lng]);
                curr = curr.parent;
            }
            tempPath.push([startCell.lat, startCell.lng]);
            tempPath.reverse(); // Now it's from start to end

            // Append exact actual positions to ends for smoothness
            pathCoords.push([userCoords.lat, userCoords.lng]);
            pathCoords.push(...tempPath);
            pathCoords.push([targetNode.lat, targetNode.lng]);
        }

        // Draw the final route polyline segment by segment
        routeLine = L.polyline([], {
            color: '#34d399',
            weight: 6,
            opacity: 0.9,
            dashArray: '14, 10',
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(map);

        let currentStep = 0;

        const animatePathRendering = () => {
            if (currentStep >= pathCoords.length) {
                isRouteRunning = false;
                // Dim down the grid layers slightly to focus on route
                gridLayers.forEach(l => {
                    if (l.options.color !== '#ef4444') { // Keep obstacles red, fade search cells
                        l.setStyle({ fillOpacity: 0.05, opacity: 0.3 });
                    }
                });
                return;
            }
            routeLine.addLatLng(pathCoords[currentStep]);
            currentStep++;
            setTimeout(animatePathRendering, 40); // 40ms per line segment
        };

        logToConsole('> Tracing Phase-2 path vector...', 'success');
        setTimeout(animatePathRendering, 300);
    }
}

// ========================
// 11. SIMULATION
// ========================

/**
 * Simulates environmental changes: random cars arrive/leave.
 */
function triggerEnvironmentalSim() {
    logToConsole('\n> Simulating slot mutations...', 'calc');

    P_NODES.forEach(n => {
        const drift = highDensitySimulation ? -4 : 0; // More cars arrive if density set high
        const delta = Math.floor(Math.random() * 8) - 3 + drift;
        const old = n.slots;
        n.slots = Math.max(0, n.slots + delta);
        if (n.slots !== old) {
            logToConsole(`  ${n.name}: ${old} → ${n.slots}`, old > n.slots ? 'error' : 'success');
            n.slotDetails = generateSlotDetails(n.slots);
        }
    });

    drawParkingMarkers();
    renderParkingList();

    // Check if selected node became full
    if (selectedNodeId) {
        const node = P_NODES.find(n => n.id === selectedNodeId);
        if (node && node.slots === 0) {
            logToConsole(`\n⚠ WARNING: "${node.name}" just became FULL!`, 'error');
            hideDetailCard();
        } else if (node) {
            showDetailCard(node);
        }
    }
}

// ========================
// 12. CONSOLE LOGGER
// ========================
function logToConsole(text, theme = '') {
    const container = document.getElementById('console-logs');
    const line = document.createElement('span');
    line.className = `log-line${theme ? ' ' + theme : ''}`;
    line.textContent = text;
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
}

/**
 * showReservationToast()
 * Custom styled notification for slot reservation confirmations.
 * More reliable than alert() and doesn't block the UI.
 */
function showReservationToast(slotId) {
    // Remove existing toast if any
    const existing = document.querySelector('.reservation-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'reservation-toast';
    toast.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <div>
            <strong>Reservation Successful!</strong>
            <span>Slot ${slotId} is now reserved for you.</span>
        </div>
    `;
    document.querySelector('.map-area').appendChild(toast);

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
    }, 4000);
}

/**
 * showMismatchToast()
 * Warns user when their vehicle type doesn't match the parking zone type.
 * Shows a premium styled popup with clear visual feedback.
 */
function showMismatchToast(vehicleEmoji, vehicleLabel, facilityEmoji, facilityLabel, facilityName) {
    // Remove existing mismatch overlay if any
    const existing = document.querySelector('.mismatch-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'mismatch-overlay';

    const toast = document.createElement('div');
    toast.className = 'mismatch-toast';
    toast.innerHTML = `
        <div class="mismatch-toast-header">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <strong>Vehicle Type Mismatch!</strong>
        </div>
        <div class="mismatch-toast-body">
            <div class="mismatch-vs">
                <div class="mismatch-side">
                    <span class="mismatch-emoji">${vehicleEmoji}</span>
                    <span class="mismatch-label">Your Vehicle</span>
                    <span class="mismatch-type">${vehicleLabel}</span>
                </div>
                <div class="mismatch-divider">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                    </svg>
                </div>
                <div class="mismatch-side">
                    <span class="mismatch-emoji">${facilityEmoji}</span>
                    <span class="mismatch-label">Parking Zone</span>
                    <span class="mismatch-type">${facilityLabel}</span>
                </div>
            </div>
            <p class="mismatch-message">
                <strong>"${facilityName}"</strong> is a <strong>${facilityLabel}</strong>. 
                Please select a compatible vehicle or choose a different parking zone.
            </p>
        </div>
        <button class="mismatch-dismiss-btn" onclick="this.closest('.mismatch-overlay').remove()">Got It</button>
    `;
    overlay.appendChild(toast);
    document.body.appendChild(overlay);

    // Auto-dismiss after 6 seconds
    setTimeout(() => {
        if (overlay.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'scale(0.95)';
            setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 400);
        }
    }, 6000);
}

// ========================
// NAVIGATION PANEL SWITCHING
// ========================
function switchPanel(panelName) {
    activePanel = panelName;
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`panel-${panelName}`).classList.remove('hidden');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${panelName}`).classList.add('active');

    if (panelName === 'vehicles') loadVehicles();
    if (panelName === 'history') loadHistory();
}

// ========================
// VEHICLE MANAGEMENT
// ========================
async function loadVehicles() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/vehicles`);
        vehiclesList = await res.json();
        renderVehiclesList();
    } catch (err) {
        console.error('Failed to load vehicles:', err);
    }
}

function renderVehiclesList() {
    const container = document.getElementById('vehicles-list');
    container.innerHTML = '';

    if (vehiclesList.length === 0) {
        container.innerHTML = '<div class="empty-message">No vehicles registered yet. Add one below.</div>';
        return;
    }

    vehiclesList.forEach(v => {
        const iconMap = { 'Car': '🚗', 'Bike': '🏍️', 'Electric': '🚗' };
        const card = document.createElement('div');
        card.className = 'vehicle-card';
        card.innerHTML = `
            <div class="vehicle-card-info">
                <div class="vehicle-card-icon">${iconMap[v.type] || '🚗'}</div>
                <div>
                    <div class="vehicle-card-name">${v.name}</div>
                    <div class="vehicle-card-plate">${v.plate}</div>
                    <div class="vehicle-card-type">${v.type}</div>
                </div>
            </div>
            <button class="vehicle-delete-btn" data-vid="${v.id}" title="Remove vehicle">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;
        // Attach delete handler
        card.querySelector('.vehicle-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteVehicle(parseInt(e.currentTarget.dataset.vid));
        });
        container.appendChild(card);
    });
}

async function handleAddVehicle(e) {
    e.preventDefault();
    const name = document.getElementById('add-veh-name').value.trim();
    let plate = document.getElementById('add-veh-plate').value.trim().toUpperCase();
    const type = document.getElementById('add-veh-type').value;
    if (!name || !plate) return;

    // License Plate Validation
    const plateRegex = /^[A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,2}[-\s]?[0-9]{4}$/i;
    const fallbackRegex = /^[A-Z0-9\s-]{4,15}$/i; // Safe fallback for demo purposes
    
    if (!plateRegex.test(plate) && !fallbackRegex.test(plate)) {
        alert("Invalid license plate format. Please use a valid format (e.g. MH-12-AB-1234).");
        return;
    }

    try {
        const res = await fetch(`${BACKEND_URL}/api/vehicles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, plate, type })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('add-veh-name').value = '';
            document.getElementById('add-veh-plate').value = '';
            loadVehicles();
            logToConsole(`> Vehicle ${plate} registered.`, 'success');
        }
    } catch (err) {
        console.error('Failed to add vehicle:', err);
    }
}

async function deleteVehicle(id) {
    if (!confirm('Remove this vehicle?')) return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/vehicles/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            loadVehicles();
            logToConsole(`> Vehicle removed.`, 'success');
        }
    } catch (err) {
        console.error('Failed to delete vehicle:', err);
    }
}

// ========================
// DYNAMIC HISTORY
// ========================
async function loadHistory() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/history`);
        const data = await res.json();
        renderHistory(data);
    } catch (err) {
        console.error('Failed to load history:', err);
        renderHistory([]);
    }
}

function renderHistory(entries) {
    const container = document.getElementById('history-list');
    container.innerHTML = '';

    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-message">No activity yet. Book a parking slot to see history.</div>';
        return;
    }

    entries.forEach(entry => {
        const iconMap = { 'in': '↗', 'out': '↘', 'book': '📋', 'vehicle': '🚗' };
        const item = document.createElement('div');
        item.className = `history-item history-${entry.type}`;
        item.innerHTML = `
            <div class="history-icon-circle history-icon-${entry.type}">${iconMap[entry.type] || '•'}</div>
            <div class="history-info" style="flex:1;">
                <div class="history-title">${entry.title}</div>
                ${entry.detail ? `<div class="history-detail">${entry.detail}</div>` : ''}
                <div class="history-time">${entry.timeDisplay || entry.time}</div>
            </div>
            ${entry.type === 'book' ? `<button class="slot-release-btn" data-hid="${entry.id}" data-fid="${entry.facilityId}" data-sid="${entry.slotId}" data-ckey="${entry.clusterKey || 'SRM_KTR'}" style="background:transparent;border:1px solid #ef4444;color:#ef4444;padding:4px 8px;border-radius:4px;font-size:0.75rem;cursor:pointer;margin-left:8px;">Release</button>` : ''}
        `;
        
        item.querySelectorAll('.slot-release-btn').forEach(btn => {
            btn.addEventListener('click', () => requestReleaseSlot(btn.dataset.hid, btn.dataset.fid, btn.dataset.sid, btn.dataset.ckey));
        });
        
        container.appendChild(item);
    });
}

// ========================
// BOOKING MODAL (Vehicle Selection)
// ========================
function showBookingModal(nodeId, slotId) {
    pendingBooking = { nodeId, slotId };
    const node = P_NODES.find(n => n.id === nodeId);
    if (!node) return;

    const facilityVtype = node.vehicleType || 'car';
    const vtypeLabel = facilityVtype === '2-wheeler' ? '🏍️ Two-Wheeler Zone' : '🚗 Car Zone';
    document.getElementById('bm-facility-name').textContent = node.name;
    document.getElementById('bm-slot-id').textContent = slotId;

    // Show facility vehicle type in modal
    let vtypeInfoEl = document.getElementById('bm-facility-vtype');
    if (vtypeInfoEl) {
        vtypeInfoEl.textContent = vtypeLabel;
        vtypeInfoEl.className = `bm-vtype-tag bm-vtype-${facilityVtype === '2-wheeler' ? '2w' : 'car'}`;
    }

    // Populate vehicle dropdown with type info
    const select = document.getElementById('bm-vehicle-select');
    select.innerHTML = '<option value="">— No vehicle —</option>';
    vehiclesList.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = `${v.name} (${v.plate}) — ${v.type}`;
        opt.dataset.vname = v.name;
        opt.dataset.vplate = v.plate;
        opt.dataset.vtype = v.type; // 'Car', 'Bike', 'Other'
        select.appendChild(opt);
    });

    document.getElementById('booking-modal').classList.remove('hidden');
}

async function confirmBookingFromModal() {
    if (!pendingBooking) return;
    const { nodeId, slotId } = pendingBooking;
    const select = document.getElementById('bm-vehicle-select');
    const selectedOpt = select.options[select.selectedIndex];

    const vehicleId = select.value ? parseInt(select.value) : null;
    const vehicleName = selectedOpt?.dataset?.vname || null;
    const vehiclePlate = selectedOpt?.dataset?.vplate || null;
    const vehicleType = selectedOpt?.dataset?.vtype || null; // 'Car', 'Bike', 'Other'

    // ── Vehicle-Type Mismatch Check ──
    if (vehicleId && vehicleType) {
        const node = P_NODES.find(n => n.id === nodeId);
        if (node) {
            const facilityType = node.vehicleType || 'car'; // 'car' or '2-wheeler'
            const isBikeVehicle = vehicleType === 'Bike';
            const isCarVehicle = !isBikeVehicle; // Anything not a Bike is car-class (Car, Electric, etc.)
            const isCarFacility = facilityType === 'car';
            const is2wFacility = facilityType === '2-wheeler';

            if ((isBikeVehicle && isCarFacility) || (isCarVehicle && is2wFacility)) {
                const vehicleEmoji = isBikeVehicle ? '🏍️' : '🚗';
                const facilityEmoji = isCarFacility ? '🚗' : '🏍️';
                const vehicleLabel = isBikeVehicle ? 'Bike / Two-Wheeler' : 'Car / Four-Wheeler';
                const facilityLabel = isCarFacility ? 'Car Parking Zone' : 'Two-Wheeler Parking Zone';
                showMismatchToast(
                    vehicleEmoji, vehicleLabel,
                    facilityEmoji, facilityLabel,
                    node.name
                );
                logToConsole(`> ⚠ BLOCKED: ${vehicleLabel} cannot park in ${facilityLabel} (${node.name})`, 'error');
                return; // Do NOT close the modal — let them pick a different vehicle
            }
        }
    }

    document.getElementById('booking-modal').classList.add('hidden');
    logToConsole(`> Initiating reservation for ${nodeId} / ${slotId}...`);

    let estimatedArrival = "N/A";
    if (userCoords) {
        const node = P_NODES.find(n => n.id === nodeId);
        if (node) {
            const distKm = calculateDistance(userCoords.lat, userCoords.lng, node.lat, node.lng) / 1000;
            const mins = Math.max(1, Math.round(distKm * 3)); // ~20km/h average city/campus speed
            estimatedArrival = `${mins} min${mins > 1 ? 's' : ''}`;
        }
    }

    // Handle LOCAL / SRM_KTR mode
    if (currentClusterKey === 'OFFLINE' || currentClusterKey === 'SRM_KTR') {
        logToConsole(`> [LOCAL MODE] Reserving slot...`, 'calc');
        const node = P_NODES.find(n => n.id === nodeId);
        if (!node) { pendingBooking = null; return; }

        const slot = node.slotDetails.find(s => s.id === slotId);
        if (slot && slot.status === 'available') {
            slot.status = 'reserved';
            node.slots--;
            const vehLabel = vehiclePlate ? ` for ${vehiclePlate}` : '';
            logToConsole(`> SUCCESS: Slot ${slotId} reserved${vehLabel}. ETA: ${estimatedArrival}`, 'success');

            // Send to history API for local bookings
            const historyBody = {
                type: 'book',
                title: `Slot ${slotId} Reserved — ${node.name}`,
                detail: `Vehicle: ${vehiclePlate ? `${vehicleName} (${vehiclePlate})` : 'No vehicle linked'} • ETA: ${estimatedArrival}`,
                facilityId: node.id,
                slotId: slotId,
                clusterKey: currentClusterKey
            };

            fetch(`${BACKEND_URL}/api/history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(historyBody)
            }).then(() => {
                if (vehiclePlate) {
                    return fetch(`${BACKEND_URL}/api/history`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 'in',
                            title: `Vehicle ${vehiclePlate} Checked In`,
                            detail: `${vehicleName} → ${node.name} Slot ${slotId} • ETA: ${estimatedArrival}`
                        })
                    });
                }
            }).catch(e => console.error("Could not record local history:", e));

            drawParkingMarkers();
            renderParkingList();
            showDetailCard(node);
            showReservationToast(slotId);
        }
        pendingBooking = null;
        return;
    }

    // ONLINE booking with vehicle info and ETA
    try {
        const res = await fetch(`${BACKEND_URL}/api/book`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clusterKey: currentClusterKey,
                facilityId: nodeId,
                slotId,
                vehicleId,
                vehicleName,
                vehiclePlate,
                estimatedArrival
            })
        });
        const result = await res.json();

        if (result.success) {
            logToConsole(`> SUCCESS: ${result.message}`, 'success');
            if (userCoords) {
                await fetchParkingFromBackend(userCoords.lat, userCoords.lng, lastSearchedName);
                selectParkingNode(nodeId);
            }
            showReservationToast(slotId);
        } else {
            logToConsole(`> FAILED: ${result.error}`, 'error');
            alert(`Reservation Failed: ${result.error}`);
        }
    } catch (err) {
        console.error("Booking error:", err);
        logToConsole(`> Network error during booking.`, 'error');
        alert('Booking failed. Check backend connection.');
    }
    pendingBooking = null;
}

function cancelBookingModal() {
    document.getElementById('booking-modal').classList.add('hidden');
    pendingBooking = null;
}

// Release Slot Function
async function requestReleaseSlot(historyId, facilityId, slotId, clusterKey) {
    if (!confirm(`Cancel reservation and release Slot ${slotId}?`)) return;
    
    try {
        logToConsole(`> Releasing slot ${slotId}...`);
        const res = await fetch(`${BACKEND_URL}/api/book/${slotId}?clusterKey=${clusterKey}&facilityId=${facilityId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        
        if (data.success || clusterKey === 'SRM_KTR' || clusterKey === 'OFFLINE') {
            // Local fallback release
            const node = P_NODES.find(n => n.id === facilityId);
            if (node) {
                const slot = node.slotDetails.find(s => s.id === slotId);
                if (slot && slot.status === 'reserved') {
                    slot.status = 'available';
                    node.slots++;
                }
            }
            logToConsole(`> ${data.message || `Slot ${slotId} released.`}`, 'success');
            
            if (selectedNodeId === facilityId && node) {
                showDetailCard(node);
            }
            drawParkingMarkers();
            renderParkingList();
            loadHistory();
        } else {
            alert(data.error || 'Failed to release slot');
        }
    } catch (err) {
        console.error("Cancellation error:", err);
        alert("Failed to release checking network.");
    }
}

