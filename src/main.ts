import Phaser from 'phaser';
import { GameScene, W, H } from './GameScene';
import { StartScene } from './StartScene';
import { MapScene } from './MapScene';
import { USE_3D } from './three/World3D';
import { setupDisplay } from './three/display';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: 'rgba(0,0,0,0)',
  transparent: true,
  // fullscreen takes the whole #game box, so the 3D and pixelated canvases next to Phaser's come along
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, fullscreenTarget: 'game' },
  input: { activePointers: 3 },
  // the drawing is kept after each frame so the pixelated display can copy it
  render: { antialias: true, roundPixels: false, preserveDrawingBuffer: true },
  scene: [StartScene, MapScene, GameScene],
});
(window as any).__phaserGame = game;
if (USE_3D) setupDisplay(game);
