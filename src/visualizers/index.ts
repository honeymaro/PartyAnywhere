import type { VisualizerInfo, VisualizerRegistry } from '../gl/registry';
import type { VisualizerFactory } from '../gl/visualizer';
import { createGradientPulse } from './gradient-pulse';
import { createSpectrumBars } from './spectrum-bars';
import { createPlasmaWave } from './plasma-wave';
import { createAuroraCurtains } from './aurora-curtains';
import { createLightningArcs } from './lightning-arcs';
import { createPlasmaInterferenceRgb } from './plasma-interference-rgb';
import { createSdfMetaballChrome } from './sdf-metaball-chrome';
import { createCliffordAttractor } from './clifford-attractor';
import { createWaveformRings } from './waveform-rings';
import { createQuilezPaletteFbmField } from './quilez-palette-fbm-field';
import { createCrtVhsTube } from './crt-vhs-tube';
import { createCurlFlowInk } from './curl-flow-ink';
import { createNebulaVolumetric } from './nebula-volumetric';
import { createGlitchDatamosh } from './glitch-datamosh';
import { createElectricWebNetwork } from './electric-web-network';
import { createAudioEqualizerSkyline } from './audio-equalizer-skyline';
import { createReactionDiffusionFaux } from './reaction-diffusion-faux';
import { createFerrofluidSpikes } from './ferrofluid-spikes';
import { createSineRibbonFlow } from './sine-ribbon-flow';
import { createFractalFlameSwirl } from './fractal-flame-swirl';
import { createGradientMeshBlob } from './gradient-mesh-blob';
import { createHexGridPulse } from './hex-grid-pulse';
import { createHexpansionRipple } from './hexpansion-ripple';
import { createHyperbolicPoincare } from './hyperbolic-poincare';
import { createStarfieldWarp } from './starfield-warp';
import { createIrisPortal } from './iris-portal';
import { createJuliaMorph } from './julia-morph';
import { createKaleidoMandala } from './kaleido-mandala';
import { createKifsOctahedron } from './kifs-octahedron';
import { createLiquidChromeFlow } from './liquid-chrome-flow';
import { createLiquidGlassRefract } from './liquid-glass-refract';
import { createLiquidMercuryPool } from './liquid-mercury-pool';
import { createVoronoiCellsLiving } from './voronoi-cells-living';
import { createMandelboxCave } from './mandelbox-cave';
import { createMandelbulbOrbit } from './mandelbulb-orbit';
import { createMengerTunnel } from './menger-tunnel';
import { createMetaballLava } from './metaball-lava';
import { createInterferenceMoire } from './interference-moire';
import { createOilSlickWarp } from './oil-slick-warp';
import { createPhyllotaxisSpiral } from './phyllotaxis-spiral';
import { createPrismDispersionBeams } from './prism-dispersion-beams';
import { createSpectrumRadialBars } from './spectrum-radial-bars';
import { createCausticsPool } from './caustics-pool';
import { createRetroGridHorizon } from './retro-grid-horizon';
import { createSmokePlumeRise } from './smoke-plume-rise';
import { createVoronoiShatterGlass } from './voronoi-shatter-glass';
import { createSpectralHelixDna } from './spectral-helix-dna';
import { createThinFilmBubble } from './thin-film-bubble';
import { createNoiseContourTopo } from './noise-contour-topo';
import { createTruchetWeave } from './truchet-weave';
import { createRaymarchTwistTunnel } from './raymarch-twist-tunnel';
import { createWatercolorBleed } from './watercolor-bleed';
import { createWoodGrainMarble } from './wood-grain-marble';
import { createWormholeNeon } from './wormhole-neon';
import { createWormholeCosmic } from './wormhole-cosmic';
import { createWormholeLensing } from './wormhole-lensing';

export interface VisualizerEntry {
  info: VisualizerInfo;
  factory: VisualizerFactory;
}

/** The canonical list of available visualizers, shared by the live host and the gallery. */
export const VISUALIZERS: VisualizerEntry[] = [
  { info: { id: 'gradient-pulse', name: 'Gradient Pulse' }, factory: createGradientPulse },
  { info: { id: 'spectrum-bars', name: 'Spectrum Bars' }, factory: createSpectrumBars },
  { info: { id: 'plasma-wave', name: 'Plasma Wave' }, factory: createPlasmaWave },
  { info: { id: 'aurora-curtains', name: 'Aurora Curtains' }, factory: createAuroraCurtains },
  { info: { id: 'lightning-arcs', name: 'Branching Lightning' }, factory: createLightningArcs },
  { info: { id: 'plasma-interference-rgb', name: 'Chromatic Plasma Interference' }, factory: createPlasmaInterferenceRgb },
  { info: { id: 'sdf-metaball-chrome', name: 'Chrome Metaball Sculpture' }, factory: createSdfMetaballChrome },
  { info: { id: 'clifford-attractor', name: 'Clifford Attractor Field' }, factory: createCliffordAttractor },
  { info: { id: 'waveform-rings', name: 'Concentric Waveform Rings' }, factory: createWaveformRings },
  { info: { id: 'quilez-palette-fbm-field', name: 'Cosine Palette Noise Field' }, factory: createQuilezPaletteFbmField },
  { info: { id: 'crt-vhs-tube', name: 'CRT VHS Tube' }, factory: createCrtVhsTube },
  { info: { id: 'curl-flow-ink', name: 'Curl Noise Ink Flow' }, factory: createCurlFlowInk },
  { info: { id: 'nebula-volumetric', name: 'Cyber-Organic Nebula' }, factory: createNebulaVolumetric },
  { info: { id: 'glitch-datamosh', name: 'Datamosh Glitch' }, factory: createGlitchDatamosh },
  { info: { id: 'electric-web-network', name: 'Electric Node Network' }, factory: createElectricWebNetwork },
  { info: { id: 'audio-equalizer-skyline', name: 'Equalizer Skyline' }, factory: createAudioEqualizerSkyline },
  { info: { id: 'reaction-diffusion-faux', name: 'Faux Reaction Diffusion' }, factory: createReactionDiffusionFaux },
  { info: { id: 'ferrofluid-spikes', name: 'Ferrofluid Spikes' }, factory: createFerrofluidSpikes },
  { info: { id: 'sine-ribbon-flow', name: 'Flowing Sine Ribbons' }, factory: createSineRibbonFlow },
  { info: { id: 'fractal-flame-swirl', name: 'Fractal Flame Swirl' }, factory: createFractalFlameSwirl },
  { info: { id: 'gradient-mesh-blob', name: 'Gradient Mesh Blobs' }, factory: createGradientMeshBlob },
  { info: { id: 'hex-grid-pulse', name: 'Hex Grid Pulse' }, factory: createHexGridPulse },
  { info: { id: 'hexpansion-ripple', name: 'Hex Ripple Expansion' }, factory: createHexpansionRipple },
  { info: { id: 'hyperbolic-poincare', name: 'Hyperbolic Poincare Tiling' }, factory: createHyperbolicPoincare },
  { info: { id: 'starfield-warp', name: 'Hyperspace Starfield' }, factory: createStarfieldWarp },
  { info: { id: 'iris-portal', name: 'Iridescent Iris Portal' }, factory: createIrisPortal },
  { info: { id: 'julia-morph', name: 'Julia Morph Travel' }, factory: createJuliaMorph },
  { info: { id: 'kaleido-mandala', name: 'Kaleidoscope Mandala' }, factory: createKaleidoMandala },
  { info: { id: 'kifs-octahedron', name: 'KIFS Octahedron Bloom' }, factory: createKifsOctahedron },
  { info: { id: 'liquid-chrome-flow', name: 'Liquid Chrome Flow' }, factory: createLiquidChromeFlow },
  { info: { id: 'liquid-glass-refract', name: 'Liquid Glass Refraction' }, factory: createLiquidGlassRefract },
  { info: { id: 'liquid-mercury-pool', name: 'Liquid Mercury Pool' }, factory: createLiquidMercuryPool },
  { info: { id: 'voronoi-cells-living', name: 'Living Voronoi Cells' }, factory: createVoronoiCellsLiving },
  { info: { id: 'mandelbox-cave', name: 'Mandelbox Crystal Cave' }, factory: createMandelboxCave },
  { info: { id: 'mandelbulb-orbit', name: 'Mandelbulb Alien Orbit' }, factory: createMandelbulbOrbit },
  { info: { id: 'menger-tunnel', name: 'Menger Sponge Tunnel' }, factory: createMengerTunnel },
  { info: { id: 'metaball-lava', name: 'Metaball Lava Lamp' }, factory: createMetaballLava },
  { info: { id: 'interference-moire', name: 'Moire Interference' }, factory: createInterferenceMoire },
  { info: { id: 'oil-slick-warp', name: 'Oil Slick Domain Warp' }, factory: createOilSlickWarp },
  { info: { id: 'phyllotaxis-spiral', name: 'Phyllotaxis Spiral Dots' }, factory: createPhyllotaxisSpiral },
  { info: { id: 'prism-dispersion-beams', name: 'Prism Dispersion Beams' }, factory: createPrismDispersionBeams },
  { info: { id: 'spectrum-radial-bars', name: 'Radial Spectrum Bars' }, factory: createSpectrumRadialBars },
  { info: { id: 'caustics-pool', name: 'Refractive Caustics Pool' }, factory: createCausticsPool },
  { info: { id: 'retro-grid-horizon', name: 'Retro Synthwave Grid' }, factory: createRetroGridHorizon },
  { info: { id: 'smoke-plume-rise', name: 'Rising Smoke Plume' }, factory: createSmokePlumeRise },
  { info: { id: 'voronoi-shatter-glass', name: 'Shattered Glass Voronoi' }, factory: createVoronoiShatterGlass },
  { info: { id: 'spectral-helix-dna', name: 'Spectral Helix DNA' }, factory: createSpectralHelixDna },
  { info: { id: 'thin-film-bubble', name: 'Thin-Film Soap Bubble' }, factory: createThinFilmBubble },
  { info: { id: 'noise-contour-topo', name: 'Topographic Contour Lines' }, factory: createNoiseContourTopo },
  { info: { id: 'truchet-weave', name: 'Truchet Arc Weave' }, factory: createTruchetWeave },
  { info: { id: 'raymarch-twist-tunnel', name: 'Twisting SDF Tunnel' }, factory: createRaymarchTwistTunnel },
  { info: { id: 'watercolor-bleed', name: 'Watercolor Bleed' }, factory: createWatercolorBleed },
  { info: { id: 'wood-grain-marble', name: 'Wood Grain and Marble' }, factory: createWoodGrainMarble },
  { info: { id: 'wormhole-neon', name: 'Neon Wormhole' }, factory: createWormholeNeon },
  { info: { id: 'wormhole-cosmic', name: 'Cosmic Wormhole' }, factory: createWormholeCosmic },
  { info: { id: 'wormhole-lensing', name: 'Lensing Wormhole' }, factory: createWormholeLensing },
];

export function registerAll(registry: VisualizerRegistry): void {
  for (const v of VISUALIZERS) registry.register(v.info, v.factory);
}
