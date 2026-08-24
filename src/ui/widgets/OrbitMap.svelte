<script lang="ts">
  /**
   * Canvas orbit map (concept §9: "simple canvas orbit map").
   *
   * Draws Earth, the trajectory flown so far, and — once there is a closed
   * orbit — the ellipse the vehicle is on. The ellipse is sampled from the
   * same Kepler code the simulation flies, not approximated, so what the map
   * shows is what the vehicle is actually doing.
   */
  import { elementsToState, type OrbitalElements } from '../../sim/physics/kepler.js';
  import { EARTH_RADIUS_M, MU_EARTH } from '../../sim/physics/constants.js';
  import { TAU } from '../../sim/math.js';

  interface Props {
    position: { x: number; y: number };
    trail: { x: number; y: number }[];
    elements: OrbitalElements | null;
    apoapsisAltitude_m: number;
  }

  const { position, trail, elements, apoapsisAltitude_m }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    const element = canvas;
    if (element === undefined) return;

    const context = element.getContext('2d');
    if (context === null) return;

    const ratio = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    // Scale so the whole orbit fits with a margin, never closer than the globe.
    const furthest = Math.max(
      EARTH_RADIUS_M + Math.max(apoapsisAltitude_m, 0),
      EARTH_RADIUS_M * 1.06,
      Math.hypot(position.x, position.y),
    );
    const centreX = width / 2;
    const centreY = height / 2;
    const scale = (Math.min(width, height) / 2 - 14) / furthest;

    const toScreen = (x: number, y: number): [number, number] => [
      centreX + x * scale,
      centreY - y * scale,
    ];

    // Earth.
    context.beginPath();
    context.arc(centreX, centreY, EARTH_RADIUS_M * scale, 0, Math.PI * 2);
    context.fillStyle = 'rgba(60, 120, 150, 0.16)';
    context.fill();
    context.strokeStyle = 'rgba(120, 200, 230, 0.45)';
    context.lineWidth = 1;
    context.stroke();

    // The orbit, sampled through mean anomaly so the spacing is honest.
    if (elements !== null) {
      context.beginPath();
      for (let i = 0; i <= 180; i++) {
        const meanAnomaly = (TAU * i) / 180;
        const point = elementsToState({ ...elements, meanAnomaly_rad: meanAnomaly }, MU_EARTH);
        const [x, y] = toScreen(point.position.x, point.position.y);
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.strokeStyle = 'rgba(109, 252, 174, 0.55)';
      context.setLineDash([4, 4]);
      context.stroke();
      context.setLineDash([]);
    }

    // Flown trajectory.
    if (trail.length > 1) {
      context.beginPath();
      trail.forEach((point, index) => {
        const [x, y] = toScreen(point.x, point.y);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = 'rgba(255, 194, 92, 0.75)';
      context.lineWidth = 1.4;
      context.stroke();
    }

    // The vehicle.
    const [vx, vy] = toScreen(position.x, position.y);
    context.beginPath();
    context.arc(vx, vy, 3.2, 0, Math.PI * 2);
    context.fillStyle = '#e8fff2';
    context.fill();
    context.beginPath();
    context.arc(vx, vy, 6.5, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(232, 255, 242, 0.35)';
    context.stroke();
  });
</script>

<canvas bind:this={canvas} aria-label="Orbit map"></canvas>

<style>
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
