import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let pointCloud, lidarSensorMesh;
const objectsToScan = []; // Array to hold objects the LiDAR can hit

// --- Simulation Parameters ---
const lidarPosition = new THREE.Vector3(0, 1, 0); // Position of the LiDAR sensor
const lidarRange = 15; // Maximum range of the LiDAR rays
const horizontalResolution = 180; // Number of rays horizontally (e.g., 360 for full circle)
const verticalResolution = 90;  // Number of rays vertically (e.g., 180 for full sphere)
const horizontalFov = Math.PI * 2; // Horizontal field of view (2*PI for 360 degrees)
const verticalFov = Math.PI;     // Vertical field of view (PI for 180 degrees)
const scanFrequency = 10; // How many scans per second (lower for better performance)
let lastScanTime = 0;
// ---------------------------

init();
animate();

function init() {
    // --- Basic Scene Setup ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 5, 10);
    camera.lookAt(scene.position);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // --- Controls ---
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xaaaaaa);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    // --- Objects to Scan ---
    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x555555, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; // Rotate to be flat
    ground.position.y = -1;
    scene.add(ground);
    objectsToScan.push(ground); // Add ground to scannable objects

    const cubeGeometry = new THREE.BoxGeometry(2, 2, 2);
    const cubeMaterial = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
    const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
    cube.position.set(-3, 0, -2);
    scene.add(cube);
    objectsToScan.push(cube); // Add cube to scannable objects

    const sphereGeometry = new THREE.SphereGeometry(1.5, 32, 16);
    const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(4, 0.5, 1);
    scene.add(sphere);
    objectsToScan.push(sphere); // Add sphere to scannable objects

    // --- LiDAR Sensor Visualization (Optional) ---
    const sensorGeom = new THREE.SphereGeometry(0.1, 8, 8);
    const sensorMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    lidarSensorMesh = new THREE.Mesh(sensorGeom, sensorMat);
    lidarSensorMesh.position.copy(lidarPosition);
    scene.add(lidarSensorMesh);

    // --- Point Cloud Setup ---
    const pointsMaterial = new THREE.PointsMaterial({
        color: 0x00ffff, // Cyan color for points
        size: 0.05,      // Adjust size as needed
        sizeAttenuation: true // Points get smaller farther away
    });
    const pointsGeometry = new THREE.BufferGeometry(); // Start with empty geometry
    pointCloud = new THREE.Points(pointsGeometry, pointsMaterial);
    scene.add(pointCloud);

    // --- Event Listeners ---
    window.addEventListener('resize', onWindowResize, false);
}

function simulateLidarScan() {
    const hitPoints = [];
    const raycaster = new THREE.Raycaster();
    raycaster.near = 0.01; // Avoid hitting the sensor itself
    raycaster.far = lidarRange;

    // Loop through vertical angles
    for (let i = 0; i < verticalResolution; i++) {
        const phi = verticalFov * (i / (verticalResolution -1)) - (verticalFov / 2); // Angle up/down from horizontal

        // Loop through horizontal angles
        for (let j = 0; j < horizontalResolution; j++) {
            const theta = horizontalFov * (j / horizontalResolution); // Angle around the Y axis

            // Calculate direction vector
            const direction = new THREE.Vector3();
            direction.setFromSphericalCoords(1, Math.PI / 2 - phi, theta); // Use spherical coords (radius 1)
                                                                           // Note: THREE uses phi from positive Y axis, hence PI/2 - phi

            // Set raycaster
            raycaster.set(lidarPosition, direction);

            // Check for intersections
            const intersects = raycaster.intersectObjects(objectsToScan, false); // Don't check recursively if objects aren't nested

            if (intersects.length > 0) {
                // Add the *closest* hit point to our list
                // We check distance again because raycaster.far is a threshold,
                // but the actual hit might be closer than the previous closest hit
                // for a different ray in this scan. intersectObjects returns sorted.
                hitPoints.push(intersects[0].point.x, intersects[0].point.y, intersects[0].point.z);
            }
        }
    }
    return new Float32Array(hitPoints);
}

function updatePointCloud(pointsData) {
    const geometry = pointCloud.geometry;

    // Efficiently update the position attribute
    if (!geometry.getAttribute('position') || geometry.getAttribute('position').count !== pointsData.length / 3) {
        // If attribute doesn't exist or size changed drastically, create a new one
        geometry.setAttribute('position', new THREE.BufferAttribute(pointsData, 3));
    } else {
        // Otherwise, just update the data
        geometry.getAttribute('position').array = pointsData;
        geometry.getAttribute('position').needsUpdate = true; // VERY IMPORTANT
    }

    // Optional: Recompute bounding sphere for frustum culling
    geometry.computeBoundingSphere();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(time) {
    requestAnimationFrame(animate);

    const currentTime = time * 0.001; // Convert ms to seconds
    const deltaTime = currentTime - lastScanTime;

    // --- Update Simulation ---
    // Only scan at the desired frequency
    if (deltaTime >= (1 / scanFrequency)) {
        const scanResults = simulateLidarScan();
        updatePointCloud(scanResults);
        lastScanTime = currentTime;

        // Optional: Make the sensor pulse slightly when scanning
        lidarSensorMesh.scale.setScalar(1.5);
        setTimeout(() => lidarSensorMesh.scale.setScalar(1.0), 50); // Reset scale shortly after
    }

    // --- Update Controls ---
    controls.update();

    // --- Render Scene ---
    renderer.render(scene, camera);
}
