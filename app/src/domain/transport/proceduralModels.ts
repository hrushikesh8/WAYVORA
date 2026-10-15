/* ─── Procedural 3D Transport Models (WAYVORA Studio) ──────────────────
   Original, high-performance, low-poly procedural 3D meshes in Three.js.
   100% in-house authored under WAYVORA MIT license.
   Zero external network requests, zero bundle bloat, zero licensing ambiguity.

   Coordinate Conventions:
   - Local +Y: Up (skywards)
   - Local -Z: Forward (direction of travel / North at bearing 0)
   - Local +X: Right (starboard / East at bearing 0)
   - Center (0, 0, 0): Baseline ground/water surface contact
   ─────────────────────────────────────────────────────────────────── */

import * as THREE from 'three';
import type { CanonicalTransportMode } from './types';

function createMaterials() {
  return {
    // Automotive
    carChassis: new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Vibrant cyan-blue
      metalness: 0.6,
      roughness: 0.25,
    }),
    darkGlass: new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Deep tinted greenhouse glass
      metalness: 0.8,
      roughness: 0.15,
    }),
    rubberWheel: new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.85,
    }),
    headlightBeam: new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xf8fafc,
      emissiveIntensity: 2.0,
    }),
    taillightBeam: new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.5,
    }),

    // Aviation
    planeFuselage: new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // Pearl white
      metalness: 0.3,
      roughness: 0.2,
    }),
    planeAccent: new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Sky-blue livery
      metalness: 0.5,
      roughness: 0.3,
    }),
    planeEngine: new THREE.MeshStandardMaterial({
      color: 0x475569, // Titanium gray
      metalness: 0.7,
      roughness: 0.2,
    }),
    navLightGreen: new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x22c55e,
      emissiveIntensity: 2.0,
    }),
    navLightRed: new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 2.0,
    }),

    // Marine
    boatHull: new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Deep marine navy hull
      metalness: 0.4,
      roughness: 0.3,
    }),
    boatDeck: new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // Crisp white superstructure
      metalness: 0.2,
      roughness: 0.4,
    }),
    boatTeak: new THREE.MeshStandardMaterial({
      color: 0xb45309, // Rich teak decking
      roughness: 0.7,
    }),
    boatChrome: new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.9,
      roughness: 0.1,
    }),

    // Transit & Rail
    busBody: new THREE.MeshStandardMaterial({
      color: 0xd97706, // Warm highway coach amber
      metalness: 0.5,
      roughness: 0.3,
    }),
    busRoof: new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      metalness: 0.2,
      roughness: 0.4,
    }),
    trainBody: new THREE.MeshStandardMaterial({
      color: 0xf8fafc, // High-speed bullet train white
      metalness: 0.4,
      roughness: 0.2,
    }),
    trainAccent: new THREE.MeshStandardMaterial({
      color: 0xdc2626, // Crimson aerodynamic stripe
      metalness: 0.5,
      roughness: 0.3,
    }),
    trainMetal: new THREE.MeshStandardMaterial({
      color: 0x64748b, // Metallic pantograph / bogies
      metalness: 0.8,
      roughness: 0.25,
    }),

    // Outdoor & Trail
    hikerJacket: new THREE.MeshStandardMaterial({
      color: 0xe11d48, // High-visibility outdoor rose/red
      roughness: 0.7,
    }),
    hikerTrousers: new THREE.MeshStandardMaterial({
      color: 0x475569, // Trail slate trousers
      roughness: 0.8,
    }),
    hikerBackpack: new THREE.MeshStandardMaterial({
      color: 0x334155, // Expedition rucksack
      roughness: 0.7,
    }),
    hikerSkin: new THREE.MeshStandardMaterial({
      color: 0xfbbf24, // Stylized figure
      roughness: 0.6,
    }),
    hikerHat: new THREE.MeshStandardMaterial({
      color: 0x78716c, // Trail explorer hat
      roughness: 0.7,
    }),
    poleMetal: new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Trekking pole aluminum
      metalness: 0.8,
      roughness: 0.2,
    }),

    // Two-Wheelers
    motoFairing: new THREE.MeshStandardMaterial({
      color: 0x10b981, // Racing emerald
      metalness: 0.6,
      roughness: 0.3,
    }),
    motoFrame: new THREE.MeshStandardMaterial({
      color: 0x334155, // Steel frame / engine
      metalness: 0.7,
      roughness: 0.3,
    }),
    motoPannier: new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Aluminum luggage panniers
      metalness: 0.8,
      roughness: 0.2,
    }),
    bikeFrame: new THREE.MeshStandardMaterial({
      color: 0x06b6d4, // Electric cyan frame
      metalness: 0.6,
      roughness: 0.3,
    }),
    cyclistJersey: new THREE.MeshStandardMaterial({
      color: 0x2563eb, // Cobalt cycling jersey
      roughness: 0.6,
    }),
    cyclistHelmet: new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      metalness: 0.4,
      roughness: 0.3,
    }),
  };
}

/**
 * 1. Car: Low-poly modern touring sedan
 */
export function createProceduralCar(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wayvora-model-car';
  const mats = createMaterials();

  // Lower chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 3.8), mats.carChassis);
  chassis.position.set(0, 0.45, 0);
  chassis.castShadow = true;
  group.add(chassis);

  // Aerodynamic cabin (tapered top)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.1), mats.darkGlass);
  cabin.position.set(0, 0.95, -0.2);
  cabin.castShadow = true;
  group.add(cabin);

  // Front headlights (facing forward: -Z)
  const headlightGeom = new THREE.BoxGeometry(0.35, 0.12, 0.08);
  const leftHeadlight = new THREE.Mesh(headlightGeom, mats.headlightBeam);
  leftHeadlight.position.set(-0.6, 0.5, -1.91);
  const rightHeadlight = new THREE.Mesh(headlightGeom, mats.headlightBeam);
  rightHeadlight.position.set(0.6, 0.5, -1.91);
  group.add(leftHeadlight, rightHeadlight);

  // Rear taillights (facing backward: +Z)
  const taillightGeom = new THREE.BoxGeometry(0.35, 0.12, 0.08);
  const leftTaillight = new THREE.Mesh(taillightGeom, mats.taillightBeam);
  leftTaillight.position.set(-0.6, 0.5, 1.91);
  const rightTaillight = new THREE.Mesh(taillightGeom, mats.taillightBeam);
  rightTaillight.position.set(0.6, 0.5, 1.91);
  group.add(leftTaillight, rightTaillight);

  // 4 Wheels
  const wheelGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.28, 16);
  wheelGeom.rotateZ(Math.PI / 2);

  const wheelFL = new THREE.Mesh(wheelGeom, mats.rubberWheel);
  wheelFL.position.set(-0.95, 0.35, -1.2);
  const wheelFR = new THREE.Mesh(wheelGeom, mats.rubberWheel);
  wheelFR.position.set(0.95, 0.35, -1.2);
  const wheelRL = new THREE.Mesh(wheelGeom, mats.rubberWheel);
  wheelRL.position.set(-0.95, 0.35, 1.2);
  const wheelRR = new THREE.Mesh(wheelGeom, mats.rubberWheel);
  wheelRR.position.set(0.95, 0.35, 1.2);
  group.add(wheelFL, wheelFR, wheelRL, wheelRR);

  return group;
}

/**
 * 2. Airplane: Commercial twin-jet passenger airliner
 */
export function createProceduralAirplane(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wayvora-model-airplane';
  const mats = createMaterials();

  // Main fuselage (cylinder along Z-axis)
  const fuselageGeom = new THREE.CylinderGeometry(0.85, 0.85, 7.5, 16);
  fuselageGeom.rotateX(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuselageGeom, mats.planeFuselage);
  fuselage.position.set(0, 1.0, 0);
  fuselage.castShadow = true;
  group.add(fuselage);

  // Aerodynamic nose cone (facing forward: -Z)
  const noseGeom = new THREE.ConeGeometry(0.85, 2.2, 16);
  noseGeom.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeom, mats.planeFuselage);
  nose.position.set(0, 1.0, -4.85);
  nose.castShadow = true;
  group.add(nose);

  // Cockpit windshield
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.4, 0.8),
    mats.darkGlass
  );
  windshield.position.set(0, 1.45, -4.0);
  windshield.rotateX(0.25);
  group.add(windshield);

  // Main wings (swept back, span ~10.5m)
  const wingGeom = new THREE.BoxGeometry(10.5, 0.14, 1.8);
  const wings = new THREE.Mesh(wingGeom, mats.planeAccent);
  wings.position.set(0, 0.85, -0.3);
  wings.castShadow = true;
  group.add(wings);

  // Dual underslung turbofan jet engines
  const engineGeom = new THREE.CylinderGeometry(0.38, 0.38, 1.8, 14);
  engineGeom.rotateX(Math.PI / 2);

  const leftEngine = new THREE.Mesh(engineGeom, mats.planeEngine);
  leftEngine.position.set(-2.4, 0.45, -0.3);
  leftEngine.castShadow = true;

  const rightEngine = new THREE.Mesh(engineGeom, mats.planeEngine);
  rightEngine.position.set(2.4, 0.45, -0.3);
  rightEngine.castShadow = true;
  group.add(leftEngine, rightEngine);

  // Vertical stabilizer (tail fin)
  const verticalFinGeom = new THREE.BoxGeometry(0.12, 1.8, 1.6);
  const verticalFin = new THREE.Mesh(verticalFinGeom, mats.planeAccent);
  verticalFin.position.set(0, 2.1, 3.2);
  verticalFin.rotateX(0.35); // Swept back
  verticalFin.castShadow = true;
  group.add(verticalFin);

  // Horizontal tail stabilizers
  const horizTailGeom = new THREE.BoxGeometry(3.6, 0.1, 0.9);
  const horizTail = new THREE.Mesh(horizTailGeom, mats.planeFuselage);
  horizTail.position.set(0, 1.4, 3.4);
  horizTail.castShadow = true;
  group.add(horizTail);

  // Wingtip navigation lights: Port (Red: -X) & Starboard (Green: +X)
  const navLightGeom = new THREE.SphereGeometry(0.12, 8, 8);
  const portLight = new THREE.Mesh(navLightGeom, mats.navLightRed);
  portLight.position.set(-5.25, 0.85, -0.3);

  const starLight = new THREE.Mesh(navLightGeom, mats.navLightGreen);
  starLight.position.set(5.25, 0.85, -0.3);
  group.add(portLight, starLight);

  return group;
}

/**
 * 3. Boat: Luxury cabin cruiser / yacht
 */
export function createProceduralBoat(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wayvora-model-boat';
  const mats = createMaterials();

  // Lower V-hull (navy blue)
  const hullGeom = new THREE.BoxGeometry(2.4, 0.9, 6.2);
  const hull = new THREE.Mesh(hullGeom, mats.boatHull);
  hull.position.set(0, 0.45, 0);
  hull.castShadow = true;
  group.add(hull);

  // Tapered forward bow (wedge pointing -Z)
  const bowGeom = new THREE.ConeGeometry(1.2, 2.4, 4);
  bowGeom.rotateX(-Math.PI / 2);
  bowGeom.rotateY(Math.PI / 4);
  const bow = new THREE.Mesh(bowGeom, mats.boatHull);
  bow.position.set(0, 0.45, -3.8);
  bow.scale.set(1.0, 0.75, 1.0);
  bow.castShadow = true;
  group.add(bow);

  // Teak deck inlay
  const deckGeom = new THREE.BoxGeometry(2.1, 0.1, 5.4);
  const deck = new THREE.Mesh(deckGeom, mats.boatTeak);
  deck.position.set(0, 0.95, -0.1);
  group.add(deck);

  // Cabin superstructure (white)
  const cabinGeom = new THREE.BoxGeometry(1.8, 0.85, 3.2);
  const cabin = new THREE.Mesh(cabinGeom, mats.boatDeck);
  cabin.position.set(0, 1.4, -0.5);
  cabin.castShadow = true;
  group.add(cabin);

  // Wrap-around bridge glass
  const bridgeGlass = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.45, 2.6),
    mats.darkGlass
  );
  bridgeGlass.position.set(0, 1.6, -0.7);
  group.add(bridgeGlass);

  // Radar arch / navigation mast
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.25), mats.boatChrome);
  mast.position.set(0, 2.05, 0.6);
  mast.rotateX(-0.2);
  group.add(mast);

  // Navigation lights on mast: Port (Red: -X) & Starboard (Green: +X)
  const navGeom = new THREE.SphereGeometry(0.09, 8, 8);
  const portLight = new THREE.Mesh(navGeom, mats.navLightRed);
  portLight.position.set(-0.8, 2.2, 0.6);
  const starLight = new THREE.Mesh(navGeom, mats.navLightGreen);
  starLight.position.set(0.8, 2.2, 0.6);
  group.add(portLight, starLight);

  return group;
}

/**
 * 4. Bus: Long-distance touring motorcoach
 */
export function createProceduralBus(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wayvora-model-bus';
  const mats = createMaterials();

  // Main coach body
  const bodyGeom = new THREE.BoxGeometry(2.4, 1.8, 8.8);
  const body = new THREE.Mesh(bodyGeom, mats.busBody);
  body.position.set(0, 1.35, 0);
  body.castShadow = true;
  group.add(body);

  // Roof cap
  const roofGeom = new THREE.BoxGeometry(2.35, 0.25, 8.6);
  const roof = new THREE.Mesh(roofGeom, mats.busRoof);
  roof.position.set(0, 2.35, 0);
  group.add(roof);

  // Panoramic front windscreen (facing -Z)
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.9, 0.2),
    mats.darkGlass
  );
  windshield.position.set(0, 1.6, -4.41);
  windshield.rotateX(0.12);
  group.add(windshield);

  // Side panoramic window bands
  const sideWindowGeom = new THREE.BoxGeometry(2.42, 0.7, 7.2);
  const sideWindows = new THREE.Mesh(sideWindowGeom, mats.darkGlass);
  sideWindows.position.set(0, 1.65, 0.2);
  group.add(sideWindows);

  // Roof AC units
  const acGeom = new THREE.BoxGeometry(1.6, 0.3, 2.4);
  const ac = new THREE.Mesh(acGeom, mats.busRoof);
  ac.position.set(0, 2.55, 0);
  group.add(ac);

  // Headlights & Taillights
  const hlLeft = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.08), mats.headlightBeam);
  hlLeft.position.set(-0.85, 0.75, -4.41);
  const hlRight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.08), mats.headlightBeam);
  hlRight.position.set(0.85, 0.75, -4.41);
  group.add(hlLeft, hlRight);

  const tlLeft = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.08), mats.taillightBeam);
  tlLeft.position.set(-0.85, 0.85, 4.41);
  const tlRight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.08), mats.taillightBeam);
  tlRight.position.set(0.85, 0.85, 4.41);
  group.add(tlLeft, tlRight);

  // 6 Wheels: 1 front axle, 2 rear dual axles
  const wheelGeom = new THREE.CylinderGeometry(0.45, 0.45, 0.32, 16);
  wheelGeom.rotateZ(Math.PI / 2);

  const wheelPositions: [number, number, number][] = [
    [-1.2, 0.45, -2.8], // Front Left
    [1.2, 0.45, -2.8],  // Front Right
    [-1.2, 0.45, 2.2],  // Rear Axle 1 Left
    [1.2, 0.45, 2.2],   // Rear Axle 1 Right
    [-1.2, 0.45, 3.3],  // Rear Axle 2 Left
    [1.2, 0.45, 3.3],   // Rear Axle 2 Right
  ];

  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeom, mats.rubberWheel);
    wheel.position.set(x, y, z);
    group.add(wheel);
  }

  return group;
}

/**
 * 5. Train: High-speed passenger bullet locomotive
 */
export function createProceduralTrain(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wayvora-model-train';
  const mats = createMaterials();

  // Main locomotive passenger car body
  const bodyGeom = new THREE.BoxGeometry(2.3, 1.9, 12.0);
  const body = new THREE.Mesh(bodyGeom, mats.trainBody);
  body.position.set(0, 1.4, 0);
  body.castShadow = true;
  group.add(body);

  // Aerodynamic bullet nose cone (facing forward: -Z)
  const noseGeom = new THREE.ConeGeometry(1.15, 3.6, 16);
  noseGeom.rotateX(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeom, mats.trainBody);
  nose.position.set(0, 1.25, -7.8);
  nose.scale.set(1.0, 0.75, 1.0);
  nose.castShadow = true;
  group.add(nose);

  // Driver cockpit cab glass
  const cabGlass = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.45, 1.8),
    mats.darkGlass
  );
  cabGlass.position.set(0, 1.8, -6.2);
  cabGlass.rotateX(0.2);
  group.add(cabGlass);

  // Crimson aerodynamic livery side stripe
  const stripeGeom = new THREE.BoxGeometry(2.34, 0.22, 11.8);
  const stripe = new THREE.Mesh(stripeGeom, mats.trainAccent);
  stripe.position.set(0, 1.1, 0);
  group.add(stripe);

  // Passenger window strip
  const windows = new THREE.Mesh(
    new THREE.BoxGeometry(2.32, 0.45, 9.6),
    mats.darkGlass
  );
  windows.position.set(0, 1.55, 0.8);
  group.add(windows);

  // Roof electric pantograph power collection unit
  const pantographBase = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.1, 1.6),
    mats.trainMetal
  );
  pantographBase.position.set(0, 2.4, 2.5);
  group.add(pantographBase);

  const pantographArm = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.55, 0.1),
    mats.trainMetal
  );
  pantographArm.position.set(0, 2.7, 2.5);
  group.add(pantographArm);

  // Bogie wheel skirts
  const skirtGeom = new THREE.BoxGeometry(2.35, 0.4, 2.8);
  const frontSkirt = new THREE.Mesh(skirtGeom, mats.trainMetal);
  frontSkirt.position.set(0, 0.35, -3.5);
  const rearSkirt = new THREE.Mesh(skirtGeom, mats.trainMetal);
  rearSkirt.position.set(0, 0.35, 3.5);
  group.add(frontSkirt, rearSkirt);

  return group;
}

/**
 * 6. Hiker: Alpine trekker with expedition rucksack & trekking poles
 */
export function createProceduralHiker(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wayvora-model-hiker';
  const mats = createMaterials();

  // Boots & Legs in trail trousers
  const legGeom = new THREE.BoxGeometry(0.32, 0.9, 0.35);
  const leftLeg = new THREE.Mesh(legGeom, mats.hikerTrousers);
  leftLeg.position.set(-0.25, 0.45, 0);
  const rightLeg = new THREE.Mesh(legGeom, mats.hikerTrousers);
  rightLeg.position.set(0.25, 0.45, 0);
  group.add(leftLeg, rightLeg);

  // Torso in vivid outdoor jacket
  const torsoGeom = new THREE.BoxGeometry(0.85, 0.95, 0.55);
  const torso = new THREE.Mesh(torsoGeom, mats.hikerJacket);
  torso.position.set(0, 1.35, 0);
  torso.castShadow = true;
  group.add(torso);

  // Expedition rucksack backpack (mounted on back: +Z)
  const packGeom = new THREE.BoxGeometry(0.8, 1.1, 0.65);
  const backpack = new THREE.Mesh(packGeom, mats.hikerBackpack);
  backpack.position.set(0, 1.45, 0.48);
  backpack.castShadow = true;
  group.add(backpack);

  // Sleeping pad roll on top of pack
  const rollGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.9, 12);
  rollGeom.rotateZ(Math.PI / 2);
  const roll = new THREE.Mesh(rollGeom, mats.hikerJacket);
  roll.position.set(0, 2.1, 0.48);
  group.add(roll);

  // Head and explorer brimmed hat
  const headGeom = new THREE.SphereGeometry(0.26, 12, 12);
  const head = new THREE.Mesh(headGeom, mats.hikerSkin);
  head.position.set(0, 2.05, 0);
  group.add(head);

  const hatBrim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, 0.06, 16),
    mats.hikerHat
  );
  hatBrim.position.set(0, 2.2, 0);
  const hatCrown = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.3, 0.25, 14),
    mats.hikerHat
  );
  hatCrown.position.set(0, 2.35, 0);
  group.add(hatBrim, hatCrown);

  // Dual trekking poles angled forward (-Z)
  const poleGeom = new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8);
  poleGeom.rotateX(0.25); // Angled forward
  const leftPole = new THREE.Mesh(poleGeom, mats.poleMetal);
  leftPole.position.set(-0.6, 0.7, -0.25);
  const rightPole = new THREE.Mesh(poleGeom, mats.poleMetal);
  rightPole.position.set(0.6, 0.7, -0.25);
  group.add(leftPole, rightPole);

  return group;
}

/**
 * 7. Motorcycle: Adventure touring motorcycle with rider & panniers
 */
export function createProceduralMotorcycle(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wayvora-model-motorcycle';
  const mats = createMaterials();

  // Wheels (Front: -Z, Rear: +Z)
  const wheelGeom = new THREE.CylinderGeometry(0.42, 0.42, 0.22, 16);
  wheelGeom.rotateZ(Math.PI / 2);

  const frontWheel = new THREE.Mesh(wheelGeom, mats.rubberWheel);
  frontWheel.position.set(0, 0.42, -1.3);
  const rearWheel = new THREE.Mesh(wheelGeom, mats.rubberWheel);
  rearWheel.position.set(0, 0.42, 1.3);
  group.add(frontWheel, rearWheel);

  // Steel trellis frame & engine block
  const frameGeom = new THREE.BoxGeometry(0.45, 0.55, 1.6);
  const frame = new THREE.Mesh(frameGeom, mats.motoFrame);
  frame.position.set(0, 0.65, 0);
  group.add(frame);

  // Fuel tank and seat
  const tankGeom = new THREE.BoxGeometry(0.55, 0.35, 0.75);
  const tank = new THREE.Mesh(tankGeom, mats.motoFairing);
  tank.position.set(0, 1.0, -0.3);
  group.add(tank);

  // Front fairing with windshield facing -Z
  const fairingGeom = new THREE.BoxGeometry(0.6, 0.65, 0.4);
  const fairing = new THREE.Mesh(fairingGeom, mats.motoFairing);
  fairing.position.set(0, 1.15, -0.9);
  group.add(fairing);

  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.45, 0.1),
    mats.darkGlass
  );
  windshield.position.set(0, 1.55, -0.95);
  windshield.rotateX(0.35);
  group.add(windshield);

  // Bright xenon headlight
  const headlight = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.2, 0.08),
    mats.headlightBeam
  );
  headlight.position.set(0, 1.05, -1.12);
  group.add(headlight);

  // Adventure luggage aluminum side panniers
  const pannierGeom = new THREE.BoxGeometry(0.32, 0.48, 0.65);
  const leftPannier = new THREE.Mesh(pannierGeom, mats.motoPannier);
  leftPannier.position.set(-0.55, 0.8, 1.1);
  const rightPannier = new THREE.Mesh(pannierGeom, mats.motoPannier);
  rightPannier.position.set(0.55, 0.8, 1.1);
  group.add(leftPannier, rightPannier);

  // Stylized rider with helmet leaning forward
  const riderTorso = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.65, 0.45),
    mats.darkGlass
  );
  riderTorso.position.set(0, 1.25, 0.15);
  riderTorso.rotateX(-0.25);
  const riderHelmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 12),
    mats.motoFairing
  );
  riderHelmet.position.set(0, 1.7, -0.1);
  group.add(riderTorso, riderHelmet);

  return group;
}

/**
 * 8. Bicycle: Touring road/gravel cyclist
 */
export function createProceduralBicycle(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wayvora-model-bicycle';
  const mats = createMaterials();

  // Thin large 700c wheels
  const wheelGeom = new THREE.CylinderGeometry(0.48, 0.48, 0.08, 18);
  wheelGeom.rotateZ(Math.PI / 2);

  const frontWheel = new THREE.Mesh(wheelGeom, mats.rubberWheel);
  frontWheel.position.set(0, 0.48, -1.05);
  const rearWheel = new THREE.Mesh(wheelGeom, mats.rubberWheel);
  rearWheel.position.set(0, 0.48, 1.05);
  group.add(frontWheel, rearWheel);

  // Diamond bicycle frame tubes
  const frameTubeGeom = new THREE.BoxGeometry(0.08, 0.08, 1.2);
  const topTube = new THREE.Mesh(frameTubeGeom, mats.bikeFrame);
  topTube.position.set(0, 0.95, 0);
  topTube.rotateX(0.12);

  const downTube = new THREE.Mesh(frameTubeGeom, mats.bikeFrame);
  downTube.position.set(0, 0.65, -0.2);
  downTube.rotateX(-0.6);

  const seatTube = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), mats.bikeFrame);
  seatTube.position.set(0, 0.8, 0.35);
  seatTube.rotateX(0.25);

  group.add(topTube, downTube, seatTube);

  // Handlebars
  const handlebar = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.06, 0.12),
    mats.rubberWheel
  );
  handlebar.position.set(0, 1.15, -0.9);
  group.add(handlebar);

  // Stylized cyclist in athletic cycling posture
  const cyclistTorso = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.55, 0.38),
    mats.cyclistJersey
  );
  cyclistTorso.position.set(0, 1.28, -0.15);
  cyclistTorso.rotateX(-0.45); // Leaning forward

  const cyclistHelmet = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.38, 10),
    mats.cyclistHelmet
  );
  cyclistHelmet.rotateX(-Math.PI / 2 + 0.3);
  cyclistHelmet.position.set(0, 1.62, -0.45);

  group.add(cyclistTorso, cyclistHelmet);

  return group;
}

/**
 * Procedural model factory for all 8 canonical modes.
 */
export function createProceduralModel(mode: CanonicalTransportMode): THREE.Group | null {
  switch (mode) {
    case 'car':
      return createProceduralCar();
    case 'airplane':
      return createProceduralAirplane();
    case 'boat':
      return createProceduralBoat();
    case 'bus':
      return createProceduralBus();
    case 'train':
      return createProceduralTrain();
    case 'hiker':
      return createProceduralHiker();
    case 'motorcycle':
      return createProceduralMotorcycle();
    case 'bicycle':
      return createProceduralBicycle();
    default:
      return null;
  }
}
