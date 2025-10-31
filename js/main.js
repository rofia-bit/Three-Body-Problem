import * as THREE from './three.module.js';
import { OrbitControls } from './OrbitControls.js';

// scene setuf
const scene = new THREE.Scene();

// camere
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5);

// renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
document.body.appendChild(renderer.domElement);

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// PMREM generator for environment reflections
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();


// lights
const keyLight = new THREE.DirectionalLight(0xfff3e0, 1.0);
keyLight.position.set(8, 12, 6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x88aaff, 0.35);
rimLight.position.set(-6, 4, -10);
scene.add(rimLight);
scene.add(new THREE.AmbientLight(0x222233, 0.6));

//space background 
const loader = new THREE.TextureLoader();
loader.load(
  'https://threejs.org/examples/textures/space.jpg',
  (tex) => { 
    scene.background = tex;
    try {
      const env = pmremGenerator.fromEquirectangular(tex);
      scene.environment = env.texture;
    } catch (e) {
      console.warn('PMREM environment generation failed:', e);
    }
  },
  undefined,
  () => {
    const size = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const stars = 2000;
    for (let i = 0; i < stars; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = Math.random() * 1.5;
      const a = 0.5 + Math.random() * 0.5;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const generated = new THREE.CanvasTexture(canvas);
    generated.encoding = THREE.sRGBEncoding;
    scene.background = generated;
    try {
      const env = pmremGenerator.fromEquirectangular(generated);
      scene.environment = env.texture;
    } catch (e) {
      console.warn('PMREM environment generation failed for generated background:', e);
    }
  }
);

// controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// planet textures
const textureLoader = new THREE.TextureLoader();
function loadTextureAsync(path) {
  return new Promise((resolve) => {
    textureLoader.load(path,
      (tex) => {
        tex.encoding = THREE.sRGBEncoding;

        try { tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); } catch (e) {}
        resolve(tex);
      },
      undefined,
      () => {
        // if error set to null and continue
        console.warn('Failed to load texture:', path);
        resolve(null);
      }
    );
  });
}

// start loading but wait for all to finish before creating bodies
const texturePromises = [
  loadTextureAsync('../img/earthmap.jpg'),
  loadTextureAsync('../img/jupitermap.jpg'),
  loadTextureAsync('../img/saturnmap.jpg')
];

// physics: simple Newtonian 3-body simulation (leapfrog integrator)
const G = 0.8; // gravitational constant (tweak for visible motion)
const scale = 1; // visual scale

// bodyy container
const bodies = [];

function makeBody({ mass = 1, position = new THREE.Vector3(), velocity = new THREE.Vector3(), radius = 0.5, color = 0xffffff, map = null }) {
  const geom = new THREE.SphereGeometry(radius, 32, 32);
  const threeColor = new THREE.Color(color);

  const emissive = threeColor.clone().multiplyScalar(0.15);

  const hasTexture = !!map;
  const matOptions = {
    color: threeColor,
 
    roughness: hasTexture ? 0.28 : 0.45,
    metalness: hasTexture ? 0.04 : 0.0,
    emissive: emissive,

    emissiveIntensity: hasTexture ? 0.12 : 0.9,
    
    clearcoat: hasTexture ? 0.06 : 0.0,
    clearcoatRoughness: hasTexture ? 0.15 : 0.0,
    envMapIntensity: hasTexture ? 0.9 : 0.0
  };
  if (map) matOptions.map = map;
  const mat = new THREE.MeshStandardMaterial(matOptions);
  if (map && mat.map) mat.map.encoding = THREE.sRGBEncoding;
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(position);
  scene.add(mesh);


  const localLight = new THREE.PointLight(threeColor.getHex(), hasTexture ? 0.08 : 0.25, radius * 12);
  localLight.position.copy(position);
  scene.add(localLight);

  // glow sprite
  
  const glowSize = Math.max(64, Math.round(radius * 64));
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = glowSize;
  const gctx = glowCanvas.getContext('2d');
  const grad = gctx.createRadialGradient(glowSize / 2, glowSize / 2, 0, glowSize / 2, glowSize / 2, glowSize / 2);

  const c = threeColor.clone();
  const cr = Math.round(c.r * 255), cg = Math.round(c.g * 255), cb = Math.round(c.b * 255);

  const startAlpha = hasTexture ? 0.6 : 0.95;
  const midAlpha = hasTexture ? 0.18 : 0.45;
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},${startAlpha})`);
  grad.addColorStop(0.3, `rgba(${cr},${cg},${cb},${midAlpha})`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, glowSize, glowSize);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const spriteMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
 
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(radius * (hasTexture ? 3 : 6), radius * (hasTexture ? 3 : 6), 1);
  sprite.position.copy(position);
  scene.add(sprite);

  // trail
  const trailLen = 400;
  const trailPositions = new Float32Array(trailLen * 3);
  const trailGeom = new THREE.BufferGeometry();
  trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  const trailMat = new THREE.LineBasicMaterial({ color: threeColor.getHex(), transparent: true, opacity: 0.85 });
  const trail = new THREE.Line(trailGeom, trailMat);
  scene.add(trail);

  return {
    mass,
    mesh,
    position: position.clone(),
    velocity: velocity.clone(),
    force: new THREE.Vector3(),
    radius,
    trail,
    trailPositions,
    trailIndex: 0,
    trailLen,
    sprite,
    localLight
  };
}


// function to compute forces
function computeForces() {

  for (const b of bodies) b.force.set(0, 0, 0);

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i];
      const B = bodies[j];
      const rij = new THREE.Vector3().subVectors(B.position, A.position);
      const dist2 = rij.lengthSq();
      const eps = 0.01; 
      const invDist = 1.0 / Math.sqrt(dist2 + eps);
      const invDist3 = invDist * invDist * invDist;
      const forceMag = G * A.mass * B.mass * invDist3;
      const f = rij.clone().multiplyScalar(forceMag);
      A.force.add(f);
      B.force.sub(f);
    }
  }
}


function integrate(dt) {
  
  for (const b of bodies) {
    const a = b.force.clone().divideScalar(b.mass);
    b.velocity.addScaledVector(a, dt * 0.5);
  }

  
  for (const b of bodies) {
    b.position.addScaledVector(b.velocity, dt);
  }

  
  computeForces();

 
  for (const b of bodies) {
    const a = b.force.clone().divideScalar(b.mass);
    b.velocity.addScaledVector(a, dt * 0.5);
  }
}




function updateVisuals() {
  for (const b of bodies) {
    b.mesh.position.copy(b.position).multiplyScalar(scale);
    // keep glow sprite and local light synced with the mesh
    if (b.sprite) b.sprite.position.copy(b.mesh.position);
    if (b.localLight) b.localLight.position.copy(b.mesh.position);

    // push to trail (circular buffer)
    const idx = (b.trailIndex % b.trailLen) * 3;
    b.trailPositions[idx] = b.position.x * scale;
    b.trailPositions[idx + 1] = b.position.y * scale;
    b.trailPositions[idx + 2] = b.position.z * scale;
    b.trailIndex++;

    // copy into geometry in order so the line reads oldest->newest
    const posAttr = b.trail.geometry.attributes.position.array;
    
    const len = b.trailLen;
    for (let i = 0; i < len; i++) {
      const src = ((b.trailIndex + i) % len) * 3;
      const dst = i * 3;
      posAttr[dst] = b.trailPositions[src];
      posAttr[dst + 1] = b.trailPositions[src + 1];
      posAttr[dst + 2] = b.trailPositions[src + 2];
    }
    b.trail.geometry.attributes.position.needsUpdate = true;
  }
}

// animation loop 
let last = performance.now();
const maxSubSteps = 5;
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  let dt = (now - last) / 1000; // seconds
  last = now;


  dt = Math.min(dt, 0.05);

  // physics substeps for stability
  const subDt = 0.01;
  let steps = Math.ceil(dt / subDt);
  steps = Math.min(steps, maxSubSteps);
  for (let i = 0; i < steps; i++) {
    integrate(subDt);
  }

  updateVisuals();
  controls.update();
  renderer.render(scene, camera);
}

// wait for textures to load, create bodies, then start simulation
Promise.all(texturePromises).then(([earthMap, jupiterMap, saturnMap]) => {

  const b1 = makeBody({ mass: 1.2, position: new THREE.Vector3(-1.5, 0, 0), velocity: new THREE.Vector3(0, -0.25, 0.1), radius: 0.45, color: 0xffffff, map: earthMap });
  const b2 = makeBody({ mass: 1.0, position: new THREE.Vector3(1.2, 0.2, 0), velocity: new THREE.Vector3(0.0, 0.2, -0.1), radius: 0.4, color: 0xffffff, map: jupiterMap });
  const b3 = makeBody({ mass: 0.8, position: new THREE.Vector3(0.2, 0.9, 0), velocity: new THREE.Vector3(-0.15, 0.0, 0.05), radius: 0.35, color: 0xffffff, map: saturnMap });
  bodies.push(b1, b2, b3);


  computeForces();

  //animation
  last = performance.now();
  animate();
}).catch((err) => {
  console.error('Texture loading error, creating untextured bodies as fallback:', err);
  // fallback: create plain colored bodies
  const b1 = makeBody({ mass: 1.2, position: new THREE.Vector3(-1.5, 0, 0), velocity: new THREE.Vector3(0, -0.25, 0.1), radius: 0.45, color: 0x4caf50 });
  const b2 = makeBody({ mass: 1.0, position: new THREE.Vector3(1.2, 0.2, 0), velocity: new THREE.Vector3(0.0, 0.2, -0.1), radius: 0.4, color: 0xff8a65 });
  const b3 = makeBody({ mass: 0.8, position: new THREE.Vector3(0.2, 0.9, 0), velocity: new THREE.Vector3(-0.15, 0.0, 0.05), radius: 0.35, color: 0x90caf9 });
  bodies.push(b1, b2, b3);
  computeForces();
  last = performance.now();
  animate();
});

// responsiveness
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
