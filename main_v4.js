import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let instancedPointCloud, lidarSensorMesh, beamLinesGroup;
let sceneMeshesGroup;
const objectsToScan = [];

// --- Simulation Parameters ---
var lidarPosition = new THREE.Vector3(0, 1, 0); // Global position, updated each frame
const lidarRange = 15;
const horizontalResolution = 50;
const verticalResolution = 50;
const horizontalFov = Math.PI * 2;
const verticalFov = Math.PI;
const scanFrequency = 50; // Adjust scan rate as needed
const showBeamLines = false;
const showSceneMeshes = false;

// --- Pulse/Beam Characteristics ---
const beamDivergenceAngle = THREE.MathUtils.degToRad(30.2);
const pulseDurationNanoSeconds = .01;
const speedOfLight = 0.299792458;
const pulseLength = pulseDurationNanoSeconds * speedOfLight;
const pointScaleFactor = 1.0;
// ----------------------------------

let lastScanTime = 0;
const MAX_POINTS = horizontalResolution * verticalResolution * 100; // <<< Increase buffer size significantly for persistence
let nextInstanceIndex = 0; // <<< New: Index for the circular buffer
let totalPointsWritten = 0; // <<< New: Track total points added

// --- Temp variables ---
const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempScale = new THREE.Vector3();
const surfaceNormal = new THREE.Vector3();
const beamDirection = new THREE.Vector3();
const viewDirection = new THREE.Vector3();
const tangent = new THREE.Vector3();
const bitangent = new THREE.Vector3();
const rotationMatrix = new THREE.Matrix4();
const clock = new THREE.Clock(); // <<< Use clock for smooth movement delta
// ---------------------

// --- Beam Visualization ---
const beamLineMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.05 }); // Example material
// ---------------------------

init();
animate();

// --- Helper: Create Gaussian Texture ---
function createGaussianTexture(size = 64) { /* ... (same as before) ... */
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2, radius = size / 2;
    ctx.beginPath(); ctx.arc(center, center, radius, 0, 2 * Math.PI, false); ctx.closePath();
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,.01)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.005)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fill();
    return new THREE.CanvasTexture(canvas);
}
// --------------------------------------

function init() {
    // --- Basic Scene Setup ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

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

    // --- Group for Scene Meshes ---
    sceneMeshesGroup = new THREE.Group();
    sceneMeshesGroup.visible = showSceneMeshes;
    scene.add(sceneMeshesGroup);
    // --------------------------------------------------------

    // --- Objects to Scan ---
    // ... (Adding objects - same as before) ...
    const groundGeometry = new THREE.PlaneGeometry(20, 20); const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x555555, side: THREE.DoubleSide }); const ground = new THREE.Mesh(groundGeometry, groundMaterial); ground.rotation.x = -Math.PI / 2; ground.position.y = -1; sceneMeshesGroup.add(ground); objectsToScan.push(ground);
    const cubeGeometry = new THREE.BoxGeometry(2, 2, 2); const cubeMaterial = new THREE.MeshLambertMaterial({ color: 0x00ff00 }); const cube = new THREE.Mesh(cubeGeometry, cubeMaterial); cube.position.set(-3, 0, -2); sceneMeshesGroup.add(cube); objectsToScan.push(cube);
    const sphereGeometry = new THREE.SphereGeometry(1.5, 32, 16); const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 }); const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial); sphere.position.set(4, 0.5, 1); sceneMeshesGroup.add(sphere); objectsToScan.push(sphere);


    // --- LiDAR Sensor Visualization ---
    const sensorGeom = new THREE.SphereGeometry(0.1, 8, 8);
    const sensorMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    lidarSensorMesh = new THREE.Mesh(sensorGeom, sensorMat);
    lidarSensorMesh.position.copy(lidarPosition); // Set initial visual position
    scene.add(lidarSensorMesh);

    // --- Instanced Point Cloud Setup ---
    const gaussianTexture = createGaussianTexture();
    const pointGeometry = new THREE.PlaneGeometry(1, 1);
    const pointMaterial = new THREE.MeshBasicMaterial({
        map: gaussianTexture,
        color: 0x00ffff,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        alphaTest: 0.01,
    });
    // IMPORTANT: MAX_POINTS is now the total buffer size
    instancedPointCloud = new THREE.InstancedMesh(pointGeometry, pointMaterial, MAX_POINTS);
    instancedPointCloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instancedPointCloud.count = 0; // Start with zero points visible
    scene.add(instancedPointCloud);
    // -----------------------------------

    // --- Beam Lines Setup ---
    beamLinesGroup = new THREE.Group();
    scene.add(beamLinesGroup);

    // --- Event Listeners ---
    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('keydown', handleKeyDown, false);

    // --- Initial Log ---
    console.log(`LiDAR Simulator Initialized. Point buffer size: ${MAX_POINTS}`);
    console.log("Press 'H' to toggle scene mesh visibility.");
}

function simulateLidarScan() { /* ... (no changes needed here) ... */
    const hits = [];
    const raycaster = new THREE.Raycaster();
    raycaster.near = 0.01; raycaster.far = lidarRange;
    for (let i = 0; i < verticalResolution; i++) {
        const phi = verticalFov * (i / (verticalResolution - 1)) - (verticalFov / 2);
        for (let j = 0; j < horizontalResolution; j++) {
            const theta = horizontalFov * (j / horizontalResolution);
            beamDirection.setFromSphericalCoords(1, Math.PI / 2 - phi, theta);
            raycaster.set(lidarPosition, beamDirection); // Uses updated global lidarPosition
            const intersects = raycaster.intersectObjects(objectsToScan, false);
            if (intersects.length > 0) {
                const intersection = intersects[0]; const hitData = { position: intersection.point.clone(), distance: intersection.distance, normal: null, beamDirection: beamDirection.clone() };
                if (intersection.face) { hitData.normal = intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld).normalize(); }
                else { hitData.normal = lidarPosition.clone().sub(hitData.position).normalize(); }
                hits.push(hitData);
            }
        }
    } return hits;
}


// --- Modified: Update Instanced Mesh using Circular Buffer ---
function updateInstancedPointCloud(hits) {
    if (!instancedPointCloud || !hits) return;

    // Keep track if any matrices were actually updated in this batch
    let matricesUpdated = false;

    for (const hit of hits) {
        // Check if we exceed MAX_POINTS *before* accessing the index
        if (nextInstanceIndex >= MAX_POINTS) {
             console.warn("Attempted to write past MAX_POINTS. Check buffer size or logic.");
             nextInstanceIndex = 0; // Wrap immediately if somehow over limit
        }

        // --- 1. Orientation & Scale Calculation (same as before) ---
        surfaceNormal.copy(hit.normal); beamDirection.copy(hit.beamDirection); viewDirection.copy(beamDirection).negate();
        tangent.copy(viewDirection).projectOnPlane(surfaceNormal).normalize();
        if (tangent.lengthSq() < 0.0001) { if (Math.abs(surfaceNormal.x) > Math.abs(surfaceNormal.z)) tangent.set(-surfaceNormal.y, surfaceNormal.x, 0).normalize(); else tangent.set(0, -surfaceNormal.z, surfaceNormal.y).normalize(); }
        bitangent.crossVectors(surfaceNormal, tangent).normalize(); rotationMatrix.makeBasis(tangent, bitangent, surfaceNormal); tempQuaternion.setFromRotationMatrix(rotationMatrix);
        const distance = hit.distance; const divergenceDiameter = 2.0 * distance * Math.tan(beamDivergenceAngle / 2.0); const cosAngle = Math.abs(surfaceNormal.dot(viewDirection)); const clampedCosAngle = Math.max(0.01, cosAngle); const pulseProjectionLength = pulseLength / clampedCosAngle; const majorAxisDiameter = pulseProjectionLength + divergenceDiameter;
        tempScale.set(majorAxisDiameter * pointScaleFactor, divergenceDiameter * pointScaleFactor, 0.01);
        tempPosition.copy(hit.position);
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        // ----------------------------------------------------------

        // --- 2. Set Matrix at the current circular buffer index ---
        instancedPointCloud.setMatrixAt(nextInstanceIndex, tempMatrix);
        matricesUpdated = true;

        // --- 3. Advance the index for the next point (wrap around) ---
        nextInstanceIndex = (nextInstanceIndex + 1) % MAX_POINTS;

        // --- 4. Track total points written for initial count ---
        totalPointsWritten++;
    }

    // --- 5. Update the InstancedMesh if matrices were changed ---
    if (matricesUpdated) {
        instancedPointCloud.instanceMatrix.needsUpdate = true;
        // Update the number of instances to draw, capped by the buffer size
        instancedPointCloud.count = Math.min(totalPointsWritten, MAX_POINTS);
    }
}
// -----------------------------------------------------------

function clearBeamVisualization() { /* ... (no changes needed) ... */ }
function updateBeamVisualization(hits) { /* ... (no changes needed) ... */ }
function onWindowResize() { /* ... (no changes needed) ... */ }
function handleKeyDown(event) { /* ... (no changes needed) ... */ }

function animate(time) { // time parameter from rAF can be inconsistent, use clock
    requestAnimationFrame(animate);

    const frameDeltaTime = clock.getDelta(); // Time since last frame
    const currentTime = clock.getElapsedTime(); // Total elapsed time

    // --- Update Sensor Position (Smooth movement every frame) ---
    // Example: Circular motion + vertical sine wave
    const radius = 4;
    const angularSpeed = 0.5;
    lidarPosition.x = Math.cos(currentTime * angularSpeed) * radius;
    lidarPosition.z = Math.sin(currentTime * angularSpeed) * radius;
    lidarPosition.y = 1.5 + Math.sin(currentTime * 1.1) * 1.0; // Bob up and down

    // Update visual mesh
    if (lidarSensorMesh) {
        lidarSensorMesh.position.copy(lidarPosition);
    }
    // ----------------------------------------------------------

    // --- Update Scan Simulation (Throttled by scanFrequency) ---
    const scanDeltaTime = currentTime - lastScanTime;
    if (scanDeltaTime >= (1 / scanFrequency)) {

        const scanResults = simulateLidarScan(); // Uses the updated global lidarPosition

        // Update the point cloud buffer
        updateInstancedPointCloud(scanResults);

        // Update beams visualization if enabled
        updateBeamVisualization(scanResults); // Uses the updated global lidarPosition

        lastScanTime = currentTime; // Reset scan timer

        // Optional pulse animation
        if (lidarSensorMesh) {
            lidarSensorMesh.scale.setScalar(1.5);
            setTimeout(() => { if(lidarSensorMesh) lidarSensorMesh.scale.setScalar(1.0); }, 50);
        }
    }

    // --- Update Controls & Render (Every frame) ---
    controls.update();
    renderer.render(scene, camera);
}
