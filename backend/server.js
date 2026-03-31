import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ========================
// IN-MEMORY DATA STORES
// ========================
const globalStore = {};
const vehicleStore = [
  { id: 1, name: 'Maruti Suzuki Swift', plate: 'KA-01-AB-1234', type: 'Car' },
  { id: 2, name: 'Tata Nexon EV', plate: 'MH-12-RR-5678', type: 'Electric' }
];
let nextVehicleId = 3;
const bookingHistory = [];
let nextHistoryId = 1;

// ========================
// HELPER: Relative Time
// ========================
function getRelativeTime(isoTime) {
  const diff = Date.now() - new Date(isoTime).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ========================
// VEHICLE ENDPOINTS
// ========================
app.get('/api/vehicles', (req, res) => {
  res.json(vehicleStore);
});

app.post('/api/vehicles', (req, res) => {
  const { name, plate, type } = req.body;
  if (!name || !plate || !type) {
    return res.status(400).json({ error: "Name, plate and type are required." });
  }
  const newVehicle = { id: nextVehicleId++, name, plate, type };
  vehicleStore.push(newVehicle);

  bookingHistory.unshift({
    id: nextHistoryId++,
    type: 'vehicle',
    title: `Vehicle ${plate} Registered`,
    detail: `${name} (${type})`,
    time: new Date().toISOString()
  });

  res.json({ success: true, vehicle: newVehicle });
});

app.delete('/api/vehicles/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = vehicleStore.findIndex(v => v.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Vehicle not found." });
  }
  const removed = vehicleStore.splice(idx, 1)[0];
  res.json({ success: true, vehicle: removed });
});

// ========================
// FACILITY GENERATION
// ========================
const generateSlots = (num) => {
  return Array.from({ length: num }, (_, i) => ({
    id: `P${(i + 1).toString().padStart(2, '0')}`,
    status: Math.random() > 0.6 ? 'booked' : (Math.random() > 0.3 ? 'available' : 'reserved'),
  }));
};

const getOrCreateFacilities = (lat, lng, locationName) => {
  const clusterKey = `${Number(lat).toFixed(2)}_${Number(lng).toFixed(2)}`;
  const basePrefix = locationName ? locationName.split(' ')[0] : 'Local';

  if (!globalStore[clusterKey]) {
    globalStore[clusterKey] = [
      { id: 'P1', name: `${basePrefix} NDMC Multi-Level`, lat: lat + 0.0031, lng: lng + 0.0042, slots: generateSlots(32) },
      { id: 'P2', name: `${basePrefix} MCD Basement`, lat: lat - 0.0045, lng: lng - 0.0028, slots: generateSlots(12) },
      { id: 'P3', name: `${basePrefix} Smart Secure Hub`, lat: lat + 0.0082, lng: lng - 0.0064, slots: generateSlots(24) },
      { id: 'P4', name: `${basePrefix} QuickSpot Zone`, lat: lat - 0.0035, lng: lng + 0.0091, slots: generateSlots(16) },
      { id: 'P5', name: `${basePrefix} Automated Tower`, lat: lat + 0.012, lng: lng + 0.0015, slots: generateSlots(20) },
      { id: 'P6', name: `${basePrefix} Metro Station Lot`, lat: lat - 0.009, lng: lng + 0.005, slots: generateSlots(40) },
    ];
  }

  return { clusterKey, facilities: globalStore[clusterKey] };
};

app.get('/api/facilities', (req, res) => {
  const { lat, lng, name } = req.query;
  if (!lat || !lng) {
    return res.status(400).json({ error: "Latitude and longitude required." });
  }
  const result = getOrCreateFacilities(Number(lat), Number(lng), name);
  res.json({ clusterKey: result.clusterKey, facilities: result.facilities });
});

// ========================
// BOOKING (with Vehicle Linking + History Recording)
// ========================
app.post('/api/book', (req, res) => {
  const { clusterKey, facilityId, slotId, vehicleId, vehicleName, vehiclePlate } = req.body;
  if (!clusterKey || !facilityId || !slotId) {
    return res.status(400).json({ error: "Missing required booking data." });
  }

  const cluster = globalStore[clusterKey];
  if (!cluster) {
    return res.status(404).json({ error: "Facility cluster not found." });
  }

  const facility = cluster.find(f => f.id === facilityId);
  if (!facility) {
    return res.status(404).json({ error: "Facility not found." });
  }

  const slot = facility.slots.find(s => s.id === slotId);
  if (!slot) {
    return res.status(404).json({ error: "Slot not found." });
  }

  if (slot.status !== 'available') {
    return res.status(400).json({ error: "Slot is not available." });
  }

  // Update slot state
  slot.status = 'reserved';

  // Record booking in history
  const vehLabel = vehiclePlate ? `${vehicleName} (${vehiclePlate})` : 'No vehicle linked';
  const etaLabel = req.body.estimatedArrival ? ` • ETA: ${req.body.estimatedArrival}` : '';
  bookingHistory.unshift({
    id: nextHistoryId++,
    type: 'book',
    title: `Slot ${slotId} Reserved — ${facility.name}`,
    detail: `Vehicle: ${vehLabel}${etaLabel}`,
    facilityId,
    facilityName: facility.name,
    slotId,
    clusterKey,
    vehicleId: vehicleId || null,
    vehicleName: vehicleName || null,
    vehiclePlate: vehiclePlate || null,
    time: new Date().toISOString()
  });

  // If vehicle provided, add check-in event
  if (vehiclePlate) {
    bookingHistory.unshift({
      id: nextHistoryId++,
      type: 'in',
      title: `Vehicle ${vehiclePlate} Checked In`,
      detail: `${vehicleName} → ${facility.name} Slot ${slotId}${etaLabel}`,
      time: new Date().toISOString()
    });
  }

  res.json({
    success: true,
    message: `Slot ${slotId} successfully booked${vehiclePlate ? ` for ${vehiclePlate}` : ''}.`,
    booking: { facilityId, facilityName: facility.name, slotId, vehicleId, vehicleName, vehiclePlate, estimatedArrival: req.body.estimatedArrival, bookedAt: new Date().toISOString() }
  });
});

app.delete('/api/book/:slotId', (req, res) => {
  const { slotId } = req.params;
  const { clusterKey, facilityId } = req.query;

  if (clusterKey && facilityId && globalStore[clusterKey]) {
    const facility = globalStore[clusterKey].find(f => f.id === facilityId);
    if (facility) {
      const slot = facility.slots.find(s => s.id === slotId);
      if (slot && slot.status === 'reserved') {
        slot.status = 'available';
      }
    }
  }

  // Record cancellation in history
  bookingHistory.unshift({
    id: nextHistoryId++,
    type: 'out',
    title: `Slot ${slotId} Released`,
    detail: `Reservation cancelled.`,
    time: new Date().toISOString()
  });

  res.json({ success: true, message: `Slot ${slotId} released successfully.` });
});

// ========================
// DYNAMIC HISTORY
// ========================
app.get('/api/history', (req, res) => {
  const result = bookingHistory.map(entry => ({
    ...entry,
    timeDisplay: getRelativeTime(entry.time)
  }));
  res.json(result);
});

app.post('/api/history', (req, res) => {
  const entry = req.body;
  if (!entry || !entry.type) return res.status(400).json({ error: "Invalid history entry" });
  
  bookingHistory.unshift({
    id: nextHistoryId++,
    ...entry,
    time: new Date().toISOString()
  });
  res.json({ success: true });
});


// ========================
// SERVE FRONTEND (AStarProject — Single Unified UI)
// ========================
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend', 'AStarProject');
app.use(express.static(FRONTEND_PATH));

app.use((req, res) => {
  res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Smart Parking Backend Server running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
});
