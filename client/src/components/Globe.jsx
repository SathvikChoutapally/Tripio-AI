import React, { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';

// Convert Lat/Lon to 3D Cartesian coordinates matching standard SphereGeometry UV coordinates
function latLonToVector3(lat, lon, radius) {
  // phi: polar angle (from y-axis down, 0 to PI)
  const phi = (90 - lat) * (Math.PI / 180);
  // theta: azimuthal angle (around y-axis, 0 to 2*PI)
  const theta = (lon + 180) * (Math.PI / 180);

  // Exact Three.js standard UV Sphere coordinate mapping
  const x = -radius * Math.cos(theta) * Math.sin(phi);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(theta) * Math.sin(phi);

  return new THREE.Vector3(x, y, z);
}

// Generates a self-contained, high-fidelity procedural Earth texture canvas
// with rich dark colors: deep blue oceans, dark forest green and golden yellow landmasses.
function createEarthTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Fill oceans with a rich, deep oceanic blue (dark sky blue variant for depth)
  ctx.fillStyle = '#1e3a8a'; // Rich deep blue (tailwind blue-900)
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Helper to draw a continent with a rich forest green and golden yellow terrain gradient
  const drawContinent = (pointsList) => {
    if (pointsList.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(pointsList[0][0], pointsList[0][1]);
    for (let i = 1; i < pointsList.length; i++) {
      ctx.lineTo(pointsList[i][0], pointsList[i][1]);
    }
    ctx.closePath();

    // Deep green to golden yellow gradient for professional, realistic terrain
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#14532d');   // Deep forest green
    gradient.addColorStop(0.5, '#16a34a'); // Lush green
    gradient.addColorStop(0.85, '#ca8a04'); // Golden yellow/ochre
    gradient.addColorStop(1, '#a16207');   // Dark golden brown

    ctx.fillStyle = gradient;
    ctx.fill();

    // Outline land borders with a soft sandy yellow to simulate beaches
    ctx.strokeStyle = '#eab308'; // Sand yellow
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  // Coordinates mapping helper: x = (lon + 180) * (2048/360), y = (90 - lat) * (1024/180)
  const mapCoords = (pts) => pts.map(([lat, lon]) => [
    (lon + 180) * (2048 / 360),
    (90 - lat) * (1024 / 180)
  ]);

  // North America
  drawContinent(mapCoords([
    [75, -165], [78, -120], [83, -60], [70, -40], [60, -50], [50, -55], [30, -80], [25, -80], 
    [15, -95], [8, -80], [15, -100], [25, -115], [30, -115], [50, -125], [60, -140], [70, -168]
  ]));

  // Greenland
  drawContinent(mapCoords([
    [80, -70], [83, -30], [70, -10], [60, -45], [70, -60]
  ]));

  // South America
  drawContinent(mapCoords([
    [12, -72], [10, -50], [-5, -35], [-20, -40], [-40, -60], 
    [-55, -70], [-45, -75], [-20, -75], [-5, -80]
  ]));

  // Eurasia (Europe & Asia)
  drawContinent(mapCoords([
    [75, -10], [80, 40], [75, 80], [78, 120], [75, 160], [70, 175],
    [60, 170], [50, 140], [35, 140], [30, 120], [10, 105], [5, 95],
    [10, 80], [5, 75], [20, 60], [10, 45], [25, 33], [30, 37],
    [25, 45], [35, 27], [35, 22], [36, -5], [45, -10], [55, -10], [60, 5], [70, 0]
  ]));

  // Africa
  drawContinent(mapCoords([
    [36, -5], [37, 10], [32, 30], [30, 33], [15, 38], [12, 45],
    [10, 50], [0, 42], [-15, 38], [-33, 27], [-34, 18], [-20, 12],
    [-5, 10], [5, 10], [5, -10], [15, -17], [20, -15], [30, -10]
  ]));

  // Australia
  drawContinent(mapCoords([
    [-11, 130], [-13, 143], [-25, 153], [-37, 150], [-35, 138], 
    [-35, 117], [-20, 113], [-15, 122]
  ]));

  // Great Britain & Ireland
  drawContinent(mapCoords([
    [58, -7], [60, -4], [56, -1], [50, -1], [50, -6], [54, -10]
  ]));

  // Madagascar
  drawContinent(mapCoords([
    [-12, 49], [-16, 50], [-25, 47], [-25, 43], [-16, 44]
  ]));

  // Japan
  drawContinent(mapCoords([
    [45, 142], [40, 140], [34, 135], [36, 138], [43, 144]
  ]));

  // Antarctica (Southern Pole cap)
  ctx.beginPath();
  ctx.rect(0, 920, 2048, 104);
  ctx.fillStyle = '#a16207'; // Golden brown/yellow cap
  ctx.fill();

  // Draw grid lines in white/light blue for coordinate realism
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  const numGridLines = 36;
  for (let i = 0; i <= numGridLines; i++) {
    const x = (i / numGridLines) * canvas.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  const numLatLines = 18;
  for (let j = 0; j <= numLatLines; j++) {
    const y = (j / numLatLines) * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw glowing amber/yellow city lights on land
  ctx.fillStyle = '#f59e0b';
  const cityLights = [
    [40.71, -74.00],   // New York
    [34.05, -118.24],  // Los Angeles
    [51.50, -0.12],    // London
    [48.85, 2.35],     // Paris
    [35.67, 139.65],   // Tokyo
    [22.39, 114.10],   // Hong Kong
    [19.07, 72.87],    // Mumbai
    [28.61, 77.20],    // Delhi
    [1.35, 103.81],    // Singapore
    [-33.86, 151.20],  // Sydney
    [-23.55, -46.63],  // São Paulo
    [30.04, 31.23],    // Cairo
    [-26.20, 28.04],   // Johannesburg
    [55.75, 37.61],    // Moscow
  ];
  cityLights.forEach(([lat, lon]) => {
    const x = (lon + 180) * (canvas.width / 360);
    const y = (90 - lat) * (canvas.height / 180);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// ── Curved Arc component between two 3D points ──────────────────
function FlightArc({ start, end, radius }) {
  const points = useMemo(() => {
    if (!start || !end) return [];

    const startVec = latLonToVector3(start.lat, start.lon, radius);
    const endVec = latLonToVector3(end.lat, end.lon, radius);

    // Calculate midpoint and lift it up for the arc curve
    const midPoint = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
    const distance = startVec.distanceTo(endVec);
    const altitude = distance * 0.25; // Height of arc depends on distance
    midPoint.normalize().multiplyScalar(radius + altitude);

    // Create curve
    const curve = new THREE.QuadraticBezierCurve3(startVec, midPoint, endVec);
    return curve.getPoints(50);
  }, [start, end, radius]);

  const lineRef = useRef();

  useFrame(({ clock }) => {
    if (lineRef.current) {
      // Animate dash offset for a flowing flight route effect
      const material = lineRef.current.material;
      material.dashOffset = -clock.getElapsedTime() * 0.8;
    }
  });

  if (points.length === 0) return null;

  return (
    <group>
      {/* Flight Path Arc */}
      <line ref={lineRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array(points.flatMap(p => [p.x, p.y, p.z])),
              3
            ]}
          />
        </bufferGeometry>
        <lineDashedMaterial
          color="#ef4444" // Crimson red to stand out on dark blue ocean
          linewidth={4}
          dashSize={0.4}
          gapSize={0.2}
          transparent
          opacity={0.95}
        />
      </line>

      {/* Origin/Destination Markers */}
      <mesh position={points[0]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshBasicMaterial color="#b91c1c" />
      </mesh>
      <mesh position={points[points.length - 1]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
    </group>
  );
}

// ── The Sphere Globe Mesh ──────────────────────────────────────
function GlobeSphere({ radius, originCoords, destinationCoords }) {
  const globeGroupRef = useRef();
  const wireframeRef = useRef();

  useFrame((state, delta) => {
    if (globeGroupRef.current) {
      // Rotate the entire group: this rotates the globe texture AND the flight points/arcs in sync!
      globeGroupRef.current.rotation.y += delta * 0.05;
    }
    if (wireframeRef.current) {
      wireframeRef.current.rotation.y += delta * 0.03;
    }
  });

  const earthTexture = useMemo(() => createEarthTexture(), []);

  return (
    <group>
      {/* Glowing atmospheric outer shell */}
      <mesh>
        <sphereGeometry args={[radius * 1.03, 32, 32]} />
        <meshBasicMaterial
          color="#2563eb"
          transparent
          opacity={0.08}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Rotating Group containing Globe AND Flight Points/Arc */}
      <group ref={globeGroupRef}>
        {/* Main realistic Globe with texture mapping */}
        <mesh>
          <sphereGeometry args={[radius, 64, 64]} />
          <meshStandardMaterial
            map={earthTexture}
            roughness={0.75}
            metalness={0.2}
          />
        </mesh>

        {/* Flight Arc and coordinates markers are nested INSIDE the rotating group */}
        {originCoords && destinationCoords && (
          <FlightArc
            start={originCoords}
            end={destinationCoords}
            radius={radius}
          />
        )}
      </group>

      {/* Futuristic wireframe grid shell wrapper */}
      <mesh ref={wireframeRef}>
        <sphereGeometry args={[radius * 1.008, 32, 32]} />
        <meshBasicMaterial
          color="#ffffff"
          wireframe={true}
          transparent={true}
          opacity={0.06}
        />
      </mesh>

      {/* Subtle interior glow sphere */}
      <mesh>
        <sphereGeometry args={[radius * 0.98, 32, 32]} />
        <meshBasicMaterial
          color="#1e3a8a"
          transparent
          opacity={0.3}
        />
      </mesh>
    </group>
  );
}

// ── Main Canvas container ──────────────────────────────────────
export default function Globe({ originCoords, destinationCoords }) {
  const radius = 3;

  return (
    <div className="w-full h-full relative cursor-grab active:cursor-grabbing min-h-[350px] md:min-h-[500px]">
      <Suspense fallback={
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-glass-dark rounded-3xl border border-white/5">
          <div className="w-16 h-16 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-white/60 font-sans">Initializing 3D Globe viewport...</p>
        </div>
      }>
        <Canvas
          camera={{ position: [0, 0, 7.5], fov: 45 }}
          className="w-full h-full"
          gl={{ antialias: true }}
        >
          <ambientLight intensity={1.4} />
          <pointLight position={[10, 10, 10]} intensity={2.5} color="#ffffff" />
          <pointLight position={[-10, -10, -10]} intensity={1.5} color="#3b82f6" />
          
          <GlobeSphere
            radius={radius}
            originCoords={originCoords}
            destinationCoords={destinationCoords}
          />

          <Stars radius={100} depth={50} count={5000} factor={4} saturation={0.5} fade speed={1} />
          <OrbitControls
            enableZoom={true}
            enablePan={false}
            zoomSpeed={0.6}
            rotateSpeed={0.5}
            minDistance={4}
            maxDistance={15}
          />
        </Canvas>
      </Suspense>

      {/* Floating coordinates indicator overlay */}
      {originCoords && destinationCoords && (
        <div className="absolute bottom-4 left-4 right-4 text-center py-2 px-4 rounded-xl glass-card text-xs flex justify-around gap-2 text-white/80 animate-fade-in border border-white/10 pointer-events-none">
          <div>
            <span className="text-brand-400 font-semibold font-display">Origin:</span> Lat {originCoords.lat.toFixed(2)}°, Lon {originCoords.lon.toFixed(2)}°
          </div>
          <div className="text-brand-300">✈</div>
          <div>
            <span className="text-teal-400 font-semibold font-display">Destination:</span> Lat {destinationCoords.lat.toFixed(2)}°, Lon {destinationCoords.lon.toFixed(2)}°
          </div>
        </div>
      )}
    </div>
  );
}
