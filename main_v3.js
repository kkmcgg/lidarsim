import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let instancedPointCloud, lidarSensorMesh, beamLinesGroup;
let sceneMeshesGroup; // <<< New group for toggleable meshes
const objectsToScan = []; // Still holds refs to meshes for raycasting

// --- Simulation Parameters ---
var lidarPosition = new THREE.Vector3(0, 1, 0);
const lidarRange = 15;
const horizontalResolution = 50;
const verticalResolution = 50;
const horizontalFov = Math.PI * 2;
const verticalFov = Math.PI;
const scanFrequency = 150;
const showBeamLines = false; // Defaulting beams to off for clarity
const showSceneMeshes = false; // <<< New: Toggle for scene geometry visibility

// --- Pulse/Beam Characteristics ---
const beamDivergenceAngle = THREE.MathUtils.degToRad(15.2);
const pulseDurationNanoSeconds = .01;
const speedOfLight = 0.299792458; // Meters per nanosecond
const pulseLength = pulseDurationNanoSeconds * speedOfLight;
const pointScaleFactor = 1.0;
// ----------------------------------

let lastScanTime = 0;
const MAX_POINTS = horizontalResolution * verticalResolution;

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
// ---------------------

// --- Beam Visualization ---
const beamLineMaterial = new THREE.LineBasicMaterial({ /* ... */ });
// ---------------------------

init();
animate();

// --- Helper: Create Gaussian Texture ---
function createGaussianTexture(size = 64) { /* ...  ... */
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2, radius = size / 2;
    ctx.beginPath(); ctx.arc(center, center, radius, 0, 2 * Math.PI, false); ctx.closePath();
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,.125)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.0125)');
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
    // (Keep lights in main scene so hidden objects are still potentially lit
    // if needed for other effects, though not strictly necessary if only raycasting)
    const ambientLight = new THREE.AmbientLight(0xaaaaaa);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    // --- Group for Scene Meshes (for toggling visibility) --- // <<< New
    sceneMeshesGroup = new THREE.Group();
    sceneMeshesGroup.visible = showSceneMeshes; // Set initial visibility
    scene.add(sceneMeshesGroup);
    // --------------------------------------------------------

    // --- Objects to Scan ---
    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x555555, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    sceneMeshesGroup.add(ground); // <<< Add to group
    objectsToScan.push(ground); // <<< Still add to scan list

    const cubeGeometry = new THREE.BoxGeometry(2, 2, 2);
    const cubeMaterial = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
    const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
    cube.position.set(-3, 0, -2);
    sceneMeshesGroup.add(cube); // <<< Add to group
    objectsToScan.push(cube); // <<< Still add to scan list

    const sphereGeometry = new THREE.SphereGeometry(1.5, 32, 16);
    const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(4, 0.5, 1);
    sceneMeshesGroup.add(sphere); // <<< Add to group
    objectsToScan.push(sphere); // <<< Still add to scan list


    // --- LiDAR Sensor Visualization (Stays in main scene) ---
    const sensorGeom = new THREE.SphereGeometry(0.1, 8, 8);
    const sensorMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    lidarSensorMesh = new THREE.Mesh(sensorGeom, sensorMat);
    lidarSensorMesh.position.copy(lidarPosition);
    scene.add(lidarSensorMesh); // <<< Add directly to scene

    // --- Instanced Point Cloud Setup (Stays in main scene) ---
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
    instancedPointCloud = new THREE.InstancedMesh(pointGeometry, pointMaterial, MAX_POINTS);
    instancedPointCloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(instancedPointCloud); // <<< Add directly to scene
    // -----------------------------------

    // --- Beam Lines Setup (Stays in main scene) ---
    beamLinesGroup = new THREE.Group();
    scene.add(beamLinesGroup); // <<< Add directly to scene

    // --- Event Listeners ---
    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('keydown', handleKeyDown, false); // <<< Add key listener

    // --- Initial Log ---
    console.log("LiDAR Simulator Initialized.");
    console.log("Press 'H' to toggle scene mesh visibility.");
}

function simulateLidarScan() {
    const hits = [];
    const raycaster = new THREE.Raycaster();
    raycaster.near = 0.01;
    raycaster.far = lidarRange;

    // Raycasting loop
    // It uses objectsToScan, which contains the meshes even if
    // sceneMeshesGroup.visible is false.
    for (let i = 0; i < verticalResolution; i++) {
        const phi = verticalFov * (i / (verticalResolution - 1)) - (verticalFov / 2);
        for (let j = 0; j < horizontalResolution; j++) {
            const theta = horizontalFov * (j / horizontalResolution);

            beamDirection.setFromSphericalCoords(1, Math.PI / 2 - phi, theta);
            raycaster.set(lidarPosition, beamDirection);
            // *** Intersection test uses objectsToScan directly ***
            const intersects = raycaster.intersectObjects(objectsToScan, false);

            if (intersects.length > 0) {
                const intersection = intersects[0];
                const hitData = {
                    position: intersection.point.clone(),
                    distance: intersection.distance,
                    normal: null,
                    beamDirection: beamDirection.clone()
                };
                if (intersection.face) {
                     hitData.normal = intersection.face.normal.clone()
                         .transformDirection(intersection.object.matrixWorld)
                         .normalize();
                } else {
                    hitData.normal = lidarPosition.clone().sub(hitData.position).normalize();
                }
                hits.push(hitData);
            }
        }
    }
    return hits;
}

function updateInstancedPointCloud(hits) {
    if (!instancedPointCloud) return;
    let instanceIndex = 0;
    for (const hit of hits) {
        if (instanceIndex >= MAX_POINTS) break;
        // --- 1. Orientation ---
        surfaceNormal.copy(hit.normal);
        beamDirection.copy(hit.beamDirection);
        viewDirection.copy(beamDirection).negate();
        tangent.copy(viewDirection).projectOnPlane(surfaceNormal).normalize();
        if (tangent.lengthSq() < 0.0001) {
            if (Math.abs(surfaceNormal.x) > Math.abs(surfaceNormal.z)) tangent.set(-surfaceNormal.y, surfaceNormal.x, 0).normalize();
            else tangent.set(0, -surfaceNormal.z, surfaceNormal.y).normalize();
        }
        bitangent.crossVectors(surfaceNormal, tangent).normalize();
        rotationMatrix.makeBasis(tangent, bitangent, surfaceNormal);
        tempQuaternion.setFromRotationMatrix(rotationMatrix);
        // --- 2. Scale ---
        const distance = hit.distance;
        const divergenceDiameter = 2.0 * distance * Math.tan(beamDivergenceAngle / 2.0);
        const cosAngle = Math.abs(surfaceNormal.dot(viewDirection));
        const clampedCosAngle = Math.max(0.01, cosAngle);
        const pulseProjectionLength = pulseLength / clampedCosAngle;
        const majorAxisDiameter = pulseProjectionLength + divergenceDiameter;
        tempScale.set(majorAxisDiameter * pointScaleFactor, divergenceDiameter * pointScaleFactor, 0.01);
        // --- 3. Compose & Set ---
        tempPosition.copy(hit.position);
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        instancedPointCloud.setMatrixAt(instanceIndex, tempMatrix);
        instanceIndex++;
    }
    // --- 4. Update ---
    instancedPointCloud.count = instanceIndex;
    instancedPointCloud.instanceMatrix.needsUpdate = true;
}

function clearBeamVisualization() {
     if (beamLinesGroup.children[0] && beamLinesGroup.children[0].geometry) {
        beamLinesGroup.children[0].geometry.dispose();
    }
    beamLinesGroup.clear();
}

function updateBeamVisualization(hits) {
    if (!showBeamLines || !hits || hits.length === 0) {
        clearBeamVisualization(); // Clear if no hits or beams disabled
        return;
    }
    clearBeamVisualization(); // Clear previous lines first
    const lineVertices = [];
     for (const hit of hits) {
         lineVertices.push(lidarPosition.x, lidarPosition.y, lidarPosition.z);
         lineVertices.push(hit.position.x, hit.position.y, hit.position.z);
     }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lineVertices, 3));
    const lines = new THREE.LineSegments(lineGeometry, beamLineMaterial);
    beamLinesGroup.add(lines);
}


function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function handleKeyDown(event) {
    switch (event.key.toLowerCase()) {
        case 'h': // Toggle scene mesh visibility
            if (sceneMeshesGroup) {
                sceneMeshesGroup.visible = !sceneMeshesGroup.visible;
                console.log("Scene meshes visibility:", sceneMeshesGroup.visible);
            }
            break;

    }
}

function animate(time) {
    requestAnimationFrame(animate);

    const currentTime = time * 0.001;
    const deltaTime = currentTime - lastScanTime;
    //lidarPosition.z += .01
     lidarPosition.z = Math.sin(time/4000)
     lidarPosition.x = Math.sin(time/1000)
     lidarPosition.y = Math.sin(time/3000)+10
     
     if (lidarSensorMesh) {
        lidarSensorMesh.position.copy(lidarPosition);
    }

    if (deltaTime >= (1 / scanFrequency)) {
        // No need to clear beams here, updateBeamVisualization handles it

        const scanResults = simulateLidarScan();

        updateInstancedPointCloud(scanResults);

        updateBeamVisualization(scanResults);

        lastScanTime = currentTime;

        lidarSensorMesh.scale.setScalar(1.5);
        
        setTimeout(() => lidarSensorMesh.scale.setScalar(1.0), 50);
    }

    controls.update();
    renderer.render(scene, camera);
}
