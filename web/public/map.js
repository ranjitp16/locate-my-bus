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

let markers = []
fetxhFromAPI();

setInterval(() => {
    markers.forEach(m => m.remove())
    markers = []
    fetxhFromAPI()
}, 30000); // Update every 30 seconds

function fetxhFromAPI() {
    fetch('/10A')
        .then(res => res.json())
        .then(vehicles => {
            let avgLat = vehicles.reduce((sum, v) => sum + v.lat, 0) / vehicles.length
            let avgLon = vehicles.reduce((sum, v) => sum + v.lon, 0) / vehicles.length
            map.setView([avgLat, avgLon], 13)
            vehicles.forEach(v => {
                const ageSeconds = (Date.now() - Date.parse(v.timestamp)) / 1000
                const marker = L.marker([v.lat, v.lon], { icon: customIcon })
                    .addTo(map).bindPopup(`Route: ${v.route_id}<br>Vehicle ID: ${v.vehicle_id}<br>Timestamp: ${ageSeconds} s ago<br>Speed: ${v.speed} m/s<br>Bearing: ${v.bearing}`)
                markers.push(marker)
            })
        })
}