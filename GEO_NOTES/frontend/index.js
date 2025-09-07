// Remove the duplicate addPin and updateSidebar functions.
// Keep only the versions that include country/region/locationName support and sidebar improvements.
let map;
let markers = [];
let notes = {};
let currentMarker = null;
const API_BASE_URL = 'http://localhost:3001/api';
const GOOGLE_API_KEY = 'AIzaSyBBUmA4z0sdQ_iRDGfClwXPZggthxMhhv0'; // Use your key

window.initMap = function() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: -37.8136, lng: 144.9631 },
        zoom: 13,
    });

    map.addListener('click', function(event) {
        addPin(event.latLng);
    });

    loadPins();
};

async function getCountryRegion(lat, lng) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    let country = null, region = null, locationName = null;
    if (data.results && data.results.length > 0) {
        locationName = data.results[0].formatted_address;
        for (const comp of data.results[0].address_components) {
            if (comp.types.includes('country')) country = comp.long_name;
            if (comp.types.includes('administrative_area_level_1')) region = comp.long_name;
        }
    }
    return { country, region, locationName };
}

async function addPin(location, existingPin = null) {
    const marker = new google.maps.Marker({
        position: location,
        map: map,
        title: 'Click to add/edit note',
        animation: existingPin ? null : google.maps.Animation.DROP
    });

    let markerId, dbId;
    let country, region, locationName;
    if (existingPin) {
        // ensure id is a string for consistent comparisons
        markerId = existingPin._id && existingPin._id.toString ? existingPin._id.toString() : String(existingPin._id || Date.now());
        dbId = markerId;
        notes[markerId] = existingPin.note || '';
        country = existingPin.country || null;
        region = existingPin.region || null;
        locationName = existingPin.locationName || existingPin.formatted_address || null;
        if (existingPin.note) {
            marker.setTitle('Note: ' + existingPin.note.substring(0, 50) + 
                           (existingPin.note.length > 50 ? '...' : ''));
        }
    } else {
        // Get country/region/locationName from Google API
        const locInfo = await getCountryRegion(location.lat(), location.lng());
        country = locInfo.country;
        region = locInfo.region;
        locationName = locInfo.locationName;
        try {
            const response = await fetch(`${API_BASE_URL}/pins`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    latitude: location.lat(),
                    longitude: location.lng(),
                    note: '',
                    country,
                    region,
                    locationName
                })
            });
            if (!response.ok) throw new Error('Failed to save pin');
            const savedPin = await response.json();
            markerId = savedPin._id && savedPin._id.toString ? savedPin._id.toString() : String(savedPin._id || Date.now());
            dbId = markerId;
        } catch (error) {
            markerId = Date.now().toString();
            dbId = null;
        }
    }

    markers.push({ id: markerId, marker: marker, dbId: dbId, country, region, locationName });
    marker.addListener('click', function(event) {
        if (event && event.stop) event.stop();
        openNotePanel(markerId);
    });

    if (!existingPin) setTimeout(() => openNotePanel(markerId), 100);
    updateSidebar();
}

async function loadPins() {
    try {
        // clear existing markers before loading to avoid duplicates
        markers.forEach(m => { try { m.marker.setMap(null); } catch (e) {} });
        markers = [];
        notes = {};

        const response = await fetch(`${API_BASE_URL}/pins`);
        if (!response.ok) throw new Error('Failed to load pins');
        const pins = await response.json();
        for (const pin of pins) {
            const location = { lat: pin.latitude, lng: pin.longitude };
            await addPin(location, pin);
        }
        updateSidebar();
    } catch (error) {
        console.error('loadPins error:', error);
    }
}

function openNotePanel(markerId) {
    currentMarker = markerId;
    document.getElementById('noteText').value = notes[markerId] || '';
    document.getElementById('notesPanel').style.display = 'block';
}

function closeNotePanel() {
    document.getElementById('notesPanel').style.display = 'none';
    document.getElementById('noteText').value = '';
    currentMarker = null;
}

async function saveNote() {
    const noteText = document.getElementById('noteText').value.trim();
    if (currentMarker) {
        const markerObj = markers.find(m => m.id === currentMarker);
        if (markerObj && markerObj.dbId) {
            try {
                const response = await fetch(`${API_BASE_URL}/pins/${markerObj.dbId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: noteText })
                });
                if (!response.ok) throw new Error('Failed to update note');
            } catch (error) {}
        }
        notes[currentMarker] = noteText;
        if (markerObj && noteText) {
            markerObj.marker.setTitle('Note: ' + noteText.substring(0, 50) + (noteText.length > 50 ? '...' : ''));
        } else if (markerObj) {
            markerObj.marker.setTitle('Click to add/edit note');
        }
    }
    closeNotePanel();
    updateSidebar();
}

async function deletePin() {
    if (!currentMarker) return;
    const markerObj = markers.find(m => m.id === currentMarker);
    if (!markerObj) return;
    if (!confirm('Are you sure you want to delete this pin?')) return;
    try {
        if (markerObj.dbId) {
            const response = await fetch(`${API_BASE_URL}/pins/${markerObj.dbId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete pin from database');
        }
        markerObj.marker.setMap(null);
        markers = markers.filter(m => m.id !== currentMarker);
        delete notes[currentMarker];
        closeNotePanel();
        updateSidebar();
    } catch (error) {
        alert('Failed to delete pin. Please try again.');
    }
}

function updateSidebar() {
    const container = document.getElementById('pins-container');
    if (markers.length === 0) {
        container.innerHTML = '<div class="no-pins">No pins yet. Click on the map to add your first pin!</div>';
        return;
    }
    container.innerHTML = '';
    markers.forEach(markerObj => {
        const pin = {
            id: markerObj.id,
            note: notes[markerObj.id] || '',
            position: markerObj.marker.getPosition(),
            country: markerObj.country,
            region: markerObj.region,
            locationName: markerObj.locationName,
            createdAt: new Date().toISOString()
        };
        const pinItem = document.createElement('div');
        pinItem.className = 'pin-item';
        pinItem.onclick = () => focusOnPin(markerObj);
        const location = pin.locationName || `${pin.position.lat().toFixed(4)}, ${pin.position.lng().toFixed(4)}`;
        const noteText = pin.note || 'No note added';
        const noteClass = pin.note ? '' : ' empty';
        pinItem.innerHTML = `
            <div class="pin-location">📍 ${location}</div>
            <div class="pin-note${noteClass}">${noteText}</div>
            <div class="pin-date">${new Date().toLocaleDateString()}</div>
            <div style="font-size:11px;color:#888;">${pin.region ? pin.region + ', ' : ''}${pin.country || ''}</div>
        `;
        container.appendChild(pinItem);
    });
}

function focusOnPin(markerObj) {
    const position = markerObj.marker.getPosition();
    map.setCenter(position);
    map.setZoom(16);
    markerObj.marker.setAnimation(google.maps.Animation.BOUNCE);
    setTimeout(() => markerObj.marker.setAnimation(null), 2000);
    setTimeout(() => openNotePanel(markerObj.id), 500);
}

async function loadPins() {
    try {
        const response = await fetch(`${API_BASE_URL}/pins`);
        if (!response.ok) throw new Error('Failed to load pins');
        const pins = await response.json();
        for (const pin of pins) {
            const location = { lat: pin.latitude, lng: pin.longitude };
            await addPin(location, pin);
        }
        updateSidebar();
    } catch (error) {}
}

document.addEventListener('click', function(event) {
    const panel = document.getElementById('notesPanel');
    const mapDiv = document.getElementById('map');
    if (panel.style.display === 'block' && 
        !panel.contains(event.target) && 
        !mapDiv.contains(event.target)) {
        closeNotePanel();
    }
});

document.addEventListener('DOMContentLoaded', function() {
    // wire up existing buttons if present
    const saveBtn = document.getElementById('saveNoteBtn');
    const deleteBtn = document.getElementById('deletePinBtn');
    const closeBtn = document.getElementById('closeNotePanelBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveNote);
    if (deleteBtn) deleteBtn.addEventListener('click', deletePin);
    if (closeBtn) closeBtn.addEventListener('click', closeNotePanel);

    // ensure we have a container to insert search controls
    const sidebar = document.getElementById('sidebar') || document.body;
    const pinsList = document.getElementById('pins-list') || document.querySelector('.pins-list') || null;
    const insertBeforeNode = pinsList || sidebar.firstChild;

    // avoid adding twice
    if (!document.getElementById('locationSearchWrapper')) {
        const locationSearchDiv = document.createElement('div');
        locationSearchDiv.id = 'locationSearchWrapper';
        locationSearchDiv.style.display = 'flex';
        locationSearchDiv.style.gap = '8px';
        locationSearchDiv.style.marginBottom = '10px';

        const input = document.createElement('input');
        input.id = 'locationSearch';
        input.type = 'text';
        input.placeholder = 'Search by location name...';
        input.style.flex = '1';
        input.style.padding = '8px';
        input.style.borderRadius = '4px';
        input.style.border = '1px solid #ccc';

        const btn = document.createElement('button');
        btn.id = 'locationSearchBtn';
        btn.type = 'button'; // prevent accidental form submit
        btn.textContent = 'Search';
        btn.style.padding = '8px 12px';
        btn.style.borderRadius = '4px';
        btn.style.border = 'none';
        btn.style.background = '#4285f4';
        btn.style.color = 'white';
        btn.style.cursor = 'pointer';

        locationSearchDiv.appendChild(input);
        locationSearchDiv.appendChild(btn);

        if (insertBeforeNode && insertBeforeNode.parentNode) {
            insertBeforeNode.parentNode.insertBefore(locationSearchDiv, insertBeforeNode);
        } else {
            sidebar.insertBefore(locationSearchDiv, sidebar.firstChild);
        }
    }

    // search function - runs on Enter or button press
    async function searchByLocationName() {
            const query = (document.getElementById('locationSearch') || {}).value || '';
            const trimmed = query.trim();
            if (!trimmed) {
                // empty => reload all pins (loadPins already clears markers)
                await loadPins();
                return;
            }

            try {
                // call backend search endpoint
                const url = `${API_BASE_URL}/pins/search?locationName=${encodeURIComponent(trimmed)}`;
                console.log('Searching pins:', url);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Search request failed: ${response.status}`);
                const pins = await response.json();

                // clear existing markers from map and local state
                markers.forEach(m => { try { m.marker.setMap(null); } catch (e) {} });
                markers = [];
                notes = {};

                // add returned pins as existing pins (addPin will set notes and markers)
                for (const pin of pins) {
                    const location = { lat: pin.latitude, lng: pin.longitude };
                    // coerce id inside addPin
                    await addPin(location, pin);
                }

                // show only the search results in the sidebar (don't call updateSidebar here,
                // because updateSidebar would re-render all markers and overwrite the search list)
                showLocationNames(pins);
            } catch (err) {
                console.error('Error during location search:', err);
            }
        }

    // display matching location names in the sidebar container
    function showLocationNames(pins) {
        const container = document.getElementById('pins-container') || document.querySelector('#pins-list') || document.createElement('div');
        // if pins-container not present, create it under #pins-list
        if (!document.getElementById('pins-container')) {
            const pinsListEl = document.getElementById('pins-list');
            if (pinsListEl) {
                const created = document.createElement('div');
                created.id = 'pins-container';
                pinsListEl.appendChild(created);
            }
        }

        const target = document.getElementById('pins-container');
        if (!target) return;
        target.innerHTML = '';

        if (!pins || pins.length === 0) {
            target.innerHTML = '<div class="no-pins">No matching locations found.</div>';
            return;
        }

        pins.forEach(pin => {
            const div = document.createElement('div');
            div.className = 'pin-item';
            const locationText = pin.locationName || `${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)}`;
            const noteText = pin.note || 'No note added';
            const dateText = pin.createdAt ? new Date(pin.createdAt).toLocaleDateString() : '';

            div.innerHTML = `
                <div class="pin-location">📍 ${locationText}</div>
                <div class="pin-note">${escapeHtml(noteText)}</div>
                <div class="pin-date">${dateText}</div>
                <div style="font-size:11px;color:#888;">${pin.region ? pin.region + ', ' : ''}${pin.country || ''}</div>
            `;

            div.addEventListener('click', () => {
                // center map and open note panel for this pin
                if (map && typeof map.panTo === 'function') {
                    map.panTo({ lat: pin.latitude, lng: pin.longitude });
                    map.setZoom && map.setZoom(15);
                }
                // open the note panel for pin._id (backend must return _id)
                if (pin._id) {
                    openNotePanel(pin._id);
                } else {
                    // fallback: try to find the marker by coordinates and open its panel
                    const m = markers.find(mk => {
                        try {
                            const pos = mk.marker.getPosition();
                            return pos && Math.abs(pos.lat() - pin.latitude) < 1e-6 && Math.abs(pos.lng() - pin.longitude) < 1e-6;
                        } catch (e) { return false; }
                    });
                    if (m) openNotePanel(m.id);
                }
            });

            target.appendChild(div);
        });
    }

    // helper: escape HTML for safety
    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, function (s) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s];
        });
    }

    // wire up button and Enter key to trigger search
    const searchInput = document.getElementById('locationSearch');
    const searchBtn = document.getElementById('locationSearchBtn');
    if (searchBtn) searchBtn.addEventListener('click', searchByLocationName);
    if (searchInput) {
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchByLocationName();
            }
        });
    }
});