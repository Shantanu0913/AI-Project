import React, { useState, useEffect } from 'react';
import {
  Car, LayoutDashboard, History, Settings, Bell, Menu, X,
  LogOut, MapPin, CreditCard, Clock, ArrowUpRight, ArrowDownRight,
  ShieldCheck, CalendarDays, Navigation, Map as MapIcon, Search, Loader2
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import './index.css';

// Fix standard Leaflet markers
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// Custom User Marker
const userIcon = new L.DivIcon({
  html: `<div class="user-pulse-marker"></div>`,
  className: 'custom-user-marker',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

// Mock Activities
const ACTIVITIES = [
  { id: 1, type: 'in', title: 'Vehicle MH12 ABEntered', time: 'Just now', icon: ArrowUpRight },
  { id: 2, type: 'book', title: 'Slot A12 Reserved', time: '12 mins ago', icon: CalendarDays },
  { id: 3, type: 'out', title: 'Vehicle DL4C Exited', time: '28 mins ago', icon: ArrowDownRight },
];

// API Service Logic
const fetchFacilitiesFromBackend = async (lat, lng, name = "") => {
  try {
    const res = await fetch(`http://localhost:5000/api/facilities?lat=${lat}&lng=${lng}&name=${encodeURIComponent(name)}`);
    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Failed fetching facilities:", error);
    return { clusterKey: null, facilities: [] };
  }
};

const bookSlotFromBackend = async (clusterKey, facilityId, slotId) => {
  try {
    const res = await fetch(`http://localhost:5000/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clusterKey, facilityId, slotId })
    });
    return await res.json();
  } catch (err) {
    console.error("Booking error:", err);
    return { error: 'Network issue communicating with the booking endpoint.' };
  }
};

// Auto Pan Map to Center
const MapUpdater = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true, duration: 1.5 });
  }, [center, map]);
  return null;
};

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Dashboard');

  // Realtime Map State
  const [userLoc, setUserLoc] = useState([40.7128, -74.0060]); // Default to NYC
  const [facilities, setFacilities] = useState([]);
  const [clusterKey, setClusterKey] = useState(null);
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [mapMode, setMapMode] = useState('searching'); // 'searching', 'gps', 'searched'
  const [targetInfo, setTargetInfo] = useState(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Vehicles State
  const [vehicles, setVehicles] = useState([]);
  const [isAddingVehicle, setIsAddingVehicle] = useState(false);
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [newVehicle, setNewVehicle] = useState({ name: '', plate: '', type: 'Car' });

  // History State
  const [history, setHistory] = useState([]);

  // 1. Initial Loading Splash
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // 2. Fetch User Geolocation real-time
  useEffect(() => {
    if ("geolocation" in navigator && mapMode !== 'searched') {
      const geoId = navigator.geolocation.watchPosition(
        (position) => {
          // If the user already searched something, stop tracking their GPS dynamically to prevent jump-back
          if (mapMode === 'searched') return;

          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setUserLoc([lat, lng]);
          setMapMode('gps');

          // Generate mocked facilities around user only once over API Call
          if (facilities.length === 0) {
            fetchFacilitiesFromBackend(lat, lng, "Local Hub").then(res => {
              if (res.facilities) {
                setFacilities(res.facilities);
                setClusterKey(res.clusterKey);
              }
            });
          }
        },
        (error) => {
          console.error("GPS Error: ", error);
          if (mapMode !== 'searched') {
            fetchFacilitiesFromBackend(40.7128, -74.0060, "NYC Default").then(res => {
              if (res.facilities) {
                setFacilities(res.facilities);
                setClusterKey(res.clusterKey);
              }
            });
          }
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
      );
      return () => navigator.geolocation.clearWatch(geoId);
    }
  }, [mapMode, facilities.length]);

  // 3. Search geocoding handler
  const fetchLocationData = async (name, lat, lng) => {
    let locInfo = {
      title: name,
      description: "Mapped Destination",
      extract: "Scan surrounding IoT networks for live parking availability and booking options directly from the interactive map.",
      thumbnail: "https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&q=80&w=800"
    };

    // 1. Fetch exact textual details for the POI
    try {
      const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        locInfo.title = wikiData.title || name;
        locInfo.description = wikiData.description || "Geographic Location";
        locInfo.extract = wikiData.extract || locInfo.extract;
        if (wikiData.thumbnail?.source) {
          locInfo.thumbnail = wikiData.thumbnail.source;
        }
      }
    } catch (e) { }

    // 2. Fetch real photographic imagery surrounding the target coordinates to behave like Google Places
    // This frequently overrides boring schematic diagrams/icons natively with an authentic photo of the area
    try {
      const geoRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&generator=geosearch&ggscoord=${lat}|${lng}&ggsradius=10000&format=json&pithumbsize=800&origin=*`);
      const geoData = await geoRes.json();
      if (geoData.query && geoData.query.pages) {
        const pages = Object.values(geoData.query.pages);

        // Retrieve the first authentic JPEG/JPG photograph of the local geography
        const realPhoto = pages.find(p => p.thumbnail?.source && p.thumbnail.source.toLowerCase().includes('.jpg'));

        if (realPhoto) {
          locInfo.thumbnail = realPhoto.thumbnail.source;
          if (locInfo.description === "Mapped Destination") locInfo.description = `Near ${realPhoto.title}`;
        }
      }
    } catch (e) { }

    return locInfo;
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);

    try {
      let finalLat, finalLng, shortName;

      // Primary Engine: OpenStreetMap Nominatim (Highly Accurate Database)
      const nomRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1&addressdetails=1`);
      const nomData = await nomRes.json();

      if (nomData && nomData.length > 0) {
        finalLat = parseFloat(nomData[0].lat);
        finalLng = parseFloat(nomData[0].lon);
        shortName = nomData[0].display_name.split(',')[0] || "Destination";
      } else {
        // Fallback Engine: Photon Komoot (Fuzzy string matching for places Nominatim misses)
        const photRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(searchQuery)}&limit=1`);
        const photData = await photRes.json();

        if (photData && photData.features && photData.features.length > 0) {
          const feature = photData.features[0];
          finalLng = parseFloat(feature.geometry.coordinates[0]);
          finalLat = parseFloat(feature.geometry.coordinates[1]);
          const props = feature.properties;
          shortName = props.name || props.city || props.state || "Destination";
        }
      }

      // If either location provider succeeded
      if (finalLat && finalLng) {
        setUserLoc([finalLat, finalLng]);

        // Fetch original Google-like sidebar image/summary
        const locData = await fetchLocationData(shortName, finalLat, finalLng);
        setTargetInfo(locData);

        const backendData = await fetchFacilitiesFromBackend(finalLat, finalLng, shortName);
        if (backendData.facilities) {
          setFacilities(backendData.facilities);
          setClusterKey(backendData.clusterKey);
        }

        setSelectedFacility(null);
        setMapMode('searched');
      } else {
        alert("Location not found. Please try a different nearby landmark or address, or check your spelling.");
      }
    } catch (err) {
      console.error(err);
      alert("Error searching location. Ensure you have internet connection.");
    } finally {
      setIsSearching(false);
      setSearchQuery('');
    }
  };

  // 4. Vehicle Operations
  const fetchVehicles = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/vehicles');
      const data = await res.json();
      setVehicles(data);
    } catch (err) {
      console.error("Failed to fetch vehicles:", err);
    }
  };

  const handleAddVehicle = async (e) => {
    e.preventDefault();
    setIsAddingVehicle(true);
    try {
      const res = await fetch('http://localhost:5000/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newVehicle)
      });
      const data = await res.json();
      if (data.success) {
        setVehicles(prev => [...prev, data.vehicle]);
        setIsVehicleModalOpen(false);
        setNewVehicle({ name: '', plate: '', type: 'Car' });
      }
    } catch (err) {
      console.error("Failed to add vehicle:", err);
    } finally {
      setIsAddingVehicle(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'My Vehicles' && vehicles.length === 0) {
      fetchVehicles();
    }
    if (activeTab === 'History' && history.length === 0) {
      fetchHistory();
    }
  }, [activeTab]);

  const fetchHistory = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/history');
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
  };

  // Calculate global metrics based on loaded facilities
  let totalLots = 0, availLots = 0, occLots = 0;
  facilities.forEach(fac => {
    totalLots += fac.slots.length;
    fac.slots.forEach(s => {
      if (s.status === 'available') availLots++;
      if (s.status === 'booked') occLots++;
    });
  });
  const occupancyRate = totalLots > 0 ? Math.round((occLots / totalLots) * 100) : 0;

  const handleFacilitySelect = (facility) => {
    setSelectedFacility(facility);
  };

  const handleSlotClick = (slot) => {
    if (slot.status === 'available') {
      setSelectedSlot(slot);
      setIsBookingModalOpen(true);
    }
  };

  const [isBookingInProgress, setIsBookingInProgress] = useState(false);

  const confirmBooking = async (e) => {
    e.preventDefault();
    if (!selectedSlot || !selectedFacility || !clusterKey) return;

    setIsBookingInProgress(true);

    const result = await bookSlotFromBackend(clusterKey, selectedFacility.id, selectedSlot.id);
    setIsBookingInProgress(false);

    if (result.error) {
      alert(result.error);
      return;
    }

    // Reflect successful booking visibly in UI state instantly
    const updatedFacilities = facilities.map(fac => {
      if (fac.id === selectedFacility.id) {
        return {
          ...fac,
          slots: fac.slots.map(s => s.id === selectedSlot.id ? { ...s, status: 'reserved' } : s)
        };
      }
      return fac;
    });

    setFacilities(updatedFacilities);
    setSelectedFacility(updatedFacilities.find(fac => fac.id === selectedFacility.id));
    setIsBookingModalOpen(false);
    setSelectedSlot(null);
    alert(result.message || "Booking secured on backend.");
  };

  if (showSplash) {
    return (
      <div className="splash-screen">
        <MapPin size={80} className="splash-logo-icon" />
        <span className="splash-logo-text">ParkNova</span>
        <div className="splash-loader"></div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="logo-container">
          <MapPin size={32} className="logo-icon" />
          <span className="logo-text">ParkNova</span>
        </div>

        <nav className="nav-links">
          <a className={`nav-item ${activeTab === 'Dashboard' ? 'active' : ''}`} onClick={() => { setActiveTab('Dashboard'); setSidebarOpen(false); }}>
            <LayoutDashboard size={20} /> Dashboard
          </a>
          <a className={`nav-item ${activeTab === 'My Vehicles' ? 'active' : ''}`} onClick={() => { setActiveTab('My Vehicles'); setSidebarOpen(false); }}>
            <Car size={20} /> My Vehicles
          </a>
          <a className={`nav-item ${activeTab === 'History' ? 'active' : ''}`} onClick={() => { setActiveTab('History'); setSidebarOpen(false); }}>
            <History size={20} /> History
          </a>
        </nav>

        <div className="nav-links" style={{ flex: 0 }}>
          <a className={`nav-item ${activeTab === 'Settings' ? 'active' : ''}`} onClick={() => { setActiveTab('Settings'); setSidebarOpen(false); }}>
            <Settings size={20} /> Settings
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button className="btn btn-secondary" style={{ padding: '8px', border: 'none', display: 'none' }} onClick={() => setSidebarOpen(true)}>
              <Menu size={24} />
            </button>

            <form className="global-search-bar" onSubmit={handleSearch}>
              <Search size={18} color="var(--text-secondary)" />
              <input
                type="text"
                placeholder="Search destination"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                disabled={isSearching}
              />
              {isSearching ? (
                <Loader2 size={18} className="spinner" color="var(--accent-primary)" />
              ) : (
                <button type="submit" style={{ display: 'none' }}></button>
              )}
            </form>

            {mapMode === 'gps' && (
              <span className="gps-badge pulse-active"><Navigation size={14} /> Global GPS Linked</span>
            )}
            {mapMode === 'searching' && (
              <span className="gps-badge gps-searching"><Navigation size={14} /> Resolving...</span>
            )}
            {mapMode === 'searched' && (
              <span className="gps-badge pulse-active" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-primary)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                <MapPin size={14} /> Target Locked
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <div style={{ position: 'relative', cursor: 'pointer' }}>
              <Bell size={20} color="var(--text-secondary)" />
              <div style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, backgroundColor: 'var(--danger)', borderRadius: '50%' }}></div>
            </div>

            <div className="user-profile">
              <div className="avatar">A</div>
              <div style={{ display: 'flex', flexDirection: 'column', marginRight: '8px' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Alex Morgan</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Premium Member</span>
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Routed Main Content */}
        {activeTab === 'Dashboard' ? (
          <div className="dashboard-grid override-grid-sizes">

            {/* Top Metrics */}
            <div className="glass-card stat-card map-stat">
              <div className="stat-header">
                <span>Nearby Available</span>
                <div className="stat-icon-wrapper" style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}><CheckCircle size={20} /></div>
              </div>
              <div className="stat-value">{availLots}</div>
              <div className="stat-trend trend-up">Within 5 miles</div>
            </div>

            <div className="glass-card stat-card map-stat">
              <div className="stat-header">
                <span>Area Occupancy</span>
                <div className="stat-icon-wrapper" style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}><Car size={20} /></div>
              </div>
              <div className="stat-value">{occupancyRate}%</div>
              <div className="stat-trend trend-up">High Demand Zone</div>
            </div>

            <div className="glass-card stat-card map-stat">
              <div className="stat-header">
                <span>Detected Facilities</span>
                <div className="stat-icon-wrapper" style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}><MapIcon size={20} /></div>
              </div>
              <div className="stat-value">{facilities.length}</div>
              <div className="stat-trend"><span style={{ color: 'var(--text-secondary)' }}>Live Synchronized</span></div>
            </div>

            {/* Map Section */}
            <div className="glass-card map-container-area">
              <MapContainer center={userLoc} zoom={14} scrollWheelZoom={true} className="leaflet-map" zoomControl={false}>
                <TileLayer
                  attribution='&copy; <a href="https://www.google.com/maps">Google Maps</a>'
                  url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
                />
                <MapUpdater center={userLoc} />

                {/* Plot Target / User */}
                <Marker position={userLoc} icon={userIcon}>
                  <Popup className="custom-popup">{mapMode === 'searched' ? 'Destination' : 'You are here'}</Popup>
                </Marker>

                {/* Plot Facilities */}
                {facilities.map(fac => (
                  <Marker
                    key={fac.id}
                    position={[fac.lat, fac.lng]}
                    eventHandlers={{ click: () => handleFacilitySelect(fac) }}
                  >
                    <Popup className="custom-popup">
                      <strong>{fac.name}</strong><br />
                      {fac.slots.filter(s => s.status === 'available').length} Available Spots<br />
                      <button className="btn btn-primary" style={{ marginTop: '8px', padding: '6px 12px', fontSize: '12px' }} onClick={() => handleFacilitySelect(fac)}>View Grid</button>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>

            {/* Dynamic Parking Slots Section (Visible when clicked) */}
            <div className="glass-card dynamic-parking-area">
              {selectedFacility ? (
                <>
                  <div className="section-header">
                    <div>
                      <h2 className="section-title">Lot: {selectedFacility.name}</h2>
                    </div>
                    <div className="status-legend">
                      <div className="legend-item"><div className="legend-dot dot-available"></div> Available</div>
                      <div className="legend-item"><div className="legend-dot dot-occupied"></div> Occupied</div>
                      <div className="legend-item"><div className="legend-dot dot-reserved"></div> Reserved</div>
                    </div>
                  </div>

                  <div className="parking-slots override-slot-size">
                    {selectedFacility.slots.map(slot => (
                      <div key={slot.id} className={`parking-slot ${slot.status}`} onClick={() => handleSlotClick(slot)}>
                        <span className="slot-number">{slot.id}</span>
                        <span className="slot-status">{slot.status}</span>
                        <Car className="car-icon" />
                      </div>
                    ))}
                  </div>
                </>
              ) : targetInfo ? (
                <div className="location-info-card">
                  <div className="location-image" style={{ backgroundImage: `url(${targetInfo.thumbnail})` }}>
                    <div className="image-overlay">
                      <MapPin size={24} color="#f8fafc" />
                    </div>
                  </div>
                  <div className="location-details">
                    <h2 style={{ fontSize: '1.75rem', fontWeight: 'bold' }}>{targetInfo.title}</h2>
                    <span style={{ color: 'var(--accent-primary)', fontWeight: '600', fontSize: '0.95rem' }}>{targetInfo.description}</span>
                    <p style={{ marginTop: '12px', color: 'var(--text-secondary)', lineHeight: '1.6', fontSize: '0.9rem' }}>
                      {targetInfo.extract}
                    </p>
                    <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      <Navigation size={16} /> Locate a parking lot on the map grid to proceed.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <MapIcon size={48} color="rgba(255,255,255,0.1)" />
                  <h3 style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Select a Facility from the Live Map</h3>
                  <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)', marginTop: '8px', maxWidth: '300px', textAlign: 'center' }}>
                    Ensure location access is enabled to sync your global GPS coordinates and scan surrounding IoT networks for live spots.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'My Vehicles' ? (
          <div style={{ padding: '40px', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '2rem', fontWeight: 'bold' }}>My Vehicles</h2>
              <button className="btn btn-primary" onClick={() => setIsVehicleModalOpen(true)}>
                <Car size={20} style={{ marginRight: '8px' }} /> Add Vehicle
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
              {vehicles.length === 0 ? (
                <div className="glass-card" style={{ padding: '40px', textAlign: 'center', gridColumn: '1 / -1' }}>
                  <h3 style={{ color: 'var(--text-secondary)' }}>No vehicles found. Add one to get started.</h3>
                </div>
              ) : vehicles.map(vehicle => (
                <div key={vehicle.id} className="glass-card" style={{ padding: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: '600' }}>{vehicle.name}</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{vehicle.type}</p>
                    </div>
                    <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: '8px', borderRadius: '8px' }}>
                      <Car size={24} color="var(--accent-primary)" />
                    </div>
                  </div>
                  <div style={{ backgroundColor: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center', position: 'relative' }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: '700', letterSpacing: '2px', color: 'var(--text-primary)' }}>{vehicle.plate}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === 'History' ? (
          <div style={{ padding: '40px', flex: 1 }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '24px' }}>Activity History</h2>
            <div className="glass-card" style={{ padding: '24px' }}>
              {history.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>No recent activity.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {history.map(item => (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{
                          backgroundColor: item.type === 'in' ? 'rgba(34, 197, 94, 0.1)' : item.type === 'out' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                          color: item.type === 'in' ? '#22c55e' : item.type === 'out' ? '#ef4444' : '#3b82f6',
                          padding: '12px', borderRadius: '8px'
                        }}>
                          {item.type === 'in' ? <ArrowUpRight size={20} /> : item.type === 'out' ? <ArrowDownRight size={20} /> : <CalendarDays size={20} />}
                        </div>
                        <div>
                          <h4 style={{ fontWeight: '600' }}>{item.title}</h4>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Log ID: {item.id}</span>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{item.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ padding: '40px', flex: 1 }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '24px' }}>{activeTab}</h2>
            <div className="glass-card" style={{ padding: '60px', textAlign: 'center' }}>
              <Settings size={48} color="rgba(255,255,255,0.1)" style={{ margin: '0 auto 16px auto' }} />
              <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>Module Under Construction</h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                The <strong>{activeTab}</strong> section is currently being integrated with backend persistence. Check back soon.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Booking Modal */}
      {isBookingModalOpen && (
        <div className="modal-overlay" onClick={() => setIsBookingModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1.5rem', fontWeight: '600' }}>Secure Remote Booking</h3>
              <button className="btn btn-secondary" style={{ padding: '8px', border: 'none' }} onClick={() => setIsBookingModalOpen(false)}><X size={24} /></button>
            </div>

            <form onSubmit={confirmBooking}>
              <div className="form-group">
                <label className="form-label">Facility Selected</label>
                <input type="text" className="form-input" disabled value={selectedFacility?.name || ''} />
              </div>

              <div className="form-group">
                <label className="form-label">Spot Identifier</label>
                <input type="text" className="form-input" disabled value={`Spot #${selectedSlot?.id}`} />
              </div>

              <div className="form-group">
                <label className="form-label">Estimated Arrival</label>
                <input type="time" className="form-input" defaultValue="14:00" required />
              </div>

              <div style={{ marginTop: '32px', display: 'flex', gap: '16px' }}>
                <button type="button" className="btn btn-secondary btn-full" onClick={() => setIsBookingModalOpen(false)} disabled={isBookingInProgress}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-full" disabled={isBookingInProgress}>
                  {isBookingInProgress ? <Loader2 size={18} className="spinner" /> : <ShieldCheck size={18} />}
                  {isBookingInProgress ? 'Processing...' : 'Authorize GPS Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Vehicle Modal */}
      {isVehicleModalOpen && (
        <div className="modal-overlay" onClick={() => setIsVehicleModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1.5rem', fontWeight: '600' }}>Add New Vehicle</h3>
              <button className="btn btn-secondary" style={{ padding: '8px', border: 'none' }} onClick={() => setIsVehicleModalOpen(false)}><X size={24} /></button>
            </div>

            <form onSubmit={handleAddVehicle}>
              <div className="form-group">
                <label className="form-label">Vehicle Name / Model</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Mahindra Thar"
                  required
                  value={newVehicle.name}
                  onChange={e => setNewVehicle({ ...newVehicle, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">License Plate</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. MH-12-AB-1234"
                  required
                  value={newVehicle.plate}
                  onChange={e => setNewVehicle({ ...newVehicle, plate: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Vehicle Type</label>
                <select
                  className="form-input"
                  style={{ background: 'var(--bg-app)', color: 'white' }}
                  value={newVehicle.type}
                  onChange={e => setNewVehicle({ ...newVehicle, type: e.target.value })}
                >
                  <option>Car</option>
                  <option>SUV</option>
                  <option>Electric</option>
                  <option>Bike</option>
                </select>
              </div>

              <div style={{ marginTop: '32px', display: 'flex', gap: '16px' }}>
                <button type="button" className="btn btn-secondary btn-full" onClick={() => setIsVehicleModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-full" disabled={isAddingVehicle}>
                  {isAddingVehicle ? <Loader2 size={18} className="spinner" /> : <ShieldCheck size={18} />}
                  {isAddingVehicle ? 'Adding...' : 'Register Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckCircle(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
  );
}
