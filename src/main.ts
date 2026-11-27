import Phaser from 'phaser';
import { GameScene, W, H } from './GameScene';
import { StartScene } from './StartScene';
import { MapScene } from './MapScene';

(window as any).__phaserGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: 'rgba(0,0,0,0)',
  transparent: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: 3 },
  render: { antialias: true, roundPixels: false },
  scene: [StartScene, MapScene, GameScene],
});
