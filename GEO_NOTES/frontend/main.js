// Remove the duplicate addPin and updateSidebar functions.
// Keep only the versions that include country/region/locationName support and sidebar improvements.
let map;
let markers = [];
let notes = {};
let currentMarker = null;
const API_BASE_URL = '/api';
const GOOGLE_API_KEY = 'AIzaSyBBUmA4z0sdQ_iRDGfClwXPZggthxMhhv0'; // Use your key

const authScreen = document.getElementById('auth-screen');
const tabLogin   = document.getElementById('tab-login');
const tabSignup  = document.getElementById('tab-signup');
const loginForm  = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginErr   = document.getElementById('login-error');
const signupErr  = document.getElementById('signup-error');

const accountBar  = document.getElementById('account-bar');
const accountInfo = document.getElementById('account-info');
const logoutBtn   = document.getElementById('logoutBtn');

let sharedOwnersById = new Map();

// what I'm currently looking at
let currentView = { type: "self", ownerId: null, role: "editor" };

tabLogin.onclick = () => {
    tabLogin.classList.add('active'); tabSignup.classList.remove('active');
    loginForm.classList.remove('auth-hidden'); signupForm.classList.add('auth-hidden');
    loginErr.textContent = '';
};
tabSignup.onclick = () => {
    tabSignup.classList.add('active'); tabLogin.classList.remove('active');
    signupForm.classList.remove('auth-hidden'); loginForm.classList.add('auth-hidden');
    signupErr.textContent = '';
};

async function me() {
    try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    return r.ok ? r.json() : null;
    } catch (_) { return null; }
}
async function apiLogin(body) {
    const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Login failed');
    return r.json();
}
async function apiSignup(body) {
    const r = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Signup failed');
    return r.json();
}

async function hydrateAuth() {
    const user = await me();
    if (user && user.email) {
        authScreen.style.display = 'none';
        document.body.classList.remove('auth-pending');
        accountBar.style.display = 'flex';
        accountInfo.textContent = `Signed in as ${user.email}`;


        // refresh the list of people I’ve shared with
        try { renderOwnedShares(await listOwnedShares()); } catch (_) {}

        try {
            const sharedOwners = await listSharedMaps();
            populateMapChooser(sharedOwners);
            setMapInteractivity();   // <— new: enable/disable clicks + cursor
        } catch (_) {}

        try { await refreshOwnedSharesUI(); } catch {}

    } else {
        authScreen.style.display = 'flex';
        document.body.classList.add('auth-pending');
        accountBar.style.display = 'none';
        accountInfo.textContent = '';
        clearAllPinsUI();
        if (sharedWithListEl) { sharedWithListEl.classList.add('muted'); sharedWithListEl.textContent = 'No one yet.'; }
        if (mapChooser) mapChooser.value = 'self';
        currentView = { type: 'self', ownerId: null };
    }
}
logoutBtn.onclick = async () => {
    try {
    await fetch('/api/logout', { method:'POST', credentials:'same-origin' });
    } catch(_) {}
    clearAllPinsUI();
    await hydrateAuth();
};

loginForm.onsubmit = async (e) => {
    e.preventDefault();
    loginErr.textContent = '';
    const body = Object.fromEntries(new FormData(loginForm));
    try {
    await apiLogin(body);
    clearAllPinsUI();
    await hydrateAuth();
    if (map) loadPins();
    } catch (err) {
    loginErr.textContent = err.message;
    }
};

signupForm.onsubmit = async (e) => {
    e.preventDefault();
    signupErr.textContent = '';
    const body = Object.fromEntries(new FormData(signupForm));
    try {
    await apiSignup(body);
    clearAllPinsUI();
    await hydrateAuth();
    if (map) loadPins();
    } catch (err) {
    signupErr.textContent = err.message;
    }
};

// On first load, decide whether to show login or map
hydrateAuth();

function canEditCurrentView() {
  return currentView.type === 'self' || currentView.role === 'editor';
}

function setMapInteractivity() {
  if (!map) return;
  if (canEditCurrentView()) {
    map.setOptions({ draggableCursor: null }); // default cursor
  } else {
    map.setOptions({ draggableCursor: 'not-allowed' }); // visual hint
  }
}

window.initMap = function() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: -37.8136, lng: 144.9631 },
    zoom: 13,
  });

  // block click for viewers
  map.addListener('click', function(event) {
    if (!canEditCurrentView()) {
      // optional toast; keep it subtle
      console.log('View-only: cannot add pins on this map');
      return;
    }
    addPin(event.latLng);
  });

  setMapInteractivity();  // set initial cursor state
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
    if (!existingPin && !canEditCurrentView()) {
        return; // don't place a new marker in UI either
    }
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
            const body = {
                latitude: location.lat(),
                longitude: location.lng(),
                note: '(no note yet)',
                country,
                region,
                locationName
            };

            if (currentView.type === 'shared') {
            body.user_id = currentView.ownerId; // tell backend whose map to add to
            }

            const response = await fetch(`${API_BASE_URL}/pins`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
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

let pinsLoading = false;

async function loadPins() {
  if (pinsLoading) return;
  pinsLoading = true;
  try {
    // clear existing markers before loading to avoid duplicates
    markers.forEach(m => { try { m.marker.setMap(null); } catch (e) {} });
    markers = [];
    notes = {};

    const url = currentView.type === 'self'
        ? `${API_BASE_URL}/pins`
        : `/api/shared/${encodeURIComponent(currentView.ownerId)}/pins`;
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Failed to load pins');
    const pins = await response.json();

    for (const pin of pins) {
      const location = { lat: pin.latitude, lng: pin.longitude };
      await addPin(location, pin);
    }
    updateSidebar();
  } catch (error) {
    console.error('loadPins error:', error);
  } finally {
    pinsLoading = false;
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
          credentials: 'same-origin',
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: noteText })
        });
        if (!response.ok) {
          const j = await response.json().catch(() => ({}));
          throw new Error(j.message || 'Failed to update note');
        }
      } catch (error) {
        alert(error.message);       // <-- surface the error
        return;                     // <-- don’t update local state on failure
      }
    }
    // only update local state/title if backend update succeeded
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
            const response = await fetch(`${API_BASE_URL}/pins/${markerObj.dbId}`, { credentials : "same-origin" ,method: 'DELETE' });
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

function clearAllPinsUI() {
  // remove markers from map
  markers.forEach(m => { try { m.marker.setMap(null); } catch (e) {} });
  markers = [];
  notes = {};
  currentMarker = null;
  // clear sidebar
  const container = document.getElementById('pins-container');
  if (container) container.innerHTML = '<div class="no-pins">No pins yet. Click on the map to add your first pin!</div>';
  // close panel
  const panel = document.getElementById('notesPanel');
  if (panel) panel.style.display = 'none';
}

function focusOnPin(markerObj) {
    const position = markerObj.marker.getPosition();
    map.setCenter(position);
    map.setZoom(16);
    markerObj.marker.setAnimation(google.maps.Animation.BOUNCE);
    setTimeout(() => markerObj.marker.setAnimation(null), 2000);
    setTimeout(() => openNotePanel(markerObj.id), 500);
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
                const response = await fetch(url, { credentials: 'same-origin' });
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


const mapChooser = document.getElementById('mapChooser');
const shareEmail = document.getElementById('shareEmail');
const shareBtn   = document.getElementById('shareBtn');
const shareMsg   = document.getElementById('shareMsg');

async function listSharedMaps() {
  const r = await fetch('/api/shared', { credentials: 'same-origin' });
  if (!r.ok) throw new Error('Failed to load shared maps');
  return r.json(); // [{ owner_id, owner_email, role }]
}

function populateMapChooser(sharedOwners) {
  // reset to only "My Pins"
  mapChooser.innerHTML = '<option value="self">My Pins</option>';

  sharedOwnersById = new Map();
  for (const o of sharedOwners) {
    sharedOwnersById.set(String(o.owner_id), { email: o.owner_email, role: o.role });

    const opt = document.createElement('option');
    opt.value = `shared:${o.owner_id}`;
    opt.textContent = `Shared by ${o.owner_email}${o.role === 'editor' ? ' (edit)' : ' (viewer only)'}`;
    mapChooser.appendChild(opt);
  }
}

mapChooser.addEventListener('change', async () => {
  const val = mapChooser.value;

  if (val === 'self') {
    currentView = { type: 'self', ownerId: null, role: 'editor' };
  } else if (val.startsWith('shared:')) {
    const ownerId = val.split(':')[1];
    const meta = sharedOwnersById.get(ownerId) || { role: 'viewer' };
    currentView = { type: 'shared', ownerId, role: meta.role };
  }

  setMapInteractivity();   // <— new: enable/disable clicks + cursor
  await loadPins();
});

const shareRole = document.getElementById('shareRole');

shareBtn.addEventListener('click', async () => {
  shareMsg.textContent = '';
  const email = (shareEmail.value || '').trim();
  const role  = shareRole.value; // viewer or editor
  

  if (!email) { 
    shareMsg.textContent = 'Enter an email.'; 
    return; 
  }
  console.log('Sharing with', email, 'as', role);

  try {
    const r = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, role })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Share failed');
    shareMsg.textContent = `Shared as ${role}!`;
    shareEmail.value = '';
    shareRole.value = 'viewer'; // reset to default

    await refreshOwnedSharesUI();
  } catch (e) {
    shareMsg.style.color = '#b91c1c';
    shareMsg.textContent = e.message;
  } finally {
    setTimeout(() => { 
      shareMsg.textContent = ''; 
      shareMsg.style.color = '#2563eb'; 
    }, 2500);
  }
});



const sharedWithListEl = document.getElementById('sharedWithList');

async function listOwnedShares() {
  const r = await fetch('/api/shares', { credentials: 'same-origin' });
  if (!r.ok) throw new Error('Failed to load shares');
  return r.json(); // [{ member_id, email, role, createdAt }]
}

function renderOwnedShares(items) {
  if (!items || items.length === 0) {
    sharedWithListEl.classList.add('muted');
    sharedWithListEl.innerHTML = 'No one yet.';
    return;
  }
  sharedWithListEl.classList.remove('muted');
  sharedWithListEl.innerHTML = '';
  items.forEach(it => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '8px';
    row.style.padding = '6px 0';
    row.innerHTML = `
      <div>
        <div style="font-weight:500">${it.email}</div>
        <div style="font-size:12px; color:#6b7280;">${it.role || 'viewer'}</div>
      </div>
      <button class="revoke-btn" data-email="${it.email}"
        style="padding:6px 10px; border:none; border-radius:6px; background:#ef4444; color:#fff; cursor:pointer;">
        Revoke
      </button>
    `;
    sharedWithListEl.appendChild(row);
  });

  // wire revoke buttons
  sharedWithListEl.querySelectorAll('.revoke-btn').forEach(btn => {
    btn.onclick = async () => {
        const email = btn.dataset.email;
        if (!confirm(`Revoke access for ${email}?`)) return;

        try {
        const r = await fetch('/api/share', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email })
        });
        if (!r.ok) {
            const j = await r.json().catch(()=>({}));
            throw new Error(j.error || 'Failed to revoke');
        }

        // If I was viewing this user's map, bounce back to my own
        const isViewingRevoked =
            currentView.type === 'shared' &&
            sharedOwnersById.has(currentView.ownerId) &&
            sharedOwnersById.get(currentView.ownerId) === email;

        // Refresh “Shared with” list
        const fresh = await listOwnedShares();
        renderOwnedShares(fresh);

        // Refresh map chooser (maps shared *to me*)
        const sharedOwners = await listSharedMaps();
        populateMapChooser(sharedOwners);

        if (isViewingRevoked) {
            // Switch to "My Pins"
            const chooser = document.getElementById('mapChooser');
            if (chooser) chooser.value = 'self';
            currentView = { type: 'self', ownerId: null };
            updatePinsHeader(null);
            clearAllPinsUI();
            await loadPins();
        }

        } catch (e) {
        alert(e.message);
        }
    };
    });
}

async function refreshOwnedSharesUI() {
  try {
    const items = await listOwnedShares();
    renderOwnedShares(items);
  } catch (e) {
    console.error('Failed to refresh shares:', e);
  }
}

const pinsHeaderEl = document.getElementById('pins-header');
function updatePinsHeader(email) {
  const el = document.getElementById('pins-header'); // re-query in case DOM changed
  if (!el) return; // guard
  el.textContent = email ? `📍 ${email}'s Pins` : '📍 Your Pins';
}