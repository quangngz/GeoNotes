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
        markerId = existingPin._id;
        dbId = existingPin._id;
        notes[markerId] = existingPin.note;
        country = existingPin.country;
        region = existingPin.region;
        locationName = existingPin.locationName;
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
            markerId = savedPin._id;
            dbId = savedPin._id;
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
    document.getElementById('saveNoteBtn').onclick = saveNote;
    document.getElementById('deletePinBtn').onclick = deletePin;
    document.getElementById('closeNotePanelBtn').onclick = closeNotePanel;

// Location name search
    const locationSearchInput = document.createElement('input');
    locationSearchInput.id = 'locationSearch';
    locationSearchInput.type = 'text';
    locationSearchInput.placeholder = 'Search by location name...';
    locationSearchInput.style = 'width:100%;margin-bottom:10px;padding:8px;border-radius:4px;border:1px solid #ccc;';
    document.getElementById('sidebar').insertBefore(locationSearchInput, document.getElementById('pins-list'));

    locationSearchInput.addEventListener('input', async function(e) {
        const query = e.target.value.trim();
        if (!query) {
            await loadPins();
            return;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/pins/search?locationName=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Failed to search pins');
            const pins = await response.json();
            // Remove existing markers
            markers.forEach(m => m.marker.setMap(null));
            markers = [];
            notes = {};
            for (const pin of pins) {
                const location = { lat: pin.latitude, lng: pin.longitude };
                await addPin(location, pin);
            }
            updateSidebar();
        } catch (error) {}
    });
});
