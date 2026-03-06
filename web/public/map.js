const map = L.map('map')


L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
}).addTo(map)


// L.marker([44.6488, -63.5752]).addTo(map).bindPopup('Halifax, NS').openPopup()
const customIcon = L.divIcon({
    html: '🚙',
    className: '',  // clears leaflet's default white box
    iconSize: [4, 4],
    iconAnchor: [2, 2],
})

fetch('/1')
    .then(res => res.json())
    .then(vehicles => {
        let avgLat = vehicles.reduce((sum, v) => sum + v.lat, 0) / vehicles.length
        let avgLon = vehicles.reduce((sum, v) => sum + v.lon, 0) / vehicles.length
        map.setView([avgLat, avgLon], 13)
        vehicles.forEach(v => {
            console.log("added:", v)
            L.marker([v.lat, v.lon], { icon: customIcon }).addTo(map).bindPopup(`Route ID: ${v.route_id}<br>Vehicle ID: ${v.vehicle_id}<br>Timestamp: ${v.timestamp}<br>Speed: ${v.speed}<br>Bearing: ${v.bearing}`)
        })
    })